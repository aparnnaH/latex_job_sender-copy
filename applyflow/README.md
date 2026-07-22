# ApplyFlow

ApplyFlow is an event-ready job application tracker built around a Java 21 Spring Boot backend. The existing resume-tailoring capability stays isolated under `resume-tailor-python` so Python can later handle only AI resume analysis and LaTeX tailoring.

## Structure

```text
applyflow/
  backend-java/          Java 21 Spring Boot API
  resume-tailor-python/  Placeholder for existing Python tailoring code
  docker-compose.yml     PostgreSQL for local development
  README.md
```

## Current Python Status

This repository snapshot does not contain Python source files. The previously documented tailoring contract is:

```sh
python3 path/to/script.py input-resume.tex "job description text" output-resume.tex
```

Keep that interface when placing the Python tailoring implementation under `resume-tailor-python`.

## Run PostgreSQL

```sh
cd applyflow
docker compose up -d postgres
```

Defaults:

```text
POSTGRES_DB=applyflow
POSTGRES_USER=applyflow
POSTGRES_PASSWORD=applyflow
POSTGRES_PORT=5432
```

## Run the Java Backend

```sh
cd applyflow/backend-java
./mvnw spring-boot:run
```

If Maven Wrapper is not present, use:

```sh
mvn spring-boot:run
```

The API reads PostgreSQL settings from environment variables:

```text
SPRING_DATASOURCE_URL
SPRING_DATASOURCE_USERNAME
SPRING_DATASOURCE_PASSWORD
```

or from:

```text
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
```

Health check:

```sh
curl http://localhost:8080/actuator/health
```

## API

```sh
curl -X POST http://localhost:8080/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Acme",
    "jobTitle": "Backend Engineer",
    "jobDescription": "Build Java and Spring Boot services",
    "jobUrl": "https://example.com/job"
  }'
```

Endpoints:

```text
POST   /api/applications
GET    /api/applications
GET    /api/applications/{id}
PUT    /api/applications/{id}
PATCH  /api/applications/{id}/status
DELETE /api/applications/{id}
```

Status update body:

```json
{ "status": "INTERVIEW" }
```

## Test

Integration tests use Testcontainers, so Docker must be running.

```sh
cd applyflow/backend-java
mvn test
```
