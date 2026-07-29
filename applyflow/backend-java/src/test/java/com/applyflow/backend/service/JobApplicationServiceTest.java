package com.applyflow.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.applyflow.backend.dto.JobApplicationPatchRequest;
import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.dto.JobApplicationSearchRequest;
import com.applyflow.backend.entity.JobApplication;
import com.applyflow.backend.entity.JobApplicationStatus;
import com.applyflow.backend.exception.InvalidRequestException;
import com.applyflow.backend.exception.ResourceNotFoundException;
import com.applyflow.backend.repository.JobApplicationRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;

@ExtendWith(MockitoExtension.class)
class JobApplicationServiceTest {

    @Mock
    private JobApplicationRepository repository;

    private JobApplicationService service;
    private String currentUserId;

    @BeforeEach
    void setUp() {
        currentUserId = "development-user-a";
        service = new JobApplicationService(repository, () -> currentUserId);
    }

    @Test
    void createStoresApplicationWithSavedStatus() {
        when(repository.save(any(JobApplication.class))).thenAnswer(invocation -> persisted(invocation.getArgument(0)));

        var response = service.create(new JobApplicationRequest(
                "Acme",
                "Backend Engineer",
                "Build Spring services",
                "https://example.com/job",
                "Toronto, ON",
                "LinkedIn",
                OffsetDateTime.parse("2026-07-28T12:00:00Z"),
                null,
                "Promising platform role",
                "backend-resume.tex"
        ));

        assertThat(response.company()).isEqualTo("Acme");
        assertThat(response.status()).isEqualTo(JobApplicationStatus.SAVED);
        assertThat(response.location()).isEqualTo("Toronto, ON");
        assertThat(response.source()).isEqualTo("LinkedIn");
        assertThat(response.dateFound()).isEqualTo(OffsetDateTime.parse("2026-07-28T12:00:00Z"));
        assertThat(response.notes()).isEqualTo("Promising platform role");
        assertThat(response.resumeUsed()).isEqualTo("backend-resume.tex");

        ArgumentCaptor<JobApplication> captor = ArgumentCaptor.forClass(JobApplication.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getOwnerUserId()).isEqualTo("development-user-a");
        assertThat(captor.getValue().getJobTitle()).isEqualTo("Backend Engineer");
        assertThat(captor.getValue().getLocation()).isEqualTo("Toronto, ON");
    }

    @Test
    void updateStatusChangesOnlyStatus() {
        var id = UUID.randomUUID();
        var existing = application(id);
        when(repository.findByIdAndOwnerUserId(id, "development-user-a")).thenReturn(Optional.of(existing));
        when(repository.save(existing)).thenAnswer(invocation -> invocation.getArgument(0));

        var response = service.updateStatus(id, JobApplicationStatus.INTERVIEW);

        assertThat(response.status()).isEqualTo(JobApplicationStatus.INTERVIEW);
        assertThat(response.company()).isEqualTo("Acme");
    }

    @Test
    void findByIdDoesNotReturnAnotherDevelopmentUsersApplication() {
        var id = UUID.randomUUID();
        when(repository.findByIdAndOwnerUserId(id, "development-user-a")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findById(id))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void findAllUsesPaginationAndFilters() {
        var application = application(UUID.randomUUID());
        var pageable = PageRequest.of(0, 10);
        when(repository.findAll(any(Specification.class), eq(pageable)))
                .thenReturn(new PageImpl<>(List.of(application), pageable, 1));

        var response = service.findAll(new JobApplicationSearchRequest(
                JobApplicationStatus.SAVED,
                "ac",
                "Company site",
                OffsetDateTime.now().minusDays(7),
                OffsetDateTime.now()), pageable);

        assertThat(response.getTotalElements()).isEqualTo(1);
        assertThat(response.getContent().getFirst().company()).isEqualTo("Acme");
    }

    @Test
    void patchUpdatesOnlyProvidedFields() {
        var id = UUID.randomUUID();
        var existing = application(id);
        when(repository.findByIdAndOwnerUserId(id, "development-user-a")).thenReturn(Optional.of(existing));
        when(repository.save(existing)).thenAnswer(invocation -> invocation.getArgument(0));

        var response = service.patch(id, new JobApplicationPatchRequest(
                null,
                "Staff Backend Engineer",
                null,
                null,
                "Remote",
                null,
                null,
                null,
                "Keep warm",
                null));

        assertThat(response.company()).isEqualTo("Acme");
        assertThat(response.jobTitle()).isEqualTo("Staff Backend Engineer");
        assertThat(response.location()).isEqualTo("Remote");
        assertThat(response.notes()).isEqualTo("Keep warm");
    }

    @Test
    void patchRejectsBlankRequiredFields() {
        var id = UUID.randomUUID();
        when(repository.findByIdAndOwnerUserId(id, "development-user-a")).thenReturn(Optional.of(application(id)));

        assertThatThrownBy(() -> service.patch(id, new JobApplicationPatchRequest(
                "",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null)))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("company");
    }

    @Test
    void findByIdThrowsWhenMissing() {
        var id = UUID.randomUUID();
        when(repository.findByIdAndOwnerUserId(id, "development-user-a")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findById(id))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(id.toString());
    }

    @Test
    void deleteThrowsWhenMissing() {
        var id = UUID.randomUUID();
        when(repository.existsByIdAndOwnerUserId(id, "development-user-a")).thenReturn(false);

        assertThatThrownBy(() -> service.delete(id))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private JobApplication persisted(JobApplication application) {
        application.setId(UUID.randomUUID());
        application.setCreatedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        return application;
    }

    private JobApplication application(UUID id) {
        var application = new JobApplication();
        application.setId(id);
        application.setOwnerUserId("development-user-a");
        application.setCompany("Acme");
        application.setJobTitle("Backend Engineer");
        application.setJobDescription("Build Spring services");
        application.setJobUrl("https://example.com/job");
        application.setLocation("Toronto, ON");
        application.setSource("Company site");
        application.setDateFound(OffsetDateTime.now().minusDays(1));
        application.setNotes("Existing notes");
        application.setResumeUsed("resume.tex");
        application.setStatus(JobApplicationStatus.SAVED);
        application.setCreatedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        return application;
    }
}
