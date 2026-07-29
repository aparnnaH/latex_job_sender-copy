package com.applyflow.backend.worker;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.service.DocumentServiceClient;
import com.applyflow.backend.service.DocumentServiceException;
import com.applyflow.backend.service.PythonTailoringClient;
import com.applyflow.backend.service.PythonTailoringResult;
import com.applyflow.backend.service.ResumeFileStorageService;
import com.applyflow.backend.service.ResumeVersionService;
import com.rabbitmq.client.Channel;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;

@ExtendWith(MockitoExtension.class)
class ResumeTailoringWorkerTest {

    @Mock
    private ResumeVersionService resumeVersionService;
    @Mock
    private DocumentServiceClient documentServiceClient;
    @Mock
    private PythonTailoringClient pythonTailoringClient;
    @Mock
    private ResumeFileStorageService storageService;
    @Mock
    private Channel channel;

    private ResumeTailoringWorker worker;

    @TempDir
    private Path tempDir;

    @BeforeEach
    void setUp() {
        var properties = properties(false);
        worker = new ResumeTailoringWorker(resumeVersionService, documentServiceClient, pythonTailoringClient, storageService, properties);
    }

    @Test
    void successfulProcessingUsesDocumentServiceAndMarksCompleted() throws Exception {
        var event = event();
        var documentId = UUID.randomUUID();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(1));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new DocumentServiceClient.DocumentProcessingResult(
                        documentId,
                        DocumentServiceClient.DocumentProcessingStatus.COMPLETED,
                        "\\documentclass{article}",
                        "{\"matchScoreBefore\":20,\"matchScoreAfter\":80}",
                        null,
                        null,
                        false));

        worker.handle(event, message(), channel);

        verify(resumeVersionService).markCompleted(
                event.resumeVersionId(),
                event.outputResumePath(),
                documentId.toString(),
                "{\"matchScoreBefore\":20,\"matchScoreAfter\":80}",
                "\\documentclass{article}");
        verify(channel).basicAck(99L, false);
        verify(pythonTailoringClient, never()).tailor(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void temporaryFailureRequeuesUntilMaximumRetryCount() throws Exception {
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(1));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new DocumentServiceClient.DocumentProcessingResult(
                        UUID.randomUUID(),
                        DocumentServiceClient.DocumentProcessingStatus.FAILED,
                        null,
                        null,
                        "DOCUMENT_SERVICE_UNAVAILABLE",
                        "The document service is temporarily unavailable.",
                        true));

        worker.handle(event, message(), channel);

        verify(resumeVersionService).markPendingForRetry(
                event.resumeVersionId(),
                "DOCUMENT_SERVICE_UNAVAILABLE",
                "The document service is temporarily unavailable.");
        verify(channel).basicNack(99L, false, true);
    }

    @Test
    void permanentFailureMarksFailedAndRejectsToDeadLetterPath() throws Exception {
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(1));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new DocumentServiceClient.DocumentProcessingResult(
                        UUID.randomUUID(),
                        DocumentServiceClient.DocumentProcessingStatus.FAILED,
                        null,
                        null,
                        "PYTHON_RESULT_INVALID",
                        "The tailoring result was invalid.",
                        false));

        worker.handle(event, message(), channel);

        verify(resumeVersionService).markFailed(event.resumeVersionId(), "PYTHON_RESULT_INVALID", "The tailoring result was invalid.");
        verify(channel).basicReject(99L, false);
    }

    private ApplyFlowProperties properties(boolean pythonFallbackEnabled) {
        return new ApplyFlowProperties(
                new ApplyFlowProperties.Storage(tempDir, 1_048_576),
                new ApplyFlowProperties.Tailoring("python3", tempDir.resolve("tailor.py"), Duration.ofSeconds(1), 3),
                new ApplyFlowProperties.DocumentService("http://localhost:5000", Duration.ofSeconds(1), pythonFallbackEnabled, true),
                new ApplyFlowProperties.Rabbit("exchange", "queue", "routing", "dlx", "dlq"));
    }

    @Test
    void successfulProcessingMarksCompleted() throws Exception {
        worker = new ResumeTailoringWorker(resumeVersionService, documentServiceClient, pythonTailoringClient, storageService, properties(true));
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(1));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new DocumentServiceException("DOCUMENT_SERVICE_UNAVAILABLE", "The document service is unavailable.", true));
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(0, "ok", "", Duration.ofMillis(50), false));
        java.nio.file.Files.createDirectories(Path.of(event.outputResumePath()).getParent());
        java.nio.file.Files.writeString(Path.of(event.outputResumePath()), "tailored");

        worker.handle(event, message(), channel);

        verify(resumeVersionService).markCompleted(event.resumeVersionId(), event.outputResumePath());
        verify(channel).basicAck(99L, false);
        verify(resumeVersionService, never()).markFailed(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void pythonFailureMarksFailedAndDeletesOutput() throws Exception {
        worker = new ResumeTailoringWorker(resumeVersionService, documentServiceClient, pythonTailoringClient, storageService, properties(true));
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(3));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new DocumentServiceException("DOCUMENT_SERVICE_UNAVAILABLE", "The document service is unavailable.", true));
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(2, "", "failed", Duration.ofMillis(50), false));

        worker.handle(event, message(), channel);

        verify(storageService).deleteIfExists(Path.of(event.outputResumePath()));
        verify(resumeVersionService).markFailed(event.resumeVersionId(), "PYTHON_PROCESS_FAILED", "Python tailoring failed with exit code 2.");
        verify(channel).basicReject(99L, false);
    }

    @Test
    void timeoutMarksFailedAndDeletesOutput() throws Exception {
        worker = new ResumeTailoringWorker(resumeVersionService, documentServiceClient, pythonTailoringClient, storageService, properties(true));
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.of(3));
        when(documentServiceClient.tailor(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new DocumentServiceException("DOCUMENT_SERVICE_UNAVAILABLE", "The document service is unavailable.", true));
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(-1, "", "timeout", Duration.ofSeconds(60), true));

        worker.handle(event, message(), channel);

        verify(storageService).deleteIfExists(Path.of(event.outputResumePath()));
        verify(resumeVersionService).markFailed(event.resumeVersionId(), "PYTHON_PROCESS_TIMEOUT", "Python tailoring timed out.");
        verify(channel).basicReject(99L, false);
    }

    @Test
    void duplicateMessageDoesNotCreateRepeatedOutput() throws Exception {
        var event = event();
        when(resumeVersionService.beginProcessing(event.resumeVersionId())).thenReturn(java.util.Optional.empty());

        worker.handle(event, message(), channel);

        verify(documentServiceClient, never()).tailor(org.mockito.ArgumentMatchers.any());
        verify(pythonTailoringClient, never()).tailor(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
        verify(resumeVersionService, never()).markCompleted(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        verify(channel).basicAck(99L, false);
    }

    private Message message() {
        var properties = new MessageProperties();
        properties.setDeliveryTag(99L);
        return new Message(new byte[0], properties);
    }

    private ResumeTailoringRequestedEvent event() {
        var versionId = UUID.randomUUID();
        return new ResumeTailoringRequestedEvent(
                UUID.randomUUID(),
                UUID.randomUUID(),
                versionId,
                tempDir.resolve("input.tex").toString(),
                "Build Java services",
                tempDir.resolve(versionId.toString()).resolve("output.tex").toString());
    }
}
