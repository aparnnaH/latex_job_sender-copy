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
    EXIT_PROCESSING_FAILURE,
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
        self.assertTrue(report["unsupportedClaimsRejected"])
        self.assertTrue(report["suggestions"])

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
            self.assertEqual(payload["errors"], [])

    def test_valid_resume_preserves_latex_commands_and_comments(self) -> None:
        source = "\n".join(
            [
                "\\documentclass{article}",
                "% preserve this comment",
                "\\begin{document}",
                "\\section{Projects}",
                "\\customCommand{Value}",
                "\\end{document}",
                "",
            ]
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "resume.tex"
            output_path = Path(temp_dir) / "tailored.tex"
            report_path = Path(temp_dir) / "report.json"
            input_path.write_text(source, encoding="utf-8")

            exit_code = main(
                [
                    "--input",
                    str(input_path),
                    "--job-description",
                    str(FIXTURE_DIR / "job-description.txt"),
                    "--output",
                    str(output_path),
                    "--report",
                    str(report_path),
                ]
            )

            self.assertEqual(exit_code, EXIT_SUCCESS)
            self.assertEqual(output_path.read_text(encoding="utf-8"), source)

    def test_unbalanced_braces_returns_processing_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "resume.tex"
            output_path = Path(temp_dir) / "tailored.tex"
            report_path = Path(temp_dir) / "report.json"
            input_path.write_text("\\documentclass{article}\n\\begin{document}\n\\section{Broken\n\\end{document}\n", encoding="utf-8")

            with redirect_stderr(StringIO()):
                exit_code = main(
                    [
                        "--input",
                        str(input_path),
                        "--job-description",
                        str(FIXTURE_DIR / "job-description.txt"),
                        "--output",
                        str(output_path),
                        "--report",
                        str(report_path),
                    ]
                )

            self.assertEqual(exit_code, EXIT_PROCESSING_FAILURE)
            self.assertFalse(output_path.exists())
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "FAILED")
            self.assertIn("unbalanced braces", payload["errors"][0])

    def test_missing_input_file_returns_missing_input(self) -> None:
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
            self.assertIn("was not found", payload["errors"][0])

    def test_empty_input_returns_processing_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "resume.tex"
            output_path = Path(temp_dir) / "tailored.tex"
            report_path = Path(temp_dir) / "report.json"
            input_path.write_text("", encoding="utf-8")

            with redirect_stderr(StringIO()):
                exit_code = main(
                    [
                        "--input",
                        str(input_path),
                        "--job-description",
                        str(FIXTURE_DIR / "job-description.txt"),
                        "--output",
                        str(output_path),
                        "--report",
                        str(report_path),
                    ]
                )

            self.assertEqual(exit_code, EXIT_PROCESSING_FAILURE)
            self.assertFalse(output_path.exists())
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "FAILED")
            self.assertEqual(payload["errors"], ["Input resume is empty."])

    def test_output_path_matching_input_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "resume.tex"
            report_path = Path(temp_dir) / "report.json"
            original = (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8")
            input_path.write_text(original, encoding="utf-8")

            with redirect_stderr(StringIO()):
                exit_code = main(
                    [
                        "--input",
                        str(input_path),
                        "--job-description",
                        str(FIXTURE_DIR / "job-description.txt"),
                        "--output",
                        str(input_path),
                        "--report",
                        str(report_path),
                    ]
                )

            self.assertEqual(exit_code, EXIT_PROCESSING_FAILURE)
            self.assertEqual(input_path.read_text(encoding="utf-8"), original)
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertIn("must not match", payload["errors"][0])

    def test_cli_reports_invalid_arguments(self) -> None:
        with redirect_stderr(StringIO()):
            self.assertEqual(main([]), EXIT_INVALID_ARGUMENTS)

    def test_unsupported_skills_are_rejected_not_confirmed(self) -> None:
        resume = (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8")
        job = "This role requires RabbitMQ messaging and Kubernetes operations."

        report = build_report(resume, job, warnings=[])

        suggestion_text = json.dumps(report["suggestions"]).casefold()
        unsupported_text = json.dumps(report["unsupportedClaimsRejected"]).casefold()
        self.assertNotIn("approved wording about rabbitmq", suggestion_text)
        self.assertNotIn("approved wording about kubernetes", suggestion_text)
        self.assertIn("rabbitmq", unsupported_text)
        self.assertIn("kubernetes", unsupported_text)

    def test_evidence_file_can_support_missing_skill_without_editing_latex(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "tailored.tex"
            report = Path(temp_dir) / "report.json"
            evidence = Path(temp_dir) / "evidence.json"
            evidence.write_text(
                json.dumps(
                    {
                        "skills": ["RabbitMQ"],
                        "projects": ["Built a fictional queue monitor with RabbitMQ messaging."],
                        "workExperience": [],
                        "education": [],
                        "certifications": [],
                    }
                ),
                encoding="utf-8",
            )

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
                    "--evidence",
                    str(evidence),
                ]
            )

            self.assertEqual(exit_code, EXIT_SUCCESS)
            self.assertEqual(output.read_text(encoding="utf-8"), (FIXTURE_DIR / "resume.tex").read_text(encoding="utf-8"))
            payload = json.loads(report.read_text(encoding="utf-8"))
            rabbitmq_suggestions = [
                suggestion
                for suggestion in payload["suggestions"]
                if "rabbitmq" in json.dumps(suggestion).casefold()
            ]
            self.assertTrue(rabbitmq_suggestions)
            self.assertTrue(all(suggestion["requiresUserApproval"] for suggestion in rabbitmq_suggestions))
            self.assertNotIn("rabbitmq", json.dumps(payload["unsupportedClaimsRejected"]).casefold())


if __name__ == "__main__":
    unittest.main()
