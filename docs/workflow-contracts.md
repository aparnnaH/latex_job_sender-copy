# Workflow Contracts

## Purpose

This document defines the shared contracts for the intended TailorTeX / ApplyFlow resume-tailoring workflow before service integration changes are made.

The intended workflow is:

1. The frontend creates or selects a job application.
2. Java stores the application and creates a pending resume version.
3. Java publishes or handles a tailoring job.
4. Java calls the ASP.NET Core document service.
5. ASP.NET Core calls the Python tailoring engine.
6. Python creates a tailored `.tex` file and a JSON report.
7. ASP.NET Core validates and compiles the result.
8. Java records whether the job completed or failed.
9. The frontend displays the result.

## Shared Rules

### Stable IDs

All workflow records use stable IDs:

- `applicationId`: UUID identifying the job application.
- `resumeVersionId`: UUID identifying one tailoring attempt/version for an application.
- `tailoringJobId`: UUID identifying a Java orchestration job.
- `documentRequestId`: UUID/idempotency key for Java-to-ASP.NET document processing.
- `pythonRunId`: UUID identifying one Python engine run.

IDs must be generated once and reused in logs, responses, status checks, and downstream calls.

### Status Values

Use only these workflow status values:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

Status meanings:

- `PENDING`: the request is accepted and recorded, but processing has not started.
- `PROCESSING`: the request is actively being handled by Java, ASP.NET, Python, or the compiler.
- `COMPLETED`: the tailored resume and report are available.
- `FAILED`: processing ended without usable output.

### Error Contract

Every service boundary should use this error shape when returning a failure.

```json
{
  "error": {
    "code": "PYTHON_SCRIPT_NOT_FOUND",
    "message": "The tailoring engine is not configured.",
    "internalDetails": {
      "scriptPath": "../resume-tailor-python/tailor_resume.py"
    },
    "retryable": false
  }
}
```

Fields:

- `code`: stable machine-readable error code.
- `message`: user-safe message suitable for UI display.
- `internalDetails`: optional diagnostic object for logs, traces, or developer tools. Do not expose secrets.
- `retryable`: whether retrying the same request later may succeed.

Recommended common error codes:

```text
VALIDATION_FAILED
APPLICATION_NOT_FOUND
RESUME_VERSION_NOT_FOUND
RESUME_UPLOAD_REJECTED
DOCUMENT_SERVICE_UNAVAILABLE
PYTHON_SCRIPT_NOT_FOUND
PYTHON_PROCESS_FAILED
PYTHON_PROCESS_TIMEOUT
PYTHON_RESULT_INVALID
LATEX_COMPILE_FAILED
ARTIFACT_NOT_FOUND
INTERNAL_ERROR
```

## Contract: Creating An Application

Boundary: frontend to Java.

Endpoint:

```text
POST /api/applications
```

Request:

```json
{
  "company": "Acme Corp",
  "jobTitle": "Frontend Engineer",
  "jobDescription": "Build and maintain React and TypeScript workflow tools...",
  "jobUrl": "https://example.com/jobs/frontend-engineer"
}
```

Validation:

- `company` is required.
- `jobTitle` is required.
- `jobDescription` is required.
- `jobUrl` is optional, but must be a URL when present.

Success response:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "company": "Acme Corp",
  "jobTitle": "Frontend Engineer",
  "jobDescription": "Build and maintain React and TypeScript workflow tools...",
  "jobUrl": "https://example.com/jobs/frontend-engineer",
  "status": "PENDING",
  "createdAt": "2026-07-29T15:00:00Z",
  "updatedAt": "2026-07-29T15:00:00Z"
}
```

Notes:

- Existing Java status names may differ today. The integration contract should normalize workflow-facing tailoring statuses to `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED`.
- Application lifecycle statuses such as saved, applied, interview, offer, or rejected can remain separate from tailoring status.

Failure response:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The application could not be saved. Check the required fields.",
    "internalDetails": {
      "fields": {
        "company": "Company is required."
      }
    },
    "retryable": false
  }
}
```

## Contract: Starting A Tailoring Job

Boundary: frontend to Java.

Endpoint:

```text
POST /api/applications/{applicationId}/resumes/tailor
```

Request content type:

```text
multipart/form-data
```

Fields:

- `resume`: required `.tex` file or project archive, depending on supported upload mode.
- `sourceFileName`: optional source entry file; defaults to `main.tex`.
- `compilePdf`: optional boolean; defaults to `true`.

Logical request shape:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resume": {
    "fileName": "main.tex",
    "contentType": "application/x-tex",
    "sizeBytes": 48231
  },
  "sourceFileName": "main.tex",
  "compilePdf": true
}
```

Success response:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "tailoringJobId": "a0cf3f96-3928-4804-9306-12eef8f35d3a",
  "status": "PENDING",
  "createdAt": "2026-07-29T15:02:00Z",
  "statusUrl": "/api/resume-versions/f7687ed5-ec96-4ad5-9f09-13a7f85f44ed"
}
```

Failure response:

```json
{
  "error": {
    "code": "RESUME_UPLOAD_REJECTED",
    "message": "Only LaTeX resume files are supported.",
    "internalDetails": {
      "fileName": "resume.docx",
      "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    "retryable": false
  }
}
```

## Contract: Checking Tailoring Status

Boundary: frontend to Java.

Endpoint:

```text
GET /api/resume-versions/{resumeVersionId}
```

Processing response:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "tailoringJobId": "a0cf3f96-3928-4804-9306-12eef8f35d3a",
  "status": "PROCESSING",
  "createdAt": "2026-07-29T15:02:00Z",
  "updatedAt": "2026-07-29T15:02:30Z",
  "artifacts": {
    "tailoredTexUrl": null,
    "reportJsonUrl": null,
    "compiledPdfUrl": null
  },
  "reportSummary": null,
  "error": null
}
```

Completed response:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "tailoringJobId": "a0cf3f96-3928-4804-9306-12eef8f35d3a",
  "status": "COMPLETED",
  "createdAt": "2026-07-29T15:02:00Z",
  "updatedAt": "2026-07-29T15:03:20Z",
  "artifacts": {
    "tailoredTexUrl": "/api/resume-versions/f7687ed5-ec96-4ad5-9f09-13a7f85f44ed/download/tex",
    "reportJsonUrl": "/api/resume-versions/f7687ed5-ec96-4ad5-9f09-13a7f85f44ed/download/report",
    "compiledPdfUrl": "/api/resume-versions/f7687ed5-ec96-4ad5-9f09-13a7f85f44ed/download/pdf"
  },
  "reportSummary": {
    "matchScore": 87,
    "matchedSkills": [
      "React",
      "TypeScript"
    ],
    "missingRequirements": [
      "GraphQL"
    ],
    "summary": "Tailored the project and skills sections toward frontend workflow tooling."
  },
  "error": null
}
```

Failed response:

```json
{
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "tailoringJobId": "a0cf3f96-3928-4804-9306-12eef8f35d3a",
  "status": "FAILED",
  "createdAt": "2026-07-29T15:02:00Z",
  "updatedAt": "2026-07-29T15:03:20Z",
  "artifacts": {
    "tailoredTexUrl": null,
    "reportJsonUrl": null,
    "compiledPdfUrl": null
  },
  "reportSummary": null,
  "error": {
    "code": "LATEX_COMPILE_FAILED",
    "message": "The tailored resume could not be compiled.",
    "internalDetails": {
      "compilerLogPath": "/tmp/applyflow/resumes/.../compile.log"
    },
    "retryable": false
  }
}
```

## Contract: ASP.NET Document Processing

Boundary: Java to ASP.NET Core document service.

Recommended endpoint:

```text
POST /api/documents/process
```

JSON Schema files:

- `contracts/document-processing-request.schema.json`
- `contracts/document-processing-result.schema.json`

Request:

```json
{
  "requestId": "ec2dd3e8-eab7-4ddd-9c6b-73740e0a3bb7",
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "job": {
    "company": "Acme Corp",
    "title": "Frontend Engineer",
    "description": "Build and maintain React and TypeScript workflow tools...",
    "url": "https://example.com/jobs/frontend-engineer"
  },
  "input": {
    "resumeTexPath": "/tmp/applyflow/resumes/app/version/input.tex",
    "projectRootPath": null,
    "outputDirectory": "/tmp/applyflow/resumes/app/version",
    "sourceFileName": "main.tex"
  },
  "processing": {
    "compilePdf": true,
    "maxUploadBytes": 1048576,
    "timeoutSeconds": 60,
    "pythonExecutable": "python3",
    "pythonScriptPath": "../resume-tailor-python/tailor_resume.py",
    "tectonicPath": null
  }
}
```

Success response:

```json
{
  "requestId": "ec2dd3e8-eab7-4ddd-9c6b-73740e0a3bb7",
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "status": "COMPLETED",
  "artifacts": {
    "tailoredTexPath": "/tmp/applyflow/resumes/app/version/tailored.tex",
    "reportJsonPath": "/tmp/applyflow/resumes/app/version/report.json",
    "compiledPdfPath": "/tmp/applyflow/resumes/app/version/tailored.pdf",
    "compilerLogPath": "/tmp/applyflow/resumes/app/version/compile.log"
  },
  "report": {
    "matchScore": 87,
    "matchedSkills": [
      "React",
      "TypeScript"
    ],
    "missingRequirements": [
      "GraphQL"
    ],
    "suggestions": [],
    "unsupportedClaims": [],
    "summary": "Tailored the project and skills sections toward frontend workflow tooling."
  }
}
```

Failed response:

```json
{
  "requestId": "ec2dd3e8-eab7-4ddd-9c6b-73740e0a3bb7",
  "applicationId": "8d7e0fc1-78b4-4e62-9dd3-54a41f7055de",
  "resumeVersionId": "f7687ed5-ec96-4ad5-9f09-13a7f85f44ed",
  "status": "FAILED",
  "artifacts": {
    "tailoredTexPath": null,
    "reportJsonPath": null,
    "compiledPdfPath": null,
    "compilerLogPath": "/tmp/applyflow/resumes/app/version/compile.log"
  },
  "report": {
    "matchScore": 0,
    "matchedSkills": [],
    "missingRequirements": [],
    "suggestions": [],
    "unsupportedClaims": [],
    "summary": ""
  },
  "error": {
    "code": "PYTHON_PROCESS_TIMEOUT",
    "message": "The tailoring engine took too long to respond.",
    "internalDetails": {
      "timeoutSeconds": 60
    },
    "retryable": true
  }
}
```

ASP.NET responsibilities for this contract:

- Validate the request JSON.
- Validate paths and configured tool availability.
- Call Python.
- Validate Python output files and report JSON.
- Compile the tailored `.tex` when `compilePdf` is true.
- Return `COMPLETED` only when required artifacts are present and valid.
- Return `FAILED` with the shared error contract for Python, validation, or compile failures.

## Contract: Python Tailoring Results

Boundary: Python tailoring engine to ASP.NET Core document service.

Invocation remains compatible with the existing three-argument contract:

```sh
python3 tailor_resume.py input-resume.tex "job description text" output-resume.tex
```

Recommended extended invocation for the workflow:

```sh
python3 tailor_resume.py input-resume.tex "job description text" output-resume.tex --report-json report.json --run-id PYTHON_RUN_ID
```

Python must write:

- Tailored LaTeX file at the requested output path.
- JSON report at the requested report path when `--report-json` is supplied.

Python report shape:

```json
{
  "pythonRunId": "4c95f592-05a6-4a4f-ae58-f1e55e0d61b6",
  "status": "COMPLETED",
  "input": {
    "resumeTexPath": "/tmp/applyflow/resumes/app/version/input.tex",
    "outputTexPath": "/tmp/applyflow/resumes/app/version/tailored.tex"
  },
  "analysis": {
    "matchScore": 87,
    "requiredSkills": [
      "React",
      "TypeScript"
    ],
    "preferredSkills": [
      "GraphQL"
    ],
    "matchedSkills": [
      "React",
      "TypeScript"
    ],
    "missingRequirements": [
      "GraphQL"
    ],
    "unsupportedClaims": []
  },
  "changes": [
    {
      "id": "change-001",
      "fileName": "main.tex",
      "line": 42,
      "section": "Projects",
      "original": "Built an analytics dashboard.",
      "replacement": "Built a React and TypeScript analytics dashboard.",
      "reason": "Highlights supported frontend evidence for the target role.",
      "confidence": "HIGH"
    }
  ],
  "summary": "Tailored project and skills language for the target frontend role.",
  "error": null
}
```

Python failure report:

```json
{
  "pythonRunId": "4c95f592-05a6-4a4f-ae58-f1e55e0d61b6",
  "status": "FAILED",
  "input": {
    "resumeTexPath": "/tmp/applyflow/resumes/app/version/input.tex",
    "outputTexPath": "/tmp/applyflow/resumes/app/version/tailored.tex"
  },
  "analysis": {
    "matchScore": 0,
    "requiredSkills": [],
    "preferredSkills": [],
    "matchedSkills": [],
    "missingRequirements": [],
    "unsupportedClaims": []
  },
  "changes": [],
  "summary": "",
  "error": {
    "code": "PYTHON_PROCESS_FAILED",
    "message": "The tailoring engine could not process the resume.",
    "internalDetails": {
      "phase": "latex_parse"
    },
    "retryable": false
  }
}
```

Python status values must use:

```text
COMPLETED
FAILED
```

`PENDING` and `PROCESSING` are owned by Java and ASP.NET orchestration layers.

## Frontend Display Contract

The frontend should display status from Java, not from ASP.NET or Python directly.

Required display fields:

- `status`
- `reportSummary.matchScore`
- `reportSummary.matchedSkills`
- `reportSummary.missingRequirements`
- artifact URLs when completed
- `error.message` when failed

The frontend should not display `internalDetails` to ordinary users.

## Versioning

Initial contract version:

```text
workflow-contracts.v1
```

Backward-compatible additions may add optional fields. Renaming fields, changing status values, or changing required artifact behavior requires a new contract version.
