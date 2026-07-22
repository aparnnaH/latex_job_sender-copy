package com.applyflow.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.entity.JobApplication;
import com.applyflow.backend.entity.JobApplicationStatus;
import com.applyflow.backend.exception.ResourceNotFoundException;
import com.applyflow.backend.repository.JobApplicationRepository;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class JobApplicationServiceTest {

    @Mock
    private JobApplicationRepository repository;

    private JobApplicationService service;

    @BeforeEach
    void setUp() {
        service = new JobApplicationService(repository);
    }

    @Test
    void createStoresApplicationWithSavedStatus() {
        when(repository.save(any(JobApplication.class))).thenAnswer(invocation -> persisted(invocation.getArgument(0)));

        var response = service.create(new JobApplicationRequest(
                "Acme",
                "Backend Engineer",
                "Build Spring services",
                "https://example.com/job"
        ));

        assertThat(response.company()).isEqualTo("Acme");
        assertThat(response.status()).isEqualTo(JobApplicationStatus.SAVED);

        ArgumentCaptor<JobApplication> captor = ArgumentCaptor.forClass(JobApplication.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getJobTitle()).isEqualTo("Backend Engineer");
    }

    @Test
    void updateStatusChangesOnlyStatus() {
        var id = UUID.randomUUID();
        var existing = application(id);
        when(repository.findById(id)).thenReturn(Optional.of(existing));
        when(repository.save(existing)).thenAnswer(invocation -> invocation.getArgument(0));

        var response = service.updateStatus(id, JobApplicationStatus.INTERVIEW);

        assertThat(response.status()).isEqualTo(JobApplicationStatus.INTERVIEW);
        assertThat(response.company()).isEqualTo("Acme");
    }

    @Test
    void findByIdThrowsWhenMissing() {
        var id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findById(id))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining(id.toString());
    }

    @Test
    void deleteThrowsWhenMissing() {
        var id = UUID.randomUUID();
        when(repository.existsById(id)).thenReturn(false);

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
        application.setCompany("Acme");
        application.setJobTitle("Backend Engineer");
        application.setJobDescription("Build Spring services");
        application.setJobUrl("https://example.com/job");
        application.setStatus(JobApplicationStatus.SAVED);
        application.setCreatedAt(OffsetDateTime.now());
        application.setUpdatedAt(OffsetDateTime.now());
        return application;
    }
}
