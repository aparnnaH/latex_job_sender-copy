import { apiConfig } from "@/lib/api/config";
import { ApiClientError, type ApiErrorBody } from "@/lib/api/models";

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object | null;
  timeoutMs?: number;
};

function buildUrl(path: string, baseUrl = apiConfig.javaApiBaseUrl) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildBody(body: ApiRequestOptions["body"]) {
  if (!body || body instanceof FormData || body instanceof Blob || typeof body === "string") return body ?? undefined;
  return JSON.stringify(body);
}

function buildHeaders(headers: HeadersInit | undefined, body: ApiRequestOptions["body"]) {
  const nextHeaders = new Headers(headers);
  if (body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== "string" && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }
  return nextHeaders;
}

async function readError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as ApiErrorBody;
    } catch {
      return {};
    }
  }
  return { message: (await response.text().catch(() => "")).slice(0, 500) };
}

function messageFromErrorBody(body: ApiErrorBody) {
  return body.error?.message || body.message || "The backend request failed.";
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? apiConfig.timeoutMs);

  try {
    const response = await fetch(buildUrl(path), {
      ...options,
      body: buildBody(options.body),
      headers: buildHeaders(options.headers, options.body),
      signal: options.signal ?? controller.signal
    });

    if (!response.ok) {
      const errorBody = await readError(response);
      throw new ApiClientError(messageFromErrorBody(errorBody), {
        status: response.status,
        code: errorBody.error?.code,
        retryable: errorBody.error?.retryable,
        details: errorBody.error?.details ?? errorBody.details
      });
    }

    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.blob()) as T);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("The backend request timed out.", { status: 0, code: "REQUEST_TIMEOUT", retryable: true });
    }
    throw new ApiClientError("The backend is unavailable.", { status: 0, code: "BACKEND_UNAVAILABLE", retryable: true });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function toQueryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}
