package com.applyflow.backend.dto;

import com.applyflow.backend.entity.JobApplicationStatus;
import jakarta.validation.constraints.NotNull;

public record StatusUpdateRequest(@NotNull JobApplicationStatus status) {
}
