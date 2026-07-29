package com.applyflow.backend.controller;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.dto.ResumeVersionReviewResponse;
import com.applyflow.backend.service.ResumeVersionService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/resume-versions")
@RequiredArgsConstructor
public class ResumeVersionController {

    private final ResumeVersionService service;

    @GetMapping("/{id}")
    public ResumeVersionResponse findById(@PathVariable UUID id) {
        return service.findById(id);
    }

    @GetMapping("/{id}/review")
    public ResumeVersionReviewResponse review(@PathVariable UUID id) {
        return service.review(id);
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable UUID id) {
        return downloadTex(id);
    }

    @GetMapping("/{id}/download/tex")
    public ResponseEntity<Resource> downloadTex(@PathVariable UUID id) {
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("application/x-tex"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"tailored-resume.tex\"")
                .body(service.download(id));
    }

    @GetMapping("/{id}/download/pdf")
    public ResponseEntity<Resource> downloadPdf(@PathVariable UUID id) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"tailored-resume.pdf\"")
                .body(service.downloadPdf(id));
    }

    @PostMapping("/{id}/retry")
    public ResponseEntity<ResumeVersionResponse> retry(@PathVariable UUID id) {
        return ResponseEntity.accepted().body(service.retry(id));
    }
}
