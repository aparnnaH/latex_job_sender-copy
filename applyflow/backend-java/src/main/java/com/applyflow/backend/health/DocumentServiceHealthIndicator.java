package com.applyflow.backend.health;

import com.applyflow.backend.config.ApplyFlowProperties;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

@Component("documentService")
public class DocumentServiceHealthIndicator implements HealthIndicator {

    private final RestTemplate restTemplate;

    public DocumentServiceHealthIndicator(RestTemplateBuilder builder, ApplyFlowProperties properties) {
        this.restTemplate = builder
                .rootUri(properties.documentService().baseUrl())
                .connectTimeout(properties.documentService().timeout())
                .readTimeout(properties.documentService().timeout())
                .build();
    }

    DocumentServiceHealthIndicator(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    @Override
    public Health health() {
        try {
            var response = restTemplate.getForEntity("/health", String.class);
            return response.getStatusCode().is2xxSuccessful()
                    ? Health.up().build()
                    : Health.down().withDetail("status", sanitize(response.getStatusCode())).build();
        } catch (RestClientException exception) {
            return Health.down().build();
        }
    }

    private static String sanitize(HttpStatusCode statusCode) {
        return Integer.toString(statusCode.value());
    }
}
