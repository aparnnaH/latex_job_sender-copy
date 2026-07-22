package com.applyflow.backend.service;

import com.applyflow.backend.config.ApplyFlowProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ProcessBuilderPythonTailoringClient implements PythonTailoringClient {

    private final ApplyFlowProperties properties;

    @Override
    public PythonTailoringResult tailor(Path inputResumePath, String jobDescription, Path outputResumePath) {
        var startedAt = Instant.now();
        var scriptPath = properties.tailoring().pythonScriptPath();
        if (!Files.exists(scriptPath)) {
            return new PythonTailoringResult(
                    127,
                    "",
                    "Python tailoring script was not found at configured path.",
                    Duration.between(startedAt, Instant.now()),
                    false);
        }

        var processBuilder = new ProcessBuilder(
                properties.tailoring().pythonExecutable(),
                scriptPath.toString(),
                inputResumePath.toString(),
                jobDescription,
                outputResumePath.toString());

        Path stdoutPath = null;
        Path stderrPath = null;
        try {
            stdoutPath = Files.createTempFile("applyflow-python-", ".out");
            stderrPath = Files.createTempFile("applyflow-python-", ".err");
            processBuilder.redirectOutput(stdoutPath.toFile());
            processBuilder.redirectError(stderrPath.toFile());

            var process = processBuilder.start();
            var completed = process.waitFor(properties.tailoring().timeout().toMillis(), TimeUnit.MILLISECONDS);
            var duration = Duration.between(startedAt, Instant.now());
            if (!completed) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                return new PythonTailoringResult(-1, readFile(stdoutPath), "Python tailoring timed out.", duration, true);
            }

            var stdout = readFile(stdoutPath);
            var stderr = readFile(stderrPath);
            return new PythonTailoringResult(process.exitValue(), stdout, stderr, duration, false);
        } catch (IOException exception) {
            return new PythonTailoringResult(126, "", "Could not start Python tailoring process.", Duration.between(startedAt, Instant.now()), false);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new PythonTailoringResult(125, "", "Python tailoring process was interrupted.", Duration.between(startedAt, Instant.now()), false);
        } finally {
            deleteTempFile(stdoutPath);
            deleteTempFile(stderrPath);
        }
    }

    private String readFile(Path path) throws IOException {
        return path == null ? "" : Files.readString(path, StandardCharsets.UTF_8);
    }

    private void deleteTempFile(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // Temporary output capture cleanup should not hide process results.
        }
    }
}
