# TailorTeX

AI-assisted LaTeX resume tailoring.

## ASP.NET Core API

This repository now includes a separate ASP.NET Core Web API in `api/`.

The current workspace does not contain a Python tailoring script, so configure the API to point at the existing Python entry point before running it. The API calls Python with three positional arguments:

```sh
python3 path/to/script.py input-resume.tex "job description text" output-resume.tex
```

Configure these values in `api/appsettings.json` or environment variables:

```sh
PythonTailoring__PythonExecutable=python3
PythonTailoring__ScriptPath=../tailor_resume.py
PythonTailoring__MaxUploadBytes=1048576
```

Run the API:

```sh
dotnet run --project api
```

Tailor a resume:

```sh
curl -X POST http://localhost:5000/api/resumes/tailor \
  -F "resume=@resume-project/main.tex" \
  -F "jobDescription=Paste the job description here" \
  --output tailored-resume.tex
```
