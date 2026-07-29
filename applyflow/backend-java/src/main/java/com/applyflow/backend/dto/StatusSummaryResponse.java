package com.applyflow.backend.dto;

import java.time.OffsetDateTime;
import java.util.Map;

public record StatusSummaryResponse(
        String status,
        Map<String, String> checks,
        OffsetDateTime checkedAt
) {
}
