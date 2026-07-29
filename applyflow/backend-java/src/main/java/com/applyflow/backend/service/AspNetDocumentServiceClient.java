package com.applyflow.backend.service;

import com.applyflow.backend.config.ApplyFlowProperties;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.util.UUID;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestTemplate;

@Component
public class AspNetDocumentServiceClient implements DocumentServiceClient {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public AspNetDocumentServiceClient(RestTemplateBuilder builder, ApplyFlowProperties properties) {
        this.restTemplate = builder
                .rootUri(properties.documentService().baseUrl())
                .connectTimeout(properties.documentService().timeout())
                .readTimeout(properties.documentService().timeout())
                .build();
        this.objectMapper = new ObjectMapper();
    }

    AspNetDocumentServiceClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public DocumentProcessingResult tailor(DocumentProcessingRequest request) {
        try {
            var response = restTemplate.postForEntity(
                    "/api/documents/tailor",
                    new HttpEntity<>(multipartBody(request), multipartHeaders()),
                    DocumentResponse.class);

            var body = response.getBody();
            if (body == null) {
                throw new DocumentServiceException("DOCUMENT_SERVICE_UNAVAILABLE", "The document service returned an empty response.", true);
            }
            return mapBody(body);
        } catch (IOException exception) {
            throw new DocumentServiceException("ARTIFACT_NOT_FOUND", "The uploaded resume could not be read for processing.", false);
        } catch (RestClientResponseException exception) {
            throw mapErrorResponse(exception);
        } catch (RestClientException exception) {
            throw new DocumentServiceException("DOCUMENT_SERVICE_UNAVAILABLE", "The document service is unavailable.", true);
        }
    }

    private DocumentServiceException mapErrorResponse(RestClientResponseException exception) {
        try {
            var envelope = objectMapper.readValue(exception.getResponseBodyAsString(), ErrorEnvelope.class);
            if (envelope.error() != null) {
                return new DocumentServiceException(
                        envelope.error().code(),
                        envelope.error().message(),
                        envelope.error().retryable());
            }
        } catch (IOException ignored) {
            // Fall back to a safe transport-level error below.
        }
        var retryable = exception.getStatusCode().is5xxServerError();
        var code = retryable ? "DOCUMENT_SERVICE_UNAVAILABLE" : "VALIDATION_FAILED";
        var message = retryable
                ? "The document service is unavailable."
                : "The document service rejected the tailoring request.";
        return new DocumentServiceException(code, message, retryable);
    }

    private static HttpHeaders multipartHeaders() {
        var headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        return headers;
    }

    private static MultiValueMap<String, HttpEntity<?>> multipartBody(DocumentProcessingRequest request) throws IOException {
        var builder = new MultipartBodyBuilder();
        var bytes = Files.readAllBytes(request.resumePath());
        builder.part("resume", new NamedByteArrayResource(bytes, request.resumeFileName()))
                .filename(request.resumeFileName())
                .contentType(MediaType.valueOf("application/x-tex"));
        builder.part("jobDescription", request.jobDescription());
        builder.part("evidence", request.evidenceJson());
        builder.part("compilePdf", Boolean.toString(request.compilePdf()));
        builder.part("requestId", request.requestId().toString());
        builder.part("applicationId", request.applicationId().toString());
        builder.part("resumeVersionId", request.resumeVersionId().toString());
        return builder.build();
    }

    private static DocumentProcessingResult mapBody(DocumentResponse body) {
        if (body.status() == DocumentProcessingStatus.FAILED) {
            var error = body.error();
            return new DocumentProcessingResult(
                    body.documentId(),
                    DocumentProcessingStatus.FAILED,
                    body.tailoredTex(),
                    error == null ? "DOCUMENT_SERVICE_UNAVAILABLE" : error.code(),
                    error == null ? "The document service could not tailor the resume." : error.message(),
                    error != null && error.retryable());
        }

        return new DocumentProcessingResult(
                body.documentId(),
                DocumentProcessingStatus.COMPLETED,
                body.tailoredTex(),
                null,
                null,
                false);
    }

    private static final class NamedByteArrayResource extends ByteArrayResource {

        private final String filename;

        private NamedByteArrayResource(byte[] byteArray, String filename) {
            super(byteArray);
            this.filename = filename;
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record DocumentResponse(
            UUID documentId,
            DocumentProcessingStatus status,
            String tailoredTex,
            ContractError error
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ContractError(String code, String message, boolean retryable) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ErrorEnvelope(ContractError error) {
    }
}
