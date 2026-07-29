from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path

from tailor_resume import (
    EXIT_INVALID_ARGUMENTS,
    EXIT_MISSING_INPUT,
    EXIT_SUCCESS,
    build_report,
    extract_basic_job_keywords,
    main,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"


class TailorResumeTests(unittest.TestCase):
    def test_extract_basic_job_keywords_is_deterministic(self) -> None:
        description = (FIXTURE_DIR / "job-description.txt").read_text(encoding="utf-8")

        keywords = extract_basic_job_keywords(description)

        self.assertEqual(keywords, sorted(keywords))
        self.assertIn("python", keywords)
        self.assertIn("react", keywords)
        self.assertIn("typescript", keywords)

    def test_build_report_compares_resume_to_job_without_edits(self) -> None:
        resume = (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8")
        description = (FIXTURE_DIR / "job-description.txt").read_text(encoding="utf-8")

        report = build_report(resume, description, warnings=[])

        self.assertEqual(report["status"], "COMPLETED")
        self.assertEqual(report["matchScoreBefore"], report["matchScoreAfter"])
        self.assertEqual(report["sectionsChanged"], [])
        self.assertIn("python", report["matchedKeywords"])
        self.assertIn("rabbitmq", report["missingKeywords"])
        self.assertEqual(report["unsupportedClaimsRejected"], [])

    def test_cli_copies_resume_and_writes_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "tailored.tex"
            report = Path(temp_dir) / "report.json"

            exit_code = main(
                [
                    "--input",
                    str(FIXTURE_DIR / "resume.tex"),
                    "--job-description",
                    str(FIXTURE_DIR / "job-description.txt"),
                    "--output",
                    str(output),
                    "--report",
                    str(report),
                ]
            )

            self.assertEqual(exit_code, EXIT_SUCCESS)
            self.assertEqual(output.read_text(encoding="utf-8"), (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8"))
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "COMPLETED")
            self.assertEqual(payload["sectionsChanged"], [])

    def test_cli_reports_missing_input(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            report = Path(temp_dir) / "report.json"

            with redirect_stderr(StringIO()):
                exit_code = main(
                    [
                        "--input",
                        str(Path(temp_dir) / "missing.tex"),
                        "--job-description",
                        str(FIXTURE_DIR / "job-description.txt"),
                        "--output",
                        str(Path(temp_dir) / "tailored.tex"),
                        "--report",
                        str(report),
                    ]
                )

            self.assertEqual(exit_code, EXIT_MISSING_INPUT)
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "FAILED")

    def test_cli_reports_invalid_arguments(self) -> None:
        with redirect_stderr(StringIO()):
            self.assertEqual(main([]), EXIT_INVALID_ARGUMENTS)


if __name__ == "__main__":
    unittest.main()
