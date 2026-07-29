package com.applyflow.backend.service;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.entity.ResumeVersion;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.stereotype.Component;

@Component
public class ResumeVersionMapper {

    public ResumeVersionResponse toResponse(ResumeVersion version) {
        return new ResumeVersionResponse(
                version.getId(),
                version.getJobApplicationId(),
                version.getOriginalFileName(),
                version.getBaseResumeName(),
                version.getVersionNumber(),
                version.getTailoringStatus(),
                version.getProcessingStatus(),
                version.getMatchScoreBefore(),
                version.getMatchScoreAfter(),
                new ResumeVersionResponse.DocumentAvailability(
                        isReadable(version.getStoredFilePath()),
                        isReadable(version.getOutputFilePath()),
                        version.getDocumentServiceId() != null),
                version.getDocumentServiceId(),
                version.getErrorCode(),
                version.getSafeErrorMessage(),
                version.getAttemptCount(),
                version.getCreatedAt(),
                version.getUpdatedAt(),
                version.getProcessingStartedAt(),
                version.getProcessingCompletedAt()
        );
    }

    private boolean isReadable(String path) {
        return path != null && Files.isReadable(Path.of(path));
    }
}
