import type {
  AcceptedChange,
  ParsedResume,
  ResumeField,
  ResumeFieldGroup,
  ResumeFieldKind,
  ResumeSourceFile,
  ResumeSection
} from "@/types/tailortex";
import { processLatexToAstViaUnified } from "@unified-latex/unified-latex";

type CommandConfig = {
  command: string;
  editableArgs: number[];
  kind: ResumeFieldKind;
};

const defaultCommandConfig: CommandConfig[] = [
  { command: "resumeItem", editableArgs: [0], kind: "experience" },
  { command: "resumeSubheading", editableArgs: [0, 2], kind: "command" },
  { command: "cvtag", editableArgs: [0], kind: "skill" },
  { command: "cvskill", editableArgs: [0], kind: "skill" },
  { command: "cvevent", editableArgs: [], kind: "command" },
  { command: "cvproject", editableArgs: [], kind: "command" },
  { command: "cvtechskill", editableArgs: [], kind: "command" },
  { command: "cvachievement", editableArgs: [2], kind: "experience" }
];

const knownSkills = [
  "TypeScript",
  "JavaScript",
  "Python",
  "SQL",
  "React",
  "Next.js",
  "Node.js",
  "Express",
  "Tailwind CSS",
  "PostgreSQL",
  "Supabase",
  "GitHub Actions",
  "Playwright",
  "Jest",
  "REST APIs",
  "CI/CD",
  "accessibility",
  "documentation",
  "design system"
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function isLineCommentedAt(source: string, index: number) {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const before = source.slice(lineStart, index);
  const commentIndex = before.search(/(?<!\\)%/);
  return commentIndex !== -1;
}

function shouldIncludeCommentedField(section: ResumeSection) {
  return /project/i.test(section.title);
}

export function bracesBalanced(source: string) {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];
    if (character === "{" && previous !== "\\") depth += 1;
    if (character === "}" && previous !== "\\") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export function validateLatexSource(source: string) {
  const warnings: string[] = [];
  const isLatexLike =
    /\\documentclass|\\begin\{document\}|\\section|\\cvsection|\\resumeItem|\\resumeSubheading|\\cvevent|\\cvtag|\\cvskill/.test(
      source
    );
  const balanced = bracesBalanced(source);

  if (!isLatexLike) warnings.push("The source does not contain common LaTeX resume commands.");
  if (!balanced) warnings.push("The source has unbalanced braces.");
  if (/\\begin\{document\}/.test(source) && !/\\end\{document\}/.test(source)) {
    warnings.push("The source starts a document but does not end it.");
  }
  if (!canParseWithUnifiedLatex(source)) {
    warnings.push("@unified-latex could not parse this source cleanly.");
  }

  return { isLatexLike, bracesBalanced: balanced, warnings };
}

export function createResumeSourceFile(name: string, content: string): ResumeSourceFile {
  const lower = name.toLowerCase();
  const isTex = lower.endsWith(".tex");
  const isClass = lower.endsWith(".cls");

  return {
    name,
    content,
    role: lower === "main.tex" ? "main" : isTex ? "tex" : isClass ? "class" : "other",
    editable: isTex
  };
}

export function validateLatexProject(files: ResumeSourceFile[]) {
  const editableFiles = files.filter((file) => file.editable);
  const combined = editableFiles.map((file) => file.content).join("\n");
  const warnings = editableFiles.flatMap((file) => {
    const fileWarnings: string[] = [];
    if (!bracesBalanced(file.content)) fileWarnings.push(`${file.name}: The source has unbalanced braces.`);
    if (!canParseWithUnifiedLatex(file.content)) {
      fileWarnings.push(`${file.name}: @unified-latex could not parse this source cleanly.`);
    }
    return fileWarnings;
  });

  return {
    isLatexLike: editableFiles.length > 0 && validateLatexSource(combined).isLatexLike,
    bracesBalanced: files.every((file) => !file.editable || bracesBalanced(file.content)),
    warnings
  };
}

function canParseWithUnifiedLatex(source: string) {
  try {
    processLatexToAstViaUnified().parse(source);
    return true;
  } catch {
    return false;
  }
}

function parseBracedArgs(source: string, startIndex: number) {
  const args: Array<{ content: string; start: number; end: number }> = [];
  let cursor = startIndex;

  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    while (source[cursor] === "[") {
      cursor += 1;
      let depth = 1;
      while (cursor < source.length && depth > 0) {
        const character = source[cursor];
        const previous = source[cursor - 1];
        if (character === "[" && previous !== "\\") depth += 1;
        if (character === "]" && previous !== "\\") depth -= 1;
        cursor += 1;
      }
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    }
    if (source[cursor] !== "{") break;

    const contentStart = cursor + 1;
    let depth = 1;
    cursor += 1;

    while (cursor < source.length && depth > 0) {
      const character = source[cursor];
      const previous = source[cursor - 1];
      if (character === "{" && previous !== "\\") depth += 1;
      if (character === "}" && previous !== "\\") depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) break;

    const contentEnd = cursor - 1;
    args.push({
      content: source.slice(contentStart, contentEnd),
      start: contentStart,
      end: contentEnd
    });
  }

  return args;
}

function detectSections(source: string, filename: string): ResumeSection[] {
  const sectionMatches = Array.from(source.matchAll(/\\(?:section\*?|cvsection)(?:\[[^\]]*\])?\{([^{}]+)\}/g));

  if (sectionMatches.length === 0) {
    return [
      {
        id: `section-${slugify(filename)}-document`,
        fileName: filename,
        title: "Document",
        start: 0,
        end: source.length,
        fields: []
      }
    ];
  }

  return sectionMatches.map((match, index) => {
    const title = match[1].trim();
    const start = match.index ?? 0;
    const next = sectionMatches[index + 1]?.index ?? source.length;

    return {
      id: `section-${slugify(filename)}-${slugify(title) || index}`,
      fileName: filename,
      title,
      start,
      end: next,
      fields: []
    };
  });
}

function findSection(sections: ResumeSection[], index: number) {
  return (
    sections.find((section) => index >= section.start && index < section.end) ??
    sections[sections.length - 1]
  );
}

function inferKind(sectionTitle: string, fallback: ResumeFieldKind): ResumeFieldKind {
  const lower = sectionTitle.toLowerCase();
  if (lower.includes("summary")) return "summary";
  if (lower.includes("skill")) return "skill";
  if (lower.includes("project")) return "project";
  if (lower.includes("certificate")) return "certificate";
  if (lower.includes("education")) return "education";
  if (lower.includes("experience")) return "experience";
  return fallback;
}

function supportedKeywordsFor(text: string) {
  const lower = text.toLowerCase();
  return knownSkills.filter((skill) => lower.includes(skill.toLowerCase()));
}

function cleanLatexDisplay(value: string) {
  return value
    .replace(/\\&/g, "&")
    .replace(/\\\./g, ".")
    .replace(/\\,/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHref(value: string) {
  const hrefMatch = value.match(/\\href\s*/);
  if (!hrefMatch || hrefMatch.index === undefined) return null;

  const args = parseBracedArgs(value, hrefMatch.index + hrefMatch[0].length);
  if (args.length < 2) return null;

  return {
    link: args[0].content.trim(),
    title: cleanLatexDisplay(args[1].content)
  };
}

function projectDisplayFromArgs(args: Array<{ content: string }>) {
  const href = extractHref(args[0]?.content ?? "");
  const title = href?.title || cleanLatexDisplay(args[0]?.content ?? "");
  const subtitle = cleanLatexDisplay(args[1]?.content ?? "");

  return {
    title,
    subtitle,
    link: href?.link
  };
}

function detectFieldGroups(source: string, sections: ResumeSection[]): ResumeFieldGroup[] {
  const events: ResumeFieldGroup[] = [];
  const cveventRegex = /\\cvevent\*?/g;
  const skillGroupRegex = /\\cvtechskill\*?/g;
  const projectRegex = /^[ \t]*(%[ \t]*)?\\cvproject\*?/gm;
  let match: RegExpExecArray | null;
  let previousProjectSectionId = "";
  let previousProjectTitle = "";
  let previousProjectStart = -1;
  let previousProjectEventIndex = -1;

  while ((match = cveventRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    const isCertificate = /certificate/i.test(section.title);
    if (!/(experience|certificate)/i.test(section.title)) continue;
    if (isLineCommentedAt(source, match.index) && !isCertificate) continue;

    const args = parseBracedArgs(source, cveventRegex.lastIndex);
    const title = cleanLatexDisplay(args[0]?.content ?? "");
    if (!title) continue;

    const subtitle = cleanLatexDisplay(args[1]?.content ?? "");
    const meta = cleanLatexDisplay(args[2]?.content ?? "");

    events.push({
      id: `group-${section.id}-${slugify(title) || events.length}-${stableHash(
        `${match.index}:${title}:${subtitle}:${meta}`
      )}`,
      sectionId: section.id,
      title,
      subtitle: subtitle || undefined,
      meta: meta || undefined,
      start: match.index,
      end: section.end,
      lineStart: match.index,
      isCommented: Boolean(isLineCommentedAt(source, match.index))
    });
  }

  while ((match = skillGroupRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    if (!/skill/i.test(section.title)) continue;
    if (isLineCommentedAt(source, match.index)) continue;

    const args = parseBracedArgs(source, skillGroupRegex.lastIndex);
    const title = cleanLatexDisplay(args[0]?.content ?? "");
    if (!title) continue;

    events.push({
      id: `group-${section.id}-${slugify(title) || events.length}-${stableHash(
        `${match.index}:${title}`
      )}`,
      sectionId: section.id,
      title,
      start: match.index,
      end: section.end,
      lineStart: match.index
    });
  }

  while ((match = projectRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    if (!/project/i.test(section.title)) continue;

    const args = parseBracedArgs(source, projectRegex.lastIndex);
    const project = projectDisplayFromArgs(args);
    if (!project.title) continue;
    if (
      previousProjectSectionId === section.id &&
      previousProjectTitle === project.title &&
      !/\\item\b/.test(source.slice(previousProjectStart, match.index))
    ) {
      if (previousProjectEventIndex !== -1) {
        events[previousProjectEventIndex] = {
          ...events[previousProjectEventIndex],
          subtitle: project.subtitle || undefined,
          link: project.link || undefined,
          start: match.index,
          lineStart: match.index,
          isCommented: Boolean(match[1])
        };
      }
      previousProjectStart = match.index;
      continue;
    }
    previousProjectSectionId = section.id;
    previousProjectTitle = project.title;
    previousProjectStart = match.index;

    events.push({
      id: `group-${section.id}-${slugify(project.title) || events.length}-${stableHash(
        `${match.index}:${project.title}:${project.subtitle}:${project.link ?? ""}`
      )}`,
      sectionId: section.id,
      title: project.title,
      subtitle: project.subtitle || undefined,
      link: project.link || undefined,
      start: match.index,
      end: section.end,
      lineStart: match.index,
      isCommented: Boolean(match[1])
    });
    previousProjectEventIndex = events.length - 1;
  }

  return events
    .sort((left, right) => left.start - right.start)
    .map((event, index, sortedEvents) => {
      const nextEvent = sortedEvents
        .slice(index + 1)
        .find((candidate) => candidate.sectionId === event.sectionId);
      const end = nextEvent?.start ?? event.end;
      const fallbackHref = event.link ? null : extractHref(source.slice(event.start, end));

      return {
        ...event,
        end,
        link: event.link ?? fallbackHref?.link
      };
    });
}

function findFieldGroup(groups: ResumeFieldGroup[], section: ResumeSection, index: number) {
  return groups.find((group) => group.sectionId === section.id && index > group.start && index < group.end);
}

function makeField(input: {
  source: string;
  section: ResumeSection;
  command: string;
  kind: ResumeFieldKind;
  original: string;
  start: number;
  end: number;
  lineStart?: number;
  lineEnd?: number;
  ordinal: number;
  isCommented?: boolean;
  group?: ResumeFieldGroup;
}): ResumeField {
  const kind = inferKind(input.section.title, input.kind);
  return {
    id: `${input.section.id}-${input.command}-${input.ordinal}-${stableHash(
      `${input.start}:${input.original}`
    )}`,
    fileName: input.section.fileName,
    sectionId: input.section.id,
    sectionTitle: input.section.title,
    command: input.command,
    kind,
    original: input.original,
    start: input.start,
    end: input.end,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    line: lineNumberAt(input.source, input.start),
    isCommented: input.isCommented,
    group: input.group,
    supportedKeywords: supportedKeywordsFor(input.original)
  };
}

function addPlainTextFields(
  source: string,
  sections: ResumeSection[],
  fields: ResumeField[],
  groups: ResumeFieldGroup[]
) {
  const occupied = fields.map((field) => [field.start, field.end]);
  let ordinal = fields.length;

  for (const section of sections) {
    if (!/(summary|skills)/i.test(section.title)) continue;
    const bodyStart = source.indexOf("\n", section.start);
    if (bodyStart === -1) continue;

    const sectionSource = source.slice(bodyStart + 1, section.end);
    let offset = bodyStart + 1;

    for (const line of sectionSource.split("\n")) {
      const trimmed = line.trim();
      const lineStart = offset + line.indexOf(trimmed);
      const lineEnd = lineStart + trimmed.length;
      offset += line.length + 1;

      if (trimmed.length < 12) continue;
      if (trimmed.startsWith("%") && !shouldIncludeCommentedField(section)) continue;
      if (/^\\/.test(trimmed)) continue;
      if (occupied.some(([start, end]) => lineStart >= start && lineEnd <= end)) continue;

      const uncommented = trimmed.startsWith("%") ? trimmed.replace(/^%\s?/, "") : trimmed;
      const start = trimmed.startsWith("%") ? lineStart + trimmed.indexOf(uncommented) : lineStart;
      const end = start + uncommented.length;
      const field = makeField({
        source,
        section,
        command: "plainText",
        kind: inferKind(section.title, "other"),
        original: uncommented,
        start,
        end,
        ordinal,
        isCommented: trimmed.startsWith("%"),
        group: findFieldGroup(groups, section, start)
      });
      fields.push(field);
      section.fields.push(field);
      ordinal += 1;
    }
  }
}

function addCertificateFields(
  source: string,
  sections: ResumeSection[],
  fields: ResumeField[],
  groups: ResumeFieldGroup[]
) {
  const certificateRegex = /^[ \t]*(%[ \t]*)?\\cvevent\*?/gm;
  let match: RegExpExecArray | null;
  let ordinal = fields.length;

  while ((match = certificateRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    if (!/certificate/i.test(section.title)) continue;

    const args = parseBracedArgs(source, certificateRegex.lastIndex);
    const title = cleanLatexDisplay(args[0]?.content ?? "");
    if (!title) continue;

    const lineEnd = source.indexOf("\n", match.index);
    const start = match.index + match[0].length;
    const field = makeField({
      source,
      section,
      command: "cvevent",
      kind: "certificate",
      original: title,
      start: args[0]?.start ?? start,
      end: args[0]?.end ?? start,
      lineStart: match.index,
      lineEnd: lineEnd === -1 ? source.length : lineEnd,
      ordinal,
      isCommented: Boolean(match[1]),
      group: findFieldGroup(groups, section, start)
    });
    fields.push(field);
    section.fields.push(field);
    ordinal += 1;
  }
}

function addProjectFields(
  source: string,
  sections: ResumeSection[],
  fields: ResumeField[],
  groups: ResumeFieldGroup[]
) {
  const projectRegex = /^[ \t]*(%[ \t]*)?\\cvproject\*?/gm;
  let match: RegExpExecArray | null;
  let ordinal = fields.length;
  const projectGroupByLineStart = new Map(
    groups
      .filter((group) => group.lineStart !== undefined)
      .map((group) => [group.lineStart, group])
  );

  while ((match = projectRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    if (!/project/i.test(section.title)) continue;

    const args = parseBracedArgs(source, projectRegex.lastIndex);
    const project = projectDisplayFromArgs(args);
    if (!project.title) continue;
    const group = projectGroupByLineStart.get(match.index);
    if (!group || group.sectionId !== section.id) continue;

    const firstArg = args[0];
    const field = makeField({
      source,
      section,
      command: "cvproject",
      kind: "project",
      original: project.title,
      start: firstArg?.start ?? projectRegex.lastIndex,
      end: firstArg?.end ?? projectRegex.lastIndex,
      lineStart: match.index,
      lineEnd: source.indexOf("\n", match.index) === -1 ? source.length : source.indexOf("\n", match.index),
      ordinal,
      isCommented: Boolean(match[1]),
      group
    });
    fields.push(field);
    section.fields.push(field);
    ordinal += 1;
  }
}

function addItemFields(
  source: string,
  sections: ResumeSection[],
  fields: ResumeField[],
  groups: ResumeFieldGroup[]
) {
  const itemRegex = /^[ \t]*(%[ \t]*)?\\item\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  let ordinal = fields.length;

  while ((match = itemRegex.exec(source)) !== null) {
    const section = findSection(sections, match.index);
    const isCommented = Boolean(match[1]);
    if (isCommented && !shouldIncludeCommentedField(section)) continue;
    const content = match[2].trim();
    if (!content) continue;

    const rawContentStart = (match.index ?? 0) + match[0].indexOf(match[2]);
    const leadingSpaces = match[2].length - match[2].trimStart().length;
    const start = rawContentStart + leadingSpaces;
    const end = start + content.length;

    const field = makeField({
      source,
      section,
      command: "item",
      kind: inferKind(section.title, "other"),
      original: content,
      start,
      end,
      ordinal,
      isCommented,
      group: findFieldGroup(groups, section, start)
    });
    fields.push(field);
    section.fields.push(field);
    ordinal += 1;
  }
}

export function parseLatexResume(
  source: string,
  filename = "resume.tex",
  config = defaultCommandConfig
): ParsedResume {
  const sections = detectSections(source, filename);
  const groups = detectFieldGroups(source, sections);
  const fields: ResumeField[] = [];
  const configByCommand = new Map(config.map((item) => [item.command, item]));
  const commandRegex = /\\([A-Za-z]+)\*?/g;
  const commandCounts = new Map<string, number>();
  const commandsDetected = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = commandRegex.exec(source)) !== null) {
    const command = match[1];
    const section = findSection(sections, match.index);
    const isCommented = isLineCommentedAt(source, match.index);
    if (isCommented && !shouldIncludeCommentedField(section)) continue;
    commandsDetected.add(command);
    const commandConfig = configByCommand.get(command);
    if (!commandConfig) continue;

    const args = parseBracedArgs(source, commandRegex.lastIndex);
    const count = commandCounts.get(command) ?? 0;
    commandCounts.set(command, count + 1);

    for (const argIndex of commandConfig.editableArgs) {
      const arg = args[argIndex];
      if (!arg || arg.content.trim().length < 2) continue;

      const field = makeField({
        source,
        section,
        command,
        kind: commandConfig.kind,
        original: arg.content,
        start: arg.start,
        end: arg.end,
        ordinal: count + argIndex,
        isCommented,
        group: findFieldGroup(groups, section, arg.start)
      });
      fields.push(field);
      section.fields.push(field);
    }
  }

  addPlainTextFields(source, sections, fields, groups);
  addCertificateFields(source, sections, fields, groups);
  addProjectFields(source, sections, fields, groups);
  addItemFields(source, sections, fields, groups);
  fields.sort((left, right) => left.start - right.start);
  sections.forEach((section) => section.fields.sort((left, right) => left.start - right.start));

  return {
    filename,
    source,
    files: [createResumeSourceFile(filename, source)],
    sections,
    fields,
    commandsDetected: Array.from(commandsDetected).sort(),
    validation: validateLatexSource(source)
  };
}

export function parseLatexProject(files: ResumeSourceFile[]): ParsedResume {
  const editableFiles = files.filter((file) => file.editable);
  const parsedFiles = editableFiles.map((file) => parseLatexResume(file.content, file.name));
  const source = editableFiles
    .map((file) => `% ===== ${file.name} =====\n${file.content}`)
    .join("\n\n");
  const sections = parsedFiles.flatMap((file) => file.sections);
  const fields = parsedFiles.flatMap((file) => file.fields);
  const commandsDetected = Array.from(
    new Set(parsedFiles.flatMap((file) => file.commandsDetected))
  ).sort();

  return {
    filename: files.find((file) => file.role === "main")?.name ?? editableFiles[0]?.name ?? "resume.tex",
    source,
    files,
    sections,
    fields,
    commandsDetected,
    validation: validateLatexProject(files)
  };
}

export function applyAcceptedChanges(source: string, fields: ResumeField[], changes: AcceptedChange[]) {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const validChanges = changes
    .map((change) => ({ change, field: fieldById.get(change.targetId) }))
    .filter((item): item is { change: AcceptedChange; field: ResumeField } => Boolean(item.field))
    .sort((left, right) => right.field.start - left.field.start);

  let nextSource = source;
  for (const { change, field } of validChanges) {
    if (source.slice(field.start, field.end) !== field.original) continue;
    nextSource =
      nextSource.slice(0, field.start) + change.replacement + nextSource.slice(field.end);
  }

  return nextSource;
}

export function applyAcceptedChangesToFiles(
  files: ResumeSourceFile[],
  fields: ResumeField[],
  changes: AcceptedChange[]
) {
  return files.map((file) => {
    if (!file.editable) return file;
    const fileFields = fields.filter((field) => field.fileName === file.name);
    const fileChanges = changes.filter((change) =>
      fileFields.some((field) => field.id === change.targetId)
    );

    return {
      ...file,
      content: applyAcceptedChanges(file.content, fileFields, fileChanges)
    };
  });
}

export function diffLines(original: string, tailored: string) {
  const originalLines = original.split("\n");
  const tailoredLines = tailored.split("\n");
  const max = Math.max(originalLines.length, tailoredLines.length);
  const rows: Array<{ line: number; before: string; after: string; changed: boolean }> = [];

  for (let index = 0; index < max; index += 1) {
    const before = originalLines[index] ?? "";
    const after = tailoredLines[index] ?? "";
    rows.push({ line: index + 1, before, after, changed: before !== after });
  }

  return rows;
}

export function makeSafeFilename(name: string, company: string, role: string) {
  const base = [name, company, role]
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
  return `${base || "Tailored_Resume"}.tex`;
}
