#!/usr/bin/env python3
"""Small stdlib HTTP service for the deterministic TailorTeX engine."""

from __future__ import annotations

import argparse
import json
import logging
import re
import tempfile
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from tailor_resume import (
    InvalidEvidenceError,
    InvalidLatexError,
    TailoringInputs,
    build_report,
    parse_evidence_json,
    read_required_text,
    run_tailoring,
)


MAX_UPLOAD_BYTES = 1_048_576

logging.basicConfig(level=logging.INFO, format="%(message)s")
LOGGER = logging.getLogger("tailoring_service")


def log_event(stage: str, request_id: str, application_id: str, resume_version_id: str, duration_ms: int | None = None, safe_error_code: str | None = None) -> None:
    payload: dict[str, Any] = {
        "stage": stage,
        "requestId": request_id,
        "applicationId": application_id,
        "resumeVersionId": resume_version_id,
    }
    if duration_ms is not None:
        payload["durationMs"] = duration_ms
    if safe_error_code is not None:
        payload["safeErrorCode"] = safe_error_code
    LOGGER.info(json.dumps(payload, sort_keys=True))


@dataclass(frozen=True)
class TailorApiResponse:
    status_code: int
    payload: dict[str, Any]


class ApiValidationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def error_payload(code: str, message: str, retryable: bool = False) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "internalDetails": None,
            "retryable": retryable,
        }
    }


def parse_multipart_form(body: bytes, content_type: str) -> dict[str, tuple[str | None, bytes]]:
    boundary_match = re.search(r'boundary="?([^=";]+)"?', content_type)
    if not boundary_match:
        raise ApiValidationError("INVALID_MULTIPART", "Multipart boundary is missing.")

    boundary = ("--" + boundary_match.group(1)).encode("utf-8")
    fields: dict[str, tuple[str | None, bytes]] = {}
    for raw_part in body.split(boundary):
        part = raw_part
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2]
            if part.endswith(b"\r\n"):
                part = part[:-2]
        if b"\r\n\r\n" not in part:
            continue
        raw_headers, content = part.split(b"\r\n\r\n", 1)
        headers = raw_headers.decode("utf-8", errors="replace")
        disposition = next((line for line in headers.split("\r\n") if line.lower().startswith("content-disposition:")), "")
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        if content.endswith(b"\r\n"):
            content = content[:-2]
        fields[name_match.group(1)] = (filename_match.group(1) if filename_match else None, content)
    return fields


def process_tailor_upload(
    resume_filename: str,
    resume_content: bytes,
    job_description: str,
    evidence_json: str | None = None,
    max_upload_bytes: int = MAX_UPLOAD_BYTES,
    request_id: str = "",
    application_id: str = "",
    resume_version_id: str = "",
) -> TailorApiResponse:
    started_at = time.monotonic()
    log_event("python.tailor.received", request_id, application_id, resume_version_id)
    if not resume_filename.lower().endswith(".tex"):
        log_event("python.validation.failed", request_id, application_id, resume_version_id, safe_error_code="INVALID_FILE_TYPE")
        raise ApiValidationError("INVALID_FILE_TYPE", "Only .tex resume uploads are supported.")
    if not resume_content:
        log_event("python.validation.failed", request_id, application_id, resume_version_id, safe_error_code="EMPTY_RESUME")
        raise ApiValidationError("EMPTY_RESUME", "Uploaded resume is empty.")
    if len(resume_content) > max_upload_bytes:
        log_event("python.validation.failed", request_id, application_id, resume_version_id, safe_error_code="FILE_TOO_LARGE")
        raise ApiValidationError("FILE_TOO_LARGE", "Uploaded resume exceeds the configured size limit.", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
    if not job_description.strip():
        log_event("python.validation.failed", request_id, application_id, resume_version_id, safe_error_code="EMPTY_JOB_DESCRIPTION")
        raise ApiValidationError("EMPTY_JOB_DESCRIPTION", "Job description is required.")

    try:
        evidence = parse_evidence_json(evidence_json)
    except InvalidEvidenceError as error:
        log_event("python.validation.failed", request_id, application_id, resume_version_id, safe_error_code="INVALID_EVIDENCE_JSON")
        raise ApiValidationError("INVALID_EVIDENCE_JSON", str(error)) from error

    with tempfile.TemporaryDirectory(prefix="tailortex-api-") as temp_dir:
        root = Path(temp_dir)
        input_path = root / "resume.tex"
        job_path = root / "job-description.txt"
        output_path = root / "tailored-resume.tex"
        report_path = root / "tailoring-report.json"

        input_path.write_bytes(resume_content)
        job_path.write_text(job_description, encoding="utf-8")
        read_required_text(input_path, "Input resume")

        try:
            run_tailoring(
                TailoringInputs(
                    input_path=input_path,
                    job_description_path=job_path,
                    output_path=output_path,
                    report_path=report_path,
                )
            )
            resume_source = output_path.read_text(encoding="utf-8")
            report = build_report(resume_source, job_description, warnings=[], evidence=evidence)
            report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        except InvalidLatexError as error:
            log_event("python.tailor.failed", request_id, application_id, resume_version_id, int((time.monotonic() - started_at) * 1000), "INVALID_LATEX")
            raise ApiValidationError("INVALID_LATEX", str(error), HTTPStatus.UNPROCESSABLE_ENTITY) from error

        log_event("python.tailor.completed", request_id, application_id, resume_version_id, int((time.monotonic() - started_at) * 1000))
        return TailorApiResponse(
            status_code=HTTPStatus.OK,
            payload={
                "report": json.loads(report_path.read_text(encoding="utf-8")),
                "tailoredTex": output_path.read_text(encoding="utf-8"),
            },
        )


def handle_health() -> TailorApiResponse:
    return TailorApiResponse(status_code=HTTPStatus.OK, payload={"status": "ok"})


def handle_tailor_multipart(body: bytes, content_type: str) -> TailorApiResponse:
    if not content_type.lower().startswith("multipart/form-data"):
        raise ApiValidationError("INVALID_CONTENT_TYPE", "Submit multipart/form-data.")
    fields = parse_multipart_form(body, content_type)
    resume_filename, resume_content = fields.get("resume", (None, b""))
    _, job_description_bytes = fields.get("jobDescription", (None, b""))
    _, evidence_bytes = fields.get("evidence", (None, b""))
    _, request_id_bytes = fields.get("requestId", (None, b""))
    _, application_id_bytes = fields.get("applicationId", (None, b""))
    _, resume_version_id_bytes = fields.get("resumeVersionId", (None, b""))
    if resume_filename is None:
        raise ApiValidationError("MISSING_RESUME", "The resume file field is required.")
    return process_tailor_upload(
        resume_filename=resume_filename,
        resume_content=resume_content,
        job_description=job_description_bytes.decode("utf-8", errors="replace"),
        evidence_json=evidence_bytes.decode("utf-8", errors="replace") if evidence_bytes else None,
        request_id=request_id_bytes.decode("utf-8", errors="replace"),
        application_id=application_id_bytes.decode("utf-8", errors="replace"),
        resume_version_id=resume_version_id_bytes.decode("utf-8", errors="replace"),
    )


class TailoringRequestHandler(BaseHTTPRequestHandler):
    server_version = "TailorTexPython/0.1"

    def do_GET(self) -> None:
        if self.path != "/health":
            self.write_json(HTTPStatus.NOT_FOUND, error_payload("NOT_FOUND", "Endpoint was not found."))
            return
        result = handle_health()
        self.write_json(result.status_code, result.payload)

    def do_POST(self) -> None:
        if self.path != "/api/tailor":
            self.write_json(HTTPStatus.NOT_FOUND, error_payload("NOT_FOUND", "Endpoint was not found."))
            return
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > MAX_UPLOAD_BYTES + 64_000:
            self.write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, error_payload("REQUEST_TOO_LARGE", "Request is too large."))
            return

        try:
            result = handle_tailor_multipart(self.rfile.read(content_length), content_type)
            self.write_json(result.status_code, result.payload)
        except ApiValidationError as error:
            self.write_json(error.status_code, error_payload(error.code, error.message))
        except Exception:
            LOGGER.exception(json.dumps({
                "stage": "python.tailor.unhandled-error",
                "safeErrorCode": "INTERNAL_ERROR",
            }, sort_keys=True))
            self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, error_payload("INTERNAL_ERROR", "Tailoring failed unexpectedly.", retryable=True))

    def log_message(self, format: str, *args: object) -> None:
        return

    def write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), TailoringRequestHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the TailorTeX Python tailoring HTTP service.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run_server(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
