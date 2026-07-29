# Correlation IDs and Safe Logging

Local services use a generated `requestId` to correlate one resume tailoring request across Java, RabbitMQ, the ASP.NET document service, and the Python tailoring service.

## Flow

1. Java creates a `requestId` when `ResumeVersionService` publishes `ResumeTailoringRequestedEvent`.
2. Java sends the ID in RabbitMQ:
   - Message body: `requestId`
   - Message property: `correlationId`
   - Headers: `requestId`, `applicationId`, `resumeVersionId`
3. The Java worker logs the RabbitMQ receipt and uses the same `requestId` for document processing.
4. Java calls the ASP.NET document service with:
   - HTTP headers: `X-Correlation-ID`, `X-Request-ID`, `X-Application-ID`, `X-Resume-Version-ID`
   - Multipart fields: `requestId`, `applicationId`, `resumeVersionId`
5. ASP.NET logs document processing stages and forwards the same IDs to Python using the same headers and multipart fields.
6. Python logs JSON lines with the same IDs.

## Logged Fields

Logs should include:

- `requestId`
- `applicationId`
- `resumeVersionId`
- `documentId` when available
- `stage`
- `durationMs`
- `safeErrorCode`

## Sensitive Data

By default logs must not include:

- Resume content
- Job-description content
- Evidence content
- Secrets, passwords, tokens, or connection strings
- Absolute stored file paths unless debugging locally and explicitly needed

User-facing errors should remain safe contract errors. Server logs may include stack traces for unexpected failures or transport failures, but the response body should not expose stack traces, filesystem paths, secrets, resume text, or job text.

## Stages

Common stage names are intentionally simple strings for grep-friendly local logs:

```text
tailoring.rabbit.received
tailoring.skipped
document-service.http.request
document-service.http.response
document-service.http.error
document.tailor.received
document.tailor.completed
python.http.response
python.http.retry
python.tailor.received
python.tailor.completed
tailoring.completed
tailoring.retry
tailoring.failed
```

No paid monitoring or hosted tracing service is required for this flow.
