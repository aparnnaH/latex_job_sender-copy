# ApplyFlow

ApplyFlow is an event-driven job application tracker built around a Java 21 Spring Boot backend. Python remains isolated to resume analysis, AI tailoring, and LaTeX output generation.

## Architecture

```text
Frontend or API client
  -> Java Spring Boot API
  -> RabbitMQ
  -> Java tailoring worker
  -> existing Python tailoring command
  -> generated LaTeX resume
  -> PostgreSQL resume-version status update
```

Java owns application management, resume upload handling, persistence, events, workflow statuses, retries, failure cleanup, and resume version history.

Python is called with the existing interface:

```sh
python3 path/to/script.py input-resume.tex "job description text" output-resume.tex
```

This repository snapshot still does not contain the Python script, so configure `PYTHON_TAILORING_SCRIPT_PATH` once the existing tool is placed under `resume-tailor-python`.

## Structure

```text
applyflow/
  backend-java/          Java 21 Spring Boot API and RabbitMQ worker
  resume-tailor-python/  Existing Python tailoring tool location
  docker-compose.yml     PostgreSQL and RabbitMQ
  README.md
```

## Services

```sh
cd applyflow
docker compose up -d
```

PostgreSQL defaults:

```text
POSTGRES_DB=applyflow
POSTGRES_USER=applyflow
POSTGRES_PASSWORD=applyflow
POSTGRES_PORT=5432
```

RabbitMQ defaults:

```text
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=applyflow
RABBITMQ_PASSWORD=applyflow
RABBITMQ_MANAGEMENT_PORT=15672
```

RabbitMQ management UI:

```text
http://localhost:15672
```

## Backend Environment

```text
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/applyflow
SPRING_DATASOURCE_USERNAME=applyflow
SPRING_DATASOURCE_PASSWORD=applyflow
APPLYFLOW_RESUME_STORAGE_DIR=/tmp/applyflow/resumes
APPLYFLOW_MAX_UPLOAD_BYTES=1048576
PYTHON_EXECUTABLE=python3
PYTHON_TAILORING_SCRIPT_PATH=../resume-tailor-python/tailor_resume.py
PYTHON_TAILORING_TIMEOUT=PT60S
APPLYFLOW_TAILORING_RETRY_ATTEMPTS=3
```

RabbitMQ names can also be overridden:

```text
APPLYFLOW_RABBITMQ_EXCHANGE=applyflow.resume-tailoring
APPLYFLOW_RABBITMQ_QUEUE=applyflow.resume-tailoring.requests
APPLYFLOW_RABBITMQ_ROUTING_KEY=resume.tailoring.requested
APPLYFLOW_RABBITMQ_DLX=applyflow.resume-tailoring.dlx
APPLYFLOW_RABBITMQ_DLQ=applyflow.resume-tailoring.dead
```

## Run

```sh
cd applyflow/backend-java
mvn spring-boot:run
```

Health check:

```sh
curl http://localhost:8080/actuator/health
```

## Demo Commands

Create an application:

```sh
curl -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Acme",
    "jobTitle": "Backend Engineer",
    "jobDescription": "Build Java 21 Spring Boot services with PostgreSQL and RabbitMQ.",
    "jobUrl": "https://example.com/job"
  }'
```

Request asynchronous resume tailoring:

```sh
curl -X POST http://localhost:8080/api/applications/APPLICATION_ID/resumes/tailor \
  -F "resume=@../resume-project/main.tex"
```

Check a resume version:

```sh
curl http://localhost:8080/api/resume-versions/RESUME_VERSION_ID
```

Download the generated LaTeX resume after status is `COMPLETED`:

```sh
curl http://localhost:8080/api/resume-versions/RESUME_VERSION_ID/download \
  --output tailored-resume.tex
```

Application endpoints:

```text
POST   /api/applications
GET    /api/applications
GET    /api/applications/{id}
PUT    /api/applications/{id}
PATCH  /api/applications/{id}/status
DELETE /api/applications/{id}
POST   /api/applications/{id}/resumes/tailor
GET    /api/resume-versions/{id}
GET    /api/resume-versions/{id}/download
```

## Test

Integration tests use Testcontainers, so Docker must be running.

```sh
cd applyflow/backend-java
mvn test
```

There are no Python tests in this repository snapshot because no Python source is currently present.
