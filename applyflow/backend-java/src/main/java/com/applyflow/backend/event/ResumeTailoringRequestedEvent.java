package com.applyflow.backend.event;

import java.util.UUID;

public record ResumeTailoringRequestedEvent(
        UUID jobApplicationId,
        UUID resumeVersionId,
        String inputResumePath,
        String jobDescription,
        String outputResumePath
) {
}
