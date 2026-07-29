from __future__ import annotations

import json
import unittest
from pathlib import Path

from tailoring_service import handle_health, handle_tailor_multipart, process_tailor_upload


FIXTURE_DIR = Path(__file__).parent / "fixtures"


class TailoringServiceTests(unittest.TestCase):
    def test_process_tailor_upload_returns_report_and_tex(self) -> None:
        resume = (FIXTURE_DIR / "resume.tex").read_bytes()
        job = (FIXTURE_DIR / "job-description.txt").read_text(encoding="utf-8")

        response = process_tailor_upload("resume.tex", resume, job)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["report"]["status"], "COMPLETED")
        self.assertEqual(response.payload["tailoredTex"], resume.decode("utf-8"))

    def test_rejects_non_tex_upload(self) -> None:
        with self.assertRaisesRegex(Exception, "Only .tex"):
            process_tailor_upload("resume.pdf", b"content", "A job description")

    def test_rejects_oversized_upload(self) -> None:
        with self.assertRaisesRegex(Exception, "size limit"):
            process_tailor_upload("resume.tex", b"x" * 10, "A job description", max_upload_bytes=5)

    def test_rejects_empty_job_description(self) -> None:
        with self.assertRaisesRegex(Exception, "Job description is required"):
            process_tailor_upload("resume.tex", (FIXTURE_DIR / "resume.tex").read_bytes(), " ")

    def test_rejects_invalid_json_evidence(self) -> None:
        with self.assertRaisesRegex(Exception, "Evidence JSON"):
            process_tailor_upload(
                "resume.tex",
                (FIXTURE_DIR / "resume.tex").read_bytes(),
                (FIXTURE_DIR / "job-description.txt").read_text(encoding="utf-8"),
                evidence_json="{not-json",
            )

    def test_evidence_json_affects_report_without_rewriting_tex(self) -> None:
        resume = (FIXTURE_DIR / "resume.tex").read_bytes()
        job = "This job requires RabbitMQ."
        evidence = json.dumps({"skills": ["RabbitMQ"], "projects": [], "workExperience": [], "education": [], "certifications": []})

        response = process_tailor_upload("resume.tex", resume, job, evidence_json=evidence)

        report_text = json.dumps(response.payload["report"]).casefold()
        self.assertIn("approved wording about rabbitmq", report_text)
        self.assertEqual(response.payload["tailoredTex"], resume.decode("utf-8"))

    def test_health_endpoint(self) -> None:
        response = handle_health()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload, {"status": "ok"})

    def test_tailor_endpoint_rejects_non_tex_upload(self) -> None:
        boundary = "TailorBoundary"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="resume"; filename="resume.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
            "not latex\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="jobDescription"\r\n\r\n'
            "Python role\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")

        with self.assertRaisesRegex(Exception, "Only .tex"):
            handle_tailor_multipart(body, f"multipart/form-data; boundary={boundary}")

    def test_tailor_endpoint_accepts_multipart_upload(self) -> None:
        boundary = "TailorBoundary"
        resume = (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8")
        job = (FIXTURE_DIR / "job-description.txt").read_text(encoding="utf-8")
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="resume"; filename="resume.tex"\r\n'
            "Content-Type: application/x-tex\r\n\r\n"
            f"{resume}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="jobDescription"\r\n\r\n'
            f"{job}\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")

        response = handle_tailor_multipart(body, f"multipart/form-data; boundary={boundary}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["report"]["status"], "COMPLETED")
        self.assertEqual(response.payload["tailoredTex"], resume)


if __name__ == "__main__":
    unittest.main()
