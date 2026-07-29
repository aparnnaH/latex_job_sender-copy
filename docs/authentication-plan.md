# Authentication Plan

## Purpose

ApplyFlow should eventually support user accounts and multi-user data isolation, but authentication is not implemented in this task. This plan documents the recommended direction without changing runtime behavior or adding authentication libraries.

## Recommended Approach

Use the Java Spring Boot API as the canonical authorization boundary. Next.js should authenticate the user for the browser experience, then call the Java API with a user-bound access token. The Java API must independently validate identity and enforce ownership on every application, resume version, document, and download endpoint.

Recommended production shape:

- Next.js owns user sign-in, sign-out, session UI state, and authenticated frontend routing.
- An external OpenID Connect provider issues identity tokens and/or access tokens.
- Spring Boot acts as an OAuth2 resource server and validates signed JWT access tokens.
- PostgreSQL stores application data with explicit `user_id` ownership fields.
- Service-to-service calls use a separate trust mechanism from end-user authentication.

Do not rely on the browser or Next.js alone for authorization. Next.js can hide UI, but Spring Boot must reject cross-user access even when endpoints are called directly.

## Next.js Plan

Next.js should use an OIDC-compatible authentication layer rather than custom password handling. Good future options are Auth.js/NextAuth with an OIDC provider, Clerk, Auth0, Cognito, or another hosted identity provider. The exact provider can be chosen later based on deployment and account-management needs.

Recommended behavior:

- Keep local-only mode available for development and offline experimentation.
- In backend mode, require a signed-in session before creating applications, uploading resumes, reviewing versions, or downloading artifacts.
- Attach an access token to Java API requests with `Authorization: Bearer <token>`.
- Avoid storing tokens in localStorage. Prefer secure, HTTP-only cookies for the Next.js session and short-lived access tokens for backend calls.
- Do not put user IDs in request bodies as trusted ownership input. The backend should derive identity from the token.

The current `src/lib/api/http.ts` client can later be extended to include credentials or an authorization header, but this task intentionally does not change it.

## Spring Boot Identity Validation

Spring Boot should validate every request that touches persisted data or stored files.

Recommended implementation:

- Configure Spring Security as an OAuth2 resource server.
- Validate JWT signature, issuer, audience, expiration, and token use.
- Extract a stable external subject from the token, usually `sub`.
- Map the external subject to an internal `users.id` UUID.
- Store the internal user ID on owned records.
- Enforce ownership in repository queries and service methods.

Example ownership pattern:

```text
GET /api/applications/{id}
1. Authenticate JWT.
2. Resolve current internal user ID.
3. Query by application ID and user ID.
4. Return 404 or 403 if no owned record exists.
```

Prefer ownership-aware repository methods such as `findByIdAndUserId(...)`, `existsByIdAndUserId(...)`, and `findByJobApplicationIdAndUserId(...)`. Avoid fetching a record by ID and checking ownership only in the controller; service-layer enforcement is harder to bypass accidentally.

## Data Isolation

All user-owned data must be scoped by owner:

- Job applications belong to one user.
- Resume versions inherit ownership from their job application and should also carry direct ownership for simpler checks and safer joins.
- Stored resume files and generated documents must be placed under paths derived from internal user ID and record IDs, not from filenames or user-provided path fragments.
- Download and review endpoints must verify that the current user owns the resume version before reading any file.
- Queue workers should process by stable IDs only and should not accept user-provided filesystem paths as trusted authority.

Recommended filesystem layout:

```text
{resumesDir}/{userId}/{applicationId}/{resumeVersionId}/input.tex
{resumesDir}/{userId}/{applicationId}/{resumeVersionId}/tailored.tex
{resumesDir}/{userId}/{applicationId}/{resumeVersionId}/tailored.pdf
```

The database should remain the source of truth for ownership and artifact availability. Filesystem paths should not be exposed to the frontend.

## Service-To-Service Authentication

There are two separate trust paths:

- Browser to Next.js/Java: end-user authentication.
- Java to ASP.NET/Python/document services: service authentication.

Local development options:

- Use unsigned local-only shared secrets in environment variables for service calls.
- Pass `X-ApplyFlow-Service-Token` from Java to the document service.
- Keep local secrets out of source control and document them in `.env.example`.

Deployment options:

- Prefer private networking plus mTLS or workload identity where available.
- Use short-lived service tokens issued by the deployment platform or identity provider.
- Give each service a distinct audience/scope, for example `document-service.process`.
- Rotate secrets and avoid reusing end-user JWTs for backend-to-backend calls unless token exchange is intentionally designed.

The Java worker should include service credentials when calling the ASP.NET document service. The document service should validate the service identity before accepting resume content or returning artifacts.

## Database Ownership Fields

Existing tables that need ownership:

- `job_applications`: add `user_id uuid not null references users(id)`.
- `resume_versions`: add `user_id uuid not null references users(id)`.

Recommended new table:

```sql
create table users (
    id uuid primary key,
    external_subject varchar(255) not null unique,
    email varchar(320),
    display_name varchar(255),
    created_at timestamptz not null,
    updated_at timestamptz not null
);
```

Recommended indexes:

```sql
create index idx_job_applications_user_id on job_applications(user_id);
create index idx_resume_versions_user_id on resume_versions(user_id);
create index idx_resume_versions_user_application on resume_versions(user_id, job_application_id);
```

Migration strategy:

- Add `users` first.
- For existing development data, create a single local owner row.
- Backfill `user_id` on `job_applications`.
- Backfill `resume_versions.user_id` from the owning application.
- Make ownership columns `not null`.
- Update all repository queries before enabling multi-user access.

## Staged Implementation Plan

1. Document and schema preparation

- Keep current runtime behavior unchanged.
- Add ownership fields in a migration behind a local default owner strategy.
- Update entity mappings and repository methods to accept owner context, while still using a development owner.

2. Backend authorization foundation

- Add Spring Security resource-server configuration.
- Add a current-user resolver that maps token subject to `users.id`.
- Require authentication on application, resume-version, retry, review, and download endpoints.
- Update tests for cross-user access denial.

3. Next.js authentication

- Add the chosen Next.js authentication provider.
- Protect backend-mode application screens.
- Attach access tokens to Java API calls.
- Keep local mode unauthenticated and clearly separate from backend mode.

4. Service authentication

- Add service credentials from Java to ASP.NET/document service.
- Validate service credentials at the document service boundary.
- Remove any document-processing endpoint exposure that is not needed publicly.

5. Storage hardening

- Move stored resume artifacts into user-scoped directories.
- Add ownership checks before every artifact read.
- Add retention/deletion policies for uploaded resumes, generated `.tex`, PDFs, and reports.

6. Production rollout

- Enable authentication in staging.
- Run migration/backfill.
- Verify logs do not contain resume content, tokens, or absolute file paths.
- Enable auth in production only after endpoint and repository coverage is complete.

## Uploaded Resume Security Risks

Uploaded resumes are sensitive personal documents. They may contain names, email addresses, phone numbers, addresses, work history, education, immigration/work authorization details, and private project information.

Key risks:

- Cross-user data exposure through missing ownership checks.
- Direct filesystem path exposure in API responses or logs.
- Path traversal through uploaded filenames.
- LaTeX injection or unsafe compilation behavior.
- Oversized uploads causing storage or processing exhaustion.
- Malware-like payloads hidden in archives if project ZIP upload is later supported.
- Prompt injection or data exfiltration attempts through resume/job text if LLM processing is added.
- Sensitive content leaking into logs, traces, queues, dead-letter messages, or error details.
- Long-lived generated artifacts remaining after users expect deletion.

Recommended mitigations:

- Continue accepting only `.tex` files until archive handling is explicitly sandboxed.
- Normalize filenames and never use uploaded names as storage paths.
- Keep maximum upload size limits.
- Compile LaTeX in a locked-down sandbox with no shell escape, no network access, strict CPU/memory/time limits, and temporary working directories.
- Store only user-safe error messages in API responses.
- Avoid logging resume contents, job descriptions, tokens, absolute paths, or generated reports.
- Encrypt storage volumes or object buckets where feasible.
- Add artifact retention controls and user deletion support.
- Treat LLM inputs and outputs as sensitive data and avoid sending them to providers without explicit product/privacy review.

