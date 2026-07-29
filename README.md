# TailorTeX

AI-assisted LaTeX resume tailoring.

## Local Docker Compose

The root `docker-compose.yml` starts the local backend stack:

- PostgreSQL
- RabbitMQ with the management UI
- Python tailoring service
- ASP.NET Core document service
- Java Spring Boot API and worker

The Next.js frontend is intentionally not containerized so normal Mac development stays simple.

Set up local environment values:

```sh
cp .env.example .env
```

Edit `.env` and replace the placeholder database and RabbitMQ passwords with local development values. Do not commit `.env`.

Start the backend stack:

```sh
docker compose up --build
```

Useful URLs:

```text
Java API:               http://localhost:8080
Java health:            http://localhost:8080/actuator/health
ASP.NET document API:   http://localhost:5000
Document health:        http://localhost:5000/health
Python tailoring:       http://localhost:8000/health
RabbitMQ management:    http://localhost:15672
PostgreSQL:             localhost:5432
```

Container networking is already wired:

```text
Java -> PostgreSQL:        jdbc:postgresql://postgres:5432/${POSTGRES_DB}
Java -> RabbitMQ:          rabbitmq:5672
Java -> document service:  http://document-service:8080
Document -> Python:        http://python-tailoring:8000
```

Run the frontend separately when you want the browser app:

```sh
npm run dev
```

Keep `NEXT_PUBLIC_JAVA_API_BASE_URL=http://localhost:8080` and set `NEXT_PUBLIC_TAILORTEX_API_MODE=backend` in `.env` when using the Java API from Next.js.

Stop the stack:

```sh
docker compose down
```

PostgreSQL, RabbitMQ, uploaded resumes, and file-backed document records use named Docker volumes. To remove local development data too:

```sh
docker compose down -v
```

### Backend Smoke Test

After the Compose stack is healthy, run the deterministic backend workflow smoke test:

```sh
scripts/backend-smoke-test.sh
```

The script requires `curl` and `jq`. It creates a fictional job application through Java, uploads a fictional `.tex` resume, waits up to 60 seconds for tailoring to reach `COMPLETED`, verifies the document ID, retrieves the review/report, confirms generated `.tex` exists, checks that no unsupported skill was invented, and deletes the test application when it exits.

Useful overrides:

```sh
JAVA_API_BASE_URL=http://localhost:8080 \
SMOKE_TIMEOUT_SECONDS=90 \
scripts/backend-smoke-test.sh
```

## Logging and Correlation

Tailoring requests use a generated correlation ID across Java, RabbitMQ, ASP.NET, and Python logs. See [docs/correlation-and-logging.md](docs/correlation-and-logging.md) for the exact RabbitMQ fields, HTTP headers, safe log fields, and sensitive data rules.

## ApplyFlow

The first Java/Spring Boot backend step now lives in `applyflow/`.

See `applyflow/README.md` for setup and test commands.

## ASP.NET Core API

This repository now includes a separate ASP.NET Core Web API in `api/`.

Standalone API runs are still supported. Configure these values in `api/appsettings.json` or environment variables:

```sh
DocumentProcessing__StorageRoot=/tmp/tailortex-documents
PythonService__UseMock=false
PythonService__BaseUrl=http://127.0.0.1:8000
Tectonic__ExecutablePath=tectonic
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
