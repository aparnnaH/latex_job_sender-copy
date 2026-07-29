# Current Architecture

## Purpose

TailorTeX / ApplyFlow is a LaTeX resume-tailoring and job-application tracking workspace. The repository currently combines a local-first Next.js tailoring application, an event-ready Java Spring Boot backend, a small ASP.NET Core wrapper API, a LaTeX resume project, and a reserved location for a missing Python tailoring script.

## Current Repository Structure

```text
.
├── README.md
├── package.json
├── src/
│   ├── app/
│   │   ├── api/compile/route.ts
│   │   ├── api/local-store/route.ts
│   │   ├── api/project/route.ts
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/TailorTexApp.tsx
│   ├── lib/
│   │   ├── jobAnalysis.ts
│   │   ├── latex.ts
│   │   ├── nlp.ts
│   │   ├── samples.ts
│   │   └── schemas.ts
│   └── types/tailortex.ts
├── resume-project/
│   ├── main.tex
│   ├── page1sidebar.tex
│   ├── page2sidebar.tex
│   └── altacv.cls
├── data/
│   └── example.tailortex.json
├── applyflow/
│   ├── README.md
│   ├── docker-compose.yml
│   ├── backend-java/
│   │   ├── pom.xml
│   │   └── src/main/java/com/applyflow/backend/
│   └── resume-tailor-python/
│       └── README.md
├── api/
│   ├── Program.cs
│   ├── ResumeTailoring.Api.csproj
│   └── appsettings.json
└── docs/
    └── current-architecture.md
```

Generated and local-only artifacts are also present, including `.next/`, `node_modules/`, `tsconfig.tsbuildinfo`, `.DS_Store`, and private resume files under `resume-project/`.

## Current Responsibilities

### Next.js App

The root Next.js app is the most complete product surface.

Current responsibilities:

- Presents the main TailorTeX UI from `src/components/TailorTexApp.tsx`.
- Loads the local LaTeX resume project from `resume-project/` through `GET /api/project`.
- Parses and validates LaTeX source with `@unified-latex/unified-latex` plus local command parsing.
- Detects resume sections, fields, projects, skills, certificates, experience, and education.
- Analyzes job descriptions locally with deterministic heuristics and `wink-nlp`.
- Computes match score, matched skills, missing requirements, keyword coverage, and project recommendations.
- Generates local structured suggestions without calling an external LLM or Python service.
- Applies accepted changes directly to in-memory LaTeX files.
- Compiles PDF previews through `POST /api/compile`, which shells out to Tectonic.
- Applies preview-only LaTeX compatibility fixes for `hyperref`, legacy Font Awesome, fonts, and unused `biblatex` setup.
- Saves and restores data using browser `localStorage`.
- Saves and restores a server-side local JSON file at `data/tailortex.local.json` through `GET/POST /api/local-store`.
- Exports tailored LaTeX files, ZIP projects, application packets, local backups, and generated application answers.
- Tracks job applications locally inside the browser/local JSON data model.

### Java Spring Boot Backend

The Java backend in `applyflow/backend-java/` is an event-ready backend for persistent application tracking and asynchronous resume tailoring.

Current responsibilities:

- Exposes CRUD endpoints for job applications under `/api/applications`.
- Stores job applications in PostgreSQL via Spring Data JPA.
- Stores resume-version metadata in PostgreSQL.
- Accepts `.tex` resume uploads for a job application.
- Saves uploaded resume files to a configured filesystem storage directory.
- Publishes `ResumeTailoringRequestedEvent` messages to RabbitMQ.
- Runs a RabbitMQ worker that marks resume versions `PROCESSING`, calls the configured Python script, retries failures, marks versions `COMPLETED` or `FAILED`, and cleans failed output files.
- Exposes resume-version lookup and generated `.tex` download endpoints under `/api/resume-versions`.
- Uses Flyway migrations for database schema.
- Uses Testcontainers-based integration tests for PostgreSQL-backed controller coverage.

### ASP.NET Core API

The `api/` project is a separate minimal ASP.NET Core API.

Current responsibilities:

- Exposes `POST /api/resumes/tailor`.
- Accepts multipart form data with a `.tex` resume file and `jobDescription`.
- Validates upload presence, file extension, non-empty content, and maximum upload size.
- Writes input/output files to a temporary working directory.
- Calls a configured Python script with positional arguments.
- Returns the generated `.tex` file directly when Python succeeds.
- Returns JSON errors for validation failures, missing script, process-start failure, non-zero Python exit, and missing output.
- Deletes temporary work files after each request.

## Existing Workflow

### Local TailorTeX Workflow

1. User opens the Next.js app.
2. The app tries to restore data from `data/tailortex.local.json` and browser `localStorage`.
3. If no saved project is available, it loads files from `resume-project/` or falls back to sample data.
4. User enters job details and a job description.
5. The app analyzes the job description locally.
6. The app parses the LaTeX resume and detects editable fields.
7. The app compares job requirements against resume content.
8. User reviews deterministic suggestions, project rankings, keyword coverage, and fit warnings.
9. User accepts/edits/hides content.
10. The app applies changes to local LaTeX source.
11. User can compile the original or tailored project to PDF through the Tectonic API route.
12. User downloads `.tex`, ZIP, or application packet outputs.
13. User can save the session/application record locally.

### Java ApplyFlow Workflow

1. Client creates a job application through the Java API.
2. Client uploads a `.tex` resume for that application.
3. Java validates and stores the input resume.
4. Java creates a pending resume-version record.
5. Java publishes a RabbitMQ tailoring event.
6. Java worker receives the event.
7. Worker calls the configured Python script with:

   ```sh
   python3 path/to/script.py input-resume.tex "job description text" output-resume.tex
   ```

8. Worker marks the resume version complete or failed.
9. Client polls the resume-version endpoint and downloads the generated `.tex` when complete.

### ASP.NET Core Workflow

1. Client uploads a `.tex` resume and job description to `POST /api/resumes/tailor`.
2. API validates the request.
3. API calls the configured Python script with the same three-argument contract.
4. API returns the generated `.tex` synchronously.

## Duplicated Or Overlapping Functionality

- **Resume upload validation** exists in both Java and ASP.NET Core.
- **Python process invocation** exists in both Java and ASP.NET Core.
- **Tailored `.tex` response/download behavior** exists in both Java and ASP.NET Core, with Java using async persistence and C# using synchronous request/response.
- **Job application tracking** exists in both the Next.js local app and the Java backend.
- **Resume-version/session persistence** exists locally in Next.js and durably in the Java backend.
- **Tailoring orchestration** exists locally in Next.js as deterministic source edits and externally in Java/C# as a missing Python call.
- **File storage** exists in Next.js local JSON/browser state, Java filesystem storage, and C# temporary files.
- **API ownership is unclear** because the Next.js UI does not currently call the Java backend or ASP.NET Core API for application tracking or resume tailoring.

## Missing Components

- The Python tailoring entry point is absent.
- There is no implemented Python package, dependency manifest, test suite, CLI, or documented output schema beyond the positional command contract.
- There is no LLM/API integration in the current Next.js app despite `AiResponseShape` and AI-oriented naming.
- There is no stable shared contract between the Next.js local suggestion model and the Java/Python asynchronous tailoring model.
- There is no frontend integration with the Java ApplyFlow API.
- There is no frontend integration with the ASP.NET Core API.
- There is no authentication, user model, or multi-user data isolation.
- There is no persistent backend storage for the Next.js local sessions unless `data/tailortex.local.json` is treated as a local single-user store.
- There is no production deployment configuration tying frontend, Java API, queue, database, Python worker, and compile service together.
- There is no documented decision about whether the ASP.NET Core API is a prototype, legacy bridge, or supported service.

## Broken Integrations And Incomplete Areas

- Java defaults `PYTHON_TAILORING_SCRIPT_PATH` to `../resume-tailor-python/tailor_resume.py`, but that file does not exist.
- ASP.NET Core defaults `PythonTailoring:ScriptPath` to `../tailor_resume.py`, but that file does not exist.
- The root README states that the current workspace does not contain the Python tailoring script.
- `applyflow/resume-tailor-python/README.md` is a placeholder confirming the Python code is absent.
- The Next.js app labels behavior as AI-assisted, but current analysis and suggestions are deterministic local heuristics.
- `aiResponseSchema` and `AiResponseShape` exist, but no external AI route or provider integration is present.
- Next.js local application records duplicate the domain that Java persists, but there is no sync or migration path between them.
- Java has retry-related fields such as `attempt_count`, but the current worker loop does not persist attempt count changes.
- Java event publishing occurs after saving the resume version, but there is no outbox pattern; a database commit followed by RabbitMQ publish failure could leave a pending version with no queued job.
- Java worker rejects failed jobs without requeue after internally retrying, so DLQ behavior depends on RabbitMQ dead-letter setup rather than application-level failure recovery.
- The C# API has no tests in this snapshot.
- Next.js compile requires Tectonic to be available on the host path or through `TECTONIC_PATH`; missing Tectonic causes compile failures.
- `GET /api/project` is hard-coded to four public resume files and ignores additional private or asset files in `resume-project/`.
- Server-side local storage writes to `data/tailortex.local.json`, which is appropriate for local development but not safe as a multi-user backend store.

## Places That Expect The Missing Python Script

- `README.md` documents the missing script and the expected command contract.
- `api/appsettings.json` configures `PythonTailoring:ScriptPath` as `../tailor_resume.py`.
- `api/Program.cs` checks whether the configured script exists and starts Python with the expected arguments.
- `applyflow/README.md` documents `PYTHON_TAILORING_SCRIPT_PATH` and the same command contract.
- `applyflow/resume-tailor-python/README.md` reserves the Python location and repeats the contract.
- `applyflow/backend-java/src/main/resources/application.yml` defaults `applyflow.tailoring.python-script-path` to `../resume-tailor-python/tailor_resume.py`.
- `applyflow/backend-java/src/main/java/com/applyflow/backend/config/ApplyFlowProperties.java` binds Python executable, script path, timeout, and retry attempts.
- `applyflow/backend-java/src/main/java/com/applyflow/backend/service/PythonTailoringClient.java` defines the tailoring interface.
- `applyflow/backend-java/src/main/java/com/applyflow/backend/service/ProcessBuilderPythonTailoringClient.java` validates the script path and starts the Python process.
- `applyflow/backend-java/src/main/java/com/applyflow/backend/worker/ResumeTailoringWorker.java` calls the Python client from the RabbitMQ worker.
- Java tests under `applyflow/backend-java/src/test/` mock or configure Python-tailoring behavior.

## Recommended Responsibility By Service

### Next.js

Recommended role: primary user interface and local preview/editor.

Recommended responsibilities:

- Own user-facing resume editing, review, diffing, project selection, PDF preview controls, and downloads.
- Keep LaTeX parsing/editing client-friendly where immediate feedback is useful.
- Call backend APIs for durable application tracking and asynchronous tailoring once those APIs are ready.
- Treat browser/local JSON persistence as development or offline mode, not the canonical production store.
- Keep Tectonic preview either as a Next.js local dev route or move it to a dedicated compile service if production isolation is required.

### Java Spring Boot

Recommended role: canonical backend for ApplyFlow.

Recommended responsibilities:

- Own job applications, statuses, resume versions, durable persistence, backend validation, audit metadata, and downloads.
- Own RabbitMQ event orchestration and worker lifecycle.
- Own integration with the Python tailoring engine through a stable service contract.
- Expose frontend-facing APIs for application records and async tailoring status.
- Persist attempt counts, structured failure details, and output metadata.

### Python Tailoring Engine

Recommended role: isolated resume intelligence and LaTeX transformation engine.

Recommended responsibilities:

- Own deeper AI/LLM analysis, job-description extraction, resume-to-job matching, supported-claim checks, and source-safe LaTeX transformations.
- Provide a stable CLI initially to satisfy existing Java/C# contracts.
- Later expose a structured JSON mode or service API so Java and Next.js can consume rich suggestions and diagnostics.
- Include tests with representative `.tex` projects and job descriptions.

### ASP.NET Core API

Recommended role: either retire or explicitly keep as a thin prototype/compatibility adapter.

Recommended responsibilities if retained:

- Serve only as a simple synchronous adapter around Python for demos or legacy consumers.
- Avoid becoming a second canonical application/resume backend.
- Reuse the same Python contract and validation rules as Java.

Recommended direction: mark it as experimental unless there is a concrete .NET consumer.

### PostgreSQL And RabbitMQ

Recommended role: production backend infrastructure for the Java ApplyFlow path.

Recommended responsibilities:

- PostgreSQL stores canonical job applications, resume versions, statuses, output metadata, and future user/account data.
- RabbitMQ handles asynchronous tailoring requests, retries/dead-lettering, and worker decoupling.

## Phased Implementation Plan

### Phase 1: Stabilize Contracts

- Decide whether Java is the canonical backend and whether ASP.NET Core remains supported.
- Define the Python tailoring CLI contract in one document.
- Define expected input/output files, exit codes, stdout/stderr behavior, timeout behavior, and error messages.
- Add a small fixture-based Python placeholder or contract test only after the contract is agreed.
- Document frontend-to-backend API expectations for application tracking and tailoring status.

### Phase 2: Add The Python Tailoring Engine

- Add `applyflow/resume-tailor-python/tailor_resume.py`.
- Keep the existing three-positional-argument interface working.
- Add a Python dependency manifest and tests.
- Start with deterministic transformations compatible with current Next.js heuristics.
- Add optional structured JSON output for match analysis, suggested changes, and unsupported claims.

### Phase 3: Make Java The Canonical Backend

- Persist tailoring attempt counts and richer failure details.
- Add an outbox or reliable publish strategy for resume-tailoring events.
- Add contract tests around Python invocation.
- Add API coverage for resume-version lifecycle and download behavior.
- Confirm queue, DLQ, retry, timeout, and cleanup semantics.

### Phase 4: Integrate The Frontend With Java

- Add a frontend API client for Java application records.
- Replace or augment local application tracking with backend persistence.
- Add async tailoring request and polling/status UI.
- Keep local-only mode as an explicit fallback if desired.
- Align frontend data models with Java DTOs and Python structured results.

### Phase 5: Resolve ASP.NET Core Ownership

- If needed, keep the C# API as a compatibility adapter and add tests.
- If not needed, document it as deprecated before removing it in a separate cleanup task.
- Avoid adding new product features to both Java and C# paths.

### Phase 6: Production Hardening

- Add authentication and user scoping.
- Replace local JSON storage for production use.
- Add storage abstraction for resume inputs/outputs.
- Add observability for compile/tailoring failures.
- Add deployment docs for frontend, Java API, PostgreSQL, RabbitMQ, Python runtime, and Tectonic.
- Add end-to-end tests for the primary workflow.

## Safe Checks Run During Audit

```sh
npm run typecheck
npm run lint
```

Both checks passed.
