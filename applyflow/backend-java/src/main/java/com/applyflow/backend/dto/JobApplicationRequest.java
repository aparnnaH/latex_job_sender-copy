package com.applyflow.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record JobApplicationRequest(
        @NotBlank @Size(max = 255) String company,
        @NotBlank @Size(max = 255) String jobTitle,
        @NotBlank String jobDescription,
        @Size(max = 2048) String jobUrl
) {
}
