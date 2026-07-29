package com.applyflow.backend.dto;

import com.applyflow.backend.entity.JobApplicationStatus;
import java.time.OffsetDateTime;

public record JobApplicationSearchRequest(
        JobApplicationStatus status,
        String company,
        String source,
        OffsetDateTime dateFrom,
        OffsetDateTime dateTo
) {
}
