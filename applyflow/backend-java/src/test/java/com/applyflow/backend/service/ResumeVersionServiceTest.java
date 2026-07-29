package com.applyflow.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.entity.JobApplication;
import com.applyflow.backend.entity.TailoringStatus;
import com.applyflow.backend.event.ResumeTailoringRequestedEvent;
import com.applyflow.backend.repository.JobApplicationRepository;
import com.applyflow.backend.repository.ResumeVersionRepository;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

@ExtendWith(MockitoExtension.class)
class ResumeVersionServiceTest {

    @Mock
    private JobApplicationRepository jobApplicationRepository;
    @Mock
    private ResumeVersionRepository resumeVersionRepository;
    @Mock
    private ResumeFileStorageService storageService;
    @Mock
    private ResumeTailoringEventPublisher eventPublisher;
    private ResumeVersionService service;
    private String currentUserId;

    @BeforeEach
    void setUp() {
        currentUserId = "development-user-a";
        service = new ResumeVersionService(
                jobApplicationRepository,
                resumeVersionRepository,
                storageService,
                eventPublisher,
                new ResumeVersionMapper(),
                () -> currentUserId);
    }

    @Test
    void requestTailoringCreatesVersionAndPublishesEvent() {
        var application = application();
        var file = new MockMultipartFile("resume", "resume.tex", "application/x-tex", "\\documentclass{article}".getBytes());
        when(jobApplicationRepository.findByIdAndOwnerUserId(application.getId(), "development-user-a")).thenReturn(Optional.of(application));
        when(resumeVersionRepository.countByJobApplicationIdAndOwnerUserId(application.getId(), "development-user-a")).thenReturn(2L);
        when(storageService.storeInput(any(), any(), any()))
                .thenReturn(new ResumeFileStorageService.StoredResumeFiles(Path.of("input.tex"), Path.of("output.tex")));
        when(resumeVersionRepository.save(any())).thenAnswer(invocation -> {
            var version = invocation.<com.applyflow.backend.entity.ResumeVersion>getArgument(0);
            version.setCreatedAt(OffsetDateTime.now());
            version.setUpdatedAt(OffsetDateTime.now());
            return version;
        });

        ResumeVersionResponse response = service.requestTailoring(application.getId(), file);

        assertThat(response.tailoringStatus()).isEqualTo(TailoringStatus.PENDING);
        assertThat(response.processingStatus()).isEqualTo(TailoringStatus.PENDING);
        assertThat(response.baseResumeName()).isEqualTo("resume.tex");
        assertThat(response.documentServiceId()).isNull();
        assertThat(response.versionNumber()).isEqualTo(3);

        ArgumentCaptor<com.applyflow.backend.entity.ResumeVersion> versionCaptor =
                ArgumentCaptor.forClass(com.applyflow.backend.entity.ResumeVersion.class);
        verify(resumeVersionRepository).save(versionCaptor.capture());
        assertThat(versionCaptor.getValue().getOwnerUserId()).isEqualTo("development-user-a");

        ArgumentCaptor<ResumeTailoringRequestedEvent> eventCaptor = ArgumentCaptor.forClass(ResumeTailoringRequestedEvent.class);
        verify(eventPublisher).publish(eventCaptor.capture());
        assertThat(eventCaptor.getValue().jobApplicationId()).isEqualTo(application.getId());
        assertThat(eventCaptor.getValue().jobDescription()).isEqualTo(application.getJobDescription());
        assertThat(eventCaptor.getValue().inputResumePath()).isEqualTo("input.tex");
        assertThat(eventCaptor.getValue().outputResumePath()).isEqualTo("output.tex");
    }

    @Test
    void requestTailoringDoesNotUseAnotherDevelopmentUsersApplication() {
        var applicationId = UUID.randomUUID();
        var file = new MockMultipartFile("resume", "resume.tex", "application/x-tex", "\\documentclass{article}".getBytes());
        when(jobApplicationRepository.findByIdAndOwnerUserId(applicationId, "development-user-a")).thenReturn(Optional.empty());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.requestTailoring(applicationId, file))
                .isInstanceOf(com.applyflow.backend.exception.ResourceNotFoundException.class);
    }

    @Test
    void findByIdDoesNotReturnAnotherDevelopmentUsersResumeVersion() {
        var resumeVersionId = UUID.randomUUID();
        when(resumeVersionRepository.findByIdAndOwnerUserId(resumeVersionId, "development-user-a")).thenReturn(Optional.empty());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.findById(resumeVersionId))
                .isInstanceOf(com.applyflow.backend.exception.ResourceNotFoundException.class);
    }

    private JobApplication application() {
        var application = new JobApplication();
        application.setId(UUID.randomUUID());
        application.setOwnerUserId("development-user-a");
        application.setCompany("Acme");
        application.setJobTitle("Backend Engineer");
        application.setJobDescription("Build Java services");
        application.setStatus(com.applyflow.backend.entity.JobApplicationStatus.SAVED);
        application.setCreatedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        return application;
    }
}
