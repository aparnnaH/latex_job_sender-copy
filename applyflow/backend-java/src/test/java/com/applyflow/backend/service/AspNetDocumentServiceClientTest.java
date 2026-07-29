package com.applyflow.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServiceUnavailable;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.applyflow.backend.config.ApplyFlowProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

class AspNetDocumentServiceClientTest {

    @TempDir
    private Path tempDir;

    @Test
    void tailorPostsMultipartRequestAndMapsCompletedResponse() throws Exception {
        var context = context();
        var documentId = UUID.randomUUID();
        var resumePath = tempDir.resolve("resume.tex");
        Files.writeString(resumePath, "\\documentclass{article}");
        context.server.expect(requestTo("http://documents.test/api/documents/tailor"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.MULTIPART_FORM_DATA))
                .andRespond(withSuccess("""
                        {
                          "documentId": "%s",
                          "status": "COMPLETED",
                          "originalFileName": "resume.tex",
                          "tailoredTex": "\\\\documentclass{article}"
                        }
                        """.formatted(documentId), MediaType.APPLICATION_JSON));

        var result = context.client.tailor(new DocumentServiceClient.DocumentProcessingRequest(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "resume.tex",
                resumePath,
                "Build Java services",
                "{}",
                true));

        assertThat(result.completed()).isTrue();
        assertThat(result.documentId()).isEqualTo(documentId);
        context.server.verify();
    }

    @Test
    void tailorMapsFailedResponseToSharedErrorFields() throws Exception {
        var context = context();
        var resumePath = tempDir.resolve("resume.tex");
        Files.writeString(resumePath, "\\documentclass{article}");
        context.server.expect(requestTo("http://documents.test/api/documents/tailor"))
                .andRespond(withSuccess("""
                        {
                          "documentId": "%s",
                          "status": "FAILED",
                          "originalFileName": "resume.tex",
                          "error": {
                            "code": "PYTHON_RESULT_INVALID",
                            "message": "The tailoring result was invalid.",
                            "retryable": false
                          }
                        }
                        """.formatted(UUID.randomUUID()), MediaType.APPLICATION_JSON));

        var result = context.client.tailor(new DocumentServiceClient.DocumentProcessingRequest(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "resume.tex",
                resumePath,
                "Build Java services",
                "{}",
                true));

        assertThat(result.completed()).isFalse();
        assertThat(result.errorCode()).isEqualTo("PYTHON_RESULT_INVALID");
        assertThat(result.safeErrorMessage()).isEqualTo("The tailoring result was invalid.");
    }

    @Test
    void tailorMapsTransportFailureToSafeException() throws Exception {
        var context = context();
        var resumePath = tempDir.resolve("resume.tex");
        Files.writeString(resumePath, "\\documentclass{article}");
        context.server.expect(requestTo("http://documents.test/api/documents/tailor"))
                .andRespond(withServiceUnavailable());

        assertThatThrownBy(() -> context.client.tailor(new DocumentServiceClient.DocumentProcessingRequest(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "resume.tex",
                resumePath,
                "Build Java services",
                "{}",
                true)))
                .isInstanceOf(DocumentServiceException.class)
                .hasMessage("The document service is unavailable.");
    }

    private TestContext context() {
        var builder = new RestTemplateBuilder();
        var properties = new ApplyFlowProperties(
                new ApplyFlowProperties.Storage(tempDir, 1_048_576),
                new ApplyFlowProperties.Tailoring("python3", tempDir.resolve("tailor.py"), Duration.ofSeconds(1), 1),
                new ApplyFlowProperties.DocumentService("http://documents.test", Duration.ofSeconds(1), false, true),
                new ApplyFlowProperties.Rabbit("exchange", "queue", "routing", "dlx", "dlq"));
        var restTemplate = builder
                .rootUri(properties.documentService().baseUrl())
                .connectTimeout(properties.documentService().timeout())
                .readTimeout(properties.documentService().timeout())
                .build();
        var client = new AspNetDocumentServiceClient(restTemplate);
        var server = MockRestServiceServer.bindTo(restTemplate).build();
        return new TestContext(client, server);
    }

    private record TestContext(AspNetDocumentServiceClient client, MockRestServiceServer server) {
    }
}
