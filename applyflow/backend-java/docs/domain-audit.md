# Java Domain Audit

## Scope

This audit covers only `applyflow/backend-java/`: domain entities, repositories, controllers, services, database migrations, and the RabbitMQ tailoring workflow.

## Existing Entities

### `JobApplication`

Table: `job_applications`

Current fields:

- `id`: UUID primary key.
- `company`: required string.
- `jobTitle`: required string.
- `jobDescription`: required text.
- `jobUrl`: optional string, max 2048.
- `status`: required `JobApplicationStatus`.
- `createdAt`: required timestamp.
- `updatedAt`: required timestamp.

Lifecycle:

- `@PrePersist` creates a UUID when missing.
- `@PrePersist` defaults status to `SAVED`.
- `@PrePersist` and `@PreUpdate` maintain timestamps.

Status values:

- `SAVED`
- `ANALYZING`
- `RESUME_READY`
- `APPLIED`
- `INTERVIEW`
- `OFFER`
- `REJECTED`
- `WITHDRAWN`

### `ResumeVersion`

Table: `resume_versions`

Current fields:

- `id`: UUID primary key.
- `jobApplicationId`: required UUID.
- `originalFileName`: required string.
- `storedFilePath`: required path string, max 2048.
- `outputFilePath`: optional path string, max 2048.
- `versionNumber`: required integer.
- `tailoringStatus`: required `TailoringStatus`.
- `createdAt`: required timestamp.
- `updatedAt`: required timestamp.
- `failureMessage`: optional text.
- `attemptCount`: required integer, default `0`.
- `processingStartedAt`: optional timestamp.
- `processingCompletedAt`: optional timestamp.

Lifecycle:

- `@PrePersist` creates a UUID when missing.
- `@PrePersist` defaults tailoring status to `PENDING`.
- `@PrePersist` and `@PreUpdate` maintain timestamps.

Tailoring status values:

- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

## Existing Endpoints

### Application Endpoints

Base path: `/api/applications`

- `POST /api/applications`
  - Creates a job application.
  - Request body: `JobApplicationRequest`.
  - Response: `201 Created` with `JobApplicationResponse`.

- `GET /api/applications`
  - Lists all job applications.
  - Response: `List<JobApplicationResponse>`.

- `GET /api/applications/{id}`
  - Gets one job application.
  - Response: `JobApplicationResponse`.

- `PUT /api/applications/{id}`
  - Replaces company, title, description, and URL.
  - Response: `JobApplicationResponse`.

- `PATCH /api/applications/{id}/status`
  - Updates application status.
  - Request body: `StatusUpdateRequest`.
  - Response: `JobApplicationResponse`.

- `DELETE /api/applications/{id}`
  - Deletes one job application.
  - Response: `204 No Content`.

- `POST /api/applications/{id}/resumes/tailor`
  - Accepts multipart `resume` file.
  - Creates a pending resume version and publishes a tailoring event.
  - Response: `202 Accepted` with `ResumeVersionResponse`.

### Resume Version Endpoints

Base path: `/api/resume-versions`

- `GET /api/resume-versions/{id}`
  - Gets resume-version status and metadata.
  - Response: `ResumeVersionResponse`.

- `GET /api/resume-versions/{id}/download`
  - Downloads generated `.tex`.
  - Only succeeds when `tailoringStatus == COMPLETED` and output file exists.

### Health Endpoint

- `GET /actuator/health`
  - Exposed through Spring Boot Actuator.

## Existing Database Relationships

### Physical Schema

`resume_versions.job_application_id` has a database foreign key to `job_applications.id` with `ON DELETE CASCADE`.

There is an index:

```sql
idx_resume_versions_job_application_id
```

### Java Model

The Java entity model stores `ResumeVersion.jobApplicationId` as a plain `UUID`. There is no JPA `@ManyToOne`, `@OneToMany`, or entity-level cascade relationship.

This keeps the model simple, but it means:

- application/version navigation is manual;
- version queries need repository methods by `jobApplicationId`;
- deletes rely on database cascade rather than JPA cascade;
- the domain does not currently enforce aggregate invariants in Java.

## Existing Message Flow

1. Client creates a job application through `/api/applications`.
2. Client uploads a `.tex` resume through `/api/applications/{id}/resumes/tailor`.
3. `ResumeVersionService.requestTailoring` loads the application.
4. `ResumeFileStorageService.storeInput` validates the upload and writes:
   - `input.tex`
   - expected output path `tailored.tex`
5. `ResumeVersionService` creates a `ResumeVersion` with:
   - `PENDING` status;
   - incremented `versionNumber`;
   - stored input path;
   - planned output path.
6. `ResumeTailoringEventPublisher` publishes `ResumeTailoringRequestedEvent` to RabbitMQ.
7. `ResumeTailoringWorker` consumes from `${applyflow.rabbitmq.queue}`.
8. Worker calls `resumeVersionService.markProcessing`.
   - This performs an atomic transition from `PENDING` to `PROCESSING`.
   - It sets `processingStartedAt`, increments `attemptCount`, and clears `failureMessage`.
9. Worker invokes `PythonTailoringClient`.
10. Current Python client is `ProcessBuilderPythonTailoringClient`, which shells out through `ProcessBuilder` without a shell:
    - executable: configured `pythonExecutable`;
    - script path: configured `pythonScriptPath`;
    - arguments: input path, job description, output path.
11. Worker retries internally up to `applyflow.tailoring.max-attempts`.
12. On success and output-file existence:
    - `markCompleted` sets `COMPLETED`, output path, completion timestamp, and clears failure.
13. On final failure:
    - output file is deleted if present;
    - `markFailed` sets `FAILED`, failure message, and completion timestamp;
    - worker throws `AmqpRejectAndDontRequeueException`.
14. RabbitMQ dead-lettering is configured through queue DLX settings.

RabbitMQ objects:

- direct exchange: `applyflow.resume-tailoring`
- durable queue: `applyflow.resume-tailoring.requests`
- routing key: `resume.tailoring.requested`
- dead-letter exchange: `applyflow.resume-tailoring.dlx`
- dead-letter queue: `applyflow.resume-tailoring.dead`

## Missing Application-Tracking Fields

The current `JobApplication` captures core job details, but it is thin for a job-application tracker.

Missing or not yet modeled:

- applied date;
- follow-up date;
- interview date/time;
- decision date;
- source/platform, such as LinkedIn, company portal, referral, email;
- recruiter/contact name;
- contact email or profile URL;
- location;
- remote/hybrid/on-site mode;
- salary or compensation range;
- job type, such as internship, full-time, contract;
- notes;
- user-facing priority;
- favorite/archive flag;
- tags;
- resume version submitted;
- cover-letter/application packet reference;
- generated answers/reference to application form responses;
- external application ID or portal confirmation number;
- status history/audit trail.

## Missing Resume-Version Fields

The current `ResumeVersion` tracks source file, output path, status, attempts, and timing, but it does not yet capture the richer document-processing contract.

Missing or not yet modeled:

- tailoring job ID distinct from resume version ID;
- document service request ID/idempotency key;
- Python run ID;
- report JSON path/reference;
- compiled PDF path/reference;
- compiler log path/reference;
- match score before;
- match score after;
- matched keywords summary;
- missing keywords summary;
- unsupported claims summary;
- sections changed;
- source entry filename for multi-file LaTeX projects;
- project/archive upload metadata;
- content hash/checksum for input and output;
- artifact size metadata;
- structured error code;
- user-safe error message separate from internal failure details;
- retryable flag;
- per-attempt history;
- processing worker identifier;
- queue message ID/correlation ID;
- requested compile flag;
- completed artifact download names.

## Schema Risks

- `ResumeVersion.jobApplicationId` has a database FK but no JPA association. This is workable, but the Java model does not express aggregate boundaries.
- `versionNumber` is calculated with `countByJobApplicationId + 1`, which can race if two tailoring requests are submitted concurrently for the same application.
- There is no uniqueness constraint for `(job_application_id, version_number)`.
- `attempt_count` is incremented only when transitioning `PENDING` to `PROCESSING`; internal worker retry attempts are not individually persisted.
- `processing_started_at` is set only during the initial status transition. It is not updated per retry attempt.
- `output_file_path` is set before processing starts as an expected path, so its presence does not mean output exists.
- Filesystem paths are stored directly in response DTOs, exposing local implementation details through `ResumeVersionResponse`.
- Failure data is a single free-text `failure_message`, without stable error code, retryable flag, or internal/user-safe split.
- No outbox pattern protects the save-then-publish sequence. If database save succeeds and RabbitMQ publish fails, a version can remain `PENDING` without a message.
- No explicit queue message ID, correlation ID, or idempotency key is stored.
- No schema-level length is defined on enum columns beyond migration `varchar(32)`, which is probably enough today but should be deliberate.
- Deleting a job application cascades resume-version rows in the database, but related filesystem artifacts are not automatically deleted.
- `stored_file_path` and `output_file_path` have no ownership or path traversal guard at the schema level. Storage service currently constructs paths from UUIDs, but persisted paths remain trusted later.
- There is no table for document-processing artifacts such as PDF/report/log outputs.

## Recommended Minimal Changes

These are intentionally small, incremental changes rather than a large rewrite.

1. Add schema fields for the shared workflow contract:
   - `document_request_id`
   - `report_json_path`
   - `compiled_pdf_path`
   - `compiler_log_path`
   - `error_code`
   - `error_message`
   - `error_retryable`

2. Stop exposing raw filesystem paths in public DTOs.
   - Keep paths internal.
   - Return generated IDs and download URLs/references instead.

3. Add a uniqueness constraint:
   - `(job_application_id, version_number)`

4. Make version-number allocation concurrency-safe.
   - Minimal option: add the uniqueness constraint and retry on conflict.
   - Better option later: maintain a per-application counter or use a database sequence-like strategy.

5. Persist meaningful attempt information.
   - Either increment `attempt_count` for every internal worker attempt, or rename the field to match current semantics.
   - Prefer adding a small `resume_version_attempts` table later if retry diagnostics matter.

6. Add reliable publish protection.
   - Minimal option: catch Rabbit publish failures and mark the version `FAILED` with a stable error code.
   - Better option: add an outbox table and background publisher.

7. Update Java tailoring integration direction.
   - The intended workflow now routes Java to the ASP.NET document service.
   - Replace direct Python process ownership with a document-service client behind an interface.
   - Keep the current `PythonTailoringClient` only as a temporary local fallback if still needed.

8. Add application-tracking fields in small batches.
   - First useful batch: `applied_at`, `follow_up_at`, `interview_at`, `decision_at`, `notes`, `source`, `contact_name`, `contact_email`.

9. Add artifact cleanup policy.
   - On application delete, delete associated resume artifacts.
   - Alternatively, add an explicit retention/cleanup job.

10. Align error response shape with the shared workflow contract.
    - Add stable code, user-safe message, internal details, and retryable flag to backend errors.

11. Add endpoint for listing resume versions by application.
    - `GET /api/applications/{id}/resume-versions`
    - This avoids forcing clients to infer version history from individual version IDs.

12. Add status history later, not first.
    - Useful for tracking application lifecycle and debugging workflow failures, but not necessary for the next minimal integration step.
