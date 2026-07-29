# TailorTeX Python Tailoring Engine

This is the local deterministic skeleton for the TailorTeX / ApplyFlow Python tailoring engine.

It does not call AI providers or paid APIs. The first implementation reads a LaTeX resume and job description, extracts basic keywords deterministically, compares those keywords against the resume, copies the original resume unchanged, and writes a JSON report.

## Requirements

- Python 3.11 or newer
- No third-party Python packages are required

## CLI

```sh
python3 tailor_resume.py \
  --input input-resume.tex \
  --job-description job-description.txt \
  --output tailored-resume.tex \
  --report tailoring-report.json \
  --evidence evidence.json
```

`--evidence` is optional. When provided, it must point to a JSON object with confirmed user evidence:

```json
{
  "skills": ["Python"],
  "projects": ["Built a fictional dashboard with React."],
  "workExperience": ["Completed internal workflow automation work."],
  "education": ["Coursework in SQL reporting."],
  "certifications": []
}
```

## Report Fields

The report contains:

- `status`
- `matchScoreBefore`
- `matchScoreAfter`
- `matchedKeywords`
- `missingKeywords`
- `sectionsChanged`
- `suggestions`
- `warnings`
- `errors`
- `unsupportedClaimsRejected`

Because this skeleton does not rewrite LaTeX, `matchScoreBefore` and `matchScoreAfter` are the same and `sectionsChanged` is empty.

Suggestions are review-only. A suggestion can mention a skill as supported only when it already appears in the resume or in the optional evidence file. Unsupported recommendations are recorded in `unsupportedClaimsRejected`.

## Exit Codes

```text
0  Success
2  Invalid arguments
3  Missing input
4  Invalid LaTeX or processing failure
```

## Run With Fixtures

```sh
cd services/tailoring-python
python3 tailor_resume.py \
  --input tests/fixtures/resume.tex \
  --job-description tests/fixtures/job-description.txt \
  --output /tmp/tailortex-tailored.tex \
  --report /tmp/tailortex-report.json
```

## Test

```sh
cd services/tailoring-python
python3 -m unittest discover -s tests
```
