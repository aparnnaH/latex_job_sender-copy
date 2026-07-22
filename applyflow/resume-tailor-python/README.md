# Resume Tailor Python

This directory is reserved for the existing Python resume-tailoring code.

The current repository snapshot does not include a Python entry point. The existing API contract documented at the repository root is:

```sh
python3 path/to/script.py input-resume.tex "job description text" output-resume.tex
```

When the Python tailoring script is added here, keep that contract stable so Java can later delegate only AI resume analysis and LaTeX tailoring work to Python.
