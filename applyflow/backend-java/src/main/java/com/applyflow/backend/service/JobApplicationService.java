package com.applyflow.backend.service;

import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.dto.JobApplicationPatchRequest;
import com.applyflow.backend.dto.JobApplicationResponse;
import com.applyflow.backend.dto.JobApplicationSearchRequest;
import com.applyflow.backend.entity.JobApplication;
import com.applyflow.backend.entity.JobApplicationStatus;
import com.applyflow.backend.exception.InvalidRequestException;
import com.applyflow.backend.exception.ResourceNotFoundException;
import com.applyflow.backend.repository.JobApplicationRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
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
    public Page<JobApplicationResponse> findAll(JobApplicationSearchRequest search, Pageable pageable) {
        return repository.findAll(toSpecification(search), pageable)
                .map(this::toResponse)
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
    public JobApplicationResponse patch(UUID id, JobApplicationPatchRequest request) {
        var application = findEntity(id);
        applyPatch(application, request);
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
        application.setLocation(request.location());
        application.setSource(request.source());
        application.setDateFound(request.dateFound());
        application.setDateApplied(request.dateApplied());
        application.setNotes(request.notes());
        application.setResumeUsed(request.resumeUsed());
    }

    private void applyPatch(JobApplication application, JobApplicationPatchRequest request) {
        if (request.company() != null) {
            requireText(request.company(), "company");
            application.setCompany(request.company());
        }
        if (request.jobTitle() != null) {
            requireText(request.jobTitle(), "jobTitle");
            application.setJobTitle(request.jobTitle());
        }
        if (request.jobDescription() != null) {
            requireText(request.jobDescription(), "jobDescription");
            application.setJobDescription(request.jobDescription());
        }
        if (request.jobUrl() != null) {
            application.setJobUrl(request.jobUrl());
        }
        if (request.location() != null) {
            application.setLocation(request.location());
        }
        if (request.source() != null) {
            application.setSource(request.source());
        }
        if (request.dateFound() != null) {
            application.setDateFound(request.dateFound());
        }
        if (request.dateApplied() != null) {
            application.setDateApplied(request.dateApplied());
        }
        if (request.notes() != null) {
            application.setNotes(request.notes());
        }
        if (request.resumeUsed() != null) {
            application.setResumeUsed(request.resumeUsed());
        }
    }

    private void requireText(String value, String field) {
        if (value.isBlank()) {
            throw new InvalidRequestException(field + " must not be blank.");
        }
    }

    private Specification<JobApplication> toSpecification(JobApplicationSearchRequest search) {
        Specification<JobApplication> specification = Specification.where(null);

        if (search.status() != null) {
            specification = specification.and((root, query, builder) ->
                    builder.equal(root.get("status"), search.status()));
        }
        if (search.company() != null && !search.company().isBlank()) {
            specification = specification.and((root, query, builder) ->
                    builder.like(builder.lower(root.get("company")), "%" + search.company().toLowerCase() + "%"));
        }
        if (search.source() != null && !search.source().isBlank()) {
            specification = specification.and((root, query, builder) ->
                    builder.equal(builder.lower(root.get("source")), search.source().toLowerCase()));
        }
        if (search.dateFrom() != null) {
            specification = specification.and((root, query, builder) ->
                    builder.greaterThanOrEqualTo(root.get("dateFound"), search.dateFrom()));
        }
        if (search.dateTo() != null) {
            specification = specification.and((root, query, builder) ->
                    builder.lessThanOrEqualTo(root.get("dateFound"), search.dateTo()));
        }

        return specification;
    }

    private JobApplicationResponse toResponse(JobApplication application) {
        return new JobApplicationResponse(
                application.getId(),
                application.getCompany(),
                application.getJobTitle(),
                application.getJobDescription(),
                application.getJobUrl(),
                application.getLocation(),
                application.getSource(),
                application.getDateFound(),
                application.getDateApplied(),
                application.getStatus(),
                application.getNotes(),
                application.getResumeUsed(),
                application.getCreatedAt(),
                application.getUpdatedAt()
        );
    }
}
