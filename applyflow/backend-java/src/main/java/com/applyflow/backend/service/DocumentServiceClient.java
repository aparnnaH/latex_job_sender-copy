package com.applyflow.backend.service;

import java.nio.file.Path;
import java.util.UUID;

public interface DocumentServiceClient {

    DocumentProcessingResult tailor(DocumentProcessingRequest request);

    record DocumentProcessingRequest(
            UUID requestId,
            UUID applicationId,
            UUID resumeVersionId,
            String resumeFileName,
            Path resumePath,
            String jobDescription,
            String evidenceJson,
            boolean compilePdf
    ) {
    }

    record DocumentProcessingResult(
            UUID documentId,
            DocumentProcessingStatus status,
            String tailoredTex,
            String errorCode,
            String safeErrorMessage,
            boolean retryable
    ) {
        public boolean completed() {
            return status == DocumentProcessingStatus.COMPLETED;
        }
    }

    enum DocumentProcessingStatus {
        COMPLETED,
        FAILED
    }
}
