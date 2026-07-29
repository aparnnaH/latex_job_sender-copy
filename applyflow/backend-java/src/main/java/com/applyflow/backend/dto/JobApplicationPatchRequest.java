package com.applyflow.backend.dto;

import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

public record JobApplicationPatchRequest(
        @Size(max = 255) String company,
        @Size(max = 255) String jobTitle,
        String jobDescription,
        @Size(max = 2048) String jobUrl,
        @Size(max = 255) String location,
        @Size(max = 255) String source,
        OffsetDateTime dateFound,
        OffsetDateTime dateApplied,
        String notes,
        @Size(max = 255) String resumeUsed
) {
}
