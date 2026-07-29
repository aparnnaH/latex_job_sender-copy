package com.applyflow.backend.worker;

import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.service.DocumentServiceClient;
import com.applyflow.backend.service.DocumentServiceException;
import com.applyflow.backend.service.PythonTailoringClient;
import com.applyflow.backend.service.PythonTailoringResult;
import com.applyflow.backend.service.ResumeFileStorageService;
import com.applyflow.backend.service.ResumeVersionService;
import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.nio.file.Path;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.core.Message;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class ResumeTailoringWorker {

    private final ResumeVersionService resumeVersionService;
    private final DocumentServiceClient documentServiceClient;
    private final PythonTailoringClient pythonTailoringClient;
    private final ResumeFileStorageService storageService;
    private final ApplyFlowProperties properties;

    @RabbitListener(queues = "${applyflow.rabbitmq.queue}")
    public void handle(ResumeTailoringRequestedEvent event, Message message, Channel channel) throws IOException {
        var deliveryTag = message.getMessageProperties().getDeliveryTag();
        var attempt = resumeVersionService.beginProcessing(event.resumeVersionId());
        if (attempt.isEmpty()) {
            log.info("Skipping duplicate or already-processed resume tailoring event for version {}", event.resumeVersionId());
            channel.basicAck(deliveryTag, false);
            return;
        }

        var outputPath = Path.of(event.outputResumePath());
        try {
            var result = documentServiceClient.tailor(new DocumentServiceClient.DocumentProcessingRequest(
                    UUID.randomUUID(),
                    event.jobApplicationId(),
                    event.resumeVersionId(),
                    Path.of(event.inputResumePath()).getFileName().toString(),
                    Path.of(event.inputResumePath()),
                    event.jobDescription(),
                    "{}",
                    properties.documentService().compilePdf()));

            if (result.completed()) {
                resumeVersionService.markCompleted(
                        event.resumeVersionId(),
                        outputPath.toString(),
                        result.documentId() == null ? null : result.documentId().toString(),
                        result.reportJson(),
                        result.tailoredTex());
                log.info("Document service tailoring completed for version {}", event.resumeVersionId());
                channel.basicAck(deliveryTag, false);
                return;
            }

            var errorCode = result.errorCode() == null ? "DOCUMENT_SERVICE_UNAVAILABLE" : result.errorCode();
            var safeMessage = result.safeErrorMessage() == null
                    ? "The document service could not tailor the resume."
                    : result.safeErrorMessage();
            finishFailure(event, deliveryTag, channel, attempt.get(), result.retryable(), errorCode, safeMessage);
            return;
        } catch (DocumentServiceException exception) {
            if (!properties.documentService().pythonFallbackEnabled()) {
                finishFailure(event, deliveryTag, channel, attempt.get(), exception.retryable(), exception.code(), exception.safeMessage());
                return;
            }
            log.warn("Document service failed for version {}; using development Python fallback", event.resumeVersionId());
        }

        PythonTailoringResult result = null;
        var maxAttempts = Math.max(1, properties.tailoring().maxAttempts());

        for (int attempt = 1; attempt <= maxAttempts; attempt += 1) {
            result = pythonTailoringClient.tailor(
                    Path.of(event.inputResumePath()),
                    event.jobDescription(),
                    outputPath);

            if (result.succeeded() && outputPath.toFile().exists()) {
                resumeVersionService.markCompleted(event.resumeVersionId(), outputPath.toString());
                log.info("Resume tailoring completed for version {} in {} ms", event.resumeVersionId(), result.duration().toMillis());
                channel.basicAck(deliveryTag, false);
                return;
            }

            storageService.deleteIfExists(outputPath);
            log.warn("Resume tailoring attempt {} of {} failed for version {} in {} ms", attempt, maxAttempts, event.resumeVersionId(), result.duration().toMillis());
        }

        var reason = result != null && result.timedOut()
                ? "Python tailoring timed out."
                : "Python tailoring failed with exit code " + (result == null ? "unknown" : result.exitCode()) + ".";
        var code = result != null && result.timedOut() ? "PYTHON_PROCESS_TIMEOUT" : "PYTHON_PROCESS_FAILED";
        finishFailure(event, deliveryTag, channel, attempt.get(), result != null && result.timedOut(), code, reason);
    }

    private void finishFailure(
            ResumeTailoringRequestedEvent event,
            long deliveryTag,
            Channel channel,
            int attempt,
            boolean retryable,
            String errorCode,
            String safeMessage) throws IOException {
        var maxAttempts = Math.max(1, properties.tailoring().maxAttempts());
        if (retryable && attempt < maxAttempts) {
            resumeVersionService.markPendingForRetry(event.resumeVersionId(), errorCode, safeMessage);
            log.warn("Retrying resume tailoring version {} after attempt {} of {}", event.resumeVersionId(), attempt, maxAttempts);
            channel.basicNack(deliveryTag, false, true);
            return;
        }

        resumeVersionService.markFailed(event.resumeVersionId(), errorCode, safeMessage);
        log.warn("Resume tailoring version {} failed after attempt {} of {}", event.resumeVersionId(), attempt, maxAttempts);
        channel.basicReject(deliveryTag, false);
    }
}
