package com.applyflow.backend.service;

import com.applyflow.backend.dto.ResumeVersionResponse;
import com.applyflow.backend.entity.ResumeVersion;
import org.springframework.stereotype.Component;

@Component
public class ResumeVersionMapper {

    public ResumeVersionResponse toResponse(ResumeVersion version) {
        return new ResumeVersionResponse(
                version.getId(),
                version.getJobApplicationId(),
                version.getOriginalFileName(),
                version.getBaseResumeName(),
                version.getStoredFilePath(),
                version.getOutputFilePath(),
                version.getVersionNumber(),
                version.getTailoringStatus(),
                version.getProcessingStatus(),
                version.getDocumentServiceId(),
                version.getFailureMessage(),
                version.getErrorCode(),
                version.getSafeErrorMessage(),
                version.getAttemptCount(),
                version.getCreatedAt(),
                version.getUpdatedAt(),
                version.getProcessingStartedAt(),
                version.getProcessingCompletedAt()
        );
    }
}
