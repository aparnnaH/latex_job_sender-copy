package com.applyflow.backend.dto;

import com.applyflow.backend.entity.TailoringStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record ResumeVersionResponse(
        UUID id,
        UUID jobApplicationId,
        String originalFileName,
        String baseResumeName,
        Integer versionNumber,
        TailoringStatus tailoringStatus,
        TailoringStatus processingStatus,
        Integer matchScoreBefore,
        Integer matchScoreAfter,
        DocumentAvailability documentAvailability,
        String documentServiceId,
        String errorCode,
        String safeErrorMessage,
        Integer attemptCount,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        OffsetDateTime processingStartedAt,
        OffsetDateTime processingCompletedAt
) {
    public record DocumentAvailability(
            boolean sourceTex,
            boolean tailoredTex,
            boolean pdf
    ) {
    }
}
