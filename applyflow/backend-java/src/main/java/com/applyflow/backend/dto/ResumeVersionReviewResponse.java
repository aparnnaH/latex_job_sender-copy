package com.applyflow.backend.dto;

import java.util.List;
import java.util.UUID;

public record ResumeVersionReviewResponse(
        UUID id,
        UUID jobApplicationId,
        Integer versionNumber,
        String originalFileName,
        String baseResumeName,
        String originalTex,
        String tailoredTex,
        Integer matchScoreBefore,
        Integer matchScoreAfter,
        List<String> matchedKeywords,
        List<String> missingKeywords,
        List<String> sectionsChanged,
        List<String> warnings,
        List<String> unsupportedClaimsRejected
) {
}
