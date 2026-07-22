package com.applyflow.backend.worker;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.service.PythonTailoringClient;
import com.applyflow.backend.service.PythonTailoringResult;
import com.applyflow.backend.service.ResumeFileStorageService;
import com.applyflow.backend.service.ResumeVersionService;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;

@ExtendWith(MockitoExtension.class)
class ResumeTailoringWorkerTest {

    @Mock
    private ResumeVersionService resumeVersionService;
    @Mock
    private PythonTailoringClient pythonTailoringClient;
    @Mock
    private ResumeFileStorageService storageService;

    private ResumeTailoringWorker worker;

    @TempDir
    private Path tempDir;

    @BeforeEach
    void setUp() {
        var properties = new ApplyFlowProperties(
                new ApplyFlowProperties.Storage(tempDir, 1_048_576),
                new ApplyFlowProperties.Tailoring("python3", tempDir.resolve("tailor.py"), Duration.ofSeconds(1), 1),
                new ApplyFlowProperties.Rabbit("exchange", "queue", "routing", "dlx", "dlq"));
        worker = new ResumeTailoringWorker(resumeVersionService, pythonTailoringClient, storageService, properties);
    }

    @Test
    void successfulProcessingMarksCompleted() throws Exception {
        var event = event();
        when(resumeVersionService.markProcessing(event.resumeVersionId())).thenReturn(true);
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(0, "ok", "", Duration.ofMillis(50), false));
        java.nio.file.Files.createDirectories(Path.of(event.outputResumePath()).getParent());
        java.nio.file.Files.writeString(Path.of(event.outputResumePath()), "tailored");

        worker.handle(event);

        verify(resumeVersionService).markCompleted(event.resumeVersionId(), event.outputResumePath());
        verify(resumeVersionService, never()).markFailed(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void pythonFailureMarksFailedAndDeletesOutput() {
        var event = event();
        when(resumeVersionService.markProcessing(event.resumeVersionId())).thenReturn(true);
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(2, "", "failed", Duration.ofMillis(50), false));

        assertThatThrownBy(() -> worker.handle(event)).isInstanceOf(AmqpRejectAndDontRequeueException.class);

        verify(storageService).deleteIfExists(Path.of(event.outputResumePath()));
        verify(resumeVersionService).markFailed(event.resumeVersionId(), "Python tailoring failed with exit code 2.");
    }

    @Test
    void timeoutMarksFailedAndDeletesOutput() {
        var event = event();
        when(resumeVersionService.markProcessing(event.resumeVersionId())).thenReturn(true);
        when(pythonTailoringClient.tailor(Path.of(event.inputResumePath()), event.jobDescription(), Path.of(event.outputResumePath())))
                .thenReturn(new PythonTailoringResult(-1, "", "timeout", Duration.ofSeconds(60), true));

        assertThatThrownBy(() -> worker.handle(event)).isInstanceOf(AmqpRejectAndDontRequeueException.class);

        verify(storageService).deleteIfExists(Path.of(event.outputResumePath()));
        verify(resumeVersionService).markFailed(event.resumeVersionId(), "Python tailoring timed out.");
    }

    @Test
    void duplicateMessageDoesNotCallPython() {
        var event = event();
        when(resumeVersionService.markProcessing(event.resumeVersionId())).thenReturn(false);

        worker.handle(event);

        verify(pythonTailoringClient, never()).tailor(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    private ResumeTailoringRequestedEvent event() {
        var versionId = UUID.randomUUID();
        return new ResumeTailoringRequestedEvent(
                UUID.randomUUID(),
                versionId,
                tempDir.resolve("input.tex").toString(),
                "Build Java services",
                tempDir.resolve(versionId.toString()).resolve("output.tex").toString());
    }
}
