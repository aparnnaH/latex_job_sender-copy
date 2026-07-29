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
  --report tailoring-report.json
```

## Report Fields

The report contains:

- `status`
- `matchScoreBefore`
- `matchScoreAfter`
- `matchedKeywords`
- `missingKeywords`
- `sectionsChanged`
- `warnings`
- `unsupportedClaimsRejected`

Because this skeleton does not invent edits, `matchScoreBefore` and `matchScoreAfter` are the same, `sectionsChanged` is empty, and `unsupportedClaimsRejected` is empty.

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
