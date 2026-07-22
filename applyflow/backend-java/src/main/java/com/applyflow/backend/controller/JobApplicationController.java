package com.applyflow.backend.controller;

import com.applyflow.backend.dto.JobApplicationRequest;
import com.applyflow.backend.dto.JobApplicationResponse;
import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.dto.StatusUpdateRequest;
import com.applyflow.backend.service.JobApplicationService;
import com.applyflow.backend.service.ResumeVersionService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
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
    public List<JobApplicationResponse> findAll() {
        return service.findAll();
    }

    @GetMapping("/{id}")
    public JobApplicationResponse findById(@PathVariable UUID id) {
        return service.findById(id);
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

    @PostMapping(value = "/{id}/resumes/tailor", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ResumeVersionResponse> tailorResume(
            @PathVariable UUID id,
            @RequestParam("resume") MultipartFile resume) {
        var response = resumeVersionService.requestTailoring(id, resume);
        return ResponseEntity.accepted().body(response);
    }
}
