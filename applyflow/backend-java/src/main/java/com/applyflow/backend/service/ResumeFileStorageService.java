package com.applyflow.backend.service;

import com.applyflow.backend.config.ApplyFlowProperties;
import com.applyflow.backend.exception.InvalidRequestException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class ResumeFileStorageService {

    private final ApplyFlowProperties properties;

    public StoredResumeFiles storeInput(UUID jobApplicationId, UUID resumeVersionId, MultipartFile file) {
        validateUpload(file);
        var directory = resumeVersionDirectory(jobApplicationId, resumeVersionId);
        var inputPath = directory.resolve("input.tex");
        var outputPath = directory.resolve("tailored.tex");

        try {
            Files.createDirectories(directory);
            file.transferTo(inputPath);
            return new StoredResumeFiles(inputPath, outputPath);
        } catch (IOException exception) {
            throw new InvalidRequestException("Could not store uploaded resume.");
        }
    }

    public Path resumeVersionDirectory(UUID jobApplicationId, UUID resumeVersionId) {
        return properties.storage().resumesDir()
                .resolve(jobApplicationId.toString())
                .resolve(resumeVersionId.toString());
    }

    public void deleteIfExists(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // Failure cleanup should not hide the original processing failure.
        }
    }

    private void validateUpload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidRequestException("A non-empty resume file is required.");
        }
        var filename = file.getOriginalFilename();
        if (filename == null || !filename.toLowerCase().endsWith(".tex")) {
            throw new InvalidRequestException("Only LaTeX .tex resume files are supported.");
        }
        if (file.getSize() > properties.storage().maxUploadBytes()) {
            throw new InvalidRequestException("The resume file exceeds the configured upload size limit.");
        }
    }

    public record StoredResumeFiles(Path inputPath, Path outputPath) {
    }
}
