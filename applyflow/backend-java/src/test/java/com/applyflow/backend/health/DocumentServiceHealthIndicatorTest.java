package com.applyflow.backend.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

class DocumentServiceHealthIndicatorTest {

    @Test
    void reportsUpWhenDocumentServiceHealthEndpointSucceeds() {
        var context = context();
        context.server.expect(requestTo("/health"))
                .andRespond(withSuccess("{\"status\":\"ok\"}", MediaType.APPLICATION_JSON));

        var health = context.indicator.health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).isEmpty();
        context.server.verify();
    }

    @Test
    void reportsDownWithoutInternalErrorDetailsWhenDocumentServiceUnavailable() {
        var context = context();
        context.server.expect(requestTo("/health"))
                .andRespond(withServerError());

        var health = context.indicator.health();

        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).isEmpty();
        context.server.verify();
    }

    private TestContext context() {
        var restTemplate = new RestTemplate();
        var indicator = new DocumentServiceHealthIndicator(restTemplate);
        var server = MockRestServiceServer.bindTo(restTemplate).build();
        return new TestContext(indicator, server);
    }

    private record TestContext(DocumentServiceHealthIndicator indicator, MockRestServiceServer server) {
    }
}
