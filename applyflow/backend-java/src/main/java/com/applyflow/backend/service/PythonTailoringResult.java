package com.applyflow.backend.service;

import java.time.Duration;

public record PythonTailoringResult(
        int exitCode,
        String stdout,
        String stderr,
        Duration duration,
        boolean timedOut
) {
    public boolean succeeded() {
        return exitCode == 0 && !timedOut;
    }
}
