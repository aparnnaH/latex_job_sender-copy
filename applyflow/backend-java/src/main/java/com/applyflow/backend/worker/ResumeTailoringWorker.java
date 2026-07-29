package com.applyflow.backend.worker;

import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.service.DocumentServiceClient;
import com.applyflow.backend.service.DocumentServiceException;
import com.applyflow.backend.service.PythonTailoringClient;
import com.applyflow.backend.service.PythonTailoringResult;
import com.applyflow.backend.service.ResumeFileStorageService;
import com.applyflow.backend.service.ResumeVersionService;
import java.nio.file.Path;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
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
    public void handle(ResumeTailoringRequestedEvent event) {
        if (!resumeVersionService.markProcessing(event.resumeVersionId())) {
            log.info("Skipping duplicate or already-processed resume tailoring event for version {}", event.resumeVersionId());
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
                        result.documentId() == null ? null : result.documentId().toString());
                log.info("Document service tailoring completed for version {}", event.resumeVersionId());
                return;
            }

            var errorCode = result.errorCode() == null ? "DOCUMENT_SERVICE_UNAVAILABLE" : result.errorCode();
            var safeMessage = result.safeErrorMessage() == null
                    ? "The document service could not tailor the resume."
                    : result.safeErrorMessage();
            resumeVersionService.markFailed(event.resumeVersionId(), errorCode, safeMessage);
            throw new AmqpRejectAndDontRequeueException(safeMessage);
        } catch (DocumentServiceException exception) {
            if (!properties.documentService().pythonFallbackEnabled()) {
                resumeVersionService.markFailed(event.resumeVersionId(), exception.code(), exception.safeMessage());
                throw new AmqpRejectAndDontRequeueException(exception.safeMessage(), exception);
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
                return;
            }

            storageService.deleteIfExists(outputPath);
            log.warn("Resume tailoring attempt {} of {} failed for version {} in {} ms", attempt, maxAttempts, event.resumeVersionId(), result.duration().toMillis());
        }

        var reason = result != null && result.timedOut()
                ? "Python tailoring timed out."
                : "Python tailoring failed with exit code " + (result == null ? "unknown" : result.exitCode()) + ".";
        var code = result != null && result.timedOut() ? "PYTHON_PROCESS_TIMEOUT" : "PYTHON_PROCESS_FAILED";
        resumeVersionService.markFailed(event.resumeVersionId(), code, reason);
        throw new AmqpRejectAndDontRequeueException(reason);
    }
}
