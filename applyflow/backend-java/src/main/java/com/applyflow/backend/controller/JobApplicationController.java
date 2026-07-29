package com.applyflow.backend.controller;

import com.applyflow.backend.dto.JobApplicationPatchRequest;
import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.dto.JobApplicationResponse;
import com.applyflow.backend.dto.JobApplicationSearchRequest;
import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.dto.StatusUpdateRequest;
import com.applyflow.backend.entity.JobApplicationStatus;
import com.applyflow.backend.service.JobApplicationService;
import com.applyflow.backend.service.ResumeVersionService;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/applications")
@RequiredArgsConstructor
public class JobApplicationController {

    private final JobApplicationService service;
    private final ResumeVersionService resumeVersionService;

    @PostMapping
    public ResponseEntity<JobApplicationResponse> create(@Valid @RequestBody JobApplicationRequest request) {
        var response = service.create(request);
        return ResponseEntity.created(URI.create("/api/applications/" + response.id())).body(response);
    }

    @GetMapping
    public Page<JobApplicationResponse> findAll(
            @RequestParam(required = false) JobApplicationStatus status,
            @RequestParam(required = false) String company,
            @RequestParam(required = false) String source,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime dateFrom,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime dateTo,
            @ParameterObject Pageable pageable) {
        return service.findAll(new JobApplicationSearchRequest(status, company, source, dateFrom, dateTo), pageable);
    }

    @GetMapping("/{id}")
    public JobApplicationResponse findById(@PathVariable UUID id) {
        return service.findById(id);
    }

    @PatchMapping("/{id}")
    public JobApplicationResponse patch(@PathVariable UUID id, @Valid @RequestBody JobApplicationPatchRequest request) {
        return service.patch(id, request);
    }

    @PutMapping("/{id}")
    public JobApplicationResponse update(@PathVariable UUID id, @Valid @RequestBody JobApplicationRequest request) {
        return service.update(id, request);
    }

    @PatchMapping("/{id}/status")
    public JobApplicationResponse updateStatus(@PathVariable UUID id, @Valid @RequestBody StatusUpdateRequest request) {
        return service.updateStatus(id, request.status());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/{id}/tailor", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ResumeVersionResponse> tailorResume(
            @PathVariable UUID id,
            @RequestParam("resume") MultipartFile resume) {
        var response = resumeVersionService.requestTailoring(id, resume);
        return ResponseEntity.accepted().body(response);
    }

    @PostMapping(value = "/{id}/resumes/tailor", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ResumeVersionResponse> tailorResumeCompatibility(
            @PathVariable UUID id,
            @RequestParam("resume") MultipartFile resume) {
        return tailorResume(id, resume);
    }

    @GetMapping("/{id}/resume-versions")
    public List<ResumeVersionResponse> findResumeVersions(@PathVariable UUID id) {
        return resumeVersionService.findByJobApplicationId(id);
    }
}
