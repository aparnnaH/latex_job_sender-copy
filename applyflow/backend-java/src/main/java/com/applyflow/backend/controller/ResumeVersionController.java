package com.applyflow.backend.controller;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.service.ResumeVersionService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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

    @GetMapping("/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable UUID id) {
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf("application/x-tex"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"tailored-resume.tex\"")
                .body(service.download(id));
    }
}
