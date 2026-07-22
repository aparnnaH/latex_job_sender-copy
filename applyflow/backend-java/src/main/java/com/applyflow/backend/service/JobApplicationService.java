package com.applyflow.backend.service;

import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.dto.JobApplicationResponse;
import com.applyflow.backend.entity.JobApplication;
import com.applyflow.backend.entity.JobApplicationStatus;
import com.applyflow.backend.exception.ResourceNotFoundException;
import com.applyflow.backend.repository.JobApplicationRepository;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class JobApplicationService {

    private final JobApplicationRepository repository;

    @Transactional
    public JobApplicationResponse create(JobApplicationRequest request) {
        var application = new JobApplication();
        applyRequest(application, request);
        application.setStatus(JobApplicationStatus.SAVED);
        return toResponse(repository.save(application));
    }

    @Transactional(readOnly = true)
    public List<JobApplicationResponse> findAll() {
        return repository.findAll().stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public JobApplicationResponse findById(UUID id) {
        return toResponse(findEntity(id));
    }

    @Transactional
    public JobApplicationResponse update(UUID id, JobApplicationRequest request) {
        var application = findEntity(id);
        applyRequest(application, request);
        return toResponse(repository.save(application));
    }

    @Transactional
    public JobApplicationResponse updateStatus(UUID id, JobApplicationStatus status) {
        var application = findEntity(id);
        application.setStatus(status);
        return toResponse(repository.save(application));
    }

    @Transactional
    public void delete(UUID id) {
        if (!repository.existsById(id)) {
            throw new ResourceNotFoundException("Job application not found: " + id);
        }
        repository.deleteById(id);
    }

    private JobApplication findEntity(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Job application not found: " + id));
    }

    private void applyRequest(JobApplication application, JobApplicationRequest request) {
        application.setCompany(request.company());
        application.setJobTitle(request.jobTitle());
        application.setJobDescription(request.jobDescription());
        application.setJobUrl(request.jobUrl());
    }

    private JobApplicationResponse toResponse(JobApplication application) {
        return new JobApplicationResponse(
                application.getId(),
                application.getCompany(),
                application.getJobTitle(),
                application.getJobDescription(),
                application.getJobUrl(),
                application.getStatus(),
                application.getCreatedAt(),
                application.getUpdatedAt()
        );
    }
}
