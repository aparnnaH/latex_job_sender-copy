package com.applyflow.backend.dto;

import com.applyflow.backend.entity.JobApplicationStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

public record JobApplicationResponse(
        UUID id,
        String company,
        String jobTitle,
        String jobDescription,
        String jobUrl,
        JobApplicationStatus status,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
