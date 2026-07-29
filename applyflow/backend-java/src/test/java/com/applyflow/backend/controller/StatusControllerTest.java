package com.applyflow.backend.controller;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthContributorRegistry;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.actuate.health.MapHealthContributorRegistry;

class StatusControllerTest {

    @Test
    void statusSummaryReportsHealthyDependenciesWithoutDetails() {
        var controller = new StatusController(registry(
                () -> Health.up().withDetail("url", "jdbc:postgresql://localhost/applyflow").build(),
                () -> Health.up().withDetail("version", "3.13").build(),
                () -> Health.up().withDetail("body", "{\"status\":\"ok\"}").build()));

        var response = controller.status();

        assertThat(response.status()).isEqualTo("UP");
        assertThat(response.checks()).containsEntry("javaApplication", "UP");
        assertThat(response.checks()).containsEntry("postgresql", "UP");
        assertThat(response.checks()).containsEntry("rabbitmq", "UP");
        assertThat(response.checks()).containsEntry("documentService", "UP");
        assertThat(response.checks()).doesNotContainKey("error");
    }

    @Test
    void statusSummaryReportsUnavailableDependenciesWithoutDetails() {
        var controller = new StatusController(registry(
                () -> Health.down().withDetail("error", "connection refused").build(),
                () -> Health.down().withDetail("error", "auth failed").build(),
                () -> Health.down().withDetail("error", "timeout").build()));

        var response = controller.status();

        assertThat(response.status()).isEqualTo("DOWN");
        assertThat(response.checks()).containsEntry("postgresql", "DOWN");
        assertThat(response.checks()).containsEntry("rabbitmq", "DOWN");
        assertThat(response.checks()).containsEntry("documentService", "DOWN");
        assertThat(response.checks().values()).doesNotContain("connection refused", "auth failed", "timeout");
    }

    private static HealthContributorRegistry registry(
            HealthIndicator db,
            HealthIndicator rabbit,
            HealthIndicator documentService) {
        var registry = new MapHealthContributorRegistry();
        registry.registerContributor("db", db);
        registry.registerContributor("rabbit", rabbit);
        registry.registerContributor("documentService", documentService);
        return registry;
    }
}
