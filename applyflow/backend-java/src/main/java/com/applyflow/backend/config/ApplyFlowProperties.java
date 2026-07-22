package com.applyflow.backend.config;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "applyflow")
public record ApplyFlowProperties(
        Storage storage,
        Tailoring tailoring,
        Rabbit rabbitmq
) {
    public record Storage(Path resumesDir, long maxUploadBytes) {
    }

    public record Tailoring(String pythonExecutable, Path pythonScriptPath, Duration timeout, int maxAttempts) {
    }

    public record Rabbit(
            String exchange,
            String queue,
            String routingKey,
            String deadLetterExchange,
            String deadLetterQueue
    ) {
    }
}
