#!/usr/bin/env python3
"""Deterministic TailorTeX resume tailoring skeleton."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


EXIT_SUCCESS = 0
EXIT_INVALID_ARGUMENTS = 2
EXIT_MISSING_INPUT = 3
EXIT_PROCESSING_FAILURE = 4

STOP_WORDS = {
    "about",
    "across",
    "also",
    "and",
    "are",
    "build",
    "candidate",
    "company",
    "description",
    "engineer",
    "experience",
    "for",
    "from",
    "has",
    "have",
    "help",
    "into",
    "job",
    "must",
    "our",
    "role",
    "should",
    "that",
    "the",
    "their",
    "this",
    "with",
    "work",
    "will",
    "you",
    "your",
}

KNOWN_TECH_TERMS = [
    "accessibility",
    "api",
    "automation",
    "ci/cd",
    "css",
    "docker",
    "java",
    "javascript",
    "latex",
    "next.js",
    "postgresql",
    "python",
    "rabbitmq",
    "react",
    "rest",
    "spring boot",
    "sql",
    "tailwind",
    "testing",
    "typescript",
]


@dataclass(frozen=True)
class TailoringInputs:
    input_path: Path
    job_description_path: Path
    output_path: Path
    report_path: Path


class TailoringError(Exception):
    """Base class for expected tailoring failures."""

    exit_code = EXIT_PROCESSING_FAILURE


class MissingInputError(TailoringError):
    """Raised when an input file is missing."""

    exit_code = EXIT_MISSING_INPUT


class InvalidLatexError(TailoringError):
    """Raised when the resume does not look like LaTeX."""


class UnsafeOutputError(TailoringError):
    """Raised when the output path would overwrite protected input."""


def parse_args(argv: Sequence[str]) -> TailoringInputs:
    parser = argparse.ArgumentParser(
        description="Create a deterministic TailorTeX report and copy the resume unchanged."
    )
    parser.add_argument("--input", required=True, help="Path to the input LaTeX resume.")
    parser.add_argument("--job-description", required=True, help="Path to a text job description.")
    parser.add_argument("--output", required=True, help="Path where the tailored LaTeX resume should be written.")
    parser.add_argument("--report", required=True, help="Path where the JSON tailoring report should be written.")
    namespace = parser.parse_args(argv)

    return TailoringInputs(
        input_path=Path(namespace.input),
        job_description_path=Path(namespace.job_description),
        output_path=Path(namespace.output),
        report_path=Path(namespace.report),
    )


def read_required_text(path: Path, label: str) -> str:
    if not path.exists():
        raise MissingInputError(f"{label} was not found: {path}")
    if not path.is_file():
        raise MissingInputError(f"{label} is not a file: {path}")
    content = path.read_text(encoding="utf-8")
    if label == "Input resume" and not content.strip():
        raise InvalidLatexError("Input resume is empty.")
    if label == "Job description" and not content.strip():
        raise MissingInputError("Job description is empty.")
    return content


def validate_latex(source: str) -> list[str]:
    warnings: list[str] = []
    latex_markers = (
        "\\documentclass",
        "\\begin{document}",
        "\\section",
        "\\cvsection",
        "\\resumeItem",
        "\\cvevent",
    )
    if not any(marker in source for marker in latex_markers):
        raise InvalidLatexError("Input resume does not contain recognizable LaTeX resume markers.")

    brace_depth = 0
    for index, character in enumerate(source):
        previous = source[index - 1] if index > 0 else ""
        if character == "{" and previous != "\\":
            brace_depth += 1
        elif character == "}" and previous != "\\":
            brace_depth -= 1
        if brace_depth < 0:
            raise InvalidLatexError("Input resume has unbalanced braces.")

    if brace_depth != 0:
        raise InvalidLatexError("Input resume has unbalanced braces.")

    environments = re.findall(r"\\(begin|end)\{([^{}]+)\}", source)
    environment_stack: list[str] = []
    for command, environment in environments:
        if command == "begin":
            environment_stack.append(environment)
            continue
        if not environment_stack:
            raise InvalidLatexError(f"Input resume closes LaTeX environment '{environment}' before it is opened.")
        opened = environment_stack.pop()
        if opened != environment:
            raise InvalidLatexError(
                f"Input resume closes LaTeX environment '{environment}' before closing '{opened}'."
            )

    if environment_stack:
        unclosed = ", ".join(environment_stack)
        raise InvalidLatexError(f"Input resume has unclosed LaTeX environment(s): {unclosed}.")
    return warnings


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.casefold())


def extract_basic_job_keywords(job_description: str) -> list[str]:
    normalized = normalize_text(job_description)
    keywords: list[str] = []

    for term in KNOWN_TECH_TERMS:
        if term in normalized:
            keywords.append(term)

    tokens = re.findall(r"[a-zA-Z][a-zA-Z.+/#-]{2,}", job_description.casefold())
    for token in tokens:
        cleaned = token.strip(".-_/")
        if len(cleaned) < 3 or cleaned in STOP_WORDS:
            continue
        if cleaned not in keywords:
            keywords.append(cleaned)

    return sorted(keywords)


def compare_keywords(resume_source: str, keywords: Sequence[str]) -> tuple[list[str], list[str]]:
    normalized_resume = normalize_text(resume_source)
    matched = [keyword for keyword in keywords if keyword in normalized_resume]
    missing = [keyword for keyword in keywords if keyword not in normalized_resume]
    return matched, missing


def calculate_match_score(matched_keywords: Sequence[str], all_keywords: Sequence[str]) -> int:
    if not all_keywords:
        return 0
    return round((len(matched_keywords) / len(all_keywords)) * 100)


def build_report(resume_source: str, job_description: str, warnings: Sequence[str]) -> dict[str, object]:
    keywords = extract_basic_job_keywords(job_description)
    matched_keywords, missing_keywords = compare_keywords(resume_source, keywords)
    match_score = calculate_match_score(matched_keywords, keywords)

    return {
        "status": "COMPLETED",
        "matchScoreBefore": match_score,
        "matchScoreAfter": match_score,
        "matchedKeywords": matched_keywords,
        "missingKeywords": missing_keywords,
        "sectionsChanged": [],
        "warnings": list(warnings),
        "errors": [],
        "unsupportedClaimsRejected": [],
    }


def write_failure_report(report_path: Path, message: str) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "FAILED",
        "matchScoreBefore": 0,
        "matchScoreAfter": 0,
        "matchedKeywords": [],
        "missingKeywords": [],
        "sectionsChanged": [],
        "warnings": [],
        "errors": [message],
        "unsupportedClaimsRejected": [],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def assert_safe_output_path(input_path: Path, output_path: Path) -> None:
    try:
        same_path = input_path.resolve(strict=False) == output_path.resolve(strict=False)
    except OSError:
        same_path = input_path.absolute() == output_path.absolute()
    if same_path:
        raise UnsafeOutputError("Output path must not match the input resume path.")


def write_output_atomically(output_path: Path, content: str) -> None:
    if not content:
        raise InvalidLatexError("Refusing to write an empty tailored resume.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(content)

    try:
        temp_path.replace(output_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def run_tailoring(inputs: TailoringInputs) -> dict[str, object]:
    assert_safe_output_path(inputs.input_path, inputs.output_path)
    resume_source = read_required_text(inputs.input_path, "Input resume")
    job_description = read_required_text(inputs.job_description_path, "Job description")
    warnings = validate_latex(resume_source)

    inputs.report_path.parent.mkdir(parents=True, exist_ok=True)
    write_output_atomically(inputs.output_path, resume_source)

    report = build_report(resume_source, job_description, warnings)
    inputs.report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main(argv: Sequence[str] | None = None) -> int:
    try:
        inputs = parse_args(sys.argv[1:] if argv is None else argv)
    except SystemExit as error:
        return int(error.code) if isinstance(error.code, int) else EXIT_INVALID_ARGUMENTS

    try:
        run_tailoring(inputs)
        return EXIT_SUCCESS
    except TailoringError as error:
        write_failure_report(inputs.report_path, str(error))
        print(f"tailor_resume: {error}", file=sys.stderr)
        return error.exit_code
    except OSError as error:
        write_failure_report(inputs.report_path, f"File processing failed: {error}")
        print(f"tailor_resume: File processing failed: {error}", file=sys.stderr)
        return EXIT_PROCESSING_FAILURE
    except Exception as error:
        write_failure_report(inputs.report_path, "Unexpected processing failure.")
        print(f"tailor_resume: Unexpected processing failure: {error}", file=sys.stderr)
        return EXIT_PROCESSING_FAILURE


if __name__ == "__main__":
    raise SystemExit(main())
