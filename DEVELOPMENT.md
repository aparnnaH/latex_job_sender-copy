# Development

This repository contains the TailorTeX Next.js app, the ApplyFlow Java backend, a small ASP.NET Core tailoring API, and local PostgreSQL/RabbitMQ infrastructure.

## Environment Files

Example files are provided for local setup:

```text
.env.example
applyflow/.env.example
applyflow/backend-java/.env.example
api/.env.example
```

Copy an example file to a real local environment file only when needed. Do not commit real `.env` files or secrets.

## Next.js

Install dependencies if needed:

```sh
npm install
```

Run the development server:

```sh
npm run dev
```

Run lightweight checks:

```sh
npm run typecheck
npm run lint
```

Optional environment variable:

```text
TECTONIC_PATH
```

`TECTONIC_PATH` is only needed when the LaTeX PDF preview compiler is not available on `PATH`.

## PostgreSQL And RabbitMQ

Start local infrastructure:

```sh
cd applyflow
docker compose up -d
```

Stop local infrastructure:

```sh
cd applyflow
docker compose down
```

RabbitMQ management UI:

```text
http://localhost:15672
```

Environment variables are documented in `applyflow/.env.example`.

## Java Spring Boot

Start PostgreSQL and RabbitMQ first.

Run the backend:

```sh
cd applyflow/backend-java
mvn spring-boot:run
```

Run tests:

```sh
cd applyflow/backend-java
mvn test
```

The Java tests use Testcontainers, so Docker must be running.

Environment variables are documented in `applyflow/backend-java/.env.example`.

Important unresolved variable:

```text
PYTHON_TAILORING_SCRIPT_PATH
```

The repository currently does not include the Python tailoring script, so this path must be set once that script exists.

## ASP.NET Core API

Run the API:

```sh
dotnet run --project api
```

Environment variables are documented in `api/.env.example`.

Important unresolved variable:

```text
PythonTailoring__ScriptPath
```

The repository currently does not include the Python tailoring script, so this path must be set once that script exists.
