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
        var startedAt = System.nanoTime();
        log.info("stage=tailoring.rabbit.received requestId={} applicationId={} resumeVersionId={}",
                event.requestId(), event.jobApplicationId(), event.resumeVersionId());
        var attempt = resumeVersionService.beginProcessing(event.resumeVersionId());
        if (attempt.isEmpty()) {
            log.info("stage=tailoring.skipped requestId={} applicationId={} resumeVersionId={} durationMs={}",
                    event.requestId(), event.jobApplicationId(), event.resumeVersionId(), elapsedMs(startedAt));
            channel.basicAck(deliveryTag, false);
            return;
        }

        var outputPath = Path.of(event.outputResumePath());
        try {
            var result = documentServiceClient.tailor(new DocumentServiceClient.DocumentProcessingRequest(
                    event.requestId(),
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
                log.info("stage=tailoring.completed requestId={} applicationId={} resumeVersionId={} documentId={} durationMs={}",
                        event.requestId(), event.jobApplicationId(), event.resumeVersionId(), result.documentId(), elapsedMs(startedAt));
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
                log.warn("stage=document-service.error requestId={} applicationId={} resumeVersionId={} safeErrorCode={} durationMs={}",
                        event.requestId(), event.jobApplicationId(), event.resumeVersionId(), exception.code(), elapsedMs(startedAt), exception);
                finishFailure(event, deliveryTag, channel, attempt.get(), exception.retryable(), exception.code(), exception.safeMessage());
                return;
            }
            log.warn("stage=document-service.fallback requestId={} applicationId={} resumeVersionId={} safeErrorCode={} durationMs={}",
                    event.requestId(), event.jobApplicationId(), event.resumeVersionId(), exception.code(), elapsedMs(startedAt), exception);
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
                log.info("stage=python-fallback.completed requestId={} applicationId={} resumeVersionId={} durationMs={}",
                        event.requestId(), event.jobApplicationId(), event.resumeVersionId(), result.duration().toMillis());
                channel.basicAck(deliveryTag, false);
                return;
            }

            storageService.deleteIfExists(outputPath);
            log.warn("stage=python-fallback.attempt-failed requestId={} applicationId={} resumeVersionId={} attempt={} maxAttempts={} safeErrorCode={} durationMs={}",
                    event.requestId(), event.jobApplicationId(), event.resumeVersionId(), attempt, maxAttempts,
                    result.timedOut() ? "PYTHON_PROCESS_TIMEOUT" : "PYTHON_PROCESS_FAILED", result.duration().toMillis());
        }

        var reason = result != null && result.timedOut()
                ? "Python tailoring timed out."
                : "Python tailoring failed with exit code " + (result == null ? "unknown" : result.exitCode()) + ".";
        var code = result != null && result.timedOut() ? "PYTHON_PROCESS_TIMEOUT" : "PYTHON_PROCESS_FAILED";
        finishFailure(event, deliveryTag, channel, attempt.get(), result != null && result.timedOut(), code, reason);
    }

    private long elapsedMs(long startedAt) {
        return java.time.Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
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
            log.warn("stage=tailoring.retry requestId={} applicationId={} resumeVersionId={} attempt={} maxAttempts={} safeErrorCode={}",
                    event.requestId(), event.jobApplicationId(), event.resumeVersionId(), attempt, maxAttempts, errorCode);
            channel.basicNack(deliveryTag, false, true);
            return;
        }

        resumeVersionService.markFailed(event.resumeVersionId(), errorCode, safeMessage);
        log.warn("stage=tailoring.failed requestId={} applicationId={} resumeVersionId={} attempt={} maxAttempts={} safeErrorCode={}",
                event.requestId(), event.jobApplicationId(), event.resumeVersionId(), attempt, maxAttempts, errorCode);
        channel.basicReject(deliveryTag, false);
    }
}
