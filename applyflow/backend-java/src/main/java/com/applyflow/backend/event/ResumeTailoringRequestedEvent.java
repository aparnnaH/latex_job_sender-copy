package com.applyflow.backend.event;

import java.util.UUID;

/**
 * RabbitMQ contract for an asynchronous tailoring job.
 *
 * The message carries stable IDs and references to files already stored by the API.
 * Resume file contents stay out of RabbitMQ so duplicate deliveries can be handled
 * idempotently by resumeVersionId.
 */
public record ResumeTailoringRequestedEvent(
        UUID jobApplicationId,
        UUID resumeVersionId,
        String inputResumePath,
        String jobDescription,
        String outputResumePath
) {
}
