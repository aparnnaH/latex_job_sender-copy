import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localStorePath = path.join(process.cwd(), "data", "tailortex.local.json");

async function ensureDataDir() {
  await mkdir(path.dirname(localStorePath), { recursive: true });
}

export async function GET() {
  try {
    const content = await readFile(localStorePath, "utf8");
    return new Response(content, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-TailorTeX-Local-Store-Path": localStorePath
      }
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : "";
    if (code === "ENOENT") {
      return Response.json(
        {
          error: "No local TailorTeX data file exists yet.",
          path: localStorePath
        },
        { status: 404 }
      );
    }

    const message = error instanceof Error ? error.message : "Could not read local TailorTeX data.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    await ensureDataDir();
    await writeFile(localStorePath, JSON.stringify(payload, null, 2), "utf8");

    return Response.json({
      ok: true,
      path: localStorePath,
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write local TailorTeX data.";
    return Response.json({ error: message }, { status: 500 });
  }
}
