import { ApiClientError } from "@/lib/api/models";

export type LocalProjectFile = {
  name: string;
  content: string;
};

export type LocalProjectResponse = {
  files: LocalProjectFile[];
  loadedFrom?: string;
};

export type LocalCompileRequest = {
  files: LocalProjectFile[];
  mainFile: string;
};

export type LocalCompileResult = {
  url: string;
  compileFixes?: string;
  pageCount?: number;
};

async function parseLocalError(response: Response, fallback: string) {
  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let message = responseText;

  if (contentType.includes("application/json")) {
    try {
      const error = JSON.parse(responseText) as { error?: string; message?: string };
      message = error.error || error.message || responseText;
    } catch {
      message = responseText;
    }
  }

  return new ApiClientError(
    message
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1600) || fallback,
    { status: response.status }
  );
}

export const localApi = {
  async getProject() {
    const response = await fetch("/api/project");
    if (!response.ok) throw await parseLocalError(response, "Could not load resume-project.");
    return (await response.json()) as LocalProjectResponse;
  },

  async getLocalStore<T>() {
    const response = await fetch("/api/local-store", { cache: "no-store" });
    return {
      ok: response.ok,
      status: response.status,
      path: response.headers.get("X-TailorTeX-Local-Store-Path") ?? undefined,
      data: response.ok ? ((await response.json()) as T) : undefined
    };
  },

  async saveLocalStore<T extends object>(data: T) {
    const response = await fetch("/api/local-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = (await response.json().catch(() => ({}))) as { path?: string };
    if (!response.ok) throw new ApiClientError("Local file sync failed.", { status: response.status });
    return result;
  },

  async compilePdf(request: LocalCompileRequest): Promise<LocalCompileResult> {
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });

    if (!response.ok) throw await parseLocalError(response, "The LaTeX compiler failed.");

    const blob = await response.blob();
    return {
      url: URL.createObjectURL(blob),
      compileFixes: decodeURIComponent(response.headers.get("X-TailorTeX-Compile-Fixes") ?? ""),
      pageCount: Number(response.headers.get("X-TailorTeX-Page-Count") ?? "0") || undefined
    };
  }
};
