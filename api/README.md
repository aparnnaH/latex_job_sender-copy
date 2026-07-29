# TailorTeX Document Processing API

The ASP.NET Core API owns production document processing and PDF compilation.

## Tectonic

Install Tectonic on the API host and make it available on `PATH`, or configure:

```text
Tectonic__ExecutablePath=/absolute/path/to/tectonic
Tectonic__TimeoutSeconds=45
```

The compiler service invokes Tectonic without a shell, compiles in an isolated temporary directory, stores successful PDFs under the generated document ID, and removes temporary files after each request.

The existing Next.js route at `src/app/api/compile/route.ts` is intentionally still available as a temporary local-development fallback for PDF preview while production compilation moves here.
