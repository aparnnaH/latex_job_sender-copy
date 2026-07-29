package com.applyflow.backend.dto;

import com.applyflow.backend.entity.TailoringStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ResumeVersionResponse(
        UUID id,
        UUID jobApplicationId,
        String originalFileName,
        String baseResumeName,
        String storedFilePath,
        String outputFilePath,
        Integer versionNumber,
        TailoringStatus tailoringStatus,
        TailoringStatus processingStatus,
        String documentServiceId,
        String failureMessage,
        String errorCode,
        String safeErrorMessage,
        Integer attemptCount,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime processingStartedAt,
        OffsetDateTime processingCompletedAt
) {
}
