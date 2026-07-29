export type ApiMode = "local" | "backend";

const defaultBackendBaseUrl = "http://localhost:8080";

function normalizeMode(value: string | undefined): ApiMode {
  return value === "backend" ? "backend" : "local";
}

function normalizeBaseUrl(value: string | undefined) {
  return (value ?? defaultBackendBaseUrl).replace(/\/+$/, "");
}

export const apiConfig = {
  mode: normalizeMode(process.env.NEXT_PUBLIC_TAILORTEX_API_MODE),
  javaApiBaseUrl: normalizeBaseUrl(process.env.NEXT_PUBLIC_JAVA_API_BASE_URL),
  timeoutMs: Number(process.env.NEXT_PUBLIC_JAVA_API_TIMEOUT_MS ?? "15000")
};

export function isBackendMode() {
  return apiConfig.mode === "backend";
}
