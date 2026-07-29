#!/usr/bin/env bash
set -euo pipefail

JAVA_API_BASE_URL="${JAVA_API_BASE_URL:-http://localhost:8080}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-60}"
SMOKE_POLL_INTERVAL_SECONDS="${SMOKE_POLL_INTERVAL_SECONDS:-2}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local response_file status_file status

  response_file="$(mktemp)"
  status_file="$(mktemp)"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$body" \
      -o "$response_file" \
      -w "%{http_code}" > "$status_file"
  else
    curl -fsS -X "$method" "$url" \
      -o "$response_file" \
      -w "%{http_code}" > "$status_file"
  fi
  status="$(cat "$status_file")"
  rm -f "$status_file"
  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "Request failed: $method $url returned $status" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    exit 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

cleanup() {
  local exit_code=$?
  if [ -n "${application_id:-}" ]; then
    curl -fsS -X DELETE "$JAVA_API_BASE_URL/api/applications/$application_id" >/dev/null 2>&1 || true
  fi
  if [ -n "${work_dir:-}" ] && [ -d "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
  exit "$exit_code"
}

require_command curl
require_command jq
trap cleanup EXIT

work_dir="$(mktemp -d)"
resume_file="$work_dir/fictional-resume.tex"

cat > "$resume_file" <<'TEX'
\documentclass{article}
\begin{document}
\section*{Fictional Candidate}
Software engineer with experience building Java services, PostgreSQL schemas, RabbitMQ workers, and deterministic test automation.
\section*{Experience}
Built a local resume tailoring workflow using Spring Boot, ASP.NET Core, Python, and LaTeX.
\end{document}
TEX

job_description="Fictional backend engineer role building Java services with PostgreSQL, RabbitMQ, Python automation, and deterministic smoke tests. Do not require Kubernetes."

application_payload="$(jq -n \
  --arg company "Smoke Test Labs" \
  --arg jobTitle "Backend Workflow Engineer" \
  --arg jobDescription "$job_description" \
  --arg jobUrl "https://example.invalid/smoke-test-role" \
  --arg source "backend-smoke-test" \
  '{
    company: $company,
    jobTitle: $jobTitle,
    jobDescription: $jobDescription,
    jobUrl: $jobUrl,
    source: $source,
    notes: "Created by deterministic backend smoke test."
  }')"

echo "Checking Java API health at $JAVA_API_BASE_URL..."
request_json GET "$JAVA_API_BASE_URL/actuator/health/liveness" >/dev/null

echo "Creating fictional job application..."
application_response="$(request_json POST "$JAVA_API_BASE_URL/api/applications" "$application_payload")"
application_id="$(jq -r '.id' <<<"$application_response")"
if [ -z "$application_id" ] || [ "$application_id" = "null" ]; then
  echo "Application response did not include an id." >&2
  echo "$application_response" >&2
  exit 1
fi

echo "Starting tailoring request..."
tailor_response_file="$(mktemp)"
tailor_status_file="$(mktemp)"
curl -fsS -X POST "$JAVA_API_BASE_URL/api/applications/$application_id/tailor" \
  -F "resume=@$resume_file;type=application/x-tex" \
  -o "$tailor_response_file" \
  -w "%{http_code}" > "$tailor_status_file"
tailor_status="$(cat "$tailor_status_file")"
rm -f "$tailor_status_file"
if [[ "$tailor_status" -lt 200 || "$tailor_status" -ge 300 ]]; then
  echo "Tailoring request returned $tailor_status" >&2
  cat "$tailor_response_file" >&2
  rm -f "$tailor_response_file"
  exit 1
fi
tailor_response="$(cat "$tailor_response_file")"
rm -f "$tailor_response_file"

resume_version_id="$(jq -r '.id' <<<"$tailor_response")"
if [ -z "$resume_version_id" ] || [ "$resume_version_id" = "null" ]; then
  echo "Tailoring response did not include a resume version id." >&2
  echo "$tailor_response" >&2
  exit 1
fi

echo "Waiting for resume version $resume_version_id to complete..."
deadline=$((SECONDS + SMOKE_TIMEOUT_SECONDS))
version_response=""
while [ "$SECONDS" -lt "$deadline" ]; do
  version_response="$(request_json GET "$JAVA_API_BASE_URL/api/resume-versions/$resume_version_id")"
  status="$(jq -r '.tailoringStatus' <<<"$version_response")"
  if [ "$status" = "COMPLETED" ]; then
    break
  fi
  if [ "$status" = "FAILED" ]; then
    echo "Resume tailoring failed." >&2
    echo "$version_response" >&2
    exit 1
  fi
  sleep "$SMOKE_POLL_INTERVAL_SECONDS"
done

if [ "$(jq -r '.tailoringStatus' <<<"$version_response")" != "COMPLETED" ]; then
  echo "Timed out after ${SMOKE_TIMEOUT_SECONDS}s waiting for COMPLETED." >&2
  echo "$version_response" >&2
  exit 1
fi

document_id="$(jq -r '.documentServiceId // empty' <<<"$version_response")"
if [ -z "$document_id" ]; then
  echo "Completed resume version did not include documentServiceId." >&2
  echo "$version_response" >&2
  exit 1
fi

echo "Retrieving tailoring report and generated .tex..."
review_response="$(request_json GET "$JAVA_API_BASE_URL/api/resume-versions/$resume_version_id/review")"
tailored_tex="$(jq -r '.tailoredTex // empty' <<<"$review_response")"
if [ -z "$tailored_tex" ] || ! grep -q '\\documentclass' <<<"$tailored_tex"; then
  echo "Review response did not include a generated .tex result." >&2
  echo "$review_response" >&2
  exit 1
fi

unsupported_count="$(jq '.unsupportedClaimsRejected | length' <<<"$review_response")"
if [ "$unsupported_count" -ne 0 ]; then
  echo "Tailoring report included unsupported invented claims." >&2
  jq '.unsupportedClaimsRejected' <<<"$review_response" >&2
  exit 1
fi

downloaded_tex_file="$work_dir/tailored-resume.tex"
curl -fsS "$JAVA_API_BASE_URL/api/resume-versions/$resume_version_id/download/tex" -o "$downloaded_tex_file"
if [ ! -s "$downloaded_tex_file" ] || ! grep -q '\\documentclass' "$downloaded_tex_file"; then
  echo "Downloaded .tex result was missing or invalid." >&2
  exit 1
fi

echo "Smoke test passed."
echo "Application: $application_id"
echo "Resume version: $resume_version_id"
echo "Document: $document_id"
