import { readFile } from "fs/promises";
import path from "path";

const projectFileNames = ["main.tex", "page1sidebar.tex", "page2sidebar.tex", "altacv.cls"];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projectDir = path.join(process.cwd(), "resume-project");
    const files = await Promise.all(
      projectFileNames.map(async (name) => ({
        name,
        content: await readFile(path.join(projectDir, name), "utf8")
      }))
    );

    return Response.json({
      files,
      loadedFrom: projectDir
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not read the local resume-project folder.";
    return Response.json({ error: message }, { status: 404 });
  }
}
