package com.applyflow.backend.controller;

import com.applyflow.backend.dto.StatusSummaryResponse;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthContributor;
import org.springframework.boot.actuate.health.HealthContributorRegistry;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StatusController {

    private final HealthContributorRegistry healthContributorRegistry;

    public StatusController(HealthContributorRegistry healthContributorRegistry) {
        this.healthContributorRegistry = healthContributorRegistry;
    }

    @GetMapping("/api/status")
    public StatusSummaryResponse status() {
        var checks = new LinkedHashMap<String, String>();
        checks.put("javaApplication", "UP");
        checks.put("postgresql", contributorStatus("db"));
        checks.put("rabbitmq", contributorStatus("rabbit"));
        checks.put("documentService", contributorStatus("documentService"));
        var overallStatus = checks.containsValue("DOWN") || checks.containsValue("OUT_OF_SERVICE")
                ? "DOWN"
                : "UP";
        return new StatusSummaryResponse(overallStatus, checks, OffsetDateTime.now());
    }

    private String contributorStatus(String name) {
        var contributor = healthContributorRegistry.getContributor(name);
        if (contributor instanceof HealthIndicator indicator) {
            return sanitize(indicator.health());
        }
        return contributor == null ? "UNKNOWN" : "UP";
    }

    private static String sanitize(Health health) {
        return health.getStatus().getCode();
    }
}
