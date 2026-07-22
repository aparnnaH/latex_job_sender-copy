import { execFile } from "child_process";
import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type CompileFile = {
  name: string;
  content: string;
};

type PreviewCompileContext = {
  legacyFontAwesomeAvailable: boolean;
};

export const runtime = "nodejs";

function safeFileName(name: string) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function commandCandidates() {
  return [
    process.env.TECTONIC_PATH,
    "/usr/local/bin/tectonic",
    "/opt/homebrew/bin/tectonic",
    "tectonic"
  ].filter(Boolean) as string[];
}

function applyPreviewCompileFixes(file: CompileFile, context: PreviewCompileContext) {
  const fixes: string[] = [];
  let content = file.content;

  if (/\\usepackage(?:\[[^\]]*\])?\{hyperref\}/.test(content)) {
    content = content.replace(
      /\\usepackage(?:\[[^\]]*\])?\{hyperref\}/,
      [
        "% TailorTeX preview fallback: omit hyperref to avoid local pzdr font lookup.",
        "\\providecommand{\\href}[2]{#2}"
      ].join("\n")
    );
    fixes.push(`${safeFileName(file.name)}: replaced hyperref with plain \\href text for preview.`);
  } else if (
    /\\href\s*\{/.test(content) &&
    /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content)
  ) {
    content = content.replace(
      /(\\documentclass(?:\[[^\]]*\])?\{[^}]+\})/,
      "$1\n\\providecommand{\\href}[2]{#2}"
    );
    fixes.push(`${safeFileName(file.name)}: added plain \\href fallback for preview.`);
  }

  if (/\\RequirePackage\{fontawesome\}/.test(content) && !context.legacyFontAwesomeAvailable) {
    content = content.replace(
      /\\RequirePackage\{fontawesome\}/,
      [
        "% TailorTeX preview fallback: legacy fontawesome package requires FontAwesome.otf.",
        "\\providecommand{\\faAt}{@}",
        "\\providecommand{\\faPhone}{Tel.}",
        "\\providecommand{\\faChain}{Link}",
        "\\providecommand{\\faMapMarker}{Loc.}",
        "\\providecommand{\\faLinkedin}{LinkedIn}",
        "\\providecommand{\\faTwitter}{Twitter}",
        "\\providecommand{\\faGithub}{GitHub}",
        "\\providecommand{\\faEnvelope}{Mail}",
        "\\providecommand{\\faCalendar}{Date}",
        "\\providecommand{\\faCircle}{\\textbullet}"
      ].join("\n")
    );
    fixes.push(
      `${safeFileName(file.name)}: replaced legacy fontawesome icons with text placeholders for preview.`
    );
  }

  if (/\\RequirePackage\[backend=biber[\s\S]*?\]\{biblatex\}/.test(content)) {
    content = content.replace(
      /\\RequirePackage\[backend=biber[\s\S]*?\\setlength\{\\bibitemsep\}\{0\.25\\baselineskip\}/,
      [
        "% TailorTeX preview fallback: omit unused biblatex/biber setup.",
        "\\newlength{\\bibhang}",
        "\\newlength{\\bibitemsep}",
        "\\providecommand{\\defbibheading}[2]{}",
        "\\providecommand{\\AtEveryBibitem}[1]{}",
        "\\providecommand{\\bibsetup}{}"
      ].join("\n")
    );
    fixes.push(`${safeFileName(file.name)}: omitted unused biblatex/biber setup for preview.`);
  }

  return { file: { ...file, content }, fixes };
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(root: string, fileName: string, maxDepth = 5): Promise<string | null> {
  if (maxDepth < 0 || !(await fileExists(root))) return null;

  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name === fileName) return entryPath;
      if (entry.isDirectory()) {
        const match = await findFileByName(entryPath, fileName, maxDepth - 1);
        if (match) return match;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function addFontCompatibilityFiles(workDir: string) {
  const fixes: string[] = [];
  const userFontDir = path.join(process.env.HOME ?? "", "Library/Fonts");
  try {
    const fontFiles = await readdir(userFontDir);
    const latoFiles = fontFiles.filter((file) => /^Lato-.*\.ttf$/i.test(file));
    for (const fontFile of latoFiles) {
      await copyFile(path.join(userFontDir, fontFile), path.join(workDir, fontFile));
    }
    if (latoFiles.length > 0) {
      fixes.push(`Lato fonts: copied ${latoFiles.length} local font files for preview.`);
    }
  } catch {
    // Font copying is best-effort. The compiler will report missing fonts if needed.
  }

  const fontAwesomeTarget = path.join(workDir, "FontAwesome.otf");
  const tectonicLegacyFontAwesome = await findFileByName(
    path.join(process.env.HOME ?? "", "Library/Caches/Tectonic/bundles/data"),
    "FontAwesome.otf"
  );
  const fontAwesomeCandidates = [
    tectonicLegacyFontAwesome,
    path.join(process.env.HOME ?? "", "Library/Fonts/Font Awesome 7 Free-Solid-900.otf"),
    path.join(process.env.HOME ?? "", "Library/Fonts/Font Awesome 7 Free-Regular-400.otf")
  ].filter(Boolean) as string[];
  let legacyFontAwesomeAvailable = false;

  if (!(await fileExists(fontAwesomeTarget))) {
    for (const candidate of fontAwesomeCandidates) {
      if (await fileExists(candidate)) {
        await copyFile(candidate, fontAwesomeTarget);
        legacyFontAwesomeAvailable = path.basename(candidate) === "FontAwesome.otf";
        fixes.push(
          legacyFontAwesomeAvailable
            ? "FontAwesome.otf: copied legacy Font Awesome font for original AltaCV icons."
            : "FontAwesome.otf: added local Font Awesome compatibility copy for preview."
        );
        break;
      }
    }
  }

  return { fixes, legacyFontAwesomeAvailable };
}

function summarizeCompileError(log: string) {
  const undefinedControl = log.match(/error:\s+([^:\n]+):(\d+): Undefined control sequence/i);
  if (undefinedControl) {
    return `${undefinedControl[1]}:${undefinedControl[2]} uses an undefined LaTeX command. Add the package or macro that defines it, then compile again.`;
  }

  const firstError = log
    .split("\n")
    .find((line) => /^error:/i.test(line.trim()) || /^!/i.test(line.trim()));
  if (firstError) return firstError.trim();

  return log.slice(-4000);
}

function countPdfPages(pdf: Buffer) {
  const text = pdf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ?? 0;
}

function countPagesFromLog(log: string) {
  const outputMatch = log.match(/Output written on .+?\((\d+)\s+pages?\b/i);
  if (outputMatch) return Number(outputMatch[1]);

  const shippedPages = Array.from(log.matchAll(/\[(\d+)(?:[^\]]*)\]/g))
    .map((match) => Number(match[1]))
    .filter((page) => Number.isFinite(page));

  return shippedPages.length ? Math.max(...shippedPages) : 0;
}

async function compileWithTectonic(workDir: string, mainFile: string) {
  const outDir = path.join(workDir, "out");
  await mkdir(outDir, { recursive: true });
  const logPath = path.join(outDir, mainFile.replace(/\.tex$/i, ".log"));

  let lastError = "";
  for (const command of commandCandidates()) {
    try {
      const result = await execFileAsync(
        command,
        ["--keep-logs", "--outdir", outDir, mainFile],
        {
          cwd: workDir,
          timeout: 45000,
          maxBuffer: 1024 * 1024 * 4
        }
      );
      let fileLog = "";
      try {
        fileLog = await readFile(logPath, "utf8");
      } catch {
        fileLog = "";
      }
      return { outDir, log: `${result.stdout}\n${result.stderr}\n${fileLog}` };
    } catch (error) {
      const typedError = error as { stderr?: string; stdout?: string; message?: string };
      let fileLog = "";
      try {
        fileLog = await readFile(logPath, "utf8");
      } catch {
        fileLog = "";
      }
      lastError = `${typedError.stdout ?? ""}\n${typedError.stderr ?? ""}\n${fileLog}\n${typedError.message ?? ""}`.trim();
    }
  }

  throw new Error(
    lastError
      ? `${summarizeCompileError(lastError)}\n\nCompiler log:\n${lastError.slice(-2500)}`
      : "Tectonic is not installed or could not be executed."
  );
}

export async function POST(request: Request) {
  let workDir: string | undefined;

  try {
    const body = (await request.json()) as {
      files?: CompileFile[];
      mainFile?: string;
    };
    const files = body.files ?? [];
    const mainFile = safeFileName(body.mainFile || "main.tex");

    if (!files.length) {
      return Response.json({ error: "No LaTeX files were provided." }, { status: 400 });
    }
    if (!files.some((file) => safeFileName(file.name) === mainFile)) {
      return Response.json({ error: `Main file ${mainFile} was not included.` }, { status: 400 });
    }

    workDir = await mkdtemp(path.join(tmpdir(), "tailortex-"));
    const previewFixes: string[] = [];
    const fontCompatibility = await addFontCompatibilityFiles(workDir);
    previewFixes.push(...fontCompatibility.fixes);
    for (const file of files) {
      const fixed = applyPreviewCompileFixes(file, {
        legacyFontAwesomeAvailable: fontCompatibility.legacyFontAwesomeAvailable
      });
      previewFixes.push(...fixed.fixes);
      await writeFile(path.join(workDir, safeFileName(file.name)), fixed.file.content, "utf8");
    }

    const { outDir, log } = await compileWithTectonic(workDir, mainFile);
    const pdfName = mainFile.replace(/\.tex$/i, ".pdf");
    const pdf = await readFile(path.join(outDir, pdfName));
    const pageCount = countPagesFromLog(log) || countPdfPages(pdf);

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfName}"`,
        "X-TailorTeX-Compile-Log": encodeURIComponent(log.slice(-1500)),
        "X-TailorTeX-Compile-Fixes": encodeURIComponent(previewFixes.join("\n")),
        "X-TailorTeX-Page-Count": pageCount.toString()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not compile the LaTeX project.";
    return Response.json({ error: message.slice(-4000) }, { status: 500 });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
