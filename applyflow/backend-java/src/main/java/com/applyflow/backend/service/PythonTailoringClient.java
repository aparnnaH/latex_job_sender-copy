package com.applyflow.backend.service;

import java.nio.file.Path;

public interface PythonTailoringClient {

    PythonTailoringResult tailor(Path inputResumePath, String jobDescription, Path outputResumePath);
}
