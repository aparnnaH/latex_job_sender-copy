"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { analyzeJobDescription, compareResumeToJob, generateStructuredSuggestions } from "@/lib/jobAnalysis";
import {
  applyAcceptedChangesToFiles,
  bracesBalanced,
  createResumeSourceFile,
  diffLines,
  makeSafeFilename,
  parseLatexProject,
} from "@/lib/latex";
import { sampleJobDescription, sampleLatexResume, sampleOverleafFiles } from "@/lib/samples";
import { aiResponseSchema, autofillProfileSchema, jobInputSchema, latexSourceSchema } from "@/lib/schemas";
import { backendApi, isBackendMode, localApi } from "@/lib/api";
import type { ApplicationStatus, JobApplication, JobApplicationRequest } from "@/lib/api";
import type {
  AcceptedChange,
  AiResponseShape,
  ParsedResume,
  ResumeField,
  ResumeSourceFile,
  ResumeSuggestion
} from "@/types/tailortex";

type SuggestionStatus = ResumeSuggestion["status"];
type EditorFieldGroup = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  link?: string;
  start: number;
  end: number;
  isCommented?: boolean;
  fields: ResumeField[];
};
type KeywordCoverage = {
  label: string;
  matched: string[];
  missing: string[];
  total: number;
};
type AtsKeywordDelta = {
  gained: string[];
  stillMissing: string[];
  locations: Array<{
    keyword: string;
    fileName: string;
    line: number;
    sectionTitle: string;
    text: string;
  }>;
};
type ProjectRecommendation = {
  groupId: string;
  title: string;
  score: number;
  matchedKeywords: string[];
  evidence: Array<{
    keyword: string;
    source: string;
    text: string;
  }>;
  reason: string;
};
type OptimizerItem = {
  title: string;
  reason: string;
  action: string;
  priority: number;
};
type SkillGapFinding = {
  skill: string;
  evidence: Array<{
    sectionTitle: string;
    fileName: string;
    line: number;
    text: string;
  }>;
};
type PdfPreview = {
  name: string;
  url: string;
  pageCount?: number;
};
type PdfFocusCue = {
  id: string;
  kind: "Project" | "Experience";
  title: string;
  subtitle?: string;
  fileName: string;
  line: number;
  estimatedPage: number;
  confidence: "estimated" | "source";
};
type CompileLocation = {
  fileName: string;
  line: number;
};
type JobDescriptionQuality = {
  level: "good" | "thin" | "vague";
  actionableCount: number;
  responsibilityCount: number;
  keywordCount: number;
  messages: string[];
};
type TailoringConfidenceItem = {
  label: string;
  value: string;
  tone: "sage" | "gold" | "coral";
  detail: string;
};
type EditImpactTag = {
  label: string;
  tone: "sage" | "gold" | "coral" | "ink";
};
type CompileErrorDetails = {
  fileName?: string;
  line?: number;
  likelyCause: string;
  summary: string;
  rawLog: string;
};
type SourceJumpTarget = CompileLocation & {
  nonce: number;
};
type SavedTailoringSession = {
  id: string;
  name: string;
  company: string;
  title: string;
  savedAt: string;
  files: Array<{ name: string; content: string }>;
  activeFileName: string;
  job: {
    title: string;
    company: string;
    url: string;
    description: string;
  };
  manualChangeTags: string[];
  resumeVersionLabel?: string;
  matchScore?: number;
  includedProjects?: string[];
  includedCertificates?: string[];
  pdfPageCount?: number;
};
type ApplicationRecord = {
  id: string;
  savedAt: string;
  appliedAt?: string;
  followUpDate?: string;
  interviewAt?: string;
  decisionAt?: string;
  status: "draft" | "applied" | "interview" | "rejected" | "offer";
  notes: string;
  job: {
    title: string;
    company: string;
    url: string;
    description: string;
  };
  matchScore: number;
  matchedSkills: string[];
  missingRequirements: string[];
  resumeFileName: string;
  resumeVersionLabel?: string;
  submittedFileName: string;
  files: Array<{ name: string; content: string }>;
  includedProjects: string[];
  includedCertificates: string[];
  changeTags: string[];
  pdfPageCount?: number;
  generatedAnswers?: GeneratedApplicationAnswer[];
};
type AutofillProfile = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedIn: string;
  github: string;
  portfolio: string;
  workAuthorization: string;
  sponsorship: string;
  graduationDate: string;
  preferredJobTitles: string;
  eeoAnswers: string;
  shortBio: string;
};
type GeneratedApplicationAnswer = {
  id: string;
  label: string;
  value: string;
};
type TailoringPreset = {
  id: string;
  name: string;
  description: string;
  projectKeywords: string[];
  skillKeywords: string[];
  certificateKeywords: string[];
  custom?: boolean;
};
type TailorTexLocalStore = {
  schema?: string;
  schemaVersion?: number;
  savedAt?: string;
  project?: {
    files?: Array<{ name: string; content: string; editable?: boolean }>;
    originalFiles?: Array<{ name: string; content: string; editable?: boolean }>;
    activeFileName?: string;
    resumeVersionLabel?: string;
    manualChangeTags?: string[];
  };
  job?: Partial<{ title: string; company: string; url: string; description: string }>;
  namedSessions?: SavedTailoringSession[];
  tailoringPresets?: TailoringPreset[];
  applicationRecords?: ApplicationRecord[];
  autofillProfile?: Partial<AutofillProfile>;
  applicationDraft?: {
    notes?: string;
    status?: ApplicationRecord["status"];
  };
  editorPreferences?: {
    maxProjects?: number;
    maxCertificates?: number;
    priorityKeywords?: string[];
    showEducationEditor?: boolean;
    selectedEditorTab?: EditorTab;
    densityMode?: DensityMode;
    safeModeEnabled?: boolean;
  };
};
type LocalStoreStatus = {
  state: "checking" | "file" | "browser" | "error";
  message: string;
  path?: string;
  lastSyncedAt?: string;
  isSaving: boolean;
  browserFallbackActive: boolean;
  backupJsonAvailable: boolean;
};
type DiffRow = {
  line: number;
  before: string;
  after: string;
  changed: boolean;
  fileName: string;
  sectionTitle: string;
};
type StepStatus = "done" | "needs_attention" | "optional" | "blocked";
type SkillOrderSuggestion = {
  groupId: string;
  suggestedIds: string[];
  matchedSkills: string[];
  changed: boolean;
};
type EditorTab = "experience" | "skills" | "projects" | "certificates" | "education";
type ApplicationQuickFilter = "all" | "follow-up" | "interviews" | "high-match" | "drafts" | "applied-week";
type DensityMode = "compact" | "comfortable";
type BackendApplicationDraft = {
  company: string;
  jobTitle: string;
  jobUrl: string;
  source: string;
  location: string;
  jobDescription: string;
  status: ApplicationStatus;
  notes: string;
  resumeUsed: string;
};

const projectStorageKey = "tailortex.savedProject.v1";
const tailoringSessionsStorageKey = "tailortex.namedSessions.v1";
const applicationRecordsStorageKey = "tailortex.applicationRecords.v1";
const autofillProfileStorageKey = "tailortex.autofillProfile.v1";
const backendApplicationStatuses: ApplicationStatus[] = ["SAVED", "APPLIED", "INTERVIEW", "OFFER", "REJECTED", "ARCHIVED"];
const defaultTailoringPresets: TailoringPreset[] = [
  {
    id: "preset-ai-evaluation",
    name: "AI Evaluation",
    description: "Prioritize AI evaluation, NLP, data quality, annotation, model assessment, and Python projects.",
    projectKeywords: ["AI", "evaluation", "NLP", "machine learning", "Python", "model", "annotation", "quality"],
    skillKeywords: ["Python", "NLP", "machine learning", "data analysis", "evaluation", "SQL", "Azure"],
    certificateKeywords: ["Azure", "AI", "data"]
  },
  {
    id: "preset-frontend",
    name: "Frontend",
    description: "Prioritize React, TypeScript, UI, web, accessibility, and product-facing projects.",
    projectKeywords: ["React", "TypeScript", "JavaScript", "frontend", "UI", "web", "accessibility", "responsive"],
    skillKeywords: ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Tailwind", "Next.js"],
    certificateKeywords: ["frontend", "web", "Azure"]
  },
  {
    id: "preset-data-analyst",
    name: "Data Analyst",
    description: "Prioritize SQL, Python, dashboards, analysis, reporting, data cleaning, and metrics.",
    projectKeywords: ["SQL", "Python", "data", "analysis", "dashboard", "visualization", "reporting", "metrics"],
    skillKeywords: ["SQL", "Python", "Excel", "Power BI", "Tableau", "data analysis", "statistics"],
    certificateKeywords: ["data", "Azure", "analytics"]
  },
  {
    id: "preset-research-assistant",
    name: "Research Assistant",
    description: "Prioritize research, experiments, literature review, data collection, writing, and academic projects.",
    projectKeywords: ["research", "experiment", "analysis", "study", "literature", "data collection", "paper", "university"],
    skillKeywords: ["Python", "research", "statistics", "data analysis", "documentation", "writing"],
    certificateKeywords: ["research", "data"]
  }
];

const defaultJob = {
  title: "Junior Software Engineer, Frontend",
  company: "Aurora Systems",
  url: "https://example.com/jobs/junior-frontend",
  description: sampleJobDescription
};
const defaultAutofillProfile: AutofillProfile = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  linkedIn: "",
  github: "",
  portfolio: "",
  workAuthorization: "",
  sponsorship: "",
  graduationDate: "",
  preferredJobTitles: "",
  eeoAnswers: "",
  shortBio: ""
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/x-tex;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadProjectZip(filename: string, files: ResumeSourceFile[]) {
  const zip = new JSZip();
  files.forEach((file) => zip.file(file.name, file.content));
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadApplicationPacketZip(
  filename: string,
  packet: {
    files: Array<{ name: string; content: string }>;
    job: { title: string; company: string; url: string; description: string };
    matchScore: number;
    matchedSkills: string[];
    missingRequirements: string[];
    includedProjects: string[];
    includedCertificates: string[];
    generatedAnswers: GeneratedApplicationAnswer[];
    notes: string;
    status: ApplicationRecord["status"];
    submittedFileName: string;
    resumeVersionLabel?: string;
    savedAt: string;
  }
) {
  const zip = new JSZip();
  const resumeFolder = zip.folder("resume");
  const jobFolder = zip.folder("job");
  const answersFolder = zip.folder("answers");
  packet.files.forEach((file) => resumeFolder?.file(file.name, file.content));
  jobFolder?.file("job-description.txt", packet.job.description || "");
  jobFolder?.file(
    "job-details.json",
    JSON.stringify(
      {
        title: packet.job.title,
        company: packet.job.company,
        url: packet.job.url
      },
      null,
      2
    )
  );
  answersFolder?.file(
    "generated-answers.txt",
    packet.generatedAnswers.map((answer) => `${answer.label}\n${answer.value}`).join("\n\n---\n\n")
  );
  packet.generatedAnswers.forEach((answer, index) => {
    answersFolder?.file(
      `${String(index + 1).padStart(2, "0")}-${normalizeFilenameTag(answer.label) || answer.id}.txt`,
      answer.value
    );
  });
  zip.file("notes.txt", packet.notes || "");
  zip.file(
    "tracker-summary.json",
    JSON.stringify(
      {
        savedAt: packet.savedAt,
        status: packet.status,
        job: packet.job,
        matchScore: packet.matchScore,
        matchedSkills: packet.matchedSkills,
        missingRequirements: packet.missingRequirements,
        submittedFileName: packet.submittedFileName,
        resumeVersionLabel: packet.resumeVersionLabel,
        includedProjects: packet.includedProjects,
        includedCertificates: packet.includedCertificates,
        generatedAnswers: packet.generatedAnswers
      },
      null,
      2
    )
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function tokenizeFilename(filename: string) {
  return filename.replace(/\.tex$/i, "") || "Alex_Morgan";
}

function normalizeFilenameTag(value: string) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .slice(0, 42);
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildTailoredFilename(input: {
  baseName: string;
  company: string;
  role: string;
  tags: string[];
  extension: ".tex" | ".zip";
}) {
  const suffix = input.tags
    .map(normalizeFilenameTag)
    .filter(Boolean)
    .slice(0, 4)
    .join("_");
  const role = [input.role, suffix].filter(Boolean).join("_");

  return makeSafeFilename(input.baseName, input.company, role).replace(/\.tex$/, input.extension);
}

function normalizeApplicationKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function applicationRecordKey(job: { company: string; title: string; url: string }) {
  return [job.company, job.title, job.url].map(normalizeApplicationKeyPart).join("|");
}

function hasApplicationIdentity(job: { company: string; title: string; url: string }) {
  return Boolean(job.company.trim() && job.title.trim() && job.url.trim());
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function dateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}

function applicationAppliedDate(record: ApplicationRecord) {
  return record.appliedAt || (record.status === "draft" ? "" : record.savedAt);
}

function formatApplicationDate(value?: string) {
  if (!value) return "Not set";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function relativeTimeLabel(value?: string) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function dateInputToTime(value?: string) {
  if (!value) return Number.NaN;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return date.getTime();
}

function startOfCurrentWeek() {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function normalizeTailorTexStorePayload(payload: unknown): TailorTexLocalStore | null {
  if (!payload || typeof payload !== "object") return null;

  const data = payload as {
    schema?: string;
    schemaVersion?: number;
    exportedAt?: string;
    savedAt?: string;
    currentProject?: TailorTexLocalStore["project"];
    currentJob?: TailorTexLocalStore["job"];
    project?: TailorTexLocalStore["project"];
    job?: TailorTexLocalStore["job"];
    namedSessions?: SavedTailoringSession[];
    tailoringPresets?: TailoringPreset[];
    applicationRecords?: ApplicationRecord[];
    autofillProfile?: Partial<AutofillProfile>;
    applicationDraft?: TailorTexLocalStore["applicationDraft"];
    editorPreferences?: TailorTexLocalStore["editorPreferences"];
  };

  if (data.schema === "tailortex.fullBackup") {
    return {
      schema: "tailortex.localStore",
      schemaVersion: 1,
      savedAt: data.exportedAt ?? data.savedAt ?? new Date().toISOString(),
      project: data.currentProject,
      job: data.currentJob,
      namedSessions: data.namedSessions,
      tailoringPresets: data.tailoringPresets,
      applicationRecords: data.applicationRecords,
      autofillProfile: data.autofillProfile,
      applicationDraft: data.applicationDraft,
      editorPreferences: data.editorPreferences
    };
  }

  if (
    data.schema === "tailortex.localStore" ||
    data.project ||
    data.namedSessions ||
    data.applicationRecords ||
    data.autofillProfile
  ) {
    return {
      schema: "tailortex.localStore",
      schemaVersion: data.schemaVersion ?? 1,
      savedAt: data.savedAt ?? new Date().toISOString(),
      project: data.project,
      job: data.job,
      namedSessions: data.namedSessions,
      tailoringPresets: data.tailoringPresets,
      applicationRecords: data.applicationRecords,
      autofillProfile: data.autofillProfile,
      applicationDraft: data.applicationDraft,
      editorPreferences: data.editorPreferences
    };
  }

  return null;
}

function uniqueTerms(values: string[]) {
  const seen = new Set<string>();
  const terms: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    terms.push(trimmed);
  });

  return terms;
}

function textHasTerm(text: string, term: string) {
  return text.toLowerCase().includes(term.toLowerCase());
}

function keywordScore(text: string, terms: string[]) {
  return uniqueTerms(terms).filter((term) => textHasTerm(text, term) || textHasTerm(term, text)).length;
}

function analyzeJobDescriptionQuality(
  description: string,
  jobAnalysis: ReturnType<typeof analyzeJobDescription>
): JobDescriptionQuality {
  const trimmed = description.trim();
  const actionableTerms = uniqueTerms([
    ...jobAnalysis.requiredSkills,
    ...jobAnalysis.preferredSkills,
    ...jobAnalysis.responsibilities,
    ...jobAnalysis.keywords
  ]);
  const responsibilitySignals = (trimmed.match(/\b(build|develop|design|implement|support|test|debug|analyze|collaborate|maintain|evaluate|document|deploy|review)\b/gi) ?? []).length;
  const fluffSignals = (trimmed.match(/\b(culture|mission|passionate|fast-paced|family|rockstar|ninja|world-class|dynamic|innovative|values)\b/gi) ?? []).length;
  const actionableCount = actionableTerms.length;
  const responsibilityCount = Math.max(jobAnalysis.responsibilities.length, responsibilitySignals);
  const keywordCount = uniqueTerms(jobAnalysis.keywords).length;
  const messages: string[] = [];

  if (trimmed.length < 500) {
    messages.push("The job description is short. Paste the full responsibilities and qualifications sections for better matching.");
  }
  if (actionableCount < 6) {
    messages.push(`Only ${actionableCount} actionable keywords were found. The match score may be noisy.`);
  }
  if (jobAnalysis.requiredSkills.length < 3) {
    messages.push("Few required skills were detected. Look for a qualifications section or bullet list in the posting.");
  }
  if (responsibilityCount < 4) {
    messages.push("Few responsibilities were detected. Project ranking works better with concrete role duties.");
  }
  if (fluffSignals > actionableCount) {
    messages.push("This posting looks heavy on company/culture language compared with technical requirements.");
  }

  const level: JobDescriptionQuality["level"] =
    actionableCount >= 10 && responsibilityCount >= 4 && trimmed.length >= 700
      ? "good"
      : actionableCount >= 6 || responsibilityCount >= 3
        ? "thin"
        : "vague";

  return {
    level,
    actionableCount,
    responsibilityCount,
    keywordCount,
    messages: level === "good" && messages.length === 0
      ? ["This job description has enough concrete skills and responsibilities for matching."]
      : messages
  };
}

function coverageFor(label: string, text: string, terms: string[]): KeywordCoverage {
  const matched = terms.filter((term) => textHasTerm(text, term));

  return {
    label,
    matched,
    missing: terms.filter((term) => !matched.includes(term)),
    total: terms.length
  };
}

function projectTextForFiles(filesToRead: ResumeSourceFile[]) {
  return filesToRead.filter((file) => file.editable).map((file) => file.content).join("\n");
}

function keywordLocationsForFiles(
  filesToRead: ResumeSourceFile[],
  terms: string[],
  sections: ParsedResume["sections"]
): AtsKeywordDelta["locations"] {
  return uniqueTerms(terms).flatMap((term) =>
    filesToRead
      .filter((file) => file.editable)
      .flatMap((file) =>
        file.content.split("\n").flatMap((line, index) => {
          if (!textHasTerm(line, term)) return [];
          const lineNumber = index + 1;

          return [
            {
              keyword: term,
              fileName: file.name,
              line: lineNumber,
              sectionTitle: sectionTitleForLine(file.name, lineNumber, sections, filesToRead),
              text: line.trim()
            }
          ];
        })
      )
  );
}

function skillRelevanceScore(skill: string, terms: string[]) {
  return terms.filter((term) => textHasTerm(skill, term) || textHasTerm(term, skill)).length;
}

function unsupportedAddedTerms(original: string, suggested: string, resumeSource: string, candidateTerms: string[]) {
  return uniqueTerms(candidateTerms).filter(
    (term) =>
      textHasTerm(suggested, term) &&
      !textHasTerm(original, term) &&
      !textHasTerm(resumeSource, term)
  );
}

function firstWord(value: string) {
  return value.trim().match(/[A-Za-z]+/)?.[0]?.toLowerCase() ?? "";
}

function editImpactTags(
  suggestion: ResumeSuggestion,
  unsupportedTerms: string[],
  pdfFitState: "unknown" | "stale" | "fits" | "overflow"
): EditImpactTag[] {
  const tags: EditImpactTag[] = [];
  const lengthDelta = suggestion.suggested.length - suggestion.original.length;
  const addsKeyword = suggestion.keywordsAdded.length > 0;
  const toneChanged =
    firstWord(suggestion.original) !== firstWord(suggestion.suggested) ||
    /\b(led|owned|optimized|improved|delivered|streamlined|architected|spearheaded)\b/i.test(suggestion.suggested) !==
      /\b(led|owned|optimized|improved|delivered|streamlined|architected|spearheaded)\b/i.test(suggestion.original);

  if (addsKeyword) tags.push({ label: "adds keyword", tone: "sage" });
  if (lengthDelta > 20) tags.push({ label: "lengthens bullet", tone: "gold" });
  if (lengthDelta > 35 || (lengthDelta > 15 && (pdfFitState === "stale" || pdfFitState === "overflow"))) {
    tags.push({ label: "may affect one-page fit", tone: "gold" });
  }
  if (toneChanged) tags.push({ label: "changes tone", tone: "ink" });
  if (unsupportedTerms.length > 0) {
    tags.push({ label: "unsupported claim risk", tone: "coral" });
  } else {
    tags.push({ label: "no new claim", tone: "sage" });
  }
  if (tags.length === 1 && !addsKeyword && lengthDelta <= 20 && !toneChanged) {
    tags.unshift({ label: "small wording edit", tone: "ink" });
  }

  return tags;
}

function splitHighlightedText(value: string, terms: string[]) {
  const activeTerms = uniqueTerms(terms).sort((left, right) => right.length - left.length);
  if (activeTerms.length === 0) return [{ text: value, highlighted: false }];

  const escaped = activeTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");

  return value.split(regex).filter(Boolean).map((part) => ({
    text: part,
    highlighted: activeTerms.some((term) => part.toLowerCase() === term.toLowerCase())
  }));
}

function projectEvidenceFor(group: EditorFieldGroup, terms: string[]) {
  const sources = [
    { source: "Title", text: group.title },
    { source: "Label", text: group.subtitle ?? "" },
    { source: "Date/meta", text: group.meta ?? "" },
    ...group.fields
      .filter((field) => field.command === "item")
      .map((field, index) => ({ source: `Bullet ${index + 1}`, text: field.original }))
  ];

  return terms.flatMap((term) =>
    sources
      .filter((source) => source.text && textHasTerm(source.text, term))
      .map((source) => ({
        keyword: term,
        source: source.source,
        text: source.text
      }))
  );
}

function keywordHintsForGroup(group: EditorFieldGroup, terms: string[]) {
  const text = [
    group.title,
    group.subtitle,
    group.meta,
    ...group.fields.map((field) => field.original)
  ]
    .filter(Boolean)
    .join(" ");

  return uniqueTerms(terms.filter((term) => textHasTerm(text, term)));
}

function sourceLineNumberAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function parseCompileLocation(message: string): CompileLocation | null {
  const candidates = Array.from(message.matchAll(/(?:error:\s+)?([A-Za-z0-9_.-]+\.tex):(\d+)/g));
  const match = candidates.find((candidate) => ["main.tex", "page1sidebar.tex"].includes(candidate[1])) ?? candidates[0];
  if (!match) return null;

  return {
    fileName: match[1],
    line: Number(match[2])
  };
}

function likelyCompileCause(message: string) {
  if (/Undefined control sequence/i.test(message)) {
    return "Undefined command or missing package/macro.";
  }
  if (/No such file or directory|not found/i.test(message)) {
    return "Missing file, package, image, class, or font referenced by the project.";
  }
  if (/Runaway argument|File ended while scanning|Emergency stop/i.test(message)) {
    return "Likely unclosed brace, command argument, or LaTeX environment.";
  }
  if (/Missing \$ inserted|Extra }, or forgotten|Misplaced alignment tab/i.test(message)) {
    return "Likely LaTeX syntax issue around the reported line.";
  }
  if (/font/i.test(message)) {
    return "Font package or local font file issue.";
  }
  return "LaTeX compiler stopped near the reported line. Check the raw log for context.";
}

function parseCompileErrorDetails(message: string): CompileErrorDetails {
  const location = parseCompileLocation(message);
  const compilerLogIndex = message.indexOf("Compiler log:");
  const rawLog = compilerLogIndex >= 0 ? message.slice(compilerLogIndex + "Compiler log:".length).trim() : message;
  const summary = (compilerLogIndex >= 0 ? message.slice(0, compilerLogIndex) : message)
    .replace(/\s+/g, " ")
    .trim();

  return {
    fileName: location?.fileName,
    line: location?.line,
    likelyCause: likelyCompileCause(message),
    summary: summary || "The LaTeX compiler failed.",
    rawLog
  };
}

function uncommentLatexLine(line: string) {
  return line.replace(/^[ \t]*%[ \t]?/, "").trim();
}

function replaceSourceRange(
  filesToUpdate: ResumeSourceFile[],
  fileName: string,
  start: number,
  end: number,
  replacement: string
) {
  return filesToUpdate.map((file) =>
    file.name === fileName
      ? {
          ...file,
          content: file.content.slice(0, start) + replacement + file.content.slice(end)
        }
      : file
  );
}

function projectBlockWithSelection(block: string, selected: boolean) {
  let projectTitleLineSeen = false;

  return block.replace(
    /^([ \t]*)(%[ \t]*)?(\\(?:cvproject\*?|begin\{itemize\}|item\b|end\{itemize\}))/gm,
    (_line, indentation: string, _comment: string | undefined, command: string) => {
      if (!selected) return `${indentation}% ${command}`;
      if (command.startsWith("\\cvproject")) {
        if (projectTitleLineSeen) return `${indentation}% ${command}`;
        projectTitleLineSeen = true;
      }
      return `${indentation}${command}`;
    }
  );
}

function hiddenEvidenceForSkill(
  skill: string,
  sections: ParsedResume["sections"],
  files: ResumeSourceFile[]
): SkillGapFinding["evidence"] {
  const evidence: SkillGapFinding["evidence"] = [];

  sections
    .filter((section) => /(experience|project)/i.test(section.title))
    .forEach((section) => {
      const file = files.find((candidate) => candidate.name === section.fileName);
      if (!file) return;

      const sectionSource = file.content.slice(section.start, section.end);
      let offset = section.start;

      sectionSource.split("\n").forEach((line) => {
        const lineStart = offset;
        offset += line.length + 1;
        if (!/^[ \t]*%/.test(line)) return;
        if (!/\\(?:item|cvproject)\b/.test(line)) return;
        const text = uncommentLatexLine(line);
        if (!textHasTerm(text, skill)) return;

        evidence.push({
          sectionTitle: section.title,
          fileName: file.name,
          line: sourceLineNumberAt(file.content, lineStart),
          text
        });
      });
    });

  return evidence;
}

function sectionTitleForLine(fileName: string, line: number, sections: ParsedResume["sections"], filesToSearch: ResumeSourceFile[]) {
  const file = filesToSearch.find((candidate) => candidate.name === fileName);
  if (!file) return "Document";

  const matchingSection = sections.find((section) => {
    if (section.fileName !== fileName) return false;
    const startLine = sourceLineNumberAt(file.content, section.start);
    const endLine = sourceLineNumberAt(file.content, Math.max(section.start, section.end - 1));
    return line >= startLine && line <= endLine;
  });

  return matchingSection?.title ?? "Document";
}

function fieldLabel(field: ResumeField) {
  const prefix = field.isCommented ? "Archived " : "";
  if (field.command === "item") return `${prefix}Bullet`;
  if (field.command === "cvtag") return `${prefix}Skill tag`;
  if (field.command === "cvskill") return `${prefix}Skill`;
  if (field.command === "cvachievement") return `${prefix}Achievement detail`;
  if (field.command === "plainText") return `${prefix}${field.kind === "summary" ? "Summary" : "Text"}`;
  return `${prefix}${field.kind.charAt(0).toUpperCase() + field.kind.slice(1)}`;
}

function fieldInputMode(field: ResumeField) {
  if (field.kind === "skill") return "compact";
  if (field.kind === "summary") return "long";
  return field.original.length > 90 ? "long" : "medium";
}

function shouldGroupSection(fields: ResumeField[]) {
  return fields.some((field) => field.group);
}

function isCertificateSection(sectionTitle: string) {
  return /certificate/i.test(sectionTitle);
}

function isProjectSection(sectionTitle: string) {
  return /project/i.test(sectionTitle);
}

function isProjectGroupSelected(group: EditorFieldGroup) {
  const projectField = group.fields.find((field) => field.command === "cvproject");
  return projectField ? !projectField.isCommented : !group.isCommented;
}

function isSkillSection(sectionTitle: string) {
  return /skill/i.test(sectionTitle);
}

function tabForSection(sectionTitle: string): EditorTab | null {
  if (/experience/i.test(sectionTitle)) return "experience";
  if (/skill/i.test(sectionTitle)) return "skills";
  if (/project/i.test(sectionTitle)) return "projects";
  if (/certificate/i.test(sectionTitle)) return "certificates";
  if (/education/i.test(sectionTitle)) return "education";
  return null;
}

function groupedEditorFields(fields: ResumeField[], sectionTitle: string) {
  const groups = new Map<string, EditorFieldGroup>();

  fields.forEach((field) => {
    const id = field.group?.id ?? `ungrouped-${field.sectionId}`;
    const existing = groups.get(id);

    if (existing) {
      existing.fields.push(field);
      return;
    }

    groups.set(id, {
      id,
      title: field.group?.title ?? `Other ${sectionTitle}`,
      subtitle: field.group?.subtitle,
      meta: field.group?.meta,
      link: field.group?.link,
      start: field.group?.start ?? field.start,
      end: field.group?.end ?? field.end,
      isCommented: field.group?.isCommented,
      fields: [field]
    });
  });

  return Array.from(groups.values());
}

function pdfFocusCueForGroup(group: EditorFieldGroup, kind: PdfFocusCue["kind"], pageCount?: number): PdfFocusCue {
  const firstField = group.fields[0];
  const fileName = firstField?.fileName ?? "main.tex";
  const lowerFileName = fileName.toLowerCase();
  const estimatedPage =
    pageCount === 1
      ? 1
      : lowerFileName.includes("page2")
        ? 2
        : 1;

  return {
    id: `${kind}:${group.id}:${Date.now()}`,
    kind,
    title: group.title,
    subtitle: [group.subtitle, group.meta].filter(Boolean).join(" | ") || undefined,
    fileName,
    line: firstField?.line ?? 1,
    estimatedPage: Math.min(Math.max(1, estimatedPage), pageCount ?? estimatedPage),
    confidence: pageCount ? "source" : "estimated"
  };
}

function buildAiResponse(
  jobAnalysis: ReturnType<typeof analyzeJobDescription>,
  matchScore: number,
  matchedSkills: string[],
  unsupportedRequirements: string[],
  suggestions: ResumeSuggestion[]
): AiResponseShape {
  return {
    jobAnalysis: {
      requiredSkills: jobAnalysis.requiredSkills,
      preferredSkills: jobAnalysis.preferredSkills,
      responsibilities: jobAnalysis.responsibilities,
      keywords: jobAnalysis.keywords
    },
    matchScore,
    matchedSkills,
    unsupportedRequirements,
    suggestions: suggestions.map((suggestion) => ({
      targetId: suggestion.targetId,
      original: suggestion.original,
      suggested: suggestion.suggested,
      reason: suggestion.reason,
      keywordsAdded: suggestion.keywordsAdded,
      confidence: suggestion.confidence
    }))
  };
}

async function fetchProjectFolderFiles() {
  const project = await localApi.getProject();

  return {
    files: project.files.map((file) => createResumeSourceFile(file.name, file.content)),
    loadedFrom: project.loadedFrom
  };
}

export default function TailorTexApp() {
  const [files, setFiles] = useState<ResumeSourceFile[]>([
    createResumeSourceFile("Alex_Morgan_resume.tex", sampleLatexResume)
  ]);
  const [originalFiles, setOriginalFiles] = useState<ResumeSourceFile[]>([
    createResumeSourceFile("Alex_Morgan_resume.tex", sampleLatexResume)
  ]);
  const [activeFileName, setActiveFileName] = useState("Alex_Morgan_resume.tex");
  const [previewPdf, setPreviewPdf] = useState<PdfPreview | null>(null);
  const [originalPreviewPdf, setOriginalPreviewPdf] = useState<PdfPreview | null>(null);
  const [compileStatus, setCompileStatus] = useState<{
    state: "idle" | "compiling" | "success" | "error";
    message: string;
  }>({ state: "idle", message: "Compile the uploaded LaTeX project to preview it here." });
  const [compileJumpTarget, setCompileJumpTarget] = useState<CompileLocation | null>(null);
  const [compileErrorDetails, setCompileErrorDetails] = useState<CompileErrorDetails | null>(null);
  const [sourceJumpTarget, setSourceJumpTarget] = useState<SourceJumpTarget | null>(null);
  const [pdfFitStatus, setPdfFitStatus] = useState<{
    state: "unknown" | "stale" | "fits" | "overflow";
    pageCount?: number;
  }>({ state: "unknown" });
  const [job, setJob] = useState(defaultJob);
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [selectedStep, setSelectedStep] = useState("upload");
  const [selectedEditorTab, setSelectedEditorTab] = useState<EditorTab>("experience");
  const [workspacePreviewMode, setWorkspacePreviewMode] = useState<"tailored" | "original">("tailored");
  const [visitedSteps, setVisitedSteps] = useState<Set<string>>(() => new Set(["upload"]));
  const [storageReady, setStorageReady] = useState(false);
  const [showEducationEditor, setShowEducationEditor] = useState(false);
  const [workspaceSourceOpen, setWorkspaceSourceOpen] = useState(false);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(() => new Set());
  const [draggedSkillId, setDraggedSkillId] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [manualChangeTags, setManualChangeTags] = useState<string[]>([]);
  const [maxProjects, setMaxProjects] = useState(3);
  const [maxCertificates, setMaxCertificates] = useState(3);
  const [priorityKeywords, setPriorityKeywords] = useState<string[]>([]);
  const [exportSummaryReviewed, setExportSummaryReviewed] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedTailoringSession[]>([]);
  const [sessionName, setSessionName] = useState("");
  const [currentSessionName, setCurrentSessionName] = useState("");
  const [customTailoringPresets, setCustomTailoringPresets] = useState<TailoringPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [applicationRecords, setApplicationRecords] = useState<ApplicationRecord[]>([]);
  const [applicationNotes, setApplicationNotes] = useState("");
  const [applicationStatus, setApplicationStatus] = useState<ApplicationRecord["status"]>("applied");
  const [backendApplications, setBackendApplications] = useState<JobApplication[]>([]);
  const [backendApplicationsStatus, setBackendApplicationsStatus] = useState<{
    state: "idle" | "loading" | "saving" | "error";
    message: string;
  }>({ state: "idle", message: "" });
  const [backendStatusFilter, setBackendStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [autofillProfile, setAutofillProfile] = useState<AutofillProfile>(defaultAutofillProfile);
  const [autofillProfileReady, setAutofillProfileReady] = useState(false);
  const [copiedAnswerId, setCopiedAnswerId] = useState<string | null>(null);
  const [resumeVersionLabel, setResumeVersionLabel] = useState("");
  const [densityMode, setDensityMode] = useState<DensityMode>("comfortable");
  const [safeModeEnabled, setSafeModeEnabled] = useState(true);
  const [pdfFocusCue, setPdfFocusCue] = useState<PdfFocusCue | null>(null);
  const [syncPulseTick, setSyncPulseTick] = useState(0);
  const [diffFileFilter, setDiffFileFilter] = useState("all");
  const [diffSectionFilter, setDiffSectionFilter] = useState("all");
  const [diffChangedOnly, setDiffChangedOnly] = useState(false);
  const [projectStorageStatus, setProjectStorageStatus] = useState("Checking for a saved project...");
  const [localStoreStatus, setLocalStoreStatus] = useState<LocalStoreStatus>({
    state: "checking",
    message: "Checking for data/tailortex.local.json...",
    isSaving: false,
    browserFallbackActive: true,
    backupJsonAvailable: true
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspacePreviewRef = useRef<HTMLDivElement | null>(null);

  const activeFile = files.find((file) => file.name === activeFileName) ?? files[0];
  const primaryEditorFiles = useMemo(() => {
    const preferred = ["main.tex", "page1sidebar.tex"]
      .map((name) => files.find((file) => file.name === name))
      .filter((file): file is ResumeSourceFile => Boolean(file));

    return preferred.length > 0 ? preferred : files.filter((file) => file.editable).slice(0, 2);
  }, [files]);
  const secondaryFiles = files.filter((file) => !primaryEditorFiles.some((primary) => primary.name === file.name));
  const workspaceSourceFile =
    primaryEditorFiles.find((file) => file.name === activeFileName) ?? primaryEditorFiles[0] ?? activeFile;
  const workspacePreview = workspacePreviewMode === "original" ? originalPreviewPdf : previewPdf;
  const workspacePreviewTitle = workspacePreviewMode === "original" ? "Original PDF" : "Tailored PDF";
  const parsedResume = useMemo<ParsedResume>(() => parseLatexProject(files), [files]);
  const originalParsedResume = useMemo<ParsedResume>(() => parseLatexProject(originalFiles), [originalFiles]);
  const sourceValidation = parsedResume.validation;
  const source = parsedResume.source;
  const jobAnalysis = useMemo(() => analyzeJobDescription(job.description), [job.description]);
  const jobDescriptionQuality = useMemo(
    () => analyzeJobDescriptionQuality(job.description, jobAnalysis),
    [job.description, jobAnalysis]
  );
  const matchAnalysis = useMemo(
    () => compareResumeToJob(parsedResume, jobAnalysis),
    [parsedResume, jobAnalysis]
  );
  const educationFieldCount = parsedResume.fields.filter((field) => field.kind === "education").length;
  const editableSections = useMemo(
    () =>
      parsedResume.sections
        .map((section) => ({
          ...section,
          fields: section.fields.filter((field) =>
            [
              "summary",
              "skill",
              "experience",
              "project",
              "certificate",
              showEducationEditor ? "education" : ""
            ].includes(field.kind)
          )
        }))
        .filter((section) => section.fields.length > 0),
    [parsedResume.sections, showEducationEditor]
  );
  const baseEditorTabs: Array<{ id: EditorTab; label: string; count: number }> = [
    {
      id: "experience",
      label: "Experience",
      count: editableSections
        .filter((section) => tabForSection(section.title) === "experience")
        .reduce((total, section) => total + section.fields.length, 0)
    },
    {
      id: "skills",
      label: "Skills",
      count: editableSections
        .filter((section) => tabForSection(section.title) === "skills")
        .reduce((total, section) => total + section.fields.length, 0)
    },
    {
      id: "projects",
      label: "Projects",
      count: editableSections
        .filter((section) => tabForSection(section.title) === "projects")
        .reduce((total, section) => total + section.fields.length, 0)
    },
    {
      id: "certificates",
      label: "Certificates",
      count: editableSections
        .filter((section) => tabForSection(section.title) === "certificates")
        .reduce((total, section) => total + section.fields.length, 0)
    }
  ];
  const editorTabs: Array<{ id: EditorTab; label: string; count: number }> = showEducationEditor
    ? [
        ...baseEditorTabs,
        {
          id: "education",
          label: "Education",
          count: editableSections
            .filter((section) => tabForSection(section.title) === "education")
            .reduce((total, section) => total + section.fields.length, 0)
        }
      ]
    : baseEditorTabs;
  const visibleEditorSections = editableSections.filter(
    (section) => tabForSection(section.title) === selectedEditorTab
  );
  const projectGroups = useMemo(
    () =>
      groupedEditorFields(
        parsedResume.fields.filter((field) => field.kind === "project"),
        "Projects"
      ).filter((group) => group.fields.some((field) => field.command === "cvproject")),
    [parsedResume.fields]
  );
  const certificateGroups = useMemo(
    () =>
      groupedEditorFields(
        parsedResume.fields.filter((field) => field.kind === "certificate"),
        "Certificate"
      ),
    [parsedResume.fields]
  );
  const experienceGroups = useMemo(
    () =>
      groupedEditorFields(
        parsedResume.fields.filter((field) => field.kind === "experience"),
        "Experience"
      ),
    [parsedResume.fields]
  );
  const selectedProjectCount = projectGroups.filter((group) => {
    const projectField = group.fields.find((field) => field.command === "cvproject");
    return projectField ? !projectField.isCommented : !group.isCommented;
  }).length;
  const selectedCertificateCount = certificateGroups.filter((group) => {
    const certificateField = group.fields[0];
    return certificateField ? !certificateField.isCommented : !group.isCommented;
  }).length;
  const experienceGroupCount = experienceGroups.length;
  const includedProjectNames = projectGroups
    .filter((group) => {
      const projectField = group.fields.find((field) => field.command === "cvproject");
      return projectField ? !projectField.isCommented : !group.isCommented;
    })
    .map((group) => group.title);
  const includedCertificateNames = certificateGroups
    .filter((group) => {
      const certificateField = group.fields[0];
      return certificateField ? !certificateField.isCommented : !group.isCommented;
    })
    .map((group) => group.title);
  const originalProjectNames = useMemo(
    () =>
      groupedEditorFields(
        originalParsedResume.fields.filter((field) => field.kind === "project"),
        "Projects"
      )
        .filter((group) => {
          const projectField = group.fields.find((field) => field.command === "cvproject");
          return projectField ? !projectField.isCommented : !group.isCommented;
        })
        .map((group) => group.title),
    [originalParsedResume.fields]
  );
  const originalCertificateNames = useMemo(
    () =>
      groupedEditorFields(
        originalParsedResume.fields.filter((field) => field.kind === "certificate"),
        "Certificate"
      )
        .filter((group) => {
          const certificateField = group.fields[0];
          return certificateField ? !certificateField.isCommented : !group.isCommented;
        })
        .map((group) => group.title),
    [originalParsedResume.fields]
  );
  const tailoringPresets = useMemo(
    () => [...defaultTailoringPresets, ...customTailoringPresets],
    [customTailoringPresets]
  );
  const skillsReordered = useMemo(() => {
    const currentSkillGroups = groupedEditorFields(
      parsedResume.fields.filter((field) => field.kind === "skill"),
      "Skills"
    );
    const originalSkillGroups = groupedEditorFields(
      originalParsedResume.fields.filter((field) => field.kind === "skill"),
      "Skills"
    );

    return currentSkillGroups.some((group) => {
      const originalGroup = originalSkillGroups.find((candidate) => candidate.title === group.title);
      if (!originalGroup) return false;
      const currentSkills = group.fields
        .filter((field) => field.kind === "skill" && !field.isCommented)
        .map((field) => field.original);
      const originalSkills = originalGroup.fields
        .filter((field) => field.kind === "skill" && !field.isCommented)
        .map((field) => field.original);

      return currentSkills.join("|") !== originalSkills.join("|");
    });
  }, [originalParsedResume.fields, parsedResume.fields]);
  const projectLimitExceeded = selectedProjectCount > maxProjects;
  const certificateLimitExceeded = selectedCertificateCount > maxCertificates;
  const focusModeActive =
    focusModeEnabled && (selectedEditorTab === "projects" || selectedEditorTab === "experience");
  const jobKeywordTerms = useMemo(
    () => uniqueTerms([...jobAnalysis.requiredSkills, ...jobAnalysis.preferredSkills, ...jobAnalysis.keywords]),
    [jobAnalysis]
  );
  const weightedJobKeywordTerms = useMemo(
    () => {
      const activePriorities = priorityKeywords.filter((keyword) => jobKeywordTerms.includes(keyword));
      return [...activePriorities, ...activePriorities, ...jobKeywordTerms].filter(Boolean);
    },
    [jobKeywordTerms, priorityKeywords]
  );
  const keywordCoverageBySection = useMemo<KeywordCoverage[]>(() => {
    const textForKind = (kind: ResumeField["kind"]) =>
      parsedResume.fields
        .filter((field) => field.kind === kind && !field.isCommented)
        .map((field) => [field.group?.title, field.group?.subtitle, field.group?.meta, field.original].filter(Boolean).join(" "))
        .join(" ");

    return [
      coverageFor("Experience", textForKind("experience"), jobKeywordTerms),
      coverageFor("Skills", textForKind("skill"), jobKeywordTerms),
      coverageFor("Projects", textForKind("project"), jobKeywordTerms),
      coverageFor("Certificates", textForKind("certificate"), jobKeywordTerms)
    ];
  }, [parsedResume.fields, jobKeywordTerms]);
  const activeKeywordCoverage = keywordCoverageBySection.find(
    (coverage) => coverage.label.toLowerCase() === selectedEditorTab
  );
  const focusCardCount = selectedEditorTab === "projects" ? selectedProjectCount : experienceGroupCount;
  const projectRecommendations = useMemo<ProjectRecommendation[]>(() => {
    return projectGroups
      .map((group) => {
        const projectField = group.fields.find((field) => field.command === "cvproject");
        const text = [
          group.title,
          group.subtitle,
          group.meta,
          ...group.fields.map((field) => field.original)
        ]
          .filter(Boolean)
          .join(" ");
        const weightedMatches = weightedJobKeywordTerms.filter((term) => textHasTerm(text, term));
        const matchedKeywords = uniqueTerms(weightedMatches);
        const score = Math.round((weightedMatches.length / Math.max(1, weightedJobKeywordTerms.length)) * 100);
        const evidence = projectEvidenceFor(group, matchedKeywords);

        return {
          groupId: group.id,
          title: group.title,
          score,
          matchedKeywords,
          evidence,
          reason:
            matchedKeywords.length > 0
              ? `${matchedKeywords.slice(0, 4).join(", ")} matched in this project.`
              : "No direct job keyword matches found."
        } satisfies ProjectRecommendation;
      })
      .sort((left, right) => right.score - left.score || right.matchedKeywords.length - left.matchedKeywords.length)
      .map(({ groupId, title, score, matchedKeywords, evidence, reason }) => ({
        groupId,
        title,
        score,
        matchedKeywords,
        evidence,
        reason
      }));
  }, [projectGroups, weightedJobKeywordTerms]);
  const projectRecommendationById = useMemo(
    () => new Map(projectRecommendations.map((recommendation) => [recommendation.groupId, recommendation])),
    [projectRecommendations]
  );
  const experienceKeywordHintsById = useMemo(() => {
    const groups = groupedEditorFields(
      parsedResume.fields.filter((field) => field.kind === "experience"),
      "Experience"
    );

    return new Map(groups.map((group) => [group.id, keywordHintsForGroup(group, jobKeywordTerms)]));
  }, [parsedResume.fields, jobKeywordTerms]);
  const skillText = useMemo(
    () =>
      parsedResume.fields
        .filter((field) => field.kind === "skill" && !field.isCommented)
        .map((field) => field.original)
        .join(" "),
    [parsedResume.fields]
  );
  const onePageOptimizerItems = useMemo<OptimizerItem[]>(() => {
    const recommendationById = new Map(projectRecommendations.map((recommendation) => [recommendation.groupId, recommendation]));
    const selectedProjectItems = projectGroups
      .filter((group) => {
        const projectField = group.fields.find((field) => field.command === "cvproject");
        return projectField ? !projectField.isCommented : !group.isCommented;
      })
      .map((group) => ({
        group,
        recommendation: recommendationById.get(group.id)
      }))
      .sort((left, right) => (left.recommendation?.score ?? 0) - (right.recommendation?.score ?? 0));

    const selectedCertificateItems = certificateGroups.filter((group) => {
      const certificateField = group.fields[0];
      return certificateField ? !certificateField.isCommented : !group.isCommented;
    });

    const longestBullets = parsedResume.fields
      .filter((field) => field.command === "item" && !field.isCommented)
      .sort((left, right) => right.original.length - left.original.length)
      .slice(0, 2);

    return [
      ...selectedProjectItems.slice(0, 2).map(({ group, recommendation }, index) => ({
        title: `Remove project: ${group.title}`,
        reason: `Lowest selected project relevance${recommendation ? ` (${recommendation.score})` : ""}.`,
        action: "Uncheck this project in the Projects tab.",
        priority: index + 1
      })),
      ...selectedCertificateItems.slice(maxCertificates).map((group, index) => ({
        title: `Remove certificate: ${group.title}`,
        reason: `${selectedCertificateCount} certificates selected; target max is ${maxCertificates}.`,
        action: "Uncheck this certificate in the Certificates tab.",
        priority: 10 + index
      })),
      ...longestBullets.map((field, index) => ({
        title: `Shorten ${field.sectionTitle} bullet`,
        reason: `${field.original.length} characters at ${field.fileName} line ${field.line}.`,
        action: field.original,
        priority: 20 + index
      }))
    ].sort((left, right) => left.priority - right.priority);
  }, [
    certificateGroups,
    maxCertificates,
    parsedResume.fields,
    projectGroups,
    projectRecommendations,
    selectedCertificateCount
  ]);
  const skillGapFindings = useMemo<SkillGapFinding[]>(
    () =>
      matchAnalysis.missingRequirements.map((skill) => ({
        skill,
        evidence: hiddenEvidenceForSkill(skill, parsedResume.sections, files)
      })),
    [files, matchAnalysis.missingRequirements, parsedResume.sections]
  );
  const activeSectionWarnings = useMemo(() => {
    if (selectedEditorTab === "projects") {
      const selectedWithoutKeywords = projectGroups
        .filter(isProjectGroupSelected)
        .filter((group) => (projectRecommendationById.get(group.id)?.matchedKeywords.length ?? 0) === 0)
        .map((group) => `Selected project "${group.title}" has no direct job keyword matches.`);
      const hiddenProjectEvidence = skillGapFindings
        .filter((finding) => finding.evidence.some((item) => isProjectSection(item.sectionTitle)))
        .map((finding) => `Missing keyword "${finding.skill}" appears in a hidden project.`);

      return [...selectedWithoutKeywords, ...hiddenProjectEvidence].slice(0, 5);
    }

    if (selectedEditorTab === "experience") {
      return skillGapFindings
        .filter((finding) => finding.evidence.some((item) => /experience/i.test(item.sectionTitle)))
        .map((finding) => `Missing keyword "${finding.skill}" appears in a hidden experience bullet.`)
        .slice(0, 5);
    }

    if (selectedEditorTab === "skills") {
      return uniqueTerms([...jobAnalysis.requiredSkills, ...jobAnalysis.preferredSkills])
        .filter((skill) => textHasTerm(skillText, skill))
        .slice(0, 5)
        .map((skill) => `"${skill}" is already present in Skills. Move it forward instead of adding duplicate text.`);
    }

    return [];
  }, [
    jobAnalysis.preferredSkills,
    jobAnalysis.requiredSkills,
    projectGroups,
    projectRecommendationById,
    selectedEditorTab,
    skillGapFindings,
    skillText
  ]);
  const skillOrderSuggestionByGroupId = useMemo(() => {
    const suggestionsByGroup = new Map<string, SkillOrderSuggestion>();
    const skillGroups = groupedEditorFields(
      parsedResume.fields.filter((field) => field.kind === "skill"),
      "Skills"
    );

    skillGroups.forEach((group) => {
      const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
      const indexed = skillFields.map((field, index) => ({
        field,
        index,
        score: skillRelevanceScore(field.original, weightedJobKeywordTerms)
      }));
      const sorted = [...indexed].sort((left, right) => right.score - left.score || left.index - right.index);
      const suggestedIds = sorted.map((item) => item.field.id);
      const changed = suggestedIds.some((id, index) => id !== skillFields[index]?.id);
      const matchedSkills = sorted.filter((item) => item.score > 0).map((item) => item.field.original);

      suggestionsByGroup.set(group.id, {
        groupId: group.id,
        suggestedIds,
        matchedSkills,
        changed
      });
    });

    return suggestionsByGroup;
  }, [parsedResume.fields, weightedJobKeywordTerms]);

  useEffect(() => {
    setSuggestions(generateStructuredSuggestions(parsedResume, jobAnalysis, matchAnalysis));
    setActiveSuggestion(0);
  }, [parsedResume, jobAnalysis, matchAnalysis]);

  function createFilesFromStored(storedFiles?: Array<{ name: string; content: string }>) {
    return (
      storedFiles
        ?.filter((file) => file.name && typeof file.content === "string")
        .map((file) => createResumeSourceFile(file.name, file.content)) ?? []
    );
  }

  function isApplicationStatus(value: unknown): value is ApplicationRecord["status"] {
    return ["draft", "applied", "interview", "rejected", "offer"].includes(String(value));
  }

  function isEditorTab(value: unknown): value is EditorTab {
    return ["experience", "skills", "projects", "certificates", "education"].includes(String(value));
  }

  const applyTailorTexLocalStore = useCallback((data: TailorTexLocalStore) => {
    const localFiles = createFilesFromStored(data.project?.files);
    const localOriginalFiles = createFilesFromStored(data.project?.originalFiles);

    if (localFiles.length > 0) {
      setFiles(localFiles);
      setOriginalFiles(localOriginalFiles.length > 0 ? localOriginalFiles : localFiles);
      setActiveFileName(
        data.project?.activeFileName && localFiles.some((file) => file.name === data.project?.activeFileName)
          ? data.project.activeFileName
          : localFiles.find((file) => file.name === "main.tex")?.name ?? localFiles[0].name
      );
    }

    if (data.job) {
      setJob({ ...defaultJob, ...data.job });
    }

    setSavedSessions(
      (data.namedSessions ?? []).filter((session) => session.id && session.name && Array.isArray(session.files))
    );
    setCustomTailoringPresets(
      (data.tailoringPresets ?? []).filter((preset) => preset.id && preset.name && Array.isArray(preset.projectKeywords))
    );
    setApplicationRecords(
      (data.applicationRecords ?? []).filter((record) => record.id && record.job?.title && Array.isArray(record.files))
    );
    setAutofillProfile({ ...defaultAutofillProfile, ...(data.autofillProfile ?? {}) });
    setApplicationNotes(data.applicationDraft?.notes ?? "");
    if (isApplicationStatus(data.applicationDraft?.status)) {
      setApplicationStatus(data.applicationDraft.status);
    }

    setResumeVersionLabel(data.project?.resumeVersionLabel ?? "");
    setManualChangeTags(data.project?.manualChangeTags ?? []);
    if (typeof data.editorPreferences?.maxProjects === "number") {
      setMaxProjects(Math.max(1, data.editorPreferences.maxProjects));
    }
    if (typeof data.editorPreferences?.maxCertificates === "number") {
      setMaxCertificates(Math.max(1, data.editorPreferences.maxCertificates));
    }
    setPriorityKeywords(data.editorPreferences?.priorityKeywords ?? []);
    setShowEducationEditor(Boolean(data.editorPreferences?.showEducationEditor));
    if (isEditorTab(data.editorPreferences?.selectedEditorTab)) {
      setSelectedEditorTab(data.editorPreferences.selectedEditorTab);
    }
    if (data.editorPreferences?.densityMode === "compact" || data.editorPreferences?.densityMode === "comfortable") {
      setDensityMode(data.editorPreferences.densityMode);
    }
    if (typeof data.editorPreferences?.safeModeEnabled === "boolean") {
      setSafeModeEnabled(data.editorPreferences.safeModeEnabled);
    }
  }, []);

  function saveBrowserFallbackSnapshot(data: TailorTexLocalStore) {
    const savedAt = data.savedAt ?? new Date().toISOString();
    try {
      if (data.project?.files?.length) {
        window.localStorage.setItem(
          projectStorageKey,
          JSON.stringify({
            files: data.project.files.map((file) => ({ name: file.name, content: file.content })),
            activeFileName: data.project.activeFileName,
            savedAt
          })
        );
      }
      window.localStorage.setItem(tailoringSessionsStorageKey, JSON.stringify(data.namedSessions ?? []));
      window.localStorage.setItem(applicationRecordsStorageKey, JSON.stringify(data.applicationRecords ?? []));
      window.localStorage.setItem(
        autofillProfileStorageKey,
        JSON.stringify({ ...defaultAutofillProfile, ...(data.autofillProfile ?? {}) })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function writeLocalStoreSnapshot(data: TailorTexLocalStore, successMessage: string) {
    const savedAt = data.savedAt ?? new Date().toISOString();
    try {
      const result = await localApi.saveLocalStore({ ...data, savedAt });
      setLocalStoreStatus((current) => ({
        state: "file",
        message: successMessage,
        path: result.path ?? current.path,
        lastSyncedAt: savedAt,
        isSaving: false,
        browserFallbackActive: true,
        backupJsonAvailable: true
      }));
      return true;
    } catch {
      setLocalStoreStatus((current) => ({
        ...current,
        state: "error",
        message: "Storage: local file sync failed. Browser fallback is still active.",
        isSaving: false,
        browserFallbackActive: true,
        backupJsonAvailable: true
      }));
      return false;
    }
  }

  const buildCurrentLocalStoreSnapshot = useCallback((savedAt = new Date().toISOString()): TailorTexLocalStore => {
    return {
      schema: "tailortex.localStore",
      schemaVersion: 1,
      savedAt,
      project: {
        files: files.map((file) => ({ name: file.name, content: file.content, editable: file.editable })),
        originalFiles: originalFiles.map((file) => ({ name: file.name, content: file.content, editable: file.editable })),
        activeFileName,
        resumeVersionLabel,
        manualChangeTags
      },
      job,
      namedSessions: savedSessions,
      tailoringPresets: customTailoringPresets,
      applicationRecords,
      autofillProfile,
      applicationDraft: {
        notes: applicationNotes,
        status: applicationStatus
      },
      editorPreferences: {
        maxProjects,
        maxCertificates,
        priorityKeywords,
        showEducationEditor,
        selectedEditorTab,
        densityMode,
        safeModeEnabled
      }
    };
  }, [
    activeFileName,
    applicationNotes,
    applicationRecords,
    applicationStatus,
    autofillProfile,
    customTailoringPresets,
    densityMode,
    files,
    job,
    manualChangeTags,
    maxCertificates,
    maxProjects,
    originalFiles,
    priorityKeywords,
    safeModeEnabled,
    resumeVersionLabel,
    savedSessions,
    selectedEditorTab,
    showEducationEditor
  ]);

  async function saveLocalStoreNow() {
    const savedAt = new Date().toISOString();
    const localStoreSnapshot = buildCurrentLocalStoreSnapshot(savedAt);
    const browserFallbackSaved = saveBrowserFallbackSnapshot(localStoreSnapshot);
    if (!browserFallbackSaved) {
      setProjectStorageStatus("Manual save could not update browser fallback. Trying local file...");
      setLocalStoreStatus((current) => ({ ...current, browserFallbackActive: false }));
    }
    setLocalStoreStatus((current) => ({
      ...current,
      message: "Saving...",
      isSaving: true,
      browserFallbackActive: browserFallbackSaved
    }));

    const synced = await writeLocalStoreSnapshot(
      localStoreSnapshot,
      `Storage: manually saved local file at ${new Date(savedAt).toLocaleString()}.`
    );
    setProjectStorageStatus(
      synced
        ? "Saved now to data/tailortex.local.json and browser fallback."
        : browserFallbackSaved
          ? "Manual local file save failed. Browser fallback was updated."
          : "Manual save failed. Check local storage status."
    );
  }

  useEffect(() => {
    let cancelled = false;

    function restoreBrowserStoredData() {
      try {
        const rawSessions = window.localStorage.getItem(tailoringSessionsStorageKey);
        if (rawSessions) {
          const parsedSessions = JSON.parse(rawSessions) as SavedTailoringSession[];
          setSavedSessions(
            parsedSessions.filter((session) => session.id && session.name && Array.isArray(session.files))
          );
        }
      } catch {
        setSavedSessions([]);
      }

      try {
        const rawRecords = window.localStorage.getItem(applicationRecordsStorageKey);
        if (rawRecords) {
          const parsedRecords = JSON.parse(rawRecords) as ApplicationRecord[];
          setApplicationRecords(
            parsedRecords.filter((record) => record.id && record.job?.title && Array.isArray(record.files))
          );
        }
      } catch {
        setApplicationRecords([]);
      }

      try {
        const rawProfile = window.localStorage.getItem(autofillProfileStorageKey);
        if (rawProfile) {
          setAutofillProfile({ ...defaultAutofillProfile, ...(JSON.parse(rawProfile) as Partial<AutofillProfile>) });
        }
      } catch {
        setAutofillProfile(defaultAutofillProfile);
      }
    }

    async function restoreProjectFromBrowserOrFolder() {
      const rawProject = window.localStorage.getItem(projectStorageKey);
      if (!rawProject) {
        try {
          const project = await fetchProjectFolderFiles();
          if (cancelled) return;
          setFiles(project.files);
          setOriginalFiles(project.files);
          setActiveFileName(project.files.find((file) => file.name === "main.tex")?.name ?? project.files[0].name);
          setProjectStorageStatus(
            project.loadedFrom
              ? `Loaded project folder: ${project.loadedFrom}`
              : "Loaded local resume-project folder."
          );
        } catch {
          setProjectStorageStatus("No saved project or resume-project folder found. Sample is loaded.");
        }
        return;
      }

      try {
        const savedProject = JSON.parse(rawProject) as {
          files?: Array<{ name: string; content: string }>;
          activeFileName?: string;
          savedAt?: string;
        };
        const savedFiles = createFilesFromStored(savedProject.files);

        if (!savedFiles.length) {
          setProjectStorageStatus("Saved project was empty, so the sample is loaded.");
          return;
        }

        setFiles(savedFiles);
        setOriginalFiles(savedFiles);
        setActiveFileName(
          savedProject.activeFileName && savedFiles.some((file) => file.name === savedProject.activeFileName)
            ? savedProject.activeFileName
            : savedFiles.find((file) => file.name === "main.tex")?.name ?? savedFiles[0].name
        );
        setProjectStorageStatus(
          savedProject.savedAt
            ? `Restored saved project from ${new Date(savedProject.savedAt).toLocaleString()}.`
            : "Restored saved project from this browser."
        );
      } catch {
        setProjectStorageStatus("Could not restore the saved project, so the sample is loaded.");
      }
    }

    async function bootstrapStorage() {
      try {
        const response = await localApi.getLocalStore<TailorTexLocalStore>();
        if (response.ok && response.data) {
          const localData = response.data;
          if (cancelled) return;
          applyTailorTexLocalStore(localData);
          setLocalStoreStatus({
            state: "file",
            message: localData.savedAt
              ? `Storage: local file synced. Last saved ${new Date(localData.savedAt).toLocaleString()}.`
              : "Storage: local file synced.",
            path: response.path,
            lastSyncedAt: localData.savedAt,
            isSaving: false,
            browserFallbackActive: true,
            backupJsonAvailable: true
          });
          setProjectStorageStatus("Loaded data/tailortex.local.json.");
          return;
        }

        if (response.status !== 404) {
          throw new Error("The local store API could not read data/tailortex.local.json.");
        }

        setLocalStoreStatus({
          state: "browser",
          message: "Storage: using browser fallback until data/tailortex.local.json is created.",
          path: "data/tailortex.local.json",
          isSaving: false,
          browserFallbackActive: true,
          backupJsonAvailable: true
        });
      } catch {
        if (cancelled) return;
        setLocalStoreStatus({
          state: "error",
          message: "Storage: local file unavailable. Using browser fallback.",
          path: "data/tailortex.local.json",
          isSaving: false,
          browserFallbackActive: true,
          backupJsonAvailable: true
        });
      }

      if (cancelled) return;
      restoreBrowserStoredData();
      await restoreProjectFromBrowserOrFolder();
    }

    void bootstrapStorage().finally(() => {
      if (cancelled) return;
      setStorageReady(true);
      setAutofillProfileReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [applyTailorTexLocalStore]);

  const loadBackendApplications = useCallback(async (status = backendStatusFilter) => {
    if (!isBackendMode()) return;
    setBackendApplicationsStatus({ state: "loading", message: "Loading applications..." });
    try {
      const result = await backendApi.listApplications({
        status: status === "all" ? undefined : status,
        size: 100
      });
      setBackendApplications(result.content);
      setBackendApplicationsStatus({
        state: "idle",
        message: `Loaded ${result.content.length} application${result.content.length === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setBackendApplicationsStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Could not load applications."
      });
    }
  }, [backendStatusFilter]);

  useEffect(() => {
    if (!isBackendMode()) return;
    void loadBackendApplications(backendStatusFilter);
  }, [backendStatusFilter, loadBackendApplications]);

  useEffect(() => {
    if (!autofillProfileReady) return;

    try {
      window.localStorage.setItem(autofillProfileStorageKey, JSON.stringify(autofillProfile));
    } catch {
      setProjectStorageStatus("Could not save autofill profile. Browser storage may be full.");
    }
  }, [autofillProfile, autofillProfileReady]);

  useEffect(() => {
    if (!storageReady || !autofillProfileReady) return;

    setLocalStoreStatus((current) => ({
      ...current,
      message: "Saving...",
      isSaving: true
    }));
    const saveTimer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      const localStoreSnapshot = buildCurrentLocalStoreSnapshot(savedAt);

      if (!saveBrowserFallbackSnapshot(localStoreSnapshot)) {
        setProjectStorageStatus("Could not save browser fallback. The project may be too large for browser storage.");
        setLocalStoreStatus((current) => ({ ...current, browserFallbackActive: false }));
      }

      void writeLocalStoreSnapshot(
        localStoreSnapshot,
        `Storage: local file synced. Last saved ${new Date(savedAt).toLocaleString()}.`
      )
        .then((ok) => {
          if (!ok) return;
          setProjectStorageStatus("Saved to data/tailortex.local.json and browser fallback.");
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [
    activeFileName,
    applicationNotes,
    applicationRecords,
    applicationStatus,
    autofillProfile,
    autofillProfileReady,
    buildCurrentLocalStoreSnapshot,
    densityMode,
    files,
    job,
    manualChangeTags,
    maxCertificates,
    maxProjects,
    originalFiles,
    priorityKeywords,
    safeModeEnabled,
    resumeVersionLabel,
    savedSessions,
    selectedEditorTab,
    showEducationEditor,
    storageReady
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setSyncPulseTick((current) => current + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (previewPdf) URL.revokeObjectURL(previewPdf.url.split("#")[0]);
    };
  }, [previewPdf]);

  useEffect(() => {
    return () => {
      if (originalPreviewPdf) URL.revokeObjectURL(originalPreviewPdf.url.split("#")[0]);
    };
  }, [originalPreviewPdf]);

  const acceptedChanges = useMemo<AcceptedChange[]>(
    () =>
      suggestions
        .filter((suggestion) => suggestion.status === "accepted" || suggestion.status === "edited")
        .map((suggestion) => ({
          targetId: suggestion.targetId,
          original: suggestion.original,
          replacement: suggestion.suggested
        })),
    [suggestions]
  );
  const acceptedAiSuggestions = suggestions.filter(
    (suggestion) => suggestion.status === "accepted" || suggestion.status === "edited"
  );

  const tailoredFiles = useMemo(
    () => applyAcceptedChangesToFiles(files, parsedResume.fields, acceptedChanges),
    [files, parsedResume.fields, acceptedChanges]
  );
  const tailoredProjectSource = useMemo(
    () => tailoredFiles.filter((file) => file.editable).map((file) => `% ===== ${file.name} =====\n${file.content}`).join("\n\n"),
    [tailoredFiles]
  );
  const tailoredMainSource =
    tailoredFiles.find((file) => file.name === parsedResume.filename)?.content ??
    tailoredFiles.find((file) => file.editable)?.content ??
    tailoredProjectSource;
  const tailoredBalanced = tailoredFiles.every((file) => !file.editable || bracesBalanced(file.content));
  const atsKeywordDelta = useMemo<AtsKeywordDelta>(() => {
    const originalText = projectTextForFiles(files);
    const tailoredText = projectTextForFiles(tailoredFiles);
    const gained = jobKeywordTerms.filter((term) => !textHasTerm(originalText, term) && textHasTerm(tailoredText, term));
    const stillMissing = jobKeywordTerms.filter((term) => !textHasTerm(tailoredText, term));

    return {
      gained,
      stillMissing,
      locations: keywordLocationsForFiles(tailoredFiles, jobKeywordTerms, parsedResume.sections)
    };
  }, [files, jobKeywordTerms, parsedResume.sections, tailoredFiles]);
  const sourceDiff = useMemo<DiffRow[]>(() => {
    return files
      .filter((file) => file.editable)
      .flatMap((file) => {
        const tailoredFile = tailoredFiles.find((candidate) => candidate.name === file.name);
        const rows = diffLines(file.content, tailoredFile?.content ?? file.content);

        return rows.map((row) => ({
          ...row,
          fileName: file.name,
          sectionTitle: sectionTitleForLine(file.name, row.line, parsedResume.sections, files)
        }));
      });
  }, [files, parsedResume.sections, tailoredFiles]);
  const diffFileOptions = ["all", ...files.filter((file) => file.editable).map((file) => file.name)];
  const diffSectionOptions = [
    "all",
    ...Array.from(new Set(sourceDiff.map((row) => row.sectionTitle))).filter(Boolean)
  ];
  const filteredSourceDiff = sourceDiff.filter((row) => {
    if (diffFileFilter !== "all" && row.fileName !== diffFileFilter) return false;
    if (diffSectionFilter !== "all" && row.sectionTitle !== diffSectionFilter) return false;
    if (diffChangedOnly && !row.changed) return false;
    return true;
  });
  const aiResponse = useMemo(
    () =>
      buildAiResponse(
        jobAnalysis,
        matchAnalysis.score,
        matchAnalysis.matchedSkills,
        matchAnalysis.missingRequirements,
        suggestions
      ),
    [jobAnalysis, matchAnalysis, suggestions]
  );
  const aiResponseIsValid = aiResponseSchema.safeParse(aiResponse).success;
  const jobValidation = jobInputSchema.safeParse(job);
  const latexValidation = latexSourceSchema.safeParse(source);
  const suggestionUnsupportedById = useMemo(
    () =>
      new Map(
        suggestions.map((suggestion) => [
          suggestion.id,
          uniqueTerms([
            ...suggestion.unsupportedClaims,
            ...unsupportedAddedTerms(
              suggestion.original,
              suggestion.suggested,
              parsedResume.source,
              [...jobKeywordTerms, ...suggestion.keywordsAdded]
            )
          ])
        ])
      ),
    [suggestions, parsedResume.source, jobKeywordTerms]
  );
  const unsupportedAccepted = suggestions.filter(
    (suggestion) =>
      (suggestion.status === "accepted" || suggestion.status === "edited") &&
      (suggestionUnsupportedById.get(suggestion.id)?.length ?? 0) > 0
  );
  const tailoringConfidenceItems = useMemo<TailoringConfidenceItem[]>(() => {
    const coveredKeywords = uniqueTerms(keywordCoverageBySection.flatMap((coverage) => coverage.matched));
    const coverageRatio = jobKeywordTerms.length > 0 ? coveredKeywords.length / jobKeywordTerms.length : 0;
    const evidenceTone: TailoringConfidenceItem["tone"] =
      coverageRatio >= 0.65 ? "sage" : coverageRatio >= 0.35 ? "gold" : "coral";
    const hiddenEvidenceCount = skillGapFindings.filter((finding) => finding.evidence.length > 0).length;
    const unsupportedSuggestionCount = suggestions.filter(
      (suggestion) => (suggestionUnsupportedById.get(suggestion.id)?.length ?? 0) > 0
    ).length;
    const pageRiskTone: TailoringConfidenceItem["tone"] =
      pdfFitStatus.state === "overflow" || projectLimitExceeded || certificateLimitExceeded
        ? "coral"
        : pdfFitStatus.state === "stale" || pdfFitStatus.state === "unknown"
          ? "gold"
          : "sage";

    return [
      {
        label: "Evidence strength",
        value: coverageRatio >= 0.65 ? "Strong" : coverageRatio >= 0.35 ? "Medium" : "Thin",
        tone: evidenceTone,
        detail: `${coveredKeywords.length}/${jobKeywordTerms.length || 0} job keywords covered across resume sections`
      },
      {
        label: "Hidden evidence",
        value: hiddenEvidenceCount > 0 ? `${hiddenEvidenceCount} found` : "None",
        tone: hiddenEvidenceCount > 0 ? "gold" : "sage",
        detail:
          hiddenEvidenceCount > 0
            ? "Missing keywords appear in hidden/commented resume content"
            : "No missing keyword evidence found in hidden sections"
      },
      {
        label: "Unsupported claim risk",
        value: unsupportedSuggestionCount > 0 ? `${unsupportedSuggestionCount} review` : "Low",
        tone: unsupportedSuggestionCount > 0 ? "coral" : "sage",
        detail:
          unsupportedSuggestionCount > 0
            ? "Some suggestions add terms not found in the original resume"
            : "Current suggestions stay supported by resume evidence"
      },
      {
        label: "Page-fit risk",
        value:
          pdfFitStatus.state === "overflow"
            ? "High"
            : pdfFitStatus.state === "fits"
              ? "Low"
              : pdfFitStatus.state === "stale"
                ? "Stale"
                : "Unknown",
        tone: pageRiskTone,
        detail:
          pdfFitStatus.state === "overflow"
            ? `Compiled PDF spills to ${pdfFitStatus.pageCount ?? "multiple"} pages`
            : projectLimitExceeded || certificateLimitExceeded
              ? "Project or certificate limits are exceeded"
              : pdfFitStatus.state === "fits"
                ? "Last compiled PDF fits within the current page target"
                : "Compile after edits to confirm one-page fit"
      }
    ];
  }, [
    certificateLimitExceeded,
    jobKeywordTerms,
    keywordCoverageBySection,
    pdfFitStatus.pageCount,
    pdfFitStatus.state,
    projectLimitExceeded,
    skillGapFindings,
    suggestionUnsupportedById,
    suggestions
  ]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setActiveSuggestion((current) => Math.min(Math.max(0, suggestions.length - 1), current + 1));
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setActiveSuggestion((current) => Math.max(0, current - 1));
      }
      if (event.key === "a") {
        const suggestion = suggestions[activeSuggestion];
        if (!suggestion || (suggestionUnsupportedById.get(suggestion.id)?.length ?? 0) > 0) return;
        setSuggestions((current) =>
          current.map((item, suggestionIndex) =>
            suggestionIndex === activeSuggestion ? { ...item, status: "accepted" } : item
          )
        );
        setExportSummaryReviewed(false);
      }
      if (event.key === "r") {
        setSuggestions((current) =>
          current.map((item, suggestionIndex) =>
            suggestionIndex === activeSuggestion ? { ...item, status: "rejected" } : item
          )
        );
        setExportSummaryReviewed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSuggestion, suggestions, suggestionUnsupportedById]);

  useEffect(() => {
    setVisitedSteps((current) => new Set([...Array.from(current), selectedStep]));
  }, [selectedStep]);

  const acceptedSuggestionTags = useMemo(() => {
    const fieldById = new Map(parsedResume.fields.map((field) => [field.id, field]));

    return acceptedChanges
      .map((change) => fieldById.get(change.targetId)?.sectionTitle)
      .filter((value): value is string => Boolean(value));
  }, [acceptedChanges, parsedResume.fields]);
  const downloadTags = useMemo(() => {
    const tags = Array.from(new Set([...acceptedSuggestionTags, ...manualChangeTags]));
    return tags.length > 0 ? tags : ["Tailored"];
  }, [acceptedSuggestionTags, manualChangeTags]);
  const downloadBaseName = tokenizeFilename(parsedResume.filename);
  const resumeVersionName = resumeVersionLabel.trim();
  const exportRoleLabel = resumeVersionName || job.title;
  const exportTags = resumeVersionName ? ["Tailored"] : downloadTags;
  const currentSessionLabel = currentSessionName || [job.company, job.title].filter(Boolean).join(" ") || "Untitled session";
  const generatedApplicationAnswers = useMemo<GeneratedApplicationAnswer[]>(() => {
    const company = job.company || "your company";
    const role = job.title || "this role";
    const matchedSkillsText =
      matchAnalysis.matchedSkills.slice(0, 5).join(", ") ||
      jobAnalysis.keywords.slice(0, 5).join(", ") ||
      "the skills highlighted in the job description";
    const topProject =
      includedProjectNames[0] ||
      projectRecommendations.find((recommendation) => recommendation.score > 0)?.title ||
      "a relevant project from my resume";
    const projectRecommendation =
      projectRecommendations.find((recommendation) => recommendation.title === topProject) ??
      projectRecommendations.find((recommendation) => recommendation.score > 0);
    const projectEvidence = projectRecommendation?.evidence[0]?.text;
    const topExperience = experienceGroups[0];
    const topExperienceBullet = topExperience?.fields.find((field) => field.command === "item")?.original;
    const bioPrefix = autofillProfile.shortBio ? `${autofillProfile.shortBio} ` : "";
    const authorizationLine = [autofillProfile.workAuthorization, autofillProfile.sponsorship]
      .filter(Boolean)
      .join(" ");

    return [
      {
        id: "why-company",
        label: "Why this company?",
        value: `${bioPrefix}I am interested in ${company} because the ${role} opportunity lines up with the work already represented in my resume, especially ${matchedSkillsText}. I would be excited to contribute in a role where I can apply those strengths while continuing to learn from the team and product context.`
      },
      {
        id: "why-role",
        label: "Why this role?",
        value: `This ${role} role is a strong fit because my resume already shows experience with ${matchedSkillsText}. I am especially interested in work that lets me build, evaluate, and improve software in a practical team setting while keeping the work grounded in real user or business needs.`
      },
      {
        id: "project",
        label: "Tell us about a project",
        value: projectEvidence
          ? `One relevant project from my resume is ${topProject}. ${projectEvidence} This project is relevant to ${role} because it connects directly to ${matchedSkillsText}.`
          : `One relevant project from my resume is ${topProject}. I would use this project to discuss how I approached the problem, the tools I used, and how the work connects to ${matchedSkillsText}.`
      },
      {
        id: "experience",
        label: "Relevant experience",
        value: topExperience
          ? `My most relevant experience is ${topExperience.title}${topExperience.subtitle ? ` at ${topExperience.subtitle}` : ""}. ${topExperienceBullet ?? `This experience is relevant because it connects to ${matchedSkillsText}.`}`
          : `My relevant experience connects to ${matchedSkillsText}, based on the resume sections selected for this application.`
      },
      {
        id: "anything-else",
        label: "Anything else?",
        value: [
          `Thank you for reviewing my application for ${role}.`,
          authorizationLine,
          autofillProfile.portfolio ? `Portfolio: ${autofillProfile.portfolio}` : "",
          autofillProfile.github ? `GitHub: ${autofillProfile.github}` : "",
          autofillProfile.linkedIn ? `LinkedIn: ${autofillProfile.linkedIn}` : ""
        ]
          .filter(Boolean)
          .join(" ")
      },
      {
        id: "cover-letter",
        label: "Short cover letter paragraph",
        value: `${bioPrefix}I am applying for the ${role} position at ${company}. My resume highlights experience with ${matchedSkillsText}, and I have tailored the submitted resume to foreground the projects, skills, and experience most relevant to this posting. I would welcome the opportunity to bring that background to your team and continue growing through practical, high-impact engineering work.`
      }
    ];
  }, [
    autofillProfile.github,
    autofillProfile.linkedIn,
    autofillProfile.portfolio,
    autofillProfile.shortBio,
    autofillProfile.sponsorship,
    autofillProfile.workAuthorization,
    experienceGroups,
    includedProjectNames,
    job.company,
    job.title,
    jobAnalysis.keywords,
    matchAnalysis.matchedSkills,
    projectRecommendations
  ]);
  const followUpTemplates = useMemo<GeneratedApplicationAnswer[]>(() => {
    const company = job.company || "your team";
    const role = job.title || "the role";
    const name = autofillProfile.fullName || "Alex";
    const matchedSkillsText =
      matchAnalysis.matchedSkills.slice(0, 3).join(", ") ||
      jobAnalysis.keywords.slice(0, 3).join(", ") ||
      "the skills in the posting";
    const topProject = includedProjectNames[0] || "one of my resume projects";

    return [
      {
        id: "follow-up-one-week",
        label: "1-week follow-up",
        value: `Hi,\n\nI hope you are doing well. I wanted to follow up on my application for the ${role} position at ${company}. I am still very interested in the opportunity and would be happy to provide any additional information that would be helpful.\n\nThank you for your time,\n${name}`
      },
      {
        id: "follow-up-recruiter-thank-you",
        label: "Recruiter thank-you",
        value: `Hi,\n\nThank you for taking the time to speak with me about the ${role} opportunity at ${company}. I appreciated learning more about the role and the team. The conversation made me even more interested in the position, especially the parts connected to ${matchedSkillsText}.\n\nBest,\n${name}`
      },
      {
        id: "follow-up-interview-thank-you",
        label: "Interview thank-you",
        value: `Hi,\n\nThank you for meeting with me today about the ${role} position at ${company}. I enjoyed discussing my experience and how it connects to the team's work. I especially appreciated the chance to talk about ${topProject} and how I approach practical engineering problems.\n\nThanks again,\n${name}`
      },
      {
        id: "follow-up-rejection-response",
        label: "Rejection response",
        value: `Hi,\n\nThank you for letting me know and for considering my application for the ${role} position at ${company}. I appreciate the time your team spent reviewing my background. I would be grateful to be considered for future roles that may be a fit.\n\nBest,\n${name}`
      },
      {
        id: "follow-up-referral-request",
        label: "Referral request",
        value: `Hi,\n\nI hope you are doing well. I am interested in the ${role} position at ${company} and noticed that my background in ${matchedSkillsText} lines up with the posting. If you feel comfortable, would you be open to referring me or pointing me to the best way to apply?\n\nThank you,\n${name}`
      }
    ];
  }, [
    autofillProfile.fullName,
    includedProjectNames,
    job.company,
    job.title,
    jobAnalysis.keywords,
    matchAnalysis.matchedSkills
  ]);
  const tailoredTexFilename = buildTailoredFilename({
    baseName: downloadBaseName,
    company: job.company,
    role: exportRoleLabel,
    tags: exportTags,
    extension: ".tex"
  });
  const tailoredZipFilename = buildTailoredFilename({
    baseName: downloadBaseName,
    company: job.company,
    role: exportRoleLabel,
    tags: [...exportTags, "Overleaf"],
    extension: ".zip"
  });
  const originalZipFilename = buildTailoredFilename({
    baseName: "Original_Project",
    company: job.company,
    role: job.title,
    tags: ["Original"],
    extension: ".zip"
  });
  const duplicateApplicationRecord = useMemo(() => {
    if (!hasApplicationIdentity(job)) return undefined;
    const key = applicationRecordKey(job);
    return applicationRecords.find((record) => applicationRecordKey(record.job) === key);
  }, [applicationRecords, job]);
  const resumeHistoryEntries = useMemo(
    () =>
      [
        ...savedSessions.map((session) => ({
          id: `session-${session.id}`,
          type: "Saved session",
          company: session.company || session.job.company,
          role: session.title || session.job.title,
          date: session.savedAt,
          matchScore: session.matchScore,
          selectedProjects: session.includedProjects ?? [],
          pdfPageCount: session.pdfPageCount
        })),
        ...applicationRecords.map((record) => ({
          id: `application-${record.id}`,
          type: record.status === "draft" ? "Saved draft" : "Application record",
          company: record.job.company,
          role: record.job.title,
          date: applicationAppliedDate(record) || record.savedAt,
          matchScore: record.matchScore,
          selectedProjects: record.includedProjects,
          pdfPageCount: record.pdfPageCount
        }))
      ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()),
    [applicationRecords, savedSessions]
  );
  const hasTailoringChanges = acceptedChanges.length > 0 || manualChangeTags.length > 0;
  const canDownload = tailoredBalanced && unsupportedAccepted.length === 0;
  const exportReadiness = {
    bracesValid: tailoredBalanced,
    noUnsupportedClaims: unsupportedAccepted.length === 0,
    pdfFitsOnePage: pdfFitStatus.state === "fits" && (pdfFitStatus.pageCount ?? 1) <= 1,
    limitsOk: !projectLimitExceeded && !certificateLimitExceeded,
    summaryReviewed: exportSummaryReviewed
  };
  const exportReady = Object.values(exportReadiness).every(Boolean);
  const plainEnglishExportWarning = useMemo(() => {
    const addedProjects = includedProjectNames.filter((name) => !originalProjectNames.includes(name));
    const hiddenProjects = originalProjectNames.filter((name) => !includedProjectNames.includes(name));
    const addedCertificates = includedCertificateNames.filter((name) => !originalCertificateNames.includes(name));
    const hiddenCertificates = originalCertificateNames.filter((name) => !includedCertificateNames.includes(name));
    const pieces = [
      addedProjects.length > 0 ? `added ${addedProjects.length} project${addedProjects.length === 1 ? "" : "s"}` : "",
      hiddenProjects.length > 0 ? `hid ${hiddenProjects.length} project${hiddenProjects.length === 1 ? "" : "s"}` : "",
      addedCertificates.length > 0 ? `added ${addedCertificates.length} certificate${addedCertificates.length === 1 ? "" : "s"}` : "",
      hiddenCertificates.length > 0 ? `hid ${hiddenCertificates.length} certificate${hiddenCertificates.length === 1 ? "" : "s"}` : "",
      skillsReordered ? "reordered skills" : "",
      acceptedAiSuggestions.length > 0
        ? `accepted ${acceptedAiSuggestions.length} AI suggestion${acceptedAiSuggestions.length === 1 ? "" : "s"}`
        : ""
    ].filter(Boolean);
    const changeText = pieces.length > 0 ? `You ${pieces.join(", ")}.` : "No resume tailoring changes are currently selected.";
    const pdfText =
      pdfFitStatus.state === "fits"
        ? `The PDF still fits ${pdfFitStatus.pageCount ?? 1} page${(pdfFitStatus.pageCount ?? 1) === 1 ? "" : "s"}.`
        : pdfFitStatus.state === "overflow"
          ? `The PDF spills to ${pdfFitStatus.pageCount ?? "multiple"} pages.`
          : pdfFitStatus.state === "stale"
            ? "The PDF preview is stale after edits."
            : "The PDF has not been compiled yet.";
    const riskText = unsupportedAccepted.length > 0
      ? "Unsupported accepted claims need review before export."
      : "No unsupported accepted claims are currently blocking export.";

    return `${changeText} ${pdfText} ${riskText}`;
  }, [
    acceptedAiSuggestions.length,
    includedCertificateNames,
    includedProjectNames,
    originalCertificateNames,
    originalProjectNames,
    pdfFitStatus.pageCount,
    pdfFitStatus.state,
    skillsReordered,
    unsupportedAccepted.length
  ]);
  const statusBarItems = [
    {
      label: "PDF",
      value:
        pdfFitStatus.state === "fits"
          ? `${pdfFitStatus.pageCount ?? 1} page`
          : pdfFitStatus.state === "overflow"
            ? `${pdfFitStatus.pageCount} pages`
            : pdfFitStatus.state === "stale"
              ? "stale"
              : "not compiled",
      ok: pdfFitStatus.state === "fits"
    },
    { label: "Projects", value: `${selectedProjectCount}/${maxProjects}`, ok: !projectLimitExceeded },
    { label: "Certificates", value: `${selectedCertificateCount}/${maxCertificates}`, ok: !certificateLimitExceeded },
    { label: "Braces", value: tailoredBalanced ? "valid" : "check", ok: tailoredBalanced },
    {
      label: "Storage",
      value:
        localStoreStatus.state === "file"
          ? "local file"
          : localStoreStatus.state === "browser"
            ? "browser"
            : localStoreStatus.state === "error"
              ? "check"
              : "checking",
      ok: localStoreStatus.state === "file"
    },
    { label: "Safe mode", value: safeModeEnabled ? "on" : "off", ok: safeModeEnabled },
    { label: "Export", value: exportReady ? "ready" : "not ready", ok: exportReady }
  ];
  const syncPulseLabel = localStoreStatus.isSaving
    ? "Saving..."
    : localStoreStatus.lastSyncedAt
      ? `Saved ${relativeTimeLabel(localStoreStatus.lastSyncedAt)}`
      : localStoreStatus.message;
  void syncPulseTick;
  const firstTimeSetupItems = [
    {
      label: "Load Overleaf project",
      done: files.some((file) => file.name === "main.tex") && files.some((file) => file.name === "page1sidebar.tex")
    },
    {
      label: "Fill autofill profile",
      done: Boolean(autofillProfile.fullName.trim() && autofillProfile.email.trim())
    },
    {
      label: "Paste job",
      done: jobValidation.success && job.description.trim().length > 80
    },
    {
      label: "Compile PDF",
      done: pdfFitStatus.state === "fits" || pdfFitStatus.state === "overflow"
    },
    {
      label: "Create Apply Packet",
      done: applicationRecords.length > 0
    }
  ];
  const guidedChecklistItems = [
    {
      label: "Job pasted",
      done: jobValidation.success && job.description.trim().length > 80
    },
    {
      label: "Missing keywords reviewed",
      done: visitedSteps.has("match")
    },
    {
      label: "Projects selected",
      done: selectedProjectCount > 0 && !projectLimitExceeded
    },
    {
      label: "Skills reordered",
      done: skillsReordered
    },
    {
      label: "PDF compiled",
      done: pdfFitStatus.state === "fits" || pdfFitStatus.state === "overflow"
    },
    {
      label: "Export reviewed",
      done: exportSummaryReviewed
    }
  ];
  const sectionProgressItems = [
    {
      label: "Experience complete",
      done: experienceGroupCount > 0,
      detail: experienceGroupCount > 0 ? `${experienceGroupCount} role${experienceGroupCount === 1 ? "" : "s"} detected` : "No experience groups found"
    },
    {
      label: "Projects selected",
      done: selectedProjectCount > 0 && !projectLimitExceeded,
      detail: `${selectedProjectCount}/${maxProjects} selected`
    },
    {
      label: "Skills reordered",
      done: skillsReordered,
      detail: skillsReordered ? "Order changed for this tailoring" : "Original order still active"
    },
    {
      label: "Certificates under limit",
      done: !certificateLimitExceeded,
      detail: `${selectedCertificateCount}/${maxCertificates} selected`
    },
    {
      label: "PDF compiled",
      done: pdfFitStatus.state === "fits" || pdfFitStatus.state === "overflow",
      detail:
        pdfFitStatus.state === "fits"
          ? `Compiled, ${pdfFitStatus.pageCount ?? 1} page`
          : pdfFitStatus.state === "overflow"
            ? `Compiled, ${pdfFitStatus.pageCount} pages`
            : pdfFitStatus.state === "stale"
              ? "Compile again after edits"
              : "Not compiled yet"
    }
  ];

  function focusPdfPreviewForCard(group: EditorFieldGroup, kind: PdfFocusCue["kind"]) {
    const cue = pdfFocusCueForGroup(group, kind, workspacePreview?.pageCount ?? previewPdf?.pageCount);
    setPdfFocusCue(cue);
    if (selectedStep !== "workspace") {
      setSelectedStep("workspace");
    }
    window.setTimeout(() => {
      workspacePreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function updateSuggestion(index: number, status: SuggestionStatus) {
    const suggestion = suggestions[index];
    if (status === "accepted" && suggestion && (suggestionUnsupportedById.get(suggestion.id)?.length ?? 0) > 0) {
      return;
    }

    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) =>
        suggestionIndex === index ? { ...suggestion, status } : suggestion
      )
    );
    setExportSummaryReviewed(false);
  }

  function editSuggestion(index: number, suggested: string) {
    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) =>
        suggestionIndex === index ? { ...suggestion, suggested, status: "edited" } : suggestion
      )
    );
    setExportSummaryReviewed(false);
  }

  function restoreSuggestion(index: number) {
    setSuggestions((current) =>
      current.map((suggestion, suggestionIndex) =>
        suggestionIndex === index
          ? { ...suggestion, suggested: suggestion.original, status: "pending" }
          : suggestion
      )
    );
    setExportSummaryReviewed(false);
  }

  function markPdfFitStale() {
    setPdfFitStatus((current) => ({
      state: current.state === "unknown" ? "unknown" : "stale",
      pageCount: current.pageCount
    }));
    setExportSummaryReviewed(false);
  }

  function restoreOriginalEditorTab(tab: EditorTab) {
    const originalParsed = parseLatexProject(originalFiles);
    const sectionMatchesTab = (title: string) => tabForSection(title) === tab;
    const originalSections = originalParsed.sections.filter((section) => sectionMatchesTab(section.title));
    const currentSections = parsedResume.sections.filter((section) => sectionMatchesTab(section.title));

    setFiles((current) =>
      current.map((file) => {
        if (!file.editable) return file;
        const originalFile = originalFiles.find((candidate) => candidate.name === file.name);
        if (!originalFile) return file;

        const fileCurrentSections = currentSections
          .filter((section) => section.fileName === file.name)
          .sort((left, right) => right.start - left.start);
        if (fileCurrentSections.length === 0) return file;

        const usedOriginalSections = new Set<string>();
        let nextContent = file.content;

        for (const currentSection of fileCurrentSections) {
          const exactOriginal = originalSections.find(
            (section) =>
              section.fileName === file.name &&
              section.title.toLowerCase() === currentSection.title.toLowerCase() &&
              !usedOriginalSections.has(section.id)
          );
          const fallbackOriginal = originalSections.find(
            (section) => section.fileName === file.name && !usedOriginalSections.has(section.id)
          );
          const originalSection = exactOriginal ?? fallbackOriginal;
          if (!originalSection) continue;

          usedOriginalSections.add(originalSection.id);
          nextContent =
            nextContent.slice(0, currentSection.start) +
            originalFile.content.slice(originalSection.start, originalSection.end) +
            nextContent.slice(currentSection.end);
        }

        return { ...file, content: nextContent };
      })
    );
    const restoredTag =
      tab === "certificates"
        ? "Certificates"
        : tab === "projects"
          ? "Projects"
          : tab === "experience"
            ? "Experience"
            : tab === "education"
              ? "Education"
              : "Skills";
    if (tab !== "experience") {
      setManualChangeTags((current) => current.filter((tag) => tag !== restoredTag));
    }
    markPdfFitStale();
    setProjectStorageStatus(`Restored original ${restoredTag.toLowerCase()} section. Saving locally...`);
  }

  function restoreOriginalProject(group: EditorFieldGroup) {
    const currentProjectField = group.fields.find((field) => field.command === "cvproject") ?? group.fields[0];
    if (!currentProjectField) return;

    const originalParsed = parseLatexProject(originalFiles);
    const originalGroup = groupedEditorFields(
      originalParsed.fields.filter((field) => field.kind === "project"),
      "Projects"
    ).find((candidate) => candidate.title === group.title);
    const currentFile = files.find((file) => file.name === currentProjectField.fileName);
    const originalFile = originalFiles.find((file) => file.name === originalGroup?.fields[0]?.fileName);
    if (!currentFile || !originalFile || !originalGroup) return;

    setFiles((current) =>
      replaceSourceRange(
        current,
        currentFile.name,
        group.start,
        group.end,
        originalFile.content.slice(originalGroup.start, originalGroup.end)
      )
    );
    setManualChangeTags((current) => current.filter((tag) => tag !== "Projects"));
    markPdfFitStale();
    setProjectStorageStatus(`Restored original project: ${group.title}. Saving locally...`);
  }

  function restoreOriginalCertificate(group: EditorFieldGroup, field?: ResumeField) {
    if (!field || field.lineStart === undefined || field.lineEnd === undefined) return;

    const originalParsed = parseLatexProject(originalFiles);
    const originalField = originalParsed.fields.find(
      (candidate) =>
        candidate.kind === "certificate" &&
        candidate.original === field.original &&
        candidate.lineStart !== undefined &&
        candidate.lineEnd !== undefined
    );
    const originalFile = originalFiles.find((file) => file.name === originalField?.fileName);
    if (!originalField || !originalFile) return;

    setFiles((current) =>
      replaceSourceRange(
        current,
        field.fileName,
        field.lineStart ?? 0,
        field.lineEnd ?? 0,
        originalFile.content.slice(originalField.lineStart ?? 0, originalField.lineEnd ?? 0)
      )
    );
    setManualChangeTags((current) => current.filter((tag) => tag !== "Certificates"));
    markPdfFitStale();
    setProjectStorageStatus(`Restored original certificate: ${group.title}. Saving locally...`);
  }

  function restoreOriginalSkillGroup(group: EditorFieldGroup) {
    const currentSkills = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
    if (currentSkills.length === 0) return;

    const originalGroup = groupedEditorFields(
      originalParsedResume.fields.filter((field) => field.kind === "skill"),
      "Skills"
    ).find((candidate) => candidate.title === group.title);
    const originalSkills = originalGroup?.fields.filter((field) => field.kind === "skill" && !field.isCommented);
    if (!originalSkills || originalSkills.length !== currentSkills.length) return;

    const replacements = currentSkills.map((field, index) => ({
      field,
      replacement: originalSkills[index]?.original ?? field.original
    }));

    setFiles((current) =>
      current.map((file) => {
        if (file.name !== currentSkills[0]?.fileName) return file;
        let nextContent = file.content;

        for (const { field, replacement } of [...replacements].sort((left, right) => right.field.start - left.field.start)) {
          if (nextContent.slice(field.start, field.end) !== field.original) continue;
          nextContent =
            nextContent.slice(0, field.start) + replacement + nextContent.slice(field.end);
        }

        return { ...file, content: nextContent };
      })
    );
    setManualChangeTags((current) => current.filter((tag) => tag !== "Skills"));
    markPdfFitStale();
    setProjectStorageStatus(`Restored original ${group.title} skill order. Saving locally...`);
  }

  function setFileContent(fileName: string, content: string) {
    setFiles((current) =>
      current.map((file) => (file.name === fileName ? { ...file, content } : file))
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Source"])));
    markPdfFitStale();
    setProjectStorageStatus(`Edited ${fileName}. Saving locally...`);
  }

  function updateResumeField(field: ResumeField, replacement: string) {
    setFiles((current) =>
      current.map((file) => {
        if (file.name !== field.fileName) return file;

        return {
          ...file,
          content: file.content.slice(0, field.start) + replacement + file.content.slice(field.end)
        };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, field.sectionTitle || field.kind])));
    markPdfFitStale();
    setProjectStorageStatus("Edited structured resume field. Saving locally...");
  }

  function reorderSkillFields(group: EditorFieldGroup, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;

    const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
    const fromIndex = skillFields.findIndex((field) => field.id === draggedId);
    const toIndex = skillFields.findIndex((field) => field.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...skillFields];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const replacements = skillFields.map((field, index) => ({
      field,
      replacement: reordered[index]?.original ?? field.original
    }));

    setFiles((current) =>
      current.map((file) => {
        if (file.name !== skillFields[0]?.fileName) return file;

        let nextContent = file.content;
        const sortedReplacements = [...replacements].sort((left, right) => right.field.start - left.field.start);

        for (const { field, replacement } of sortedReplacements) {
          if (nextContent.slice(field.start, field.end) !== field.original) continue;
          nextContent =
            nextContent.slice(0, field.start) + replacement + nextContent.slice(field.end);
        }

        return { ...file, content: nextContent };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Skills"])));
    markPdfFitStale();
    setProjectStorageStatus(`Reordered ${group.title} skills. Saving locally...`);
  }

  function moveSkillField(group: EditorFieldGroup, fieldId: string, direction: -1 | 1) {
    const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
    const index = skillFields.findIndex((field) => field.id === fieldId);
    const target = skillFields[index + direction];
    if (!target) return;

    reorderSkillFields(group, fieldId, target.id);
  }

  function applySkillOrderSuggestion(group: EditorFieldGroup, suggestion?: SkillOrderSuggestion) {
    if (!suggestion?.changed) return;

    const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
    const fieldById = new Map(skillFields.map((field) => [field.id, field]));
    const suggestedFields = suggestion.suggestedIds
      .map((id) => fieldById.get(id))
      .filter((field): field is ResumeField => Boolean(field));
    if (suggestedFields.length !== skillFields.length) return;

    const replacements = skillFields.map((field, index) => ({
      field,
      replacement: suggestedFields[index]?.original ?? field.original
    }));

    setFiles((current) =>
      current.map((file) => {
        if (file.name !== skillFields[0]?.fileName) return file;

        let nextContent = file.content;
        const sortedReplacements = [...replacements].sort((left, right) => right.field.start - left.field.start);

        for (const { field, replacement } of sortedReplacements) {
          if (nextContent.slice(field.start, field.end) !== field.original) continue;
          nextContent =
            nextContent.slice(0, field.start) + replacement + nextContent.slice(field.end);
        }

        return { ...file, content: nextContent };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Skills"])));
    markPdfFitStale();
    setProjectStorageStatus(`Applied suggested ${group.title} skill order. Saving locally...`);
  }

  function setCertificateSelected(field: ResumeField, selected: boolean) {
    if (field.lineStart === undefined || field.lineEnd === undefined) return;

    setFiles((current) =>
      current.map((file) => {
        if (file.name !== field.fileName) return file;

        const line = file.content.slice(field.lineStart, field.lineEnd);
        const isSelected = !/^[ \t]*%/.test(line);
        if (isSelected === selected) return file;

        const nextLine = selected
          ? line.replace(/^([ \t]*)%[ \t]?/, "$1")
          : line.replace(/^([ \t]*)/, "$1% ");

        return {
          ...file,
          content:
            file.content.slice(0, field.lineStart) +
            nextLine +
            file.content.slice(field.lineEnd)
        };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Certificates"])));
    markPdfFitStale();
    setProjectStorageStatus(
      `${selected ? "Included" : "Hidden"} ${field.original}. Saving locally...`
    );
  }

  function setProjectSelected(group: EditorFieldGroup, selected: boolean) {
    const projectField = group.fields.find((field) => field.command === "cvproject") ?? group.fields[0];
    if (!projectField) return;

    setFiles((current) =>
      current.map((file) => {
        if (file.name !== projectField.fileName) return file;

        const block = file.content.slice(group.start, group.end);
        const nextBlock = projectBlockWithSelection(block, selected);

        return {
          ...file,
          content: file.content.slice(0, group.start) + nextBlock + file.content.slice(group.end)
        };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Projects"])));
    markPdfFitStale();
    setProjectStorageStatus(
      `${selected ? "Included" : "Hidden"} ${group.title}. Saving locally...`
    );
  }

  function setProjectSelectionBulk(selectedGroupIds: Set<string>, exclusive: boolean) {
    const projectGroupsByFile = new Map<string, EditorFieldGroup[]>();

    projectGroups.forEach((group) => {
      const projectField = group.fields.find((field) => field.command === "cvproject") ?? group.fields[0];
      if (!projectField) return;
      projectGroupsByFile.set(projectField.fileName, [
        ...(projectGroupsByFile.get(projectField.fileName) ?? []),
        group
      ]);
    });

    setFiles((current) =>
      current.map((file) => {
        const groupsForFile = projectGroupsByFile.get(file.name);
        if (!groupsForFile?.length) return file;

        let nextContent = file.content;
        for (const group of [...groupsForFile].sort((left, right) => right.start - left.start)) {
          const shouldSelect = selectedGroupIds.has(group.id) || (!exclusive && isProjectGroupSelected(group));
          const block = nextContent.slice(group.start, group.end);
          nextContent =
            nextContent.slice(0, group.start) +
            projectBlockWithSelection(block, shouldSelect) +
            nextContent.slice(group.end);
        }

        return { ...file, content: nextContent };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Projects"])));
    markPdfFitStale();
  }

  function selectTopProjects(limit = 3, exclusive = false) {
    const selectedIds = new Set(projectRecommendations.slice(0, limit).map((recommendation) => recommendation.groupId));
    if (selectedIds.size === 0) return;

    setProjectSelectionBulk(selectedIds, exclusive);
    setProjectStorageStatus(
      `${exclusive ? "Kept only" : "Selected"} top ${selectedIds.size} project${selectedIds.size === 1 ? "" : "s"}. Saving locally...`
    );
  }

  function applyTailoringPreset(preset: TailoringPreset) {
    const presetTerms = uniqueTerms([...preset.projectKeywords, ...preset.skillKeywords, ...preset.certificateKeywords]);
    const matchedJobKeywords = jobKeywordTerms.filter((keyword) => keywordScore(keyword, presetTerms) > 0);
    if (matchedJobKeywords.length > 0) {
      setPriorityKeywords((current) => uniqueTerms([...matchedJobKeywords, ...current]));
    }

    const rankedProjects = projectGroups
      .map((group) => ({
        group,
        score: keywordScore(
          [group.title, group.subtitle, group.meta, ...group.fields.map((field) => field.original)].filter(Boolean).join(" "),
          preset.projectKeywords
        )
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxProjects);
    const selectedProjectIds = new Set(rankedProjects.map((item) => item.group.id));

    const rankedCertificates = certificateGroups
      .map((group) => ({
        group,
        score: keywordScore([group.title, group.subtitle, group.meta, ...group.fields.map((field) => field.original)].filter(Boolean).join(" "), preset.certificateKeywords)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxCertificates);
    const selectedCertificateIds = new Set(rankedCertificates.map((item) => item.group.id));

    if (selectedProjectIds.size > 0 || selectedCertificateIds.size > 0) {
      setFiles((current) =>
        current.map((file) => {
          const replacements: Array<{ start: number; end: number; replacement: string }> = [];

          projectGroups.forEach((group) => {
            const projectField = group.fields.find((field) => field.command === "cvproject") ?? group.fields[0];
            if (!projectField || projectField.fileName !== file.name) return;
            const shouldSelect = selectedProjectIds.size > 0 ? selectedProjectIds.has(group.id) : isProjectGroupSelected(group);
            const block = file.content.slice(group.start, group.end);
            replacements.push({
              start: group.start,
              end: group.end,
              replacement: projectBlockWithSelection(block, shouldSelect)
            });
          });

          certificateGroups.forEach((group) => {
            const field = group.fields[0];
            if (!field || field.fileName !== file.name || field.lineStart === undefined || field.lineEnd === undefined) return;
            const line = file.content.slice(field.lineStart, field.lineEnd);
            const isSelected = !/^[ \t]*%/.test(line);
            const shouldSelect = selectedCertificateIds.size > 0 ? selectedCertificateIds.has(group.id) : isSelected;
            if (isSelected === shouldSelect) return;
            replacements.push({
              start: field.lineStart,
              end: field.lineEnd,
              replacement: shouldSelect
                ? line.replace(/^([ \t]*)%[ \t]?/, "$1")
                : line.replace(/^([ \t]*)/, "$1% ")
            });
          });

          if (replacements.length === 0) return file;
          let nextContent = file.content;
          replacements
            .sort((left, right) => right.start - left.start)
            .forEach((replacement) => {
              nextContent =
                nextContent.slice(0, replacement.start) +
                replacement.replacement +
                nextContent.slice(replacement.end);
            });

          return { ...file, content: nextContent };
        })
      );
      const changedTags = [
        selectedProjectIds.size > 0 ? "Projects" : "",
        selectedCertificateIds.size > 0 ? "Certificates" : ""
      ].filter(Boolean);
      setManualChangeTags((current) => Array.from(new Set([...current, ...changedTags])));
      markPdfFitStale();
    }

    setManualChangeTags((current) => Array.from(new Set([...current, `Preset: ${preset.name}`])));
    setProjectStorageStatus(`Applied ${preset.name} preset. Skill priorities updated; use Apply suggested skill order to reorder skills. Saving locally...`);
  }

  function saveCurrentTailoringPreset() {
    const name = presetName.trim();
    if (!name) return;
    const preset: TailoringPreset = {
      id: `custom-preset-${Date.now()}`,
      name,
      description: `Custom preset saved from ${currentSessionLabel}.`,
      projectKeywords: uniqueTerms([...includedProjectNames, ...priorityKeywords, ...matchAnalysis.matchedSkills]).slice(0, 16),
      skillKeywords: uniqueTerms([...priorityKeywords, ...matchAnalysis.matchedSkills, ...jobAnalysis.keywords]).slice(0, 16),
      certificateKeywords: uniqueTerms(includedCertificateNames).slice(0, 8),
      custom: true
    };
    setCustomTailoringPresets((current) => [preset, ...current].slice(0, 12));
    setPresetName("");
    setProjectStorageStatus(`Saved tailoring preset: ${preset.name}.`);
  }

  function deleteTailoringPreset(presetId: string) {
    setCustomTailoringPresets((current) => current.filter((preset) => preset.id !== presetId));
    setProjectStorageStatus("Deleted custom tailoring preset.");
  }

  function reorderProjectGroups(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;

    const orderedGroups = [...projectGroups].sort((left, right) => left.start - right.start);
    const fromIndex = orderedGroups.findIndex((group) => group.id === draggedId);
    const toIndex = orderedGroups.findIndex((group) => group.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const fileName = orderedGroups[fromIndex]?.fields[0]?.fileName;
    if (!fileName || orderedGroups.some((group) => group.fields[0]?.fileName !== fileName)) {
      setProjectStorageStatus("Project drag order is only available when project cards are in one file.");
      return;
    }

    const currentFile = files.find((file) => file.name === fileName);
    if (!currentFile) return;

    const reordered = [...orderedGroups];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const sectionStart = Math.min(...orderedGroups.map((group) => group.start));
    const sectionEnd = Math.max(...orderedGroups.map((group) => group.end));
    const replacement = reordered
      .map((group) => currentFile.content.slice(group.start, group.end))
      .join("");

    setFiles((current) => replaceSourceRange(current, fileName, sectionStart, sectionEnd, replacement));
    setManualChangeTags((current) => Array.from(new Set([...current, "Projects"])));
    markPdfFitStale();
    setProjectStorageStatus(`Reordered project cards. Saving locally...`);
  }

  function restoreProjectOrder() {
    const orderedGroups = [...projectGroups].sort((left, right) => left.start - right.start);
    if (orderedGroups.length < 2) return;

    const fileName = orderedGroups[0]?.fields[0]?.fileName;
    if (!fileName || orderedGroups.some((group) => group.fields[0]?.fileName !== fileName)) {
      setProjectStorageStatus("Project order restore is only available when project cards are in one file.");
      return;
    }

    const currentFile = files.find((file) => file.name === fileName);
    if (!currentFile) return;

    const originalProjectGroups = groupedEditorFields(
      originalParsedResume.fields.filter((field) => field.kind === "project"),
      "Projects"
    ).filter((group) => group.fields.some((field) => field.command === "cvproject"));
    const unusedCurrent = new Set(orderedGroups.map((group) => group.id));
    const nextOrder: EditorFieldGroup[] = [];

    originalProjectGroups.forEach((originalGroup) => {
      const match = orderedGroups.find(
        (group) => unusedCurrent.has(group.id) && group.title === originalGroup.title
      );
      if (!match) return;
      unusedCurrent.delete(match.id);
      nextOrder.push(match);
    });
    orderedGroups.forEach((group) => {
      if (unusedCurrent.has(group.id)) nextOrder.push(group);
    });

    const sectionStart = Math.min(...orderedGroups.map((group) => group.start));
    const sectionEnd = Math.max(...orderedGroups.map((group) => group.end));
    const replacement = nextOrder
      .map((group) => currentFile.content.slice(group.start, group.end))
      .join("");

    setFiles((current) => replaceSourceRange(current, fileName, sectionStart, sectionEnd, replacement));
    setManualChangeTags((current) => Array.from(new Set([...current, "Projects"])));
    markPdfFitStale();
    setProjectStorageStatus("Restored original project card order. Saving locally...");
  }

  function applyAllSkillOrderSuggestions() {
    const skillGroups = groupedEditorFields(
      parsedResume.fields.filter((field) => field.kind === "skill"),
      "Skills"
    );
    const replacements = skillGroups.flatMap((group) => {
      const suggestion = skillOrderSuggestionByGroupId.get(group.id);
      if (!suggestion?.changed) return [];

      const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
      const fieldById = new Map(skillFields.map((field) => [field.id, field]));
      const suggestedFields = suggestion.suggestedIds
        .map((id) => fieldById.get(id))
        .filter((field): field is ResumeField => Boolean(field));
      if (suggestedFields.length !== skillFields.length) return [];

      return skillFields.map((field, index) => ({
        field,
        replacement: suggestedFields[index]?.original ?? field.original
      }));
    });
    if (replacements.length === 0) return;

    setFiles((current) =>
      current.map((file) => {
        const fileReplacements = replacements
          .filter(({ field }) => field.fileName === file.name)
          .sort((left, right) => right.field.start - left.field.start);
        if (fileReplacements.length === 0) return file;

        let nextContent = file.content;
        for (const { field, replacement } of fileReplacements) {
          if (nextContent.slice(field.start, field.end) !== field.original) continue;
          nextContent =
            nextContent.slice(0, field.start) + replacement + nextContent.slice(field.end);
        }

        return { ...file, content: nextContent };
      })
    );
    setManualChangeTags((current) => Array.from(new Set([...current, "Skills"])));
    markPdfFitStale();
    setProjectStorageStatus("Applied suggested order to all skill categories. Saving locally...");
  }

  async function handleFiles(fileList: FileList) {
    const nextFiles = await Promise.all(
      Array.from(fileList).map(async (file) => createResumeSourceFile(file.name, await file.text()))
    );
    setFiles(nextFiles);
    setOriginalFiles(nextFiles);
    setActiveFileName(nextFiles.find((file) => file.name === "main.tex")?.name ?? nextFiles[0]?.name ?? "");
    setManualChangeTags([]);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setExportSummaryReviewed(false);
    setCurrentSessionName("");
    setResumeVersionLabel("");
    setProjectStorageStatus("Uploaded project. Saving locally...");
    setSelectedStep("upload");
  }

  async function compilePdfFiles(filesToCompile: ResumeSourceFile[], mainFile: string) {
    return localApi.compilePdf({
      files: filesToCompile.map((file) => ({ name: file.name, content: file.content })),
      mainFile
    });
  }

  async function compileOriginalPdfPreview() {
    setCompileStatus({ state: "compiling", message: "Compiling original LaTeX project..." });
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    try {
      const originalMainFile = originalParsedResume.filename || parsedResume.filename;
      const result = await compilePdfFiles(originalFiles, originalMainFile);
      setOriginalPreviewPdf({
        name: originalMainFile.replace(/\.tex$/i, ".pdf"),
        url: `${result.url}#view=FitH&toolbar=1&navpanes=0`,
        pageCount: result.pageCount
      });
      setCompileStatus({
        state: "success",
        message: [
          result.pageCount
            ? `Original PDF compiled: ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}.`
            : "Original PDF preview compiled.",
          result.compileFixes ? `Preview-only fix applied: ${result.compileFixes}` : ""
        ]
          .filter(Boolean)
          .join(" ")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The LaTeX compiler failed.";
      setCompileJumpTarget(parseCompileLocation(message));
      setCompileErrorDetails(parseCompileErrorDetails(message));
      setCompileStatus({ state: "error", message });
    }
  }

  async function compilePdfPreview(options?: { stayOnCurrentStep?: boolean }) {
    setCompileStatus({ state: "compiling", message: "Compiling tailored LaTeX project..." });
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    try {
      const result = await compilePdfFiles(tailoredFiles, parsedResume.filename);
      setPreviewPdf({
        name: parsedResume.filename.replace(/\.tex$/i, ".pdf"),
        url: `${result.url}#view=FitH&toolbar=1&navpanes=0`,
        pageCount: result.pageCount
      });
      setPdfFitStatus({
        state: result.pageCount && result.pageCount > 1 ? "overflow" : "fits",
        pageCount: result.pageCount
      });
      setCompileStatus({
        state: "success",
        message: [
          result.pageCount
            ? result.pageCount === 1
              ? "PDF compiled: fits on 1 page."
              : `PDF compiled: spills to ${result.pageCount} pages.`
            : "PDF preview compiled from the current LaTeX files.",
          result.compileFixes ? `Preview-only fix applied: ${result.compileFixes}` : ""
        ]
          .filter(Boolean)
          .join(" ")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The LaTeX compiler failed.";
      setCompileJumpTarget(parseCompileLocation(message));
      setCompileErrorDetails(parseCompileErrorDetails(message));
      setCompileStatus({ state: "error", message });
    }

    if (!options?.stayOnCurrentStep) {
      setSelectedStep("preview");
    }
  }

  function jumpToSourceLocation(target: CompileLocation) {
    setActiveFileName(target.fileName);
    setSourceJumpTarget({ ...target, nonce: Date.now() });
    setSelectedStep("upload");
  }

  function openHiddenEvidence(item: SkillGapFinding["evidence"][number]) {
    const targetTab = tabForSection(item.sectionTitle) ?? "projects";
    setSelectedEditorTab(targetTab);
    setActiveFileName(item.fileName);
    setSourceJumpTarget({ fileName: item.fileName, line: item.line, nonce: Date.now() });
    setSelectedStep("editor");
    setProjectStorageStatus(`Opened ${item.sectionTitle} evidence from ${item.fileName}:${item.line}.`);
  }

  function loadSampleOverleafProject() {
    const nextFiles = sampleOverleafFiles.map((file) => createResumeSourceFile(file.name, file.content));
    setFiles(nextFiles);
    setOriginalFiles(nextFiles);
    setActiveFileName("main.tex");
    setManualChangeTags([]);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setExportSummaryReviewed(false);
    setCurrentSessionName("");
    setResumeVersionLabel("");
    setProjectStorageStatus("Loaded sample Overleaf project. Saving locally...");
  }

  function loadSampleSingleFile() {
    const nextFile = createResumeSourceFile("Alex_Morgan_resume.tex", sampleLatexResume);
    setFiles([nextFile]);
    setOriginalFiles([nextFile]);
    setActiveFileName(nextFile.name);
    setManualChangeTags([]);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setExportSummaryReviewed(false);
    setCurrentSessionName("");
    setResumeVersionLabel("");
    setProjectStorageStatus("Loaded single-file sample. Saving locally...");
  }

  async function trySampleJobWorkflow() {
    let nextFiles: ResumeSourceFile[];
    let loadedFrom = "bundled Overleaf sample";

    try {
      setProjectStorageStatus("Loading your project with the sample job...");
      const project = await fetchProjectFolderFiles();
      nextFiles = project.files;
      loadedFrom = project.loadedFrom ? `your project folder: ${project.loadedFrom}` : "your local resume-project folder";
    } catch {
      nextFiles = sampleOverleafFiles.map((file) => createResumeSourceFile(file.name, file.content));
    }

    setFiles(nextFiles);
    setOriginalFiles(nextFiles);
    setActiveFileName(nextFiles.find((file) => file.name === "main.tex")?.name ?? nextFiles[0]?.name ?? "");
    setJob(defaultJob);
    setManualChangeTags([]);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setExportSummaryReviewed(false);
    setCurrentSessionName("Sample job walkthrough");
    setResumeVersionLabel("");
    setSelectedStep("match");
    setVisitedSteps((current) => new Set([...Array.from(current), "upload", "job", "parser", "match"]));
    setProjectStorageStatus(`Loaded sample job workflow using ${loadedFrom}. Review Match Analysis next.`);
  }

  async function loadProjectFolder() {
    try {
      setProjectStorageStatus("Loading resume-project folder...");
      const project = await fetchProjectFolderFiles();
      setFiles(project.files);
      setOriginalFiles(project.files);
      setActiveFileName(project.files.find((file) => file.name === "main.tex")?.name ?? project.files[0].name);
      setManualChangeTags([]);
      setPdfFitStatus({ state: "unknown" });
      setPreviewPdf(null);
      setOriginalPreviewPdf(null);
      setCompileJumpTarget(null);
      setCompileErrorDetails(null);
      setExportSummaryReviewed(false);
      setCurrentSessionName("");
      setResumeVersionLabel("");
      setProjectStorageStatus(
        project.loadedFrom
          ? `Loaded project folder: ${project.loadedFrom}`
          : "Loaded local resume-project folder."
      );
      setSelectedStep("upload");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load resume-project.";
      setProjectStorageStatus(message);
    }
  }

  function clearSavedProject() {
    window.localStorage.removeItem(projectStorageKey);
    setProjectStorageStatus("Saved project cleared from this browser.");
  }

  function persistSavedSessions(nextSessions: SavedTailoringSession[]) {
    setSavedSessions(nextSessions);
    try {
      window.localStorage.setItem(tailoringSessionsStorageKey, JSON.stringify(nextSessions));
    } catch {
      setProjectStorageStatus("Could not save named session. Browser storage may be full.");
    }
  }

  function defaultSessionName() {
    return [job.company, job.title].filter(Boolean).join(" ").trim() || "Tailored resume";
  }

  function saveNamedSession() {
    const name = (sessionName || defaultSessionName()).trim();
    if (!name) return;

    const session: SavedTailoringSession = {
      id: `${Date.now()}`,
      name,
      company: job.company,
      title: job.title,
      savedAt: new Date().toISOString(),
      files: tailoredFiles.map((file) => ({ name: file.name, content: file.content })),
      activeFileName,
      job,
      manualChangeTags: downloadTags,
      resumeVersionLabel: resumeVersionName,
      matchScore: matchAnalysis.score,
      includedProjects: includedProjectNames,
      includedCertificates: includedCertificateNames,
      pdfPageCount: pdfFitStatus.pageCount ?? previewPdf?.pageCount
    };
    persistSavedSessions([session, ...savedSessions.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 12));
    setSessionName("");
    setCurrentSessionName(name);
    setProjectStorageStatus(`Saved named tailoring session: ${name}.`);
  }

  function loadNamedSession(session: SavedTailoringSession) {
    const sessionFiles = session.files.map((file) => createResumeSourceFile(file.name, file.content));
    setFiles(sessionFiles);
    setOriginalFiles(sessionFiles);
    setActiveFileName(
      session.activeFileName && sessionFiles.some((file) => file.name === session.activeFileName)
        ? session.activeFileName
        : sessionFiles.find((file) => file.name === "main.tex")?.name ?? sessionFiles[0]?.name ?? ""
    );
    setJob(session.job);
    setManualChangeTags(session.manualChangeTags ?? []);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setExportSummaryReviewed(false);
    setCurrentSessionName(session.name);
    setResumeVersionLabel(session.resumeVersionLabel ?? "");
    setProjectStorageStatus(`Loaded named session: ${session.name}.`);
  }

  function deleteNamedSession(sessionId: string) {
    persistSavedSessions(savedSessions.filter((session) => session.id !== sessionId));
  }

  function persistApplicationRecords(nextRecords: ApplicationRecord[]) {
    setApplicationRecords(nextRecords);
    try {
      window.localStorage.setItem(applicationRecordsStorageKey, JSON.stringify(nextRecords));
    } catch {
      setProjectStorageStatus("Could not save application record. Browser storage may be full.");
    }
  }

  function deleteApplicationRecord(recordId: string) {
    persistApplicationRecords(applicationRecords.filter((record) => record.id !== recordId));
  }

  function updateApplicationRecord(recordId: string, patch: Partial<ApplicationRecord>) {
    const today = todayDateInput();
    persistApplicationRecords(
      applicationRecords.map((record) => {
        if (record.id !== recordId) return record;

        const next: ApplicationRecord = { ...record, ...patch };
        if (patch.status) {
          if (patch.status !== "draft" && !next.appliedAt) {
            next.appliedAt = today;
          }
          if (patch.status === "interview" && !next.interviewAt) {
            next.interviewAt = today;
          }
          if ((patch.status === "rejected" || patch.status === "offer") && !next.decisionAt) {
            next.decisionAt = today;
          }
        }

        return next;
      })
    );
    setProjectStorageStatus("Updated application timeline. Saving locally...");
  }

  function buildCurrentApplicationRecord(statusOverride: ApplicationRecord["status"] = applicationStatus): ApplicationRecord {
    const savedAt = new Date().toISOString();
    const timelineDate = todayDateInput();
    return {
      id: `${Date.now()}`,
      savedAt,
      appliedAt: statusOverride === "draft" ? undefined : timelineDate,
      interviewAt: statusOverride === "interview" ? timelineDate : undefined,
      decisionAt: statusOverride === "rejected" || statusOverride === "offer" ? timelineDate : undefined,
      status: statusOverride,
      notes: applicationNotes.trim(),
      job: {
        title: job.title,
        company: job.company,
        url: job.url,
        description: job.description
      },
      matchScore: matchAnalysis.score,
      matchedSkills: matchAnalysis.matchedSkills,
      missingRequirements: matchAnalysis.missingRequirements,
      resumeFileName: parsedResume.filename,
      resumeVersionLabel: resumeVersionName,
      submittedFileName: files.length > 1 ? tailoredZipFilename : tailoredTexFilename,
      files: tailoredFiles.map((file) => ({ name: file.name, content: file.content })),
      includedProjects: includedProjectNames,
      includedCertificates: includedCertificateNames,
      changeTags: downloadTags,
      pdfPageCount: pdfFitStatus.pageCount ?? previewPdf?.pageCount,
      generatedAnswers: generatedApplicationAnswers
    };
  }

  function saveApplicationRecord(statusOverride?: ApplicationRecord["status"]) {
    const record = buildCurrentApplicationRecord(statusOverride ?? applicationStatus);
    persistApplicationRecords([record, ...applicationRecords].slice(0, 80));
    setApplicationNotes("");
    setProjectStorageStatus(
      duplicateApplicationRecord
        ? `Saved application record. Heads up: ${job.company} ${job.title} was already tracked.`
        : `Saved application record for ${job.company} ${job.title}.`
    );
    return record;
  }

  async function saveBackendApplication(draft: BackendApplicationDraft, id?: string) {
    setBackendApplicationsStatus({ state: "saving", message: id ? "Updating application..." : "Creating application..." });
    const request: JobApplicationRequest = {
      company: draft.company,
      jobTitle: draft.jobTitle,
      jobUrl: draft.jobUrl,
      source: draft.source,
      location: draft.location,
      jobDescription: draft.jobDescription,
      notes: draft.notes,
      resumeUsed: draft.resumeUsed
    };
    try {
      const saved = id
        ? await backendApi.replaceApplication(id, request)
        : await backendApi.createApplication(request);
      if (saved.status !== draft.status) {
        await backendApi.updateApplicationStatus(saved.id, draft.status);
      }
      await loadBackendApplications();
      setBackendApplicationsStatus({
        state: "idle",
        message: id ? "Application updated." : "Application created."
      });
    } catch (error) {
      setBackendApplicationsStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Could not save application."
      });
    }
  }

  function openBackendApplicationInStudio(application: JobApplication) {
    setJob({
      title: application.jobTitle,
      company: application.company,
      url: application.jobUrl ?? "",
      description: application.jobDescription
    });
    setApplicationNotes(application.notes ?? "");
    setResumeVersionLabel(application.resumeUsed ?? "");
    setCurrentSessionName(`${application.company} ${application.jobTitle}`.trim());
    setSelectedStep("upload");
    setProjectStorageStatus(`Opened ${application.company} ${application.jobTitle} in the resume studio.`);
  }

  function loadApplicationResume(record: ApplicationRecord) {
    const recordFiles = record.files.map((file) => createResumeSourceFile(file.name, file.content));
    setFiles(recordFiles);
    setOriginalFiles(recordFiles);
    setActiveFileName(recordFiles.find((file) => file.name === "main.tex")?.name ?? recordFiles[0]?.name ?? "");
    setJob(record.job);
    setManualChangeTags(record.changeTags);
    setPdfFitStatus({ state: "unknown" });
    setPreviewPdf(null);
    setOriginalPreviewPdf(null);
    setCompileJumpTarget(null);
    setCompileErrorDetails(null);
    setCurrentSessionName(`${record.job.company} ${record.job.title}`.trim());
    setResumeVersionLabel(record.resumeVersionLabel ?? "");
    setProjectStorageStatus(`Loaded submitted resume for ${record.job.company} ${record.job.title}.`);
    setSelectedStep("workspace");
  }

  function downloadApplicationResume(record: ApplicationRecord) {
    const recordFiles = record.files.map((file) => createResumeSourceFile(file.name, file.content));
    if (recordFiles.length > 1) {
      void downloadProjectZip(record.submittedFileName.replace(/\.tex$/i, ".zip"), recordFiles);
      return;
    }
    downloadText(record.submittedFileName, recordFiles[0]?.content ?? "");
  }

  function applicationPacketFilename(company: string, title: string) {
    return buildTailoredFilename({
      baseName: "Application_Packet",
      company,
      role: title,
      tags: ["Packet"],
      extension: ".zip"
    });
  }

  function downloadCurrentApplicationPacket() {
    void downloadApplicationPacketZip(applicationPacketFilename(job.company, job.title), {
      files: tailoredFiles.map((file) => ({ name: file.name, content: file.content })),
      job: {
        title: job.title,
        company: job.company,
        url: job.url,
        description: job.description
      },
      matchScore: matchAnalysis.score,
      matchedSkills: matchAnalysis.matchedSkills,
      missingRequirements: matchAnalysis.missingRequirements,
      includedProjects: includedProjectNames,
      includedCertificates: includedCertificateNames,
      generatedAnswers: generatedApplicationAnswers,
      notes: applicationNotes,
      status: applicationStatus,
      submittedFileName: files.length > 1 ? tailoredZipFilename : tailoredTexFilename,
      resumeVersionLabel: resumeVersionName,
      savedAt: new Date().toISOString()
    });
  }

  function downloadSavedApplicationPacket(record: ApplicationRecord) {
    void downloadApplicationPacketZip(applicationPacketFilename(record.job.company, record.job.title), {
      files: record.files,
      job: record.job,
      matchScore: record.matchScore,
      matchedSkills: record.matchedSkills,
      missingRequirements: record.missingRequirements,
      includedProjects: record.includedProjects,
      includedCertificates: record.includedCertificates,
      generatedAnswers: record.generatedAnswers ?? [],
      notes: record.notes,
      status: record.status,
      submittedFileName: record.submittedFileName,
      resumeVersionLabel: record.resumeVersionLabel,
      savedAt: record.savedAt
    });
  }

  function createApplyPacket() {
    const record = saveApplicationRecord("applied");
    setApplicationStatus("applied");
    void downloadProjectZip(tailoredZipFilename, tailoredFiles);
    downloadSavedApplicationPacket(record);
    setSelectedStep("applications");
    setProjectStorageStatus(
      duplicateApplicationRecord
        ? `Apply packet created and saved as Applied. Duplicate warning: ${job.company} ${job.title} was already tracked.`
        : `Apply packet created and saved as Applied for ${job.company} ${job.title}.`
    );
  }

  function updateAutofillProfile(field: keyof AutofillProfile, value: string) {
    setAutofillProfile((current) => ({ ...current, [field]: value }));
  }

  function exportAutofillProfileJson() {
    const exportedAt = new Date().toISOString();
    downloadJson(`TailorTeX_Profile_Backup_${backupTimestamp()}.json`, {
      schema: "tailortex.autofillProfile",
      schemaVersion: 1,
      exportedAt,
      profile: autofillProfile
    });
    setProjectStorageStatus("Exported autofill profile JSON.");
  }

  async function importAutofillProfileJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate =
        parsed && typeof parsed === "object" && "profile" in parsed
          ? (parsed as { profile?: unknown }).profile
          : parsed;
      const importedProfile = autofillProfileSchema.partial().parse(candidate);

      setAutofillProfile({ ...defaultAutofillProfile, ...importedProfile });
      setAutofillProfileReady(true);
      setProjectStorageStatus(`Imported autofill profile JSON from ${file.name}.`);
    } catch {
      setProjectStorageStatus("Could not import profile JSON. Check that the file came from TailorTeX.");
    }
  }

  function exportAllTailorTexDataJson() {
    const exportedAt = new Date().toISOString();
    downloadJson(`TailorTeX_All_Data_Backup_${backupTimestamp()}.json`, {
      schema: "tailortex.fullBackup",
      schemaVersion: 1,
      exportedAt,
      storageKeys: {
        project: projectStorageKey,
        namedSessions: tailoringSessionsStorageKey,
        applicationRecords: applicationRecordsStorageKey,
        autofillProfile: autofillProfileStorageKey
      },
      currentProject: {
        files: files.map((file) => ({ name: file.name, content: file.content, editable: file.editable })),
        originalFiles: originalFiles.map((file) => ({ name: file.name, content: file.content, editable: file.editable })),
        activeFileName,
        resumeVersionLabel,
        manualChangeTags,
        savedAt: exportedAt
      },
      currentJob: job,
      namedSessions: savedSessions,
      tailoringPresets: customTailoringPresets,
      applicationRecords,
      autofillProfile,
      applicationDraft: {
        notes: applicationNotes,
        status: applicationStatus
      },
      editorPreferences: {
        maxProjects,
        maxCertificates,
        priorityKeywords,
        showEducationEditor,
        selectedEditorTab,
        densityMode,
        safeModeEnabled
      }
    });
    setProjectStorageStatus("Exported full TailorTeX data backup JSON.");
  }

  async function importTailorTexLocalJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const normalized = normalizeTailorTexStorePayload(parsed);
      if (!normalized) {
        throw new Error("Unsupported TailorTeX JSON shape.");
      }

      const savedAt = new Date().toISOString();
      const nextStore = {
        ...normalized,
        schema: "tailortex.localStore",
        schemaVersion: 1,
        savedAt
      };

      applyTailorTexLocalStore(nextStore);
      const browserFallbackSaved = saveBrowserFallbackSnapshot(nextStore);
      setStorageReady(true);
      setAutofillProfileReady(true);
      setPdfFitStatus({ state: "unknown" });
      setPreviewPdf(null);
      setOriginalPreviewPdf(null);
      setCompileJumpTarget(null);
      setCompileErrorDetails(null);
      setExportSummaryReviewed(false);

      const synced = await writeLocalStoreSnapshot(
        nextStore,
        `Storage: imported ${file.name} and synced local file.`
      );
      setProjectStorageStatus(
        synced
          ? `Imported ${file.name} into data/tailortex.local.json.`
          : browserFallbackSaved
            ? `Imported ${file.name} into the browser fallback. Local file sync failed.`
            : `Imported ${file.name}, but storage sync needs attention.`
      );
    } catch {
      setProjectStorageStatus("Could not import TailorTeX JSON. Use data/tailortex.local.json or an exported full backup.");
    }
  }

  async function copyToClipboard(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAnswerId(id);
      window.setTimeout(() => setCopiedAnswerId((current) => (current === id ? null : current)), 1400);
    } catch {
      setProjectStorageStatus("Could not copy to clipboard from this browser.");
    }
  }

  function toggleCardExpanded(cardId: string) {
    setExpandedCardIds((current) => {
      const next = new Set(Array.from(current));
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

  function toggleEducationEditor() {
    setShowEducationEditor((current) => {
      const next = !current;
      if (next) {
        setSelectedEditorTab("education");
      } else if (selectedEditorTab === "education") {
        setSelectedEditorTab("experience");
      }
      return next;
    });
  }

  function downloadTailoredResume() {
    if (files.length > 1) {
      void downloadProjectZip(tailoredZipFilename, tailoredFiles);
      return;
    }
    downloadText(tailoredTexFilename, tailoredMainSource);
  }

  const pendingSuggestionCount = suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const sourceNeedsAttention = !sourceValidation.isLatexLike || !sourceValidation.bracesBalanced || !latexValidation.success;
  const stepStatuses: Record<string, StepStatus> = {
    workspace: files.some((file) => file.name === "main.tex") && files.some((file) => file.name === "page1sidebar.tex")
      ? "done"
      : "optional",
    upload: sourceNeedsAttention ? "needs_attention" : "done",
    editor:
      projectLimitExceeded || certificateLimitExceeded
        ? "needs_attention"
        : editableSections.length > 0
          ? "done"
          : "blocked",
    job:
      jobValidation.success && job.description.trim().length > 80
        ? "done"
        : visitedSteps.has("job")
          ? "needs_attention"
          : "blocked",
    parser: parsedResume.fields.length > 0 ? "done" : "needs_attention",
    match:
      jobValidation.success && job.description.trim().length > 80
        ? visitedSteps.has("match")
          ? "done"
          : "optional"
        : "blocked",
    review:
      suggestions.length === 0
        ? "optional"
        : pendingSuggestionCount > 0
          ? "needs_attention"
          : "done",
    preview:
      pdfFitStatus.state === "fits"
        ? "done"
        : pdfFitStatus.state === "overflow" || pdfFitStatus.state === "stale" || compileStatus.state === "error"
          ? "needs_attention"
          : "blocked",
    export: exportReady ? "done" : "blocked",
    applications: applicationRecords.length > 0 ? "done" : "optional",
    autofill:
      autofillProfile.fullName.trim() && autofillProfile.email.trim()
        ? "done"
        : "optional"
  };
  const stepStatusSummary = {
    done: Object.values(stepStatuses).filter((status) => status === "done").length,
    needsAttention: Object.values(stepStatuses).filter((status) => status === "needs_attention").length,
    blocked: Object.values(stepStatuses).filter((status) => status === "blocked").length
  };
  const stepGroups = [
    {
      title: "Setup",
      steps: [
        ["workspace", "Workspace"],
        ["upload", "Resume Upload"]
      ]
    },
    {
      title: "Tailor",
      steps: [
        ["editor", "Resume Editor"],
        ["job", "Job Description"],
        ["parser", "Parser"],
        ["match", "Match Analysis"]
      ]
    },
    {
      title: "Review",
      steps: [
        ["review", "Suggestion Review"],
        ["preview", "PDF Preview"]
      ]
    },
    {
      title: "Export",
      steps: [["export", "Export"]]
    },
    {
      title: "Track",
      steps: [
        ["applications", "Applications"],
        ["autofill", "Autofill Kit"]
      ]
    }
  ] satisfies Array<{ title: string; steps: Array<[string, string]> }>;

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-rule bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sage">TailorTeX MVP</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Source-safe LaTeX resume tailoring</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/70">
              Parse editable resume fields, compare them with a job description, review every suggestion, and export only approved text changes back into the original LaTeX.
            </p>
          </div>
          <div className="space-y-3">
            <HeaderSessionSwitcher
              currentSessionName={currentSessionLabel}
              savedSessions={savedSessions}
              onLoad={loadNamedSession}
            />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="Match" value={`${matchAnalysis.score}/100`} tone="sage" />
              <Metric label="Fields" value={parsedResume.fields.length.toString()} tone="gold" />
              <Metric label="Accepted" value={acceptedChanges.length.toString()} tone="coral" />
            </div>
          </div>
        </div>
      </header>
      <CommandCenter
        canApplyPacket={canDownload}
        compileState={compileStatus.state}
        densityMode={densityMode}
        safeModeEnabled={safeModeEnabled}
        syncPulseLabel={syncPulseLabel}
        storageStatus={localStoreStatus}
        onCompile={() => void compilePdfPreview({ stayOnCurrentStep: true })}
        onDensityModeChange={setDensityMode}
        onSafeModeChange={setSafeModeEnabled}
        onSaveNow={() => void saveLocalStoreNow()}
        onApplyPacket={createApplyPacket}
        onExportBackup={exportAllTailorTexDataJson}
      />
      <ResumeStatusBar items={statusBarItems} />

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="h-fit space-y-3">
          <div className="border border-rule bg-white p-2">
            <div className="mb-2 grid grid-cols-3 gap-1 border-b border-rule pb-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em]">
              <span className="bg-sage/10 px-2 py-1 text-sage">{stepStatusSummary.done} done</span>
              <span className="bg-gold/10 px-2 py-1 text-gold">{stepStatusSummary.needsAttention} watch</span>
              <span className="bg-coral/10 px-2 py-1 text-coral">{stepStatusSummary.blocked} blocked</span>
            </div>
            {stepGroups.map((group) => (
              <div key={group.title} className="border-b border-rule py-2 last:border-b-0">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/40">
                  {group.title}
                </p>
                <div className="space-y-1">
                  {group.steps.map(([id, label]) => {
                    const active = selectedStep === id;
                    const status = stepStatuses[id] ?? "optional";

                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedStep(id)}
                        className={cx(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                          active ? "bg-ink text-white" : "text-ink hover:bg-paper"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <StepStatusDot status={status} active={active} />
                          <span className="min-w-0 truncate">{label}</span>
                        </span>
                        <span
                          className={cx(
                            "hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline",
                            active ? "text-white/70" : stepStatusTextClass(status)
                          )}
                        >
                          {stepStatusLabel(status)}
                        </span>
                        {id === "review" && suggestions.length > 0 ? <span>{suggestions.length}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <GuidedChecklist title="First-time setup" items={firstTimeSetupItems} />
          <GuidedChecklist items={guidedChecklistItems} />
        </nav>

        <section className="space-y-5">
          {selectedStep === "workspace" ? (
            <Panel title="Workspace" eyebrow="Edit beside preview">
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap gap-2 border border-rule bg-paper p-2">
                    {editorTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSelectedEditorTab(tab.id)}
                        className={cx(
                          "flex items-center gap-2 px-3 py-2 text-sm font-semibold",
                          selectedEditorTab === tab.id
                            ? "bg-ink text-white"
                            : "bg-white text-ink hover:bg-paper"
                        )}
                      >
                        <span>{tab.label}</span>
                        <span className={cx("text-xs", selectedEditorTab === tab.id ? "text-white/70" : "text-ink/45")}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>
                  <FocusModePanel
                    active={focusModeActive}
                    tab={selectedEditorTab}
                    cardCount={focusCardCount}
                    coverage={activeKeywordCoverage}
                    pdfState={pdfFitStatus.state}
                    pageCount={pdfFitStatus.pageCount}
                    canDownload={canDownload}
                    onToggle={() => setFocusModeEnabled((current) => !current)}
                    onRestore={() => restoreOriginalEditorTab(selectedEditorTab)}
                    onCompile={() => void compilePdfPreview({ stayOnCurrentStep: true })}
                    onDownload={downloadTailoredResume}
                  />
                  <SectionAssistPanel
                    tab={selectedEditorTab}
                    warnings={activeSectionWarnings}
                    onSelectTopProjects={() => selectTopProjects(3, false)}
                    onKeepBestProjects={() => selectTopProjects(3, true)}
                    onRestoreProjectOrder={restoreProjectOrder}
                    onApplyAllSkillSuggestions={applyAllSkillOrderSuggestions}
                  />
                  {!focusModeActive ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <LimitControl
                      label="Projects"
                      selected={selectedProjectCount}
                      max={maxProjects}
                      onChange={setMaxProjects}
                    />
                    <LimitControl
                      label="Certificates"
                      selected={selectedCertificateCount}
                      max={maxCertificates}
                      onChange={setMaxCertificates}
                    />
                  </div>
                  ) : null}
                  {!focusModeActive && (projectLimitExceeded || certificateLimitExceeded) ? (
                    <div className="border border-coral bg-paper px-4 py-3 text-sm text-coral">
                      {projectLimitExceeded ? (
                        <p>
                          Projects warning: {selectedProjectCount} selected, max {maxProjects}.
                        </p>
                      ) : null}
                      {certificateLimitExceeded ? (
                        <p>
                          Certificates warning: {selectedCertificateCount} selected, max {maxCertificates}.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {!focusModeActive && educationFieldCount > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-paper px-4 py-3">
                      <p className="text-sm text-ink/65">Education is parked outside the normal editing flow.</p>
                      <button
                        type="button"
                        onClick={toggleEducationEditor}
                        className="border border-rule bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper"
                      >
                        {showEducationEditor ? "Hide education" : `Show education (${educationFieldCount})`}
                      </button>
                    </div>
                  ) : null}
                  <div className="max-h-[820px] space-y-4 overflow-auto pr-1">
                    {visibleEditorSections.length > 0 ? (
                      visibleEditorSections.map((section) => (
                        <section key={`workspace-${section.fileName}:${section.id}`} className="border border-rule bg-white">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper px-4 py-3">
                            <div>
                              <h3 className="text-base font-semibold text-ink">{section.title}</h3>
                              <p className="mt-1 font-mono text-xs text-ink/55">{section.fileName}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFileName(section.fileName);
                                setWorkspaceSourceOpen(true);
                              }}
                              className="border border-rule px-3 py-1.5 text-xs font-semibold hover:bg-white"
                            >
                              Open source
                            </button>
                          </div>
                          <div className="grid gap-3 p-4">
                            {isCertificateSection(section.title)
                              ? groupedEditorFields(section.fields, section.title).map((group) => (
                                      <CertificateFieldToggle
                                        key={group.id}
                                        group={group}
                                        field={group.fields[0]}
                                        densityMode={densityMode}
                                        onToggle={setCertificateSelected}
                                        onRestore={restoreOriginalCertificate}
                                      />
                                ))
                              : isProjectSection(section.title)
                                ? groupedEditorFields(section.fields, section.title)
                                  .filter((group) => !focusModeActive || isProjectGroupSelected(group))
                                  .map((group) => (
                                    <ProjectFieldToggle
                                      key={group.id}
                                      group={group}
                                      recommendation={projectRecommendationById.get(group.id)}
                                      keywordHints={projectRecommendationById.get(group.id)?.matchedKeywords ?? []}
                                      densityMode={densityMode}
                                      selectedProjectCount={selectedProjectCount}
                                      maxProjects={maxProjects}
                                      expanded={expandedCardIds.has(group.id)}
                                      onToggleExpanded={() => toggleCardExpanded(group.id)}
                                      draggedProjectId={draggedProjectId}
                                      onPreviewFocus={() => focusPdfPreviewForCard(group, "Project")}
                                      onDragStart={setDraggedProjectId}
                                      onDragEnd={() => setDraggedProjectId(null)}
                                      onDrop={(targetId) => {
                                        if (!draggedProjectId) return;
                                        reorderProjectGroups(draggedProjectId, targetId);
                                        setDraggedProjectId(null);
                                      }}
                                      onToggle={setProjectSelected}
                                      onRestore={restoreOriginalProject}
                                      onFieldChange={updateResumeField}
                                    />
                                  ))
                                : isSkillSection(section.title)
                                  ? groupedEditorFields(section.fields, section.title).map((group) => (
                                      <SkillGroupEditor
                                        key={group.id}
                                      group={group}
                                      suggestion={skillOrderSuggestionByGroupId.get(group.id)}
                                      densityMode={densityMode}
                                      draggedSkillId={draggedSkillId}
                                        onDragStart={setDraggedSkillId}
                                        onDragEnd={() => setDraggedSkillId(null)}
                                        onDrop={(targetId) => {
                                          if (!draggedSkillId) return;
                                          reorderSkillFields(group, draggedSkillId, targetId);
                                          setDraggedSkillId(null);
                                        }}
                                        onMove={moveSkillField}
                                        onApplySuggestion={applySkillOrderSuggestion}
                                        onRestore={restoreOriginalSkillGroup}
                                        onFieldChange={updateResumeField}
                                      />
                                    ))
                                  : selectedEditorTab === "experience" && shouldGroupSection(section.fields)
                                    ? groupedEditorFields(section.fields, section.title).map((group) => (
                                        <ExperienceFieldCard
                                          key={group.id}
                                        group={group}
                                        keywordHints={experienceKeywordHintsById.get(group.id) ?? []}
                                        densityMode={densityMode}
                                        expanded={expandedCardIds.has(group.id)}
                                        onPreviewFocus={() => focusPdfPreviewForCard(group, "Experience")}
                                          onToggleExpanded={() => toggleCardExpanded(group.id)}
                                          onFieldChange={updateResumeField}
                                        />
                                      ))
                                  : shouldGroupSection(section.fields)
                                    ? groupedEditorFields(section.fields, section.title).map((group) => (
                                        <div key={group.id} className="border border-rule bg-white">
                                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper px-3 py-2">
                                            <div>
                                              <h4 className="text-sm font-semibold text-ink">{group.title}</h4>
                                              <p className="mt-1 text-xs text-ink/55">
                                                {[group.subtitle, group.meta].filter(Boolean).join(" | ")}
                                              </p>
                                            </div>
                                            <span className="text-xs font-semibold text-ink/45">
                                              {group.fields.length} fields
                                            </span>
                                          </div>
                                          <div className="grid gap-3 p-3">
                                            {group.fields.map((field, fieldIndex) => (
                                              <StructuredFieldEditor
                                                key={`${field.fileName}:${field.start}:${field.command}`}
                                                field={field}
                                                index={fieldIndex}
                                                onChange={(replacement) => updateResumeField(field, replacement)}
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      ))
                                    : section.fields.map((field, fieldIndex) => (
                                        <StructuredFieldEditor
                                          key={`${field.fileName}:${field.start}:${field.command}`}
                                          field={field}
                                          index={fieldIndex}
                                          onChange={(replacement) => updateResumeField(field, replacement)}
                                        />
                                      ))}
                          </div>
                        </section>
                      ))
                    ) : (
                      <div className="border border-rule bg-paper p-4 text-sm text-ink/65">
                        No editable fields were detected for this tab.
                      </div>
                    )}
                  </div>
                </div>
                <aside className="min-w-0 space-y-4">
                  <div className="sticky top-[58px] space-y-4">
                    <div className="border border-rule bg-white p-3">
                      <div className="mb-3 flex flex-wrap gap-1 border border-rule bg-paper p-1">
                        {[
                          { id: "tailored", label: "Tailored" },
                          { id: "original", label: "Original" }
                        ].map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setWorkspacePreviewMode(option.id as "tailored" | "original")}
                            className={cx(
                              "px-3 py-1.5 text-xs font-semibold",
                              workspacePreviewMode === option.id
                                ? "bg-ink text-white"
                                : "bg-white text-ink hover:bg-paper"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            workspacePreviewMode === "original"
                              ? void compileOriginalPdfPreview()
                              : void compilePdfPreview({ stayOnCurrentStep: true })
                          }
                          disabled={compileStatus.state === "compiling"}
                          className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
                        >
                          {compileStatus.state === "compiling" ? "Compiling..." : "Compile"}
                        </button>
                        {compileJumpTarget ? (
                          <button
                            type="button"
                            onClick={() => jumpToSourceLocation(compileJumpTarget)}
                            className="border border-coral px-4 py-2 text-sm font-semibold text-coral hover:bg-coral hover:text-white"
                          >
                            Open {compileJumpTarget.fileName}:{compileJumpTarget.line}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setWorkspaceSourceOpen((current) => !current)}
                          className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
                        >
                          {workspaceSourceOpen ? "Hide source" : "Show source"}
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="border border-rule bg-paper px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Preview</p>
                          <p className="mt-1 text-sm font-semibold text-ink">{workspacePreviewTitle}</p>
                        </div>
                        <div className="border border-rule bg-paper px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Pages</p>
                          <p className="mt-1 text-sm font-semibold text-ink">
                            {workspacePreview?.pageCount
                              ? `${workspacePreview.pageCount} page${workspacePreview.pageCount === 1 ? "" : "s"}`
                              : "Not compiled"}
                          </p>
                        </div>
                        <div className={cx("border px-3 py-2", compileErrorDetails ? "border-coral bg-coral/10" : "border-rule bg-paper")}>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Errors</p>
                          <p className={cx("mt-1 text-sm font-semibold", compileErrorDetails ? "text-coral" : "text-sage")}>
                            {compileErrorDetails ? "Check log" : "None"}
                          </p>
                        </div>
                      </div>
                      <p className={cx("mt-3 text-sm", compileStatus.state === "error" ? "text-coral" : "text-ink/60")}>
                        {compileStatus.message}
                      </p>
                      {compileErrorDetails ? (
                        <CompileErrorPanel details={compileErrorDetails} onOpenLocation={jumpToSourceLocation} />
                      ) : null}
                      {pdfFocusCue ? (
                        <PdfFocusCuePanel cue={pdfFocusCue} onClear={() => setPdfFocusCue(null)} />
                      ) : null}
                    </div>
                    <PdfFitNotice state={pdfFitStatus.state} pageCount={pdfFitStatus.pageCount} />
                    <div ref={workspacePreviewRef}>
                      <PdfPreviewFrame
                        title={workspacePreviewTitle}
                        preview={workspacePreview}
                        focusCue={pdfFocusCue}
                        emptyText={`Compile the ${workspacePreviewMode} LaTeX files to preview the resume.`}
                      />
                    </div>
                  </div>
                </aside>
              </div>
              {workspaceSourceOpen ? (
                <div className="mt-4 border border-rule bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper p-2">
                    {primaryEditorFiles.map((file) => (
                      <button
                        key={file.name}
                        type="button"
                        onClick={() => setActiveFileName(file.name)}
                        className={cx(
                          "px-3 py-2 font-mono text-xs font-semibold",
                          workspaceSourceFile?.name === file.name ? "bg-ink text-white" : "bg-white text-ink hover:bg-paper"
                        )}
                      >
                        {file.name}
                      </button>
                    ))}
                  </div>
                  {workspaceSourceFile ? (
                    <div className="p-4">
                      <RawFileEditor
                        file={workspaceSourceFile}
                        jumpLine={sourceJumpTarget?.fileName === workspaceSourceFile.name ? sourceJumpTarget.line : undefined}
                        jumpNonce={sourceJumpTarget?.fileName === workspaceSourceFile.name ? sourceJumpTarget.nonce : undefined}
                        minHeightClassName="min-h-[420px]"
                        safeModeEnabled={safeModeEnabled}
                        onChange={(content) => setFileContent(workspaceSourceFile.name, content)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Panel>
          ) : null}

          {selectedStep === "upload" ? (
            <Panel title="1. Resume Upload" eyebrow="LaTeX source">
              <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".tex,.cls,text/x-tex,text/plain"
                    className="hidden"
                    onChange={(event) => {
                      const selectedFiles = event.target.files;
                      if (selectedFiles?.length) void handleFiles(selectedFiles);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white"
                  >
                    Upload Overleaf files
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadProjectFolder()}
                    className="w-full border border-sage px-4 py-2 text-sm font-semibold text-sage hover:bg-sage hover:text-white"
                  >
                    Load project folder
                  </button>
                  <button
                    type="button"
                    onClick={() => void trySampleJobWorkflow()}
                    className="w-full border border-gold bg-gold px-4 py-2 text-sm font-semibold text-white"
                  >
                    Try with sample job
                  </button>
                  <button
                    type="button"
                    onClick={loadSampleSingleFile}
                    className="w-full border border-rule px-4 py-2 text-sm font-semibold text-ink hover:bg-paper"
                  >
                    Load single-file sample
                  </button>
                  <button
                    type="button"
                    onClick={loadSampleOverleafProject}
                    className="w-full border border-rule px-4 py-2 text-sm font-semibold text-ink hover:bg-paper"
                  >
                    Load Overleaf sample
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveLocalStoreNow()}
                    className="w-full border border-sage bg-sage px-4 py-2 text-sm font-semibold text-white hover:bg-sage/90"
                  >
                    Save now
                  </button>
                  <button
                    type="button"
                    onClick={clearSavedProject}
                    className="w-full border border-coral px-4 py-2 text-sm font-semibold text-coral hover:bg-coral hover:text-white"
                  >
                    Clear saved project
                  </button>
                  <div className="border border-rule bg-paper p-3 text-sm">
                    <p className="font-semibold">Project files</p>
                    <p className="mt-1 text-xs font-semibold text-sage">{localStoreStatus.message}</p>
                    <p className="mt-1 text-xs text-ink/60">{projectStorageStatus}</p>
                    <div className="mt-2 space-y-1">
                      {files.map((file) => (
                        <button
                          key={file.name}
                          type="button"
                          onClick={() => setActiveFileName(file.name)}
                          className={cx(
                            "block w-full border px-2 py-1 text-left text-xs",
                            activeFile?.name === file.name
                              ? "border-ink bg-white text-ink"
                              : "border-rule text-ink/65"
                          )}
                        >
                          {file.name} {file.editable ? "" : "(preserved)"}
                        </button>
                      ))}
                    </div>
                    <StatusLine ok={sourceValidation.isLatexLike} label="LaTeX-like structure" />
                    <StatusLine ok={sourceValidation.bracesBalanced} label="Balanced braces" />
                    <StatusLine ok={latexValidation.success} label="Zod source validation" />
                    {sourceValidation.warnings.map((warning) => (
                      <p key={warning} className="mt-2 text-xs text-coral">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
                <AdvancedDetails
                  title="Raw LaTeX source"
                  description="Use this when you need to inspect or manually fix the underlying project files."
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-2">
                      {primaryEditorFiles.map((file) => (
                        <RawFileEditor
                          key={file.name}
                          file={file}
                          jumpLine={sourceJumpTarget?.fileName === file.name ? sourceJumpTarget.line : undefined}
                          jumpNonce={sourceJumpTarget?.fileName === file.name ? sourceJumpTarget.nonce : undefined}
                          safeModeEnabled={safeModeEnabled}
                          onChange={(content) => setFileContent(file.name, content)}
                        />
                      ))}
                    </div>
                    {secondaryFiles.length > 0 ? (
                      <details className="border border-rule bg-paper p-3">
                        <summary className="cursor-pointer text-sm font-semibold">
                          Other project files
                        </summary>
                        <div className="mt-3 grid gap-4 xl:grid-cols-2">
                          {secondaryFiles.map((file) => (
                            <RawFileEditor
                              key={file.name}
                              file={file}
                              jumpLine={sourceJumpTarget?.fileName === file.name ? sourceJumpTarget.line : undefined}
                              jumpNonce={sourceJumpTarget?.fileName === file.name ? sourceJumpTarget.nonce : undefined}
                              safeModeEnabled={safeModeEnabled}
                              onChange={(content) => setFileContent(file.name, content)}
                            />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </AdvancedDetails>
              </div>
              <PrimaryPageAction
                label="Continue to Structured Editor"
                helper="Review grouped fields before tailoring."
                onClick={() => setSelectedStep("editor")}
              />
            </Panel>
          ) : null}

          {selectedStep === "editor" ? (
            <Panel title="2. Structured Resume Editor" eyebrow="Safe field editing">
              {!focusModeActive ? (
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <StatusCard ok={editableSections.length > 0} title="Editable sections detected" />
                <StatusCard ok={parsedResume.fields.some((field) => field.command === "item")} title="Bullet fields" />
                <StatusCard ok={parsedResume.fields.some((field) => field.group)} title="Field groups" />
                <StatusCard ok={sourceValidation.bracesBalanced} title="Source braces valid" />
              </div>
              ) : null}
              <div className="mb-4 flex flex-wrap gap-2 border border-rule bg-paper p-2">
                {editorTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSelectedEditorTab(tab.id)}
                    className={cx(
                      "flex items-center gap-2 px-3 py-2 text-sm font-semibold",
                      selectedEditorTab === tab.id
                        ? "bg-ink text-white"
                        : "bg-white text-ink hover:bg-paper"
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className={cx("text-xs", selectedEditorTab === tab.id ? "text-white/70" : "text-ink/45")}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mb-4">
                <FocusModePanel
                  active={focusModeActive}
                  tab={selectedEditorTab}
                  cardCount={focusCardCount}
                  coverage={activeKeywordCoverage}
                  pdfState={pdfFitStatus.state}
                  pageCount={pdfFitStatus.pageCount}
                  canDownload={canDownload}
                  onToggle={() => setFocusModeEnabled((current) => !current)}
                  onRestore={() => restoreOriginalEditorTab(selectedEditorTab)}
                  onCompile={() => void compilePdfPreview({ stayOnCurrentStep: true })}
                  onDownload={downloadTailoredResume}
                />
                <SectionAssistPanel
                  tab={selectedEditorTab}
                  warnings={activeSectionWarnings}
                  onSelectTopProjects={() => selectTopProjects(3, false)}
                  onKeepBestProjects={() => selectTopProjects(3, true)}
                  onRestoreProjectOrder={restoreProjectOrder}
                  onApplyAllSkillSuggestions={applyAllSkillOrderSuggestions}
                />
              </div>
              {!focusModeActive && selectedEditorTab !== "experience" ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-rule bg-white px-4 py-3">
                  <p className="text-sm text-ink/65">
                    Restore this section to the version loaded at the start of this session.
                  </p>
                  <button
                    type="button"
                    onClick={() => restoreOriginalEditorTab(selectedEditorTab)}
                    className="border border-coral px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white"
                  >
                    Restore original {editorTabs.find((tab) => tab.id === selectedEditorTab)?.label}
                  </button>
                </div>
              ) : null}
              {!focusModeActive ? (
              <div className="mb-4 grid gap-3 lg:grid-cols-2">
                <LimitControl
                  label="Projects"
                  selected={selectedProjectCount}
                  max={maxProjects}
                  onChange={setMaxProjects}
                />
                <LimitControl
                  label="Certificates"
                  selected={selectedCertificateCount}
                  max={maxCertificates}
                  onChange={setMaxCertificates}
                />
              </div>
              ) : null}
              {!focusModeActive && (projectLimitExceeded || certificateLimitExceeded) ? (
                <div className="mb-4 border border-coral bg-paper px-4 py-3 text-sm text-coral">
                  {projectLimitExceeded ? (
                    <p>
                      Projects warning: {selectedProjectCount} selected, max {maxProjects}. Uncheck some projects to reduce page pressure.
                    </p>
                  ) : null}
                  {certificateLimitExceeded ? (
                    <p>
                      Certificates warning: {selectedCertificateCount} selected, max {maxCertificates}. Uncheck some certificates to reduce page pressure.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {!focusModeActive && educationFieldCount > 0 ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-rule bg-paper px-4 py-3">
                  <p className="text-sm text-ink/65">
                    Education is parked outside the normal editing flow.
                  </p>
                  <button
                    type="button"
                    onClick={toggleEducationEditor}
                    className="border border-rule bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper"
                  >
                    {showEducationEditor ? "Hide education" : `Show education (${educationFieldCount})`}
                  </button>
                </div>
              ) : null}
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                {visibleEditorSections.length > 0 ? (
                  visibleEditorSections.map((section) => (
                    <section key={`${section.fileName}:${section.id}`} className="border border-rule bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper px-4 py-3">
                        <div>
                          <h3 className="text-base font-semibold text-ink">{section.title}</h3>
                          <p className="mt-1 font-mono text-xs text-ink/55">{section.fileName}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveFileName(section.fileName);
                            setSelectedStep("upload");
                          }}
                          className="border border-rule px-3 py-1.5 text-xs font-semibold hover:bg-white"
                        >
                          Open raw file
                        </button>
                      </div>
                      <div className="grid gap-3 p-4">
                        {isCertificateSection(section.title)
                          ? groupedEditorFields(section.fields, section.title).map((group) => (
                                <CertificateFieldToggle
                                  key={group.id}
                                  group={group}
                                  field={group.fields[0]}
                                  densityMode={densityMode}
                                  onToggle={setCertificateSelected}
                                  onRestore={restoreOriginalCertificate}
                                />
                            ))
                          : isProjectSection(section.title)
                          ? groupedEditorFields(section.fields, section.title)
                            .filter((group) => !focusModeActive || isProjectGroupSelected(group))
                            .map((group) => (
                              <ProjectFieldToggle
                                key={group.id}
                                group={group}
                                recommendation={projectRecommendationById.get(group.id)}
                                keywordHints={projectRecommendationById.get(group.id)?.matchedKeywords ?? []}
                                densityMode={densityMode}
                                selectedProjectCount={selectedProjectCount}
                                maxProjects={maxProjects}
                                expanded={expandedCardIds.has(group.id)}
                                onToggleExpanded={() => toggleCardExpanded(group.id)}
                                draggedProjectId={draggedProjectId}
                                onPreviewFocus={() => focusPdfPreviewForCard(group, "Project")}
                                onDragStart={setDraggedProjectId}
                                onDragEnd={() => setDraggedProjectId(null)}
                                onDrop={(targetId) => {
                                  if (!draggedProjectId) return;
                                  reorderProjectGroups(draggedProjectId, targetId);
                                  setDraggedProjectId(null);
                                }}
                                onToggle={setProjectSelected}
                                onRestore={restoreOriginalProject}
                                onFieldChange={updateResumeField}
                              />
                            ))
                          : isSkillSection(section.title)
                          ? groupedEditorFields(section.fields, section.title).map((group) => (
                              <SkillGroupEditor
                                key={group.id}
                                group={group}
                                suggestion={skillOrderSuggestionByGroupId.get(group.id)}
                                densityMode={densityMode}
                                draggedSkillId={draggedSkillId}
                                onDragStart={setDraggedSkillId}
                                onDragEnd={() => setDraggedSkillId(null)}
                                onDrop={(targetId) => {
                                  if (!draggedSkillId) return;
                                  reorderSkillFields(group, draggedSkillId, targetId);
                                  setDraggedSkillId(null);
                                }}
                                onMove={moveSkillField}
                                onApplySuggestion={applySkillOrderSuggestion}
                                onRestore={restoreOriginalSkillGroup}
                                onFieldChange={updateResumeField}
                              />
                            ))
                          : selectedEditorTab === "experience" && shouldGroupSection(section.fields)
                          ? groupedEditorFields(section.fields, section.title).map((group) => (
                              <ExperienceFieldCard
                                key={group.id}
                                group={group}
                                keywordHints={experienceKeywordHintsById.get(group.id) ?? []}
                                densityMode={densityMode}
                                expanded={expandedCardIds.has(group.id)}
                                onPreviewFocus={() => focusPdfPreviewForCard(group, "Experience")}
                                onToggleExpanded={() => toggleCardExpanded(group.id)}
                                onFieldChange={updateResumeField}
                              />
                            ))
                          : shouldGroupSection(section.fields)
                          ? groupedEditorFields(section.fields, section.title).map((group) => (
                              <div key={group.id} className="border border-rule bg-white">
                                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper px-3 py-2">
                                  <div>
                                    <h4 className="text-sm font-semibold text-ink">{group.title}</h4>
                                    <p className="mt-1 text-xs text-ink/55">
                                      {[group.subtitle, group.meta].filter(Boolean).join(" | ")}
                                    </p>
                                  </div>
                                  <span className="text-xs font-semibold text-ink/45">
                                    {group.fields.length} fields
                                  </span>
                                </div>
                                <div className="grid gap-3 p-3">
                                  {group.fields.map((field, fieldIndex) => (
                                    <StructuredFieldEditor
                                      key={`${field.fileName}:${field.start}:${field.command}`}
                                      field={field}
                                      index={fieldIndex}
                                      onChange={(replacement) => updateResumeField(field, replacement)}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))
                          : section.fields.map((field, fieldIndex) => (
                              <StructuredFieldEditor
                                key={`${field.fileName}:${field.start}:${field.command}`}
                                field={field}
                                index={fieldIndex}
                                onChange={(replacement) => updateResumeField(field, replacement)}
                              />
                            ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="border border-rule bg-paper p-4 text-sm text-ink/65">
                    No editable fields were detected for this tab. Open the parser tab to inspect the LaTeX commands.
                  </div>
                )}
                </div>
                <aside className="min-w-0">
                  <SectionProgressSidebar
                    items={sectionProgressItems}
                    onCompile={() => void compilePdfPreview({ stayOnCurrentStep: true })}
                    onApplySkillOrder={applyAllSkillOrderSuggestions}
                    onSelectProjects={() => selectTopProjects(3, false)}
                  />
                </aside>
              </div>
            </Panel>
          ) : null}

          {selectedStep === "job" ? (
            <Panel title="3. Job Description" eyebrow="Deterministic extraction">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Job title">
                  <input
                    value={job.title}
                    onChange={(event) => setJob((current) => ({ ...current, title: event.target.value }))}
                    className="w-full border border-rule px-3 py-2 outline-none focus:border-sage"
                  />
                </Field>
                <Field label="Company">
                  <input
                    value={job.company}
                    onChange={(event) => setJob((current) => ({ ...current, company: event.target.value }))}
                    className="w-full border border-rule px-3 py-2 outline-none focus:border-sage"
                  />
                </Field>
                <Field label="Job URL">
                  <input
                    value={job.url}
                    onChange={(event) => setJob((current) => ({ ...current, url: event.target.value }))}
                    className="w-full border border-rule px-3 py-2 outline-none focus:border-sage md:col-span-2"
                  />
                </Field>
              </div>
              <textarea
                value={job.description}
                onChange={(event) => setJob((current) => ({ ...current, description: event.target.value }))}
                className="mt-4 min-h-[300px] w-full resize-y border border-rule p-4 text-sm leading-6 outline-none focus:border-sage"
              />
              <JobDescriptionQualityPanel quality={jobDescriptionQuality} />
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <ChipGroup title="Required" values={jobAnalysis.requiredSkills} />
                <ChipGroup title="Preferred" values={jobAnalysis.preferredSkills} />
                <ChipGroup title="Responsibilities" values={jobAnalysis.responsibilities.slice(0, 4)} />
                <ChipGroup title="Keywords" values={jobAnalysis.keywords.slice(0, 8)} />
              </div>
              {!jobValidation.success ? (
                <p className="mt-3 text-sm text-coral">{jobValidation.error.issues[0]?.message}</p>
              ) : null}
              <PrimaryPageAction
                label="Analyze Match"
                helper="Compare this job description with the parsed resume."
                onClick={() => setSelectedStep("match")}
              />
            </Panel>
          ) : null}

          {selectedStep === "parser" ? (
            <Panel title="4. Resume Parser" eyebrow="Editable fields">
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <ChipGroup title="Commands detected" values={parsedResume.commandsDetected} />
                <ChipGroup title="Sections" values={parsedResume.sections.map((section) => section.title)} />
                <ChipGroup
                  title="Configurable commands"
                  values={["resumeItem arg 1", "resumeSubheading args 1 & 3", "plain summary/skills"]}
                />
              </div>
              <div className="overflow-hidden border border-rule">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-ink text-left text-white">
                    <tr>
                      <th className="p-3">ID</th>
                      <th className="p-3">File</th>
                      <th className="p-3">Section</th>
                      <th className="p-3">Command</th>
                      <th className="p-3">Editable Content</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedResume.fields.map((field) => (
                      <tr key={field.id} className="border-t border-rule align-top">
                        <td className="max-w-[220px] break-all p-3 font-mono text-xs">{field.id}</td>
                        <td className="p-3 font-mono text-xs">{field.fileName}</td>
                        <td className="p-3">{field.sectionTitle}</td>
                        <td className="p-3 font-mono text-xs">\\{field.command}</td>
                        <td className="p-3 text-ink/75">{field.original}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          {selectedStep === "match" ? (
            <Panel title="5. Match Analysis" eyebrow="Keyword first, AI second">
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(280px,0.85fr)_minmax(0,1fr)]">
                <div className="border border-rule bg-white p-4">
                  <p className="text-sm text-ink/60">Score</p>
                  <p className="mt-2 text-5xl font-semibold text-sage">{matchAnalysis.score}</p>
                  <div className="mt-4 h-2 bg-paper">
                    <div className="h-full bg-sage" style={{ width: `${matchAnalysis.score}%` }} />
                  </div>
                </div>
                <TailoringConfidencePanel items={tailoringConfidenceItems} />
                <div className="grid gap-3 md:grid-cols-2">
                  <ChipGroup title="Matched skills" values={matchAnalysis.matchedSkills} />
                  <ChipGroup title="Partial responsibilities" values={matchAnalysis.partiallyMatchedRequirements} />
                  <ChipGroup title="Missing requirements" values={matchAnalysis.missingRequirements} danger />
                  <ChipGroup title="Important keywords" values={matchAnalysis.importantKeywords} />
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-4">
                {keywordCoverageBySection.map((coverage) => (
                  <KeywordCoverageCard key={coverage.label} coverage={coverage} />
                ))}
              </div>
              <TailoringPresetsPanel
                presets={tailoringPresets}
                presetName={presetName}
                onPresetNameChange={setPresetName}
                onApply={applyTailoringPreset}
                onSave={saveCurrentTailoringPreset}
                onDelete={deleteTailoringPreset}
              />
              <KeywordPriorityControls
                keywords={jobKeywordTerms}
                selected={priorityKeywords}
                onToggle={(keyword) =>
                  setPriorityKeywords((current) =>
                    current.includes(keyword)
                      ? current.filter((item) => item !== keyword)
                      : [...current, keyword]
                  )
                }
              />
              <SkillGapPanel findings={skillGapFindings} onOpenEvidence={openHiddenEvidence} />
              <div className="mt-4 border border-rule bg-white">
                <div className="border-b border-rule bg-paper px-4 py-3">
                  <h3 className="text-sm font-semibold text-ink">Project relevance suggestions</h3>
                  <p className="mt-1 text-xs text-ink/55">
                    Ranked by deterministic keyword overlap. You still choose with project checkboxes.
                  </p>
                </div>
                <div className="grid gap-3 p-4 lg:grid-cols-2">
                  {projectRecommendations.length > 0 ? (
                    projectRecommendations.slice(0, 8).map((recommendation, index) => (
                      <ProjectRecommendationCard
                        key={recommendation.groupId}
                        recommendation={recommendation}
                        rank={index + 1}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-ink/55">No projects detected for ranking.</p>
                  )}
                </div>
              </div>
              <OnePageOptimizerPanel
                className="mt-4"
                items={onePageOptimizerItems}
                pdfState={pdfFitStatus.state}
                pageCount={pdfFitStatus.pageCount}
              />
              <AdvancedDetails
                title="Structured AI JSON"
                description="Inspect the exact structured response shape used by the review workflow."
                className="mt-4"
              >
                <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-xs">
                  {JSON.stringify(aiResponse, null, 2)}
                </pre>
                <StatusLine ok={aiResponseIsValid} label="AI response schema validation" />
              </AdvancedDetails>
            </Panel>
          ) : null}

          {selectedStep === "review" ? (
            <Panel title="6. Suggestion Review" eyebrow="Human approval required">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink/65">
                <span className="border border-rule px-2 py-1">Arrow keys or j/k navigate</span>
                <span className="border border-rule px-2 py-1">a accepts</span>
                <span className="border border-rule px-2 py-1">r rejects</span>
                <span className="border border-rule px-2 py-1">No automatic accepts</span>
              </div>
              <div className="space-y-4">
                {suggestions.map((suggestion, index) => {
                  const unsupportedTerms = suggestionUnsupportedById.get(suggestion.id) ?? [];
                  const hasUnsupportedTerms = unsupportedTerms.length > 0;
                  const impactTags = editImpactTags(suggestion, unsupportedTerms, pdfFitStatus.state);

                  return (
                  <article
                    key={suggestion.id}
                    className={cx(
                      "border bg-white p-4",
                      activeSuggestion === index ? "border-sage shadow-sm" : "border-rule",
                      hasUnsupportedTerms && "border-coral"
                    )}
                    onFocus={() => setActiveSuggestion(index)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage">
                          {suggestion.status}
                        </p>
                        <p className="mt-1 text-sm text-ink/65">{suggestion.reason}</p>
                        <ImpactTagRow tags={impactTags} />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => updateSuggestion(index, "accepted")}
                          disabled={hasUnsupportedTerms}
                          className="border border-sage px-3 py-1.5 text-sm font-semibold text-sage hover:bg-sage hover:text-white disabled:cursor-not-allowed disabled:border-coral disabled:text-coral disabled:hover:bg-white"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSuggestion(index, "rejected")}
                          className="border border-coral px-3 py-1.5 text-sm font-semibold text-coral hover:bg-coral hover:text-white"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => restoreSuggestion(index)}
                          className="border border-rule px-3 py-1.5 text-sm font-semibold hover:bg-paper"
                        >
                          Restore Original
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <DiffBox label="Original" value={suggestion.original} />
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                          Suggested
                        </span>
                        <textarea
                          value={suggestion.suggested}
                          onChange={(event) => editSuggestion(index, event.target.value)}
                          className="min-h-[130px] w-full resize-y border border-rule bg-paper p-3 text-sm leading-6 outline-none focus:border-sage"
                        />
                        <HighlightedSuggestionPreview value={suggestion.suggested} unsupportedTerms={unsupportedTerms} />
                      </label>
                    </div>
                    {hasUnsupportedTerms ? (
                      <div className="mt-3 border border-coral bg-paper p-3 text-sm text-coral">
                        Unsupported added claim detected. Edit or remove the highlighted text before accepting.
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {suggestion.keywordsAdded.map((keyword) => (
                        <span key={keyword} className="border border-gold px-2 py-1 text-gold">
                          {keyword}
                        </span>
                      ))}
                      {unsupportedTerms.map((claim) => (
                        <span key={claim} className="border border-coral px-2 py-1 text-coral">
                          Unsupported: {claim}
                        </span>
                      ))}
                    </div>
                  </article>
                  );
                })}
              </div>
              <PrimaryPageAction
                label="Preview PDF"
                helper="Compile or inspect the tailored resume layout."
                onClick={() => setSelectedStep("preview")}
              />
            </Panel>
          ) : null}

          {selectedStep === "preview" ? (
            <Panel title="7. PDF Preview" eyebrow="Compiled from LaTeX">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void compileOriginalPdfPreview()}
                  disabled={compileStatus.state === "compiling"}
                  className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper disabled:cursor-wait disabled:opacity-50"
                >
                  {compileStatus.state === "compiling" ? "Compiling..." : "Compile original PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => void compilePdfPreview()}
                  disabled={compileStatus.state === "compiling"}
                  className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
                >
                  {compileStatus.state === "compiling" ? "Compiling..." : "Compile tailored PDF"}
                </button>
                {previewPdf || originalPreviewPdf ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPdf(null);
                      setOriginalPreviewPdf(null);
                    }}
                    className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
                  >
                    Clear previews
                  </button>
                ) : null}
                {compileJumpTarget ? (
                  <button
                    type="button"
                    onClick={() => jumpToSourceLocation(compileJumpTarget)}
                    className="border border-coral px-4 py-2 text-sm font-semibold text-coral hover:bg-coral hover:text-white"
                  >
                    Open {compileJumpTarget.fileName}:{compileJumpTarget.line}
                  </button>
                ) : null}
                <span
                  className={cx(
                    "text-sm",
                    compileStatus.state === "error" ? "text-coral" : "text-ink/60"
                  )}
                >
                  {compileStatus.message}
                </span>
              </div>
              {compileErrorDetails ? (
                <CompileErrorPanel details={compileErrorDetails} onOpenLocation={jumpToSourceLocation} />
              ) : null}
              <PdfFitNotice state={pdfFitStatus.state} pageCount={pdfFitStatus.pageCount} />
              <OnePageOptimizerPanel
                className="mb-4 mt-4"
                items={onePageOptimizerItems}
                pdfState={pdfFitStatus.state}
                pageCount={pdfFitStatus.pageCount}
              />
              <div className="grid gap-4 xl:grid-cols-2">
                <PdfPreviewFrame
                  title="Original PDF snapshot"
                  preview={originalPreviewPdf}
                  emptyText="Compile the original LaTeX files to keep a visual baseline."
                />
                <PdfPreviewFrame
                  title="Tailored PDF snapshot"
                  preview={previewPdf}
                  emptyText="Compile the tailored LaTeX files to render the current resume."
                />
              </div>
              <PrimaryPageAction
                label="Export Resume"
                helper="Review readiness, source diff, and download options."
                onClick={() => setSelectedStep("export")}
              />
            </Panel>
          ) : null}

          {selectedStep === "export" ? (
            <Panel title="8. LaTeX Reconstruction & Export" eyebrow="Current tailored resume">
              <PlainEnglishExportWarning text={plainEnglishExportWarning} ready={exportReady} />
              <ExportReadinessChecklist ready={exportReady} readiness={exportReadiness} />
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <StatusCard ok={tailoredBalanced} title="Balanced braces" />
                <StatusCard ok={unsupportedAccepted.length === 0} title="No unsupported accepted claims" />
                <StatusCard ok={hasTailoringChanges} title="Tailoring changes" />
                <StatusCard ok={sourceValidation.isLatexLike} title="Commands preserved" />
              </div>
              <div className="mb-4">
                <PdfFitNotice state={pdfFitStatus.state} pageCount={pdfFitStatus.pageCount} />
              </div>
              <OnePageOptimizerPanel
                className="mb-4"
                items={onePageOptimizerItems}
                pdfState={pdfFitStatus.state}
                pageCount={pdfFitStatus.pageCount}
              />
              <ChangeSummaryChecklist
                projects={includedProjectNames}
                certificates={includedCertificateNames}
                skillsReordered={skillsReordered}
                acceptedSuggestionCount={acceptedAiSuggestions.length}
                reviewed={exportSummaryReviewed}
                onReviewedChange={setExportSummaryReviewed}
              />
              <NamedSessionsPanel
                sessionName={sessionName}
                savedSessions={savedSessions}
                onSessionNameChange={setSessionName}
                onSave={saveNamedSession}
                onLoad={loadNamedSession}
                onDelete={deleteNamedSession}
                defaultName={defaultSessionName()}
              />
              <ResumeHistoryTimeline entries={resumeHistoryEntries} />
              <div className="mb-4 border border-rule bg-white px-4 py-3">
                <label className="block text-sm font-semibold text-ink">
                  Resume version label
                  <input
                    value={resumeVersionLabel}
                    onChange={(event) => setResumeVersionLabel(event.target.value)}
                    placeholder="Google SWE Intern - Projects NLP + Azure"
                    className="mt-2 w-full border border-rule bg-paper px-3 py-2 text-sm font-normal outline-none focus:border-sage"
                  />
                </label>
                <p className="mt-2 text-xs text-ink/55">
                  Used for export filenames and application records. Leave blank to use the generated TailorTeX name.
                </p>
              </div>
              <div className="mb-4 border border-rule bg-paper px-4 py-3 text-sm text-ink/65">
                <p>
                  Download name:{" "}
                  <span className="font-mono text-ink">
                    {files.length > 1 ? tailoredZipFilename : tailoredTexFilename}
                  </span>
                </p>
              </div>
              {duplicateApplicationRecord ? (
                <div className="mb-4 border border-gold bg-gold/10 px-4 py-3 text-sm text-ink">
                  <p className="font-semibold">Possible duplicate application</p>
                  <p className="mt-1 text-xs leading-5 text-ink/65">
                    You already saved this company, role, and URL on{" "}
                    {new Date(duplicateApplicationRecord.savedAt).toLocaleString()} with status{" "}
                    {duplicateApplicationRecord.status}. You can still save a new version if this is intentional.
                  </p>
                </div>
              ) : null}
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canDownload}
                  onClick={createApplyPacket}
                  className="border border-gold bg-gold px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Apply Packet
                </button>
                <button
                  type="button"
                  disabled={!canDownload}
                  onClick={downloadTailoredResume}
                  className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download resume
                </button>
                <button
                  type="button"
                  disabled={!canDownload}
                  onClick={() =>
                    downloadText(
                      tailoredTexFilename,
                      tailoredProjectSource
                    )
                  }
                  className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download tailored combined .tex
                </button>
                <button
                  type="button"
                  disabled={!canDownload}
                  onClick={() =>
                    void downloadProjectZip(
                      tailoredZipFilename,
                      tailoredFiles
                    )
                  }
                  className="border border-sage px-4 py-2 text-sm font-semibold text-sage hover:bg-sage hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download tailored Overleaf ZIP
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void downloadProjectZip(
                      originalZipFilename,
                      originalFiles
                    )
                  }
                  className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
                >
                  Download original ZIP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveApplicationRecord();
                    setSelectedStep("applications");
                  }}
                  className="border border-gold px-4 py-2 text-sm font-semibold text-gold hover:bg-gold hover:text-white"
                >
                  Save application record
                </button>
                <button
                  type="button"
                  onClick={downloadCurrentApplicationPacket}
                  className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
                >
                  Download application packet
                </button>
              </div>
              <AtsKeywordDeltaPanel delta={atsKeywordDelta} />
              <AdvancedDetails
                title="Raw source diff filters"
                description="Filter the source diff by file, section, or changed lines only."
                className="mb-3"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
                    File
                    <select
                      value={diffFileFilter}
                      onChange={(event) => setDiffFileFilter(event.target.value)}
                      className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink"
                    >
                      {diffFileOptions.map((option) => (
                        <option key={option} value={option}>
                          {option === "all" ? "All files" : option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
                    Section
                    <select
                      value={diffSectionFilter}
                      onChange={(event) => setDiffSectionFilter(event.target.value)}
                      className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink"
                    >
                      {diffSectionOptions.map((option) => (
                        <option key={option} value={option}>
                          {option === "all" ? "All sections" : option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-end gap-2 text-sm font-semibold text-ink/70">
                    <input
                      type="checkbox"
                      checked={diffChangedOnly}
                      onChange={(event) => setDiffChangedOnly(event.target.checked)}
                      className="mb-2 h-4 w-4 accent-sage"
                    />
                    <span className="pb-1">Changed only</span>
                  </label>
                </div>
              </AdvancedDetails>
              <div className="overflow-hidden border border-rule">
                <div className="grid grid-cols-[150px_72px_1fr_1fr] bg-ink px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white">
                  <span>File</span>
                  <span>Line</span>
                  <span>Original</span>
                  <span>Tailored</span>
                </div>
                <div className="max-h-[620px] overflow-auto font-mono text-xs">
                  {filteredSourceDiff.map((row) => (
                    <div
                      key={`${row.fileName}:${row.line}`}
                      className={cx(
                        "grid grid-cols-[150px_72px_1fr_1fr] border-t border-rule",
                        row.changed ? "bg-[#fff4df]" : "bg-white"
                      )}
                    >
                      <span className="px-3 py-2 text-ink/50">
                        {row.fileName}
                        <span className="mt-1 block whitespace-normal font-sans text-[10px] text-ink/35">
                          {row.sectionTitle}
                        </span>
                      </span>
                      <span className="px-3 py-2 text-ink/50">{row.line}</span>
                      <pre className="overflow-auto whitespace-pre-wrap px-3 py-2">{row.before}</pre>
                      <pre className="overflow-auto whitespace-pre-wrap border-l border-rule px-3 py-2">
                        {row.after}
                      </pre>
                    </div>
                  ))}
                  {filteredSourceDiff.length === 0 ? (
                    <div className="border-t border-rule bg-white p-4 font-sans text-sm text-ink/55">
                      No diff rows match the current filters.
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : null}

          {selectedStep === "applications" ? (
            <Panel title="9. Application Tracker" eyebrow="Jobs and submitted resumes">
              {isBackendMode() ? (
                <BackendApplicationTrackerPanel
                  applications={backendApplications}
                  status={backendApplicationsStatus}
                  statusFilter={backendStatusFilter}
                  currentJob={{
                    company: job.company,
                    jobTitle: job.title,
                    jobUrl: job.url,
                    jobDescription: job.description,
                    resumeUsed: resumeVersionName
                  }}
                  onStatusFilterChange={setBackendStatusFilter}
                  onRefresh={() => void loadBackendApplications()}
                  onSave={(draft, id) => void saveBackendApplication(draft, id)}
                  onOpen={openBackendApplicationInStudio}
                />
              ) : (
                <ApplicationTrackerPanel
                  records={applicationRecords}
                  notes={applicationNotes}
                  status={applicationStatus}
                  jobTitle={job.title}
                  company={job.company}
                  jobUrl={job.url}
                  matchScore={matchAnalysis.score}
                  submittedFileName={files.length > 1 ? tailoredZipFilename : tailoredTexFilename}
                  includedProjects={includedProjectNames}
                  includedCertificates={includedCertificateNames}
                  matchedSkills={matchAnalysis.matchedSkills}
                  missingRequirements={matchAnalysis.missingRequirements}
                  jobDescription={job.description}
                  generatedAnswers={generatedApplicationAnswers}
                  copiedAnswerId={copiedAnswerId}
                  duplicateRecord={duplicateApplicationRecord}
                  densityMode={densityMode}
                  onNotesChange={setApplicationNotes}
                  onStatusChange={setApplicationStatus}
                  onSave={saveApplicationRecord}
                  onApplyPacket={createApplyPacket}
                  onLoad={loadApplicationResume}
                  onDownload={downloadApplicationResume}
                  onDownloadCurrentPacket={downloadCurrentApplicationPacket}
                  onDownloadRecordPacket={downloadSavedApplicationPacket}
                  onCopy={copyToClipboard}
                  onUpdate={updateApplicationRecord}
                  onDelete={deleteApplicationRecord}
                />
              )}
            </Panel>
          ) : null}

          {selectedStep === "autofill" ? (
            <Panel title="10. Autofill Kit" eyebrow="Reusable profile and answers">
              <AutofillKitPanel
                profile={autofillProfile}
                answers={generatedApplicationAnswers}
                followUpTemplates={followUpTemplates}
                copiedAnswerId={copiedAnswerId}
                jobTitle={job.title}
                company={job.company}
                onProfileChange={updateAutofillProfile}
                onExportProfile={exportAutofillProfileJson}
                onImportProfile={importAutofillProfileJson}
                onImportTailorTexData={importTailorTexLocalJson}
                onExportAllData={exportAllTailorTexDataJson}
                localStoreStatus={localStoreStatus}
                onCopy={copyToClipboard}
              />
            </Panel>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Panel({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-rule bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sage">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AdvancedDetails({
  title,
  description,
  className,
  children
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cx("border border-rule bg-paper p-3", className)}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-xs text-ink/55">{description}</p>
          </div>
          <span className="border border-rule bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/45">
            Advanced
          </span>
        </div>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function StepStatusDot({ status, active }: { status: StepStatus; active: boolean }) {
  const label = stepStatusLabel(status);

  return (
    <span
      title={label}
      aria-label={label}
      className={cx(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold leading-none",
        active ? "border-white" : stepStatusDotClass(status)
      )}
    >
      {status === "done" ? "✓" : status === "blocked" ? "!" : ""}
    </span>
  );
}

function stepStatusLabel(status: StepStatus) {
  switch (status) {
    case "done":
      return "done";
    case "needs_attention":
      return "needs attention";
    case "blocked":
      return "blocked";
    case "optional":
    default:
      return "optional";
  }
}

function stepStatusTextClass(status: StepStatus) {
  switch (status) {
    case "done":
      return "text-sage";
    case "needs_attention":
      return "text-gold";
    case "blocked":
      return "text-coral";
    case "optional":
    default:
      return "text-ink/35";
  }
}

function stepStatusDotClass(status: StepStatus) {
  switch (status) {
    case "done":
      return "border-sage bg-sage text-white";
    case "needs_attention":
      return "border-gold bg-gold text-white";
    case "blocked":
      return "border-coral bg-coral text-white";
    case "optional":
    default:
      return "border-rule bg-paper text-transparent";
  }
}

function PrimaryPageAction({
  label,
  helper,
  onClick
}: {
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
      <p className="text-sm text-ink/55">{helper}</p>
      <button
        type="button"
        onClick={onClick}
        className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
      >
        {label}
      </button>
    </div>
  );
}

function CommandCenter({
  canApplyPacket,
  compileState,
  densityMode,
  safeModeEnabled,
  syncPulseLabel,
  storageStatus,
  onCompile,
  onDensityModeChange,
  onSafeModeChange,
  onSaveNow,
  onApplyPacket,
  onExportBackup
}: {
  canApplyPacket: boolean;
  compileState: "idle" | "compiling" | "success" | "error";
  densityMode: DensityMode;
  safeModeEnabled: boolean;
  syncPulseLabel: string;
  storageStatus: LocalStoreStatus;
  onCompile: () => void;
  onDensityModeChange: (mode: DensityMode) => void;
  onSafeModeChange: (enabled: boolean) => void;
  onSaveNow: () => void;
  onApplyPacket: () => void;
  onExportBackup: () => void;
}) {
  return (
    <div className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Command center</p>
          <p className={cx("mt-1 text-xs font-semibold", storageStatus.isSaving ? "text-gold" : "text-sage")}>
            {syncPulseLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DensityToggle value={densityMode} onChange={onDensityModeChange} />
          <SafeModeToggle enabled={safeModeEnabled} onChange={onSafeModeChange} />
          <button
            type="button"
            onClick={onCompile}
            disabled={compileState === "compiling"}
            className="border border-ink bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compileState === "compiling" ? "Compiling..." : "Compile PDF"}
          </button>
          <button
            type="button"
            onClick={onSaveNow}
            className="border border-sage bg-sage px-3 py-2 text-xs font-semibold text-white hover:bg-sage/90"
          >
            Save now
          </button>
          <button
            type="button"
            onClick={onApplyPacket}
            disabled={!canApplyPacket}
            className="border border-gold bg-gold px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply Packet
          </button>
          <button
            type="button"
            onClick={onExportBackup}
            className="border border-rule bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
          >
            Export backup
          </button>
          <span
            className={cx(
              "border px-3 py-2 text-xs font-semibold",
              storageStatus.state === "file"
                ? "border-sage bg-white text-sage"
                : storageStatus.state === "error"
                  ? "border-coral bg-white text-coral"
                  : "border-rule bg-white text-ink/60"
            )}
          >
            Storage: {storageStatus.state === "file" ? "local file" : storageStatus.state}
          </span>
        </div>
      </div>
    </div>
  );
}

function SafeModeToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cx(
        "border px-3 py-2 text-xs font-semibold",
        enabled
          ? "border-sage bg-sage text-white"
          : "border-gold bg-white text-gold hover:bg-gold hover:text-white"
      )}
      title="Safe mode locks raw LaTeX panes while keeping structured field edits available."
    >
      Safe mode: {enabled ? "On" : "Off"}
    </button>
  );
}

function DensityToggle({ value, onChange }: { value: DensityMode; onChange: (mode: DensityMode) => void }) {
  return (
    <div className="flex border border-rule bg-white p-1" aria-label="Density mode">
      {(["compact", "comfortable"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cx(
            "px-3 py-1.5 text-xs font-semibold capitalize",
            value === mode ? "bg-ink text-white" : "text-ink/65 hover:bg-paper"
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function HeaderSessionSwitcher({
  currentSessionName,
  savedSessions,
  onLoad
}: {
  currentSessionName: string;
  savedSessions: SavedTailoringSession[];
  onLoad: (session: SavedTailoringSession) => void;
}) {
  return (
    <div className="border border-rule bg-paper p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">Current session</p>
      <p className="mt-1 max-w-[320px] truncate font-semibold text-ink">{currentSessionName}</p>
      {savedSessions.length > 0 ? (
        <select
          value=""
          onChange={(event) => {
            const session = savedSessions.find((item) => item.id === event.target.value);
            if (session) onLoad(session);
          }}
          className="mt-2 w-full border border-rule bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-sage"
        >
          <option value="">Switch saved session...</option>
          {savedSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-2 text-xs text-ink/50">No named sessions saved yet.</p>
      )}
    </div>
  );
}

function ResumeStatusBar({
  items
}: {
  items: Array<{ label: string; value: string; ok: boolean }>;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-rule bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-5 py-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={cx(
              "flex items-center gap-2 border px-3 py-1.5 text-xs font-semibold",
              item.ok ? "border-sage bg-paper text-sage" : "border-rule bg-paper text-ink/65"
            )}
          >
            <span className="text-ink/45">{item.label}</span>
            <span>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuidedChecklist({
  title = "Tailoring checklist",
  items
}: {
  title?: string;
  items: Array<{ label: string; done: boolean }>;
}) {
  const completeCount = items.filter((item) => item.done).length;

  return (
    <div className="border border-rule bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-xs font-semibold text-ink/45">
          {completeCount}/{items.length}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className={cx(
                "flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-semibold",
                item.done ? "border-sage bg-sage text-white" : "border-rule bg-paper text-ink/30"
              )}
            >
              {item.done ? "OK" : ""}
            </span>
            <span className={item.done ? "text-ink" : "text-ink/55"}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionProgressSidebar({
  items,
  onCompile,
  onApplySkillOrder,
  onSelectProjects
}: {
  items: Array<{ label: string; done: boolean; detail: string }>;
  onCompile: () => void;
  onApplySkillOrder: () => void;
  onSelectProjects: () => void;
}) {
  const completed = items.filter((item) => item.done).length;

  return (
    <div className="sticky top-[58px] border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <p className="text-sm font-semibold text-ink">Section progress</p>
        <p className="mt-1 text-xs text-ink/55">
          {completed}/{items.length} editing checks complete
        </p>
      </div>
      <div className="grid gap-2 p-3">
        {items.map((item) => (
          <div key={item.label} className="border border-rule bg-paper p-3">
            <div className="flex items-start gap-2">
              <span
                className={cx(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-semibold",
                  item.done ? "border-sage bg-sage text-white" : "border-rule bg-white text-ink/30"
                )}
              >
                {item.done ? "OK" : ""}
              </span>
              <div>
                <p className={cx("text-sm font-semibold", item.done ? "text-ink" : "text-ink/60")}>
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-ink/50">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t border-rule p-3">
        <button
          type="button"
          onClick={onCompile}
          className="border border-ink bg-ink px-3 py-2 text-xs font-semibold text-white"
        >
          Compile PDF
        </button>
        <button
          type="button"
          onClick={onSelectProjects}
          className="border border-gold px-3 py-2 text-xs font-semibold text-gold hover:bg-gold hover:text-white"
        >
          Select top projects
        </button>
        <button
          type="button"
          onClick={onApplySkillOrder}
          className="border border-sage px-3 py-2 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
        >
          Apply skill order
        </button>
      </div>
    </div>
  );
}

function FocusModePanel({
  active,
  tab,
  cardCount,
  coverage,
  pdfState,
  pageCount,
  canDownload,
  onToggle,
  onRestore,
  onCompile,
  onDownload
}: {
  active: boolean;
  tab: EditorTab;
  cardCount: number;
  coverage?: KeywordCoverage;
  pdfState: "unknown" | "stale" | "fits" | "overflow";
  pageCount?: number;
  canDownload: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onCompile: () => void;
  onDownload: () => void;
}) {
  if (tab !== "projects" && tab !== "experience") return null;

  const tabLabel = tab === "projects" ? "Projects" : "Experience";
  const pdfLabel =
    pdfState === "fits"
      ? `PDF fits ${pageCount ?? 1} page`
      : pdfState === "overflow"
        ? `PDF spills to ${pageCount} pages`
        : pdfState === "stale"
          ? "PDF check stale"
          : "PDF not compiled";

  return (
    <div className={cx("border px-4 py-3", active ? "border-sage bg-white" : "border-rule bg-paper")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{tabLabel} focus mode</p>
          <p className="mt-1 text-xs text-ink/55">
            {active ? `${cardCount} selected cards shown with PDF fit and keyword context.` : "Trim this view to the active section."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggle}
            className={cx(
              "border px-3 py-1.5 text-xs font-semibold",
              active ? "border-sage bg-sage text-white" : "border-ink bg-white text-ink hover:bg-paper"
            )}
          >
            {active ? "Exit focus" : `Focus ${tabLabel}`}
          </button>
          {active ? (
            <>
              <button
                type="button"
                onClick={onRestore}
                className="border border-coral px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white"
              >
                Restore {tabLabel}
              </button>
              <button
                type="button"
                onClick={onCompile}
                className="border border-rule px-3 py-1.5 text-xs font-semibold hover:bg-paper"
              >
                Compile PDF
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={!canDownload}
                className="border border-ink bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Download resume
              </button>
            </>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className={cx("border bg-paper px-3 py-2 text-xs font-semibold", pdfState === "fits" ? "border-sage text-sage" : "border-rule text-ink/60")}>
            {pdfLabel}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(coverage?.matched ?? []).slice(0, 10).map((keyword) => (
              <span key={keyword} className="border border-gold bg-paper px-2 py-1 text-xs text-gold">
                {keyword}
              </span>
            ))}
            {(coverage?.matched.length ?? 0) === 0 ? (
              <span className="text-xs text-ink/45">No direct keywords covered in this section yet.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionAssistPanel({
  tab,
  warnings,
  onSelectTopProjects,
  onKeepBestProjects,
  onRestoreProjectOrder,
  onApplyAllSkillSuggestions
}: {
  tab: EditorTab;
  warnings: string[];
  onSelectTopProjects: () => void;
  onKeepBestProjects: () => void;
  onRestoreProjectOrder: () => void;
  onApplyAllSkillSuggestions: () => void;
}) {
  const hasActions = tab === "projects" || tab === "skills";
  const hasWarnings = warnings.length > 0;
  if (!hasActions && !hasWarnings) return null;

  return (
    <div className="border border-rule bg-white px-4 py-3">
      {hasActions ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Bulk actions</span>
          {tab === "projects" ? (
            <>
              <button
                type="button"
                onClick={onSelectTopProjects}
                className="border border-sage px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
              >
                Select top 3 projects
              </button>
              <button
                type="button"
                onClick={onKeepBestProjects}
                className="border border-ink px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper"
              >
                Keep only best 3
              </button>
              <button
                type="button"
                onClick={onRestoreProjectOrder}
                className="border border-rule px-3 py-1.5 text-xs font-semibold hover:bg-paper"
              >
                Restore all project order
              </button>
            </>
          ) : null}
          {tab === "skills" ? (
            <button
              type="button"
              onClick={onApplyAllSkillSuggestions}
              className="border border-sage px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
            >
              Apply suggested skill order
            </button>
          ) : null}
        </div>
      ) : null}
      {hasWarnings ? (
        <div className={cx("grid gap-2", hasActions && "mt-3")}>
          {warnings.map((warning) => (
            <div key={warning} className="border border-gold bg-paper px-3 py-2 text-xs font-semibold text-gold">
              {warning}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "sage" | "gold" | "coral" }) {
  const toneClass = {
    sage: "text-sage",
    gold: "text-gold",
    coral: "text-coral"
  }[tone];

  return (
    <div className="min-w-[86px] border border-rule bg-paper px-3 py-2">
      <p className={cx("text-lg font-semibold", toneClass)}>{value}</p>
      <p className="text-ink/55">{label}</p>
    </div>
  );
}

function LimitControl({
  label,
  selected,
  max,
  onChange
}: {
  label: string;
  selected: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const exceeded = selected > max;

  return (
    <div className={cx("border px-4 py-3", exceeded ? "border-coral bg-paper" : "border-rule bg-paper")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{label}</p>
          <p className={cx("mt-1 text-xs", exceeded ? "text-coral" : "text-ink/55")}>
            {selected} selected / max {max}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink/60">
          Show max
          <input
            type="number"
            min={0}
            max={12}
            value={max}
            onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
            className="w-16 border border-rule bg-white px-2 py-1 text-sm text-ink outline-none focus:border-sage"
          />
        </label>
      </div>
    </div>
  );
}

function KeywordCoverageCard({ coverage }: { coverage: KeywordCoverage }) {
  const percent = coverage.total ? Math.round((coverage.matched.length / coverage.total) * 100) : 0;

  return (
    <div className="border border-rule bg-paper p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{coverage.label}</h3>
          <p className="mt-1 text-xs text-ink/55">
            {coverage.matched.length}/{coverage.total} keywords
          </p>
        </div>
        <span className={cx("text-sm font-semibold", percent >= 50 ? "text-sage" : "text-coral")}>
          {percent}%
        </span>
      </div>
      <div className="mt-3 h-1.5 bg-white">
        <div className="h-full bg-sage" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {coverage.matched.slice(0, 8).map((keyword) => (
          <span key={keyword} className="border border-sage bg-white px-2 py-1 text-xs text-sage">
            {keyword}
          </span>
        ))}
        {coverage.matched.length === 0 ? (
          <span className="text-xs text-ink/45">No direct keyword matches.</span>
        ) : null}
      </div>
    </div>
  );
}

function TailoringConfidencePanel({ items }: { items: TailoringConfidenceItem[] }) {
  return (
    <div className="border border-rule bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Tailoring confidence</h3>
          <p className="mt-1 text-xs text-ink/55">Evidence, risk, and layout checks before export.</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={item.label} className="border border-rule bg-paper px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-ink/60">{item.detail}</p>
              </div>
              <span
                className={cx(
                  "shrink-0 border bg-white px-2 py-1 text-xs font-semibold",
                  item.tone === "sage" && "border-sage text-sage",
                  item.tone === "gold" && "border-gold text-gold",
                  item.tone === "coral" && "border-coral text-coral"
                )}
              >
                {item.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImpactTagRow({ tags }: { tags: EditImpactTag[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.label}
          className={cx(
            "border bg-white px-2 py-1 text-xs font-semibold",
            tag.tone === "sage" && "border-sage text-sage",
            tag.tone === "gold" && "border-gold text-gold",
            tag.tone === "coral" && "border-coral text-coral",
            tag.tone === "ink" && "border-rule text-ink/60"
          )}
        >
          {tag.label}
        </span>
      ))}
    </div>
  );
}

function TailoringPresetsPanel({
  presets,
  presetName,
  onPresetNameChange,
  onApply,
  onSave,
  onDelete
}: {
  presets: TailoringPreset[];
  presetName: string;
  onPresetNameChange: (name: string) => void;
  onApply: (preset: TailoringPreset) => void;
  onSave: () => void;
  onDelete: (presetId: string) => void;
}) {
  return (
    <div className="mt-4 border border-rule bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Reusable tailoring presets</h3>
          <p className="mt-1 text-xs text-ink/55">
            Apply a role focus to project selection, certificate visibility, and skill keyword priority.
          </p>
        </div>
        <div className="flex min-w-[260px] flex-wrap gap-2">
          <input
            value={presetName}
            onChange={(event) => onPresetNameChange(event.target.value)}
            placeholder="Save current as preset"
            className="min-w-0 flex-1 border border-rule bg-white px-3 py-2 text-xs outline-none focus:border-sage"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!presetName.trim()}
            className="border border-sage px-3 py-2 text-xs font-semibold text-sage hover:bg-sage hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save preset
          </button>
        </div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {presets.map((preset) => (
          <article key={preset.id} className="border border-rule bg-paper p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-ink">{preset.name}</h4>
                <p className="mt-1 text-xs leading-5 text-ink/55">{preset.description}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onApply(preset)}
                  className="border border-ink bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink hover:text-white"
                >
                  Apply
                </button>
                {preset.custom ? (
                  <button
                    type="button"
                    onClick={() => onDelete(preset.id)}
                    className="border border-coral bg-white px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {uniqueTerms([...preset.projectKeywords, ...preset.skillKeywords, ...preset.certificateKeywords]).slice(0, 10).map((keyword) => (
                <span key={keyword} className="border border-rule bg-white px-2 py-1 text-xs text-ink/60">
                  {keyword}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function KeywordPriorityControls({
  keywords,
  selected,
  onToggle
}: {
  keywords: string[];
  selected: string[];
  onToggle: (keyword: string) => void;
}) {
  return (
    <div className="mt-4 border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">JD keyword priority</h3>
        <p className="mt-1 text-xs text-ink/55">
          Mark important keywords to weight project ranking and skill order suggestions more heavily.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {keywords.length > 0 ? (
          keywords.map((keyword) => {
            const active = selected.includes(keyword);
            return (
              <button
                key={keyword}
                type="button"
                onClick={() => onToggle(keyword)}
                className={cx(
                  "border px-2 py-1 text-xs font-semibold",
                  active
                    ? "border-sage bg-sage text-white"
                    : "border-rule bg-paper text-ink/70 hover:bg-white"
                )}
              >
                {keyword}
              </button>
            );
          })
        ) : (
          <p className="text-sm text-ink/55">No job keywords detected yet.</p>
        )}
      </div>
    </div>
  );
}

function surfaceRecommendationForEvidence(item: SkillGapFinding["evidence"][number]) {
  if (isProjectSection(item.sectionTitle)) return "Surface as a selected project card or project bullet.";
  if (/experience/i.test(item.sectionTitle)) return "Surface as an experience bullet only if the original bullet supports it.";
  if (isSkillSection(item.sectionTitle)) return "Surface as a skill chip.";
  return "Surface in the matching resume section.";
}

function SkillGapPanel({
  findings,
  onOpenEvidence
}: {
  findings: SkillGapFinding[];
  onOpenEvidence: (item: SkillGapFinding["evidence"][number]) => void;
}) {
  return (
    <div className="mt-4 border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Skill gap editor</h3>
        <p className="mt-1 text-xs text-ink/55">
          Missing job skills are checked against hidden/commented projects and experience bullets.
        </p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        {findings.length > 0 ? (
          findings.map((finding) => (
            <article key={finding.skill} className="border border-rule bg-paper p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-ink">{finding.skill}</h4>
                  <p className={cx("mt-1 text-xs", finding.evidence.length > 0 ? "text-sage" : "text-coral")}>
                    {finding.evidence.length > 0
                      ? "Hidden evidence found. You may be able to surface it truthfully."
                      : "No hidden evidence found. Do not add this as a claim unless the resume supports it."}
                  </p>
                  {finding.evidence[0] ? (
                    <p className="mt-1 text-xs font-semibold text-ink/65">
                      Recommendation: {surfaceRecommendationForEvidence(finding.evidence[0])}
                    </p>
                  ) : null}
                </div>
                <span className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/55">
                  {finding.evidence.length}
                </span>
              </div>
              {finding.evidence.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {finding.evidence.slice(0, 3).map((item) => (
                    <div key={`${item.fileName}-${item.line}-${item.text}`} className="border border-rule bg-white p-2 text-xs text-ink/60">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-ink">
                          {item.sectionTitle} | {item.fileName}:{item.line}
                        </p>
                        <button
                          type="button"
                          onClick={() => onOpenEvidence(item)}
                          className="border border-sage px-2 py-1 font-semibold text-sage hover:bg-sage hover:text-white"
                        >
                          Open evidence
                        </button>
                      </div>
                      <p className="mt-1">{item.text}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="text-sm text-ink/55">No missing required skills detected.</p>
        )}
      </div>
    </div>
  );
}

function ChangeSummaryChecklist({
  projects,
  certificates,
  skillsReordered,
  acceptedSuggestionCount,
  reviewed,
  onReviewedChange
}: {
  projects: string[];
  certificates: string[];
  skillsReordered: boolean;
  acceptedSuggestionCount: number;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
}) {
  return (
    <div className="mb-4 border border-rule bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Change summary before download</h3>
          <p className="mt-1 text-xs text-ink/55">Review the current tailored state before exporting.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-ink/65">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(event) => onReviewedChange(event.target.checked)}
            className="h-4 w-4 accent-sage"
          />
          Summary reviewed
        </label>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <SummaryChecklistItem title="Projects included" ok={projects.length > 0} detail={projects.join(", ") || "None selected"} />
        <SummaryChecklistItem title="Certificates included" ok={certificates.length > 0} detail={certificates.join(", ") || "None selected"} />
        <SummaryChecklistItem title="Skills reordered" ok={skillsReordered} detail={skillsReordered ? "Skill order differs from the loaded original." : "No skill order changes detected."} />
        <SummaryChecklistItem title="AI suggestions accepted" ok={acceptedSuggestionCount > 0} detail={`${acceptedSuggestionCount} accepted or edited suggestions`} />
      </div>
    </div>
  );
}

function PlainEnglishExportWarning({ text, ready }: { text: string; ready: boolean }) {
  return (
    <div className={cx("mb-4 border px-4 py-3", ready ? "border-sage bg-sage/10" : "border-gold bg-gold/10")}>
      <p className={cx("text-xs font-semibold uppercase tracking-[0.18em]", ready ? "text-sage" : "text-gold")}>
        Before export
      </p>
      <p className="mt-2 text-sm leading-6 text-ink">{text}</p>
    </div>
  );
}

function ExportReadinessChecklist({
  ready,
  readiness
}: {
  ready: boolean;
  readiness: {
    bracesValid: boolean;
    noUnsupportedClaims: boolean;
    pdfFitsOnePage: boolean;
    limitsOk: boolean;
    summaryReviewed: boolean;
  };
}) {
  const items = [
    ["Braces valid", readiness.bracesValid],
    ["No unsupported accepted claims", readiness.noUnsupportedClaims],
    ["PDF fits one page", readiness.pdfFitsOnePage],
    ["Project/certificate limits OK", readiness.limitsOk],
    ["Change summary reviewed", readiness.summaryReviewed]
  ] as const;

  return (
    <div className={cx("mb-4 border px-4 py-3", ready ? "border-sage bg-white" : "border-coral bg-paper")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={cx("text-sm font-semibold", ready ? "text-sage" : "text-coral")}>
            {ready ? "Ready to export" : "Not ready to export"}
          </p>
          <p className="mt-1 text-xs text-ink/55">
            This checklist combines source safety, PDF fit, section limits, and final review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map(([label, ok]) => (
            <span
              key={label}
              className={cx(
                "border bg-white px-2 py-1 text-xs font-semibold",
                ok ? "border-sage text-sage" : "border-coral text-coral"
              )}
            >
              {ok ? "Pass" : "Check"}: {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AtsKeywordDeltaPanel({ delta }: { delta: AtsKeywordDelta }) {
  const groupedLocations = delta.locations.reduce((groups, item) => {
    const existing = groups.get(item.keyword) ?? [];
    groups.set(item.keyword, [...existing, item]);
    return groups;
  }, new Map<string, AtsKeywordDelta["locations"]>());

  return (
    <div className="mb-4 border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">ATS keyword delta</h3>
        <p className="mt-1 text-xs text-ink/55">
          Compares the current resume source with the tailored output after accepted changes.
        </p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <ChipGroup title="Keywords gained" values={delta.gained} />
        <ChipGroup title="Still missing" values={delta.stillMissing} danger />
        <div className="border border-rule bg-paper p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Located keywords</p>
          <p className="text-2xl font-semibold text-sage">{groupedLocations.size}</p>
          <p className="mt-1 text-xs text-ink/55">unique job keywords found in tailored source</p>
        </div>
      </div>
      <details className="border-t border-rule bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Where keywords appear</summary>
        <div className="mt-3 max-h-[420px] overflow-auto border border-rule">
          {Array.from(groupedLocations.entries()).map(([keyword, locations]) => (
            <div key={keyword} className="border-b border-rule bg-paper p-3 last:border-b-0">
              <p className="text-sm font-semibold text-ink">{keyword}</p>
              <div className="mt-2 grid gap-2">
                {locations.slice(0, 5).map((item) => (
                  <div key={`${item.fileName}:${item.line}:${item.keyword}`} className="bg-white p-2 text-xs">
                    <p className="font-mono font-semibold text-ink/55">
                      {item.fileName}:{item.line} | {item.sectionTitle}
                    </p>
                    <p className="mt-1 text-ink/65">{item.text}</p>
                  </div>
                ))}
                {locations.length > 5 ? (
                  <p className="text-xs text-ink/45">{locations.length - 5} more locations hidden.</p>
                ) : null}
              </div>
            </div>
          ))}
          {groupedLocations.size === 0 ? (
            <p className="bg-paper p-4 text-sm text-ink/55">No job keywords found in the tailored source yet.</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function NamedSessionsPanel({
  sessionName,
  savedSessions,
  onSessionNameChange,
  onSave,
  onLoad,
  onDelete,
  defaultName
}: {
  sessionName: string;
  savedSessions: SavedTailoringSession[];
  onSessionNameChange: (name: string) => void;
  onSave: () => void;
  onLoad: (session: SavedTailoringSession) => void;
  onDelete: (sessionId: string) => void;
  defaultName: string;
}) {
  return (
    <div className="mb-4 border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Named tailoring sessions</h3>
        <p className="mt-1 text-xs text-ink/55">
          Save job-specific versions locally, like Google SWE Intern or Outlier AI Eval.
        </p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={sessionName}
          onChange={(event) => onSessionNameChange(event.target.value)}
          placeholder={defaultName}
          className="border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-sage"
        />
        <button
          type="button"
          onClick={onSave}
          className="border border-sage px-4 py-2 text-sm font-semibold text-sage hover:bg-sage hover:text-white"
        >
          Save named session
        </button>
      </div>
      <div className="grid gap-2 px-4 pb-4">
        {savedSessions.length > 0 ? (
          savedSessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-paper px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-ink">{session.name}</p>
                <p className="mt-1 text-xs text-ink/50">
                  {[session.company, session.title].filter(Boolean).join(" | ")} saved {new Date(session.savedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onLoad(session)}
                  className="border border-ink px-3 py-1.5 text-xs font-semibold hover:bg-white"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  className="border border-coral px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-ink/55">No named sessions saved yet.</p>
        )}
      </div>
    </div>
  );
}

function ResumeHistoryTimeline({
  entries
}: {
  entries: Array<{
    id: string;
    type: string;
    company: string;
    role: string;
    date: string;
    matchScore?: number;
    selectedProjects: string[];
    pdfPageCount?: number;
  }>;
}) {
  return (
    <div className="mb-4 border border-rule bg-white">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Resume history timeline</h3>
        <p className="mt-1 text-xs text-ink/55">
          Saved and submitted versions with company, role, score, selected projects, and PDF page count.
        </p>
      </div>
      <div className="grid gap-3 p-4">
        {entries.length > 0 ? (
          entries.slice(0, 12).map((entry) => (
            <article key={entry.id} className="border border-rule bg-paper p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sage">{entry.type}</p>
                  <h4 className="mt-1 text-sm font-semibold text-ink">
                    {[entry.company, entry.role].filter(Boolean).join(" | ") || "Untitled resume version"}
                  </h4>
                  <p className="mt-1 text-xs text-ink/55">{new Date(entry.date).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="border border-rule bg-white px-2 py-1 text-ink/60">
                    Match {typeof entry.matchScore === "number" ? `${entry.matchScore}/100` : "not captured"}
                  </span>
                  <span className="border border-rule bg-white px-2 py-1 text-ink/60">
                    PDF {entry.pdfPageCount ? `${entry.pdfPageCount} page${entry.pdfPageCount === 1 ? "" : "s"}` : "not captured"}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-ink/65">
                Projects: {entry.selectedProjects.length > 0 ? entry.selectedProjects.join(", ") : "not captured"}
              </p>
            </article>
          ))
        ) : (
          <div className="border border-rule bg-paper p-4">
            <p className="text-sm font-semibold text-ink">No resume versions tracked yet.</p>
            <p className="mt-1 text-xs leading-5 text-ink/55">
              Save a named session or create an Apply Packet to add the first timeline entry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AutofillKitPanel({
  profile,
  answers,
  followUpTemplates,
  copiedAnswerId,
  jobTitle,
  company,
  onProfileChange,
  onExportProfile,
  onImportProfile,
  onImportTailorTexData,
  onExportAllData,
  localStoreStatus,
  onCopy
}: {
  profile: AutofillProfile;
  answers: GeneratedApplicationAnswer[];
  followUpTemplates: GeneratedApplicationAnswer[];
  copiedAnswerId: string | null;
  jobTitle: string;
  company: string;
  onProfileChange: (field: keyof AutofillProfile, value: string) => void;
  onExportProfile: () => void;
  onImportProfile: (file: File) => void;
  onImportTailorTexData: (file: File) => void;
  onExportAllData: () => void;
  localStoreStatus: LocalStoreStatus;
  onCopy: (id: string, value: string) => void;
}) {
  const profileImportInputRef = useRef<HTMLInputElement | null>(null);
  const tailortexImportInputRef = useRef<HTMLInputElement | null>(null);
  const profileFields: Array<{ key: keyof AutofillProfile; label: string; multiline?: boolean }> = [
    { key: "fullName", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "location", label: "Location" },
    { key: "linkedIn", label: "LinkedIn" },
    { key: "github", label: "GitHub" },
    { key: "portfolio", label: "Portfolio" },
    { key: "workAuthorization", label: "Work authorization" },
    { key: "sponsorship", label: "Sponsorship answer" },
    { key: "graduationDate", label: "Graduation date" },
    { key: "preferredJobTitles", label: "Preferred job titles", multiline: true },
    { key: "eeoAnswers", label: "Standard EEO answers", multiline: true },
    { key: "shortBio", label: "Short bio / tell us about yourself", multiline: true }
  ];

  return (
    <div className="space-y-4">
      <AdvancedDetails
        title="Storage health and backup/import tools"
        description="Open this when you want to inspect local sync, restore data, or export backups."
      >
        <div className="grid gap-3 border-b border-rule pb-4 md:grid-cols-4">
          <StorageHealthItem
            title="Local file"
            value={localStoreStatus.path ?? "data/tailortex.local.json"}
            ok={localStoreStatus.state === "file"}
          />
          <StorageHealthItem
            title="Last synced"
            value={
              localStoreStatus.lastSyncedAt
                ? new Date(localStoreStatus.lastSyncedAt).toLocaleString()
                : localStoreStatus.state === "checking"
                  ? "Checking"
                  : "Not synced yet"
            }
            ok={localStoreStatus.state === "file"}
          />
          <StorageHealthItem
            title="Browser fallback"
            value={localStoreStatus.browserFallbackActive ? "Active" : "Not active"}
            ok={localStoreStatus.browserFallbackActive}
          />
          <StorageHealthItem
            title="Backup JSON"
            value={localStoreStatus.backupJsonAvailable ? "Export available" : "Unavailable"}
            ok={localStoreStatus.backupJsonAvailable}
          />
        </div>
        <p className="border-b border-rule py-3 text-xs leading-5 text-ink/60">{localStoreStatus.message}</p>
        <div className="flex flex-wrap gap-2 pt-4">
          <button
            type="button"
            onClick={() => tailortexImportInputRef.current?.click()}
            className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Import TailorTeX local JSON
          </button>
          <button
            type="button"
            onClick={onExportProfile}
            className="border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
          >
            Export profile JSON
          </button>
          <button
            type="button"
            onClick={() => profileImportInputRef.current?.click()}
            className="border border-sage px-4 py-2 text-sm font-semibold text-sage hover:bg-sage hover:text-white"
          >
            Import profile JSON
          </button>
          <button
            type="button"
            onClick={onExportAllData}
            className="border border-gold px-4 py-2 text-sm font-semibold text-gold hover:bg-gold hover:text-white"
          >
            Export all TailorTeX data JSON
          </button>
          <input
            ref={profileImportInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImportProfile(file);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={tailortexImportInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImportTailorTexData(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </AdvancedDetails>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="border border-rule bg-white">
        <div className="border-b border-rule bg-paper px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Profile autofill vault</h3>
          <p className="mt-1 text-xs text-ink/55">
            Saved locally in this browser. Use copy buttons for application forms.
          </p>
        </div>
        <div className="grid gap-3 p-4">
          {profileFields.map((field) => (
            <label key={field.key} className="block text-sm font-semibold text-ink">
              <span className="mb-1 flex items-center justify-between gap-2">
                <span>{field.label}</span>
                {profile[field.key] ? (
                  <button
                    type="button"
                    onClick={() => onCopy(`profile-${field.key}`, profile[field.key])}
                    className="border border-rule px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
                  >
                    {copiedAnswerId === `profile-${field.key}` ? "Copied" : "Copy"}
                  </button>
                ) : null}
              </span>
              {field.multiline ? (
                <textarea
                  value={profile[field.key]}
                  onChange={(event) => onProfileChange(field.key, event.target.value)}
                  rows={field.key === "shortBio" ? 4 : 3}
                  className="w-full resize-y border border-rule bg-paper p-3 text-sm font-normal leading-6 outline-none focus:border-sage"
                />
              ) : (
                <input
                  value={profile[field.key]}
                  onChange={(event) => onProfileChange(field.key, event.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm font-normal outline-none focus:border-sage"
                />
              )}
            </label>
          ))}
        </div>
        </section>

        <div className="space-y-4">
          <section className="border border-rule bg-white">
          <div className="border-b border-rule bg-paper px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Job-specific answers</h3>
            <p className="mt-1 text-xs text-ink/55">
              Generated for {[company, jobTitle].filter(Boolean).join(" | ") || "the current job"} from your resume and job description.
            </p>
          </div>
          <div className="grid gap-3 p-4">
            {answers.map((answer) => (
              <article key={answer.id} className="border border-rule bg-paper p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-ink">{answer.label}</h4>
                  <button
                    type="button"
                    onClick={() => onCopy(answer.id, answer.value)}
                    className="border border-sage bg-white px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
                  >
                    {copiedAnswerId === answer.id ? "Copied" : "Copy answer"}
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink/70">{answer.value}</p>
              </article>
            ))}
          </div>
          </section>

          <section className="border border-rule bg-white">
            <div className="border-b border-rule bg-paper px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Application follow-up templates</h3>
              <p className="mt-1 text-xs text-ink/55">
                Copy-ready messages for after applying, interviewing, or asking for a referral.
              </p>
            </div>
            <div className="grid gap-3 p-4">
              {followUpTemplates.map((template) => (
                <article key={template.id} className="border border-rule bg-paper p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-ink">{template.label}</h4>
                    <button
                      type="button"
                      onClick={() => onCopy(template.id, template.value)}
                      className="border border-sage bg-white px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
                    >
                      {copiedAnswerId === template.id ? "Copied" : "Copy template"}
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink/70">{template.value}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function emptyBackendApplicationDraft(currentJob: {
  company: string;
  jobTitle: string;
  jobUrl: string;
  jobDescription: string;
  resumeUsed: string;
}): BackendApplicationDraft {
  return {
    company: currentJob.company,
    jobTitle: currentJob.jobTitle,
    jobUrl: currentJob.jobUrl,
    source: "",
    location: "",
    jobDescription: currentJob.jobDescription,
    status: "SAVED",
    notes: "",
    resumeUsed: currentJob.resumeUsed
  };
}

function draftFromApplication(application: JobApplication): BackendApplicationDraft {
  return {
    company: application.company,
    jobTitle: application.jobTitle,
    jobUrl: application.jobUrl ?? "",
    source: application.source ?? "",
    location: application.location ?? "",
    jobDescription: application.jobDescription,
    status: application.status,
    notes: application.notes ?? "",
    resumeUsed: application.resumeUsed ?? ""
  };
}

function BackendApplicationTrackerPanel({
  applications,
  status,
  statusFilter,
  currentJob,
  onStatusFilterChange,
  onRefresh,
  onSave,
  onOpen
}: {
  applications: JobApplication[];
  status: { state: "idle" | "loading" | "saving" | "error"; message: string };
  statusFilter: ApplicationStatus | "all";
  currentJob: {
    company: string;
    jobTitle: string;
    jobUrl: string;
    jobDescription: string;
    resumeUsed: string;
  };
  onStatusFilterChange: (status: ApplicationStatus | "all") => void;
  onRefresh: () => void;
  onSave: (draft: BackendApplicationDraft, id?: string) => void;
  onOpen: (application: JobApplication) => void;
}) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState<BackendApplicationDraft>(() => emptyBackendApplicationDraft(currentJob));
  const isSaving = status.state === "saving";

  function updateDraft(field: keyof BackendApplicationDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startCreateFromStudio() {
    setEditingId(undefined);
    setDraft(emptyBackendApplicationDraft(currentJob));
  }

  function startEdit(application: JobApplication) {
    setEditingId(application.id);
    setDraft(draftFromApplication(application));
  }

  return (
    <div className="space-y-4">
      <div className="border border-rule bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">ApplyFlow backend tracker</h3>
            <p className="mt-1 text-xs text-ink/55">
              Java backend mode is active. Applications are loaded from Spring Boot.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="border border-rule bg-white px-3 py-2 text-xs font-semibold text-ink/70 hover:bg-paper"
          >
            Refresh
          </button>
        </div>
        {status.message ? (
          <div className={cx("border-b border-rule px-4 py-2 text-sm", status.state === "error" ? "bg-coral/10 text-coral" : "bg-white text-ink/60")}>
            {status.message}
          </div>
        ) : null}
        <form
          className="grid gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft, editingId);
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <BackendTextField label="Company" value={draft.company} onChange={(value) => updateDraft("company", value)} required />
            <BackendTextField label="Job title" value={draft.jobTitle} onChange={(value) => updateDraft("jobTitle", value)} required />
            <BackendTextField label="Job URL" value={draft.jobUrl} onChange={(value) => updateDraft("jobUrl", value)} />
            <BackendTextField label="Source" value={draft.source} onChange={(value) => updateDraft("source", value)} />
            <BackendTextField label="Location" value={draft.location} onChange={(value) => updateDraft("location", value)} />
            <BackendTextField label="Resume used" value={draft.resumeUsed} onChange={(value) => updateDraft("resumeUsed", value)} />
            <label className="block text-sm font-semibold text-ink">
              <span className="mb-1 block">Status</span>
              <select
                value={draft.status}
                onChange={(event) => updateDraft("status", event.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm font-normal outline-none focus:border-sage"
              >
                {backendApplicationStatuses.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <BackendTextArea label="Job description" value={draft.jobDescription} onChange={(value) => updateDraft("jobDescription", value)} required />
          <BackendTextArea label="Notes" value={draft.notes} onChange={(value) => updateDraft("notes", value)} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {editingId ? "Update application" : "Create application"}
            </button>
            <button
              type="button"
              onClick={startCreateFromStudio}
              className="border border-rule bg-white px-4 py-2 text-sm font-semibold text-ink/70 hover:bg-paper"
            >
              Use current studio job
            </button>
          </div>
        </form>
      </div>

      <div className="border border-rule bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Job applications</h3>
            <p className="mt-1 text-xs text-ink/55">Showing {applications.length} backend application{applications.length === 1 ? "" : "s"}.</p>
          </div>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Status filter
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as ApplicationStatus | "all")}
              className="ml-2 border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink"
            >
              <option value="all">All</option>
              {backendApplicationStatuses.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 p-4">
          {applications.length > 0 ? (
            applications.map((application) => (
              <article key={application.id} className="border border-rule bg-paper p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sage">{application.status}</p>
                    <h4 className="mt-1 text-sm font-semibold text-ink">
                      {application.company} | {application.jobTitle}
                    </h4>
                    <p className="mt-1 text-xs text-ink/55">
                      {[application.source, application.location, application.resumeUsed].filter(Boolean).join(" | ") || "No source, location, or resume recorded"}
                    </p>
                    {application.jobUrl ? (
                      <a href={application.jobUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs font-semibold text-sage underline-offset-2 hover:underline">
                        {application.jobUrl}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onOpen(application)} className="border border-ink bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper">
                      Open in studio
                    </button>
                    <button type="button" onClick={() => startEdit(application)} className="border border-sage bg-white px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white">
                      Edit
                    </button>
                  </div>
                </div>
                {application.notes ? (
                  <p className="mt-3 border border-rule bg-white p-3 text-sm leading-6 text-ink/70">{application.notes}</p>
                ) : null}
              </article>
            ))
          ) : (
            <div className="border border-rule bg-paper p-4">
              <p className="text-sm font-semibold text-ink">No backend applications found.</p>
              <p className="mt-1 text-xs leading-5 text-ink/55">
                Create one above or change the status filter.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackendTextField({
  label,
  value,
  onChange,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-ink">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="w-full border border-rule bg-paper px-3 py-2 text-sm font-normal outline-none focus:border-sage"
      />
    </label>
  );
}

function BackendTextArea({
  label,
  value,
  onChange,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-ink">
      <span className="mb-1 block">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="min-h-[120px] w-full resize-y border border-rule bg-paper p-3 text-sm font-normal outline-none focus:border-sage"
      />
    </label>
  );
}

function ApplicationTrackerPanel({
  records,
  notes,
  status,
  jobTitle,
  company,
  jobUrl,
  matchScore,
  submittedFileName,
  includedProjects,
  includedCertificates,
  matchedSkills,
  missingRequirements,
  jobDescription,
  generatedAnswers,
  copiedAnswerId,
  duplicateRecord,
  densityMode,
  onNotesChange,
  onStatusChange,
  onSave,
  onApplyPacket,
  onLoad,
  onDownload,
  onDownloadCurrentPacket,
  onDownloadRecordPacket,
  onCopy,
  onUpdate,
  onDelete
}: {
  records: ApplicationRecord[];
  notes: string;
  status: ApplicationRecord["status"];
  jobTitle: string;
  company: string;
  jobUrl: string;
  matchScore: number;
  submittedFileName: string;
  includedProjects: string[];
  includedCertificates: string[];
  matchedSkills: string[];
  missingRequirements: string[];
  jobDescription: string;
  generatedAnswers: GeneratedApplicationAnswer[];
  copiedAnswerId: string | null;
  duplicateRecord?: ApplicationRecord;
  densityMode: DensityMode;
  onNotesChange: (notes: string) => void;
  onStatusChange: (status: ApplicationRecord["status"]) => void;
  onSave: () => void;
  onApplyPacket: () => void;
  onLoad: (record: ApplicationRecord) => void;
  onDownload: (record: ApplicationRecord) => void;
  onDownloadCurrentPacket: () => void;
  onDownloadRecordPacket: (record: ApplicationRecord) => void;
  onCopy: (id: string, value: string) => void;
  onUpdate: (recordId: string, patch: Partial<ApplicationRecord>) => void;
  onDelete: (recordId: string) => void;
}) {
  const [quickFilter, setQuickFilter] = useState<ApplicationQuickFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ApplicationRecord["status"] | "all">("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [minimumMatchScore, setMinimumMatchScore] = useState("");
  const [appliedFromDate, setAppliedFromDate] = useState("");
  const [appliedToDate, setAppliedToDate] = useState("");
  const weekStart = startOfCurrentWeek();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayEndTime = todayEnd.getTime();
  const isAppliedThisWeek = (record: ApplicationRecord) => {
    const appliedTime = dateInputToTime(applicationAppliedDate(record));
    return Number.isFinite(appliedTime) && appliedTime >= weekStart && appliedTime <= todayEndTime;
  };
  const isFollowUpDue = (record: ApplicationRecord) => {
    const followUpTime = dateInputToTime(record.followUpDate);
    return (
      Number.isFinite(followUpTime) &&
      followUpTime <= todayEndTime &&
      record.status !== "rejected" &&
      record.status !== "offer"
    );
  };
  const appliedThisWeek = records.filter((record) => {
    return isAppliedThisWeek(record);
  }).length;
  const followUpsDue = records.filter(isFollowUpDue).length;
  const interviewCount = records.filter((record) => record.status === "interview" || Boolean(record.interviewAt)).length;
  const bestMatchScore = records.reduce((best, record) => Math.max(best, record.matchScore), 0);
  const draftCount = records.filter((record) => record.status === "draft").length;
  const filteredRecords = records.filter((record) => {
    const appliedDate = dateInputValue(applicationAppliedDate(record));
    const minimumScore = Number(minimumMatchScore);
    const matchesQuickFilter =
      quickFilter === "all" ||
      (quickFilter === "follow-up" && isFollowUpDue(record)) ||
      (quickFilter === "interviews" && (record.status === "interview" || Boolean(record.interviewAt))) ||
      (quickFilter === "high-match" && record.matchScore >= 80) ||
      (quickFilter === "drafts" && record.status === "draft") ||
      (quickFilter === "applied-week" && isAppliedThisWeek(record));

    return (
      matchesQuickFilter &&
      (statusFilter === "all" || record.status === statusFilter) &&
      record.job.company.toLowerCase().includes(companyFilter.trim().toLowerCase()) &&
      record.job.title.toLowerCase().includes(roleFilter.trim().toLowerCase()) &&
      (!minimumMatchScore || Number.isNaN(minimumScore) || record.matchScore >= minimumScore) &&
      (!appliedFromDate || (appliedDate && appliedDate >= appliedFromDate)) &&
      (!appliedToDate || (appliedDate && appliedDate <= appliedToDate))
    );
  });
  const compact = densityMode === "compact";

  return (
    <div className="space-y-4">
      <div className="border border-rule bg-white">
        <div className="border-b border-rule bg-paper px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Save current application</h3>
          <p className="mt-1 text-xs text-ink/55">
            Track the job details, match score, and exact tailored resume files submitted.
          </p>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <SummaryChecklistItem title="Company" ok={Boolean(company)} detail={company || "No company entered"} />
              <SummaryChecklistItem title="Role" ok={Boolean(jobTitle)} detail={jobTitle || "No title entered"} />
              <SummaryChecklistItem title="Match score" ok={matchScore >= 60} detail={`${matchScore}/100`} />
              <SummaryChecklistItem title="Submitted resume" ok detail={submittedFileName} />
            </div>
            {jobUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <a href={jobUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-sage underline-offset-2 hover:underline">
                  {jobUrl}
                </a>
                <button
                  type="button"
                  onClick={() => onCopy("current-job-url", jobUrl)}
                  className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
                >
                  {copiedAnswerId === "current-job-url" ? "Copied" : "Copy URL"}
                </button>
              </div>
            ) : null}
            {duplicateRecord ? (
              <div className="border border-gold bg-gold/10 p-3 text-sm text-ink">
                <p className="font-semibold">Already tracked</p>
                <p className="mt-1 text-xs leading-5 text-ink/65">
                  A saved application for this company, role, and URL already exists from{" "}
                  {new Date(duplicateRecord.savedAt).toLocaleString()} with status {duplicateRecord.status}.
                  Save again only if this is a new version or resubmission.
                </p>
              </div>
            ) : null}
            <details className="border border-rule bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Job description saved with this record</summary>
              <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink/65">
                {jobDescription}
              </pre>
            </details>
            <textarea
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Notes: date applied, referral, portal used, version details, follow-up reminder..."
              className="min-h-[120px] w-full resize-y border border-rule bg-paper p-3 text-sm outline-none focus:border-sage"
            />
            <div className="grid gap-2">
              {generatedAnswers.map((answer) => (
                <div key={answer.id} className="border border-rule bg-paper p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{answer.label}</p>
                    <button
                      type="button"
                      onClick={() => onCopy(`current-${answer.id}`, answer.value)}
                      className="border border-sage bg-white px-2 py-1 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
                    >
                      {copiedAnswerId === `current-${answer.id}` ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink/65">{answer.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
              Status
              <select
                value={status}
                onChange={(event) => onStatusChange(event.target.value as ApplicationRecord["status"])}
                className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink"
              >
                <option value="draft">Draft</option>
                <option value="applied">Applied</option>
                <option value="interview">Interview</option>
                <option value="rejected">Rejected</option>
                <option value="offer">Offer</option>
              </select>
            </label>
            <button
              type="button"
              onClick={onApplyPacket}
              className="w-full border border-gold bg-gold px-4 py-2 text-sm font-semibold text-white"
            >
              Apply Packet
            </button>
            <p className="-mt-2 text-xs leading-5 text-ink/55">
              Downloads the tailored resume ZIP and application packet ZIP, then saves this tracker record as Applied.
            </p>
            <button
              type="button"
              onClick={onSave}
              className="w-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white"
            >
              Save application record
            </button>
            <button
              type="button"
              onClick={onDownloadCurrentPacket}
              className="w-full border border-gold px-4 py-2 text-sm font-semibold text-gold hover:bg-gold hover:text-white"
            >
              Download application packet
            </button>
            <button
              type="button"
              onClick={() => onCopy("current-submitted-file", submittedFileName)}
              className="w-full border border-rule px-4 py-2 text-sm font-semibold hover:bg-paper"
            >
              {copiedAnswerId === "current-submitted-file" ? "Copied" : "Copy submitted filename"}
            </button>
            <ChipGroup title="Matched skills" values={matchedSkills.slice(0, 8)} />
            <ChipGroup title="Missing requirements" values={missingRequirements.slice(0, 8)} danger />
          </div>
        </div>
      </div>

      <div className="border border-rule bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Saved applications</h3>
            <p className="mt-1 text-xs text-ink/55">
              Showing {filteredRecords.length} of {records.length} tracked records
            </p>
          </div>
        </div>
        <div className="grid gap-3 border-b border-rule p-4 md:grid-cols-5">
          <ApplicationDashboardCard title="Applied this week" value={appliedThisWeek.toString()} tone="sage" />
          <ApplicationDashboardCard title="Follow-ups due" value={followUpsDue.toString()} tone={followUpsDue > 0 ? "coral" : "sage"} />
          <ApplicationDashboardCard title="Interviews" value={interviewCount.toString()} tone="gold" />
          <ApplicationDashboardCard title="Best match score" value={records.length > 0 ? `${bestMatchScore}/100` : "-"} tone="sage" />
          <ApplicationDashboardCard title="Drafts not submitted" value={draftCount.toString()} tone={draftCount > 0 ? "gold" : "sage"} />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-rule p-4">
          {[
            { id: "all", label: "All" },
            { id: "follow-up", label: "Needs follow-up" },
            { id: "interviews", label: "Interviews" },
            { id: "high-match", label: "High match" },
            { id: "drafts", label: "Drafts" },
            { id: "applied-week", label: "Applied this week" }
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setQuickFilter(filter.id as ApplicationQuickFilter)}
              className={cx(
                "border px-3 py-1.5 text-xs font-semibold",
                quickFilter === filter.id
                  ? "border-ink bg-ink text-white"
                  : "border-rule bg-white text-ink/65 hover:bg-paper"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 border-b border-rule p-4 lg:grid-cols-6">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ApplicationRecord["status"] | "all")}
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink"
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="applied">Applied</option>
              <option value="interview">Interview</option>
              <option value="rejected">Rejected</option>
              <option value="offer">Offer</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Company
            <input
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              placeholder="Search company"
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Role
            <input
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              placeholder="Search role"
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Min match
            <input
              type="number"
              min="0"
              max="100"
              value={minimumMatchScore}
              onChange={(event) => setMinimumMatchScore(event.target.value)}
              placeholder="0"
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Applied from
            <input
              type="date"
              value={appliedFromDate}
              onChange={(event) => setAppliedFromDate(event.target.value)}
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Applied to
            <input
              type="date"
              value={appliedToDate}
              onChange={(event) => setAppliedToDate(event.target.value)}
              className="mt-1 block w-full border border-rule bg-white px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
            />
          </label>
        </div>
        <div className="grid gap-3 p-4">
          {filteredRecords.length > 0 ? (
            filteredRecords.map((record) => (
              <article
                key={record.id}
                className={cx(
                  "border",
                  compact ? "p-2" : "p-3",
                  isFollowUpDue(record) ? "border-coral bg-coral/10" : "border-rule bg-paper"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sage">{record.status}</p>
                    <h4 className="mt-1 text-sm font-semibold text-ink">
                      {record.job.company} | {record.job.title}
                    </h4>
                    <p className="mt-1 text-xs text-ink/55">
                      Saved {new Date(record.savedAt).toLocaleString()} | Match {record.matchScore}/100 | {record.submittedFileName}
                    </p>
                    {record.resumeVersionLabel ? (
                      <p className="mt-1 text-xs font-semibold text-ink/60">
                        Version: {record.resumeVersionLabel}
                      </p>
                    ) : null}
                    {record.job.url ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a href={record.job.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs font-semibold text-sage underline-offset-2 hover:underline">
                          {record.job.url}
                        </a>
                        <button
                          type="button"
                          onClick={() => onCopy(`record-url-${record.id}`, record.job.url)}
                          className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
                        >
                          {copiedAnswerId === `record-url-${record.id}` ? "Copied" : "Copy URL"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onLoad(record)} className="border border-ink bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper">
                      Load resume
                    </button>
                    <button type="button" onClick={() => onDownload(record)} className="border border-sage bg-white px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white">
                      Download submitted
                    </button>
                    <button type="button" onClick={() => onDownloadRecordPacket(record)} className="border border-gold bg-white px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold hover:text-white">
                      Download packet
                    </button>
                    <button type="button" onClick={() => onCopy(`record-file-${record.id}`, record.submittedFileName)} className="border border-rule bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper">
                      {copiedAnswerId === `record-file-${record.id}` ? "Copied" : "Copy filename"}
                    </button>
                    <button type="button" onClick={() => onDelete(record.id)} className="border border-coral bg-white px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white">
                      Delete
                    </button>
                  </div>
                </div>
                {isFollowUpDue(record) ? (
                  <div className="mt-3 border border-coral bg-white px-3 py-2 text-xs font-semibold text-coral">
                    Follow-up due {formatApplicationDate(record.followUpDate)}.
                  </div>
                ) : null}
                <div className={cx("grid gap-3 lg:grid-cols-2", compact ? "mt-2" : "mt-3")}>
                  <SummaryChecklistItem title="Projects included" ok={record.includedProjects.length > 0} detail={record.includedProjects.join(", ") || "None"} />
                  <SummaryChecklistItem title="Certificates included" ok={record.includedCertificates.length > 0} detail={record.includedCertificates.join(", ") || "None"} />
                </div>
                <ApplicationTimeline
                  record={record}
                  onUpdate={(patch) => onUpdate(record.id, patch)}
                />
                {!compact && record.notes ? (
                  <p className="mt-3 border border-rule bg-white p-3 text-sm leading-6 text-ink/70">{record.notes}</p>
                ) : null}
                {!compact && (record.generatedAnswers?.length ?? 0) > 0 ? (
                  <details className="mt-3 border border-rule bg-white p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-ink/65">Saved generated answers</summary>
                    <div className="mt-3 grid gap-2">
                      {record.generatedAnswers?.map((answer) => (
                        <div key={answer.id} className="border border-rule bg-paper p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-ink">{answer.label}</p>
                            <button
                              type="button"
                              onClick={() => onCopy(`record-${record.id}-${answer.id}`, answer.value)}
                              className="border border-sage bg-white px-2 py-1 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
                            >
                              {copiedAnswerId === `record-${record.id}-${answer.id}` ? "Copied" : "Copy"}
                            </button>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-ink/65">{answer.value}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                <details className={cx("border border-rule bg-white p-3", compact ? "mt-2" : "mt-3")}>
                  <summary className="cursor-pointer text-xs font-semibold text-ink/65">Saved job description</summary>
                  <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-ink/65">
                    {record.job.description}
                  </pre>
                </details>
              </article>
            ))
          ) : (
            records.length > 0 ? (
              <p className="text-sm text-ink/55">No saved applications match the current filters.</p>
            ) : (
              <div className="border border-rule bg-paper p-4">
                <p className="text-sm font-semibold text-ink">Create an Apply Packet to add your first tracked application.</p>
                <p className="mt-1 text-xs leading-5 text-ink/55">
                  It will save the job, tailored resume ZIP, generated answers, and tracker status together.
                </p>
                <button
                  type="button"
                  onClick={onApplyPacket}
                  className="mt-3 border border-gold bg-gold px-4 py-2 text-sm font-semibold text-white"
                >
                  Apply Packet
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryChecklistItem({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <div className="border border-rule bg-paper p-3">
      <p className={cx("text-xs font-semibold uppercase tracking-[0.18em]", ok ? "text-sage" : "text-ink/45")}>
        {ok ? "Included" : "No change"}
      </p>
      <h4 className="mt-1 text-sm font-semibold text-ink">{title}</h4>
      <p className="mt-1 text-xs text-ink/60">{detail}</p>
    </div>
  );
}

function ApplicationDashboardCard({
  title,
  value,
  tone
}: {
  title: string;
  value: string;
  tone: "sage" | "gold" | "coral";
}) {
  const toneClass = {
    sage: "text-sage",
    gold: "text-gold",
    coral: "text-coral"
  }[tone];

  return (
    <div className="border border-rule bg-paper p-3">
      <p className={cx("text-2xl font-semibold", toneClass)}>{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink/50">{title}</p>
    </div>
  );
}

function ApplicationTimeline({
  record,
  onUpdate
}: {
  record: ApplicationRecord;
  onUpdate: (patch: Partial<ApplicationRecord>) => void;
}) {
  const timelineItems = [
    { label: "Saved", value: formatApplicationDate(record.savedAt), complete: true },
    { label: "Applied", value: formatApplicationDate(applicationAppliedDate(record)), complete: Boolean(applicationAppliedDate(record)) },
    { label: "Follow-up", value: formatApplicationDate(record.followUpDate), complete: Boolean(record.followUpDate) },
    { label: "Interview", value: formatApplicationDate(record.interviewAt), complete: Boolean(record.interviewAt) },
    {
      label: "Rejection / offer",
      value:
        record.status === "rejected" || record.status === "offer"
          ? `${record.status === "offer" ? "Offer" : "Rejected"}${record.decisionAt ? ` on ${formatApplicationDate(record.decisionAt)}` : ""}`
          : formatApplicationDate(record.decisionAt),
      complete: record.status === "rejected" || record.status === "offer" || Boolean(record.decisionAt)
    }
  ];

  return (
    <details className="mt-3 border border-rule bg-white p-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink/65">Application timeline</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="grid gap-2 md:grid-cols-5">
          {timelineItems.map((item) => (
            <div key={item.label} className="border border-rule bg-paper p-2">
              <p className={cx("text-[11px] font-semibold uppercase tracking-[0.16em]", item.complete ? "text-sage" : "text-ink/40")}>
                {item.complete ? "Tracked" : "Pending"}
              </p>
              <p className="mt-1 text-xs font-semibold text-ink">{item.label}</p>
              <p className="mt-1 text-xs text-ink/55">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
            Status
            <select
              value={record.status}
              onChange={(event) => onUpdate({ status: event.target.value as ApplicationRecord["status"] })}
              className="mt-1 block w-full border border-rule bg-paper px-2 py-2 text-sm normal-case tracking-normal text-ink"
            >
              <option value="draft">Draft</option>
              <option value="applied">Applied</option>
              <option value="interview">Interview</option>
              <option value="rejected">Rejected</option>
              <option value="offer">Offer</option>
            </select>
          </label>
          <TimelineDateInput
            label="Applied"
            value={record.appliedAt}
            onChange={(value) => onUpdate({ appliedAt: value || undefined })}
          />
          <TimelineDateInput
            label="Follow-up"
            value={record.followUpDate}
            onChange={(value) => onUpdate({ followUpDate: value || undefined })}
          />
          <TimelineDateInput
            label="Interview"
            value={record.interviewAt}
            onChange={(value) => onUpdate({ interviewAt: value || undefined })}
          />
          <TimelineDateInput
            label="Decision"
            value={record.decisionAt}
            onChange={(value) => onUpdate({ decisionAt: value || undefined })}
          />
        </div>
      </div>
    </details>
  );
}

function TimelineDateInput({
  label,
  value,
  onChange
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">
      {label}
      <input
        type="date"
        value={dateInputValue(value)}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full border border-rule bg-paper px-2 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-sage"
      />
    </label>
  );
}

function StorageHealthItem({ title, value, ok }: { title: string; value: string; ok: boolean }) {
  return (
    <div className="border border-rule bg-paper p-3">
      <p className={cx("text-xs font-semibold uppercase tracking-[0.18em]", ok ? "text-sage" : "text-ink/45")}>
        {title}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function ProjectRecommendationCard({
  recommendation,
  rank
}: {
  recommendation: ProjectRecommendation;
  rank: number;
}) {
  return (
    <article className="border border-rule bg-paper p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage">Rank {rank}</p>
          <h4 className="mt-1 text-sm font-semibold text-ink">{recommendation.title}</h4>
          <p className="mt-1 text-xs text-ink/55">{recommendation.reason}</p>
        </div>
        <span className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60">
          {recommendation.score}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {recommendation.matchedKeywords.slice(0, 8).map((keyword) => (
          <span key={keyword} className="border border-gold bg-white px-2 py-1 text-xs text-gold">
            {keyword}
          </span>
        ))}
        {recommendation.matchedKeywords.length === 0 ? (
          <span className="text-xs text-ink/45">Review manually before including.</span>
        ) : null}
      </div>
      {recommendation.evidence.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-rule pt-3">
          {recommendation.evidence.slice(0, 3).map((item, index) => (
            <div key={`${item.keyword}-${item.source}-${index}`} className="text-xs text-ink/60">
              <span className="font-semibold text-ink">{item.keyword}</span>
              <span> matched in {item.source}: </span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function OnePageOptimizerPanel({
  items,
  pdfState,
  pageCount,
  className
}: {
  items: OptimizerItem[];
  pdfState: "unknown" | "stale" | "fits" | "overflow";
  pageCount?: number;
  className?: string;
}) {
  const headline =
    pdfState === "overflow"
      ? `PDF spills to ${pageCount} pages. Try these first.`
      : pdfState === "fits"
        ? "PDF currently fits. Keep this list handy if edits spill to another page."
        : pdfState === "stale"
          ? "PDF fit check is stale. These are likely first cuts if it spills."
          : "Compile the PDF to confirm page fit. These are likely first cuts.";

  return (
    <div className={cx("border border-rule bg-white", className)}>
      <div className="border-b border-rule bg-paper px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">One-page optimizer</h3>
        <p className="mt-1 text-xs text-ink/55">{headline}</p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {items.slice(0, 5).map((item, index) => (
          <article key={`${item.title}-${index}`} className="border border-rule bg-paper p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sage">
              Step {index + 1}
            </p>
            <h4 className="mt-1 text-sm font-semibold text-ink">{item.title}</h4>
            <p className="mt-2 text-xs text-ink/55">{item.reason}</p>
            <p className="mt-2 text-xs text-ink/70">{item.action}</p>
          </article>
        ))}
        {items.length === 0 ? (
          <p className="text-sm text-ink/55">No obvious cuts detected yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function PdfPreviewFrame({
  title,
  preview,
  focusCue,
  emptyText
}: {
  title: string;
  preview: PdfPreview | null;
  focusCue?: PdfFocusCue | null;
  emptyText: string;
}) {
  const bandPosition =
    focusCue?.kind === "Experience"
      ? "top-[18%]"
      : focusCue?.estimatedPage && focusCue.estimatedPage > 1
        ? "top-[58%]"
        : "top-[44%]";

  return (
    <div className={cx("border bg-white", focusCue ? "border-gold shadow-[0_0_0_2px_rgba(184,134,11,0.14)]" : "border-rule")}>
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-paper px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-xs font-semibold text-ink/45">
          {preview?.pageCount ? `${preview.pageCount} page${preview.pageCount === 1 ? "" : "s"}` : "No page count"}
        </span>
      </div>
      {focusCue ? (
        <div className="border-b border-gold bg-gold/10 px-3 py-2 text-xs text-ink">
          <span className="font-semibold text-gold">Likely page {focusCue.estimatedPage}</span>
          <span className="text-ink/55"> | {focusCue.kind} | {focusCue.title}</span>
        </div>
      ) : null}
      <div className="relative h-[720px] overflow-hidden bg-paper">
        {preview ? (
          <>
            <object
              data={preview.url}
              type="application/pdf"
              title={preview.name}
              className="h-full w-full bg-white"
            >
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink/65">
                <p>This browser did not render the PDF inline.</p>
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-ink px-4 py-2 font-semibold text-ink hover:bg-white"
                >
                  Open preview in new tab
                </a>
              </div>
            </object>
            {focusCue ? (
              <div
                className={cx(
                  "pointer-events-none absolute left-6 right-6 h-20 border-2 border-gold bg-gold/10 shadow-[0_0_28px_rgba(184,134,11,0.22)]",
                  bandPosition
                )}
              />
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink/55">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfFocusCuePanel({ cue, onClear }: { cue: PdfFocusCue; onClear: () => void }) {
  return (
    <div className="mt-3 border border-gold bg-gold/10 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">PDF highlight</p>
          <p className="mt-1 font-semibold text-ink">
            {cue.kind}: {cue.title}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink/60">
            Likely appears on page {cue.estimatedPage}, estimated from {cue.fileName}:{cue.line}.
            {cue.subtitle ? ` ${cue.subtitle}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="border border-gold bg-white px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold hover:text-white"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function CompileErrorPanel({
  details,
  onOpenLocation
}: {
  details: CompileErrorDetails;
  onOpenLocation: (target: CompileLocation) => void;
}) {
  const hasLocation = Boolean(details.fileName && details.line);
  const fileName = details.fileName ?? "";
  const line = details.line ?? 1;

  return (
    <div className="mt-3 border border-coral bg-paper p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-coral">Compile error</p>
          <p className="mt-1 font-semibold text-ink">
            {hasLocation ? `${fileName}:${line}` : "No exact file/line reported"}
          </p>
          <p className="mt-1 text-xs text-ink/60">{details.summary}</p>
        </div>
        {hasLocation ? (
          <button
            type="button"
            onClick={() => onOpenLocation({ fileName, line })}
            className="border border-coral px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral hover:text-white"
          >
            Open {fileName}:{line}
          </button>
        ) : null}
      </div>
      <div className="mt-3 border border-rule bg-white px-3 py-2 text-xs">
        <span className="font-semibold text-ink">Likely cause: </span>
        <span className="text-ink/65">{details.likelyCause}</span>
      </div>
      <details className="mt-3 border border-rule bg-white p-2">
        <summary className="cursor-pointer text-xs font-semibold text-ink/65">Raw compiler log</summary>
        <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap font-mono text-xs text-ink/70">
          {details.rawLog}
        </pre>
      </details>
    </div>
  );
}

function HighlightedSuggestionPreview({
  value,
  unsupportedTerms
}: {
  value: string;
  unsupportedTerms: string[];
}) {
  if (unsupportedTerms.length === 0) return null;
  const parts = splitHighlightedText(value, unsupportedTerms);

  return (
    <div className="mt-2 border border-coral bg-white p-3 text-sm leading-6 text-ink/75">
      {parts.map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.highlighted ? "bg-coral px-1 font-semibold text-white" : undefined}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
}

function CertificateFieldToggle({
  group,
  field,
  densityMode,
  onToggle,
  onRestore
}: {
  group: EditorFieldGroup;
  field?: ResumeField;
  densityMode: DensityMode;
  onToggle: (field: ResumeField, selected: boolean) => void;
  onRestore: (group: EditorFieldGroup, field?: ResumeField) => void;
}) {
  if (!field) return null;

  const checked = !field.isCommented;
  const compact = densityMode === "compact";

  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 border border-rule px-3",
        compact ? "py-2" : "py-3",
        checked ? "bg-white" : "bg-paper text-ink/55"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(field, event.target.checked)}
        className="mt-1 h-4 w-4 accent-sage"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{group.title}</span>
        <span className="mt-1 block text-xs text-ink/55">
          {[group.subtitle, group.meta].filter(Boolean).join(" | ")}
        </span>
        <span className="mt-1 block font-mono text-xs text-ink/35">
          {field.fileName} | line {field.line}
        </span>
      </span>
      <span className="text-xs font-semibold text-ink/45">
        {checked ? "Included" : "Hidden"}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          onRestore(group, field);
        }}
        className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
      >
        Restore
      </button>
    </label>
  );
}

function SkillGroupEditor({
  group,
  suggestion,
  densityMode,
  draggedSkillId,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
  onApplySuggestion,
  onRestore,
  onFieldChange
}: {
  group: EditorFieldGroup;
  suggestion?: SkillOrderSuggestion;
  densityMode: DensityMode;
  draggedSkillId: string | null;
  onDragStart: (fieldId: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
  onMove: (group: EditorFieldGroup, fieldId: string, direction: -1 | 1) => void;
  onApplySuggestion: (group: EditorFieldGroup, suggestion?: SkillOrderSuggestion) => void;
  onRestore: (group: EditorFieldGroup) => void;
  onFieldChange: (field: ResumeField, replacement: string) => void;
}) {
  const skillFields = group.fields.filter((field) => field.kind === "skill" && !field.isCommented);
  const suggestedNames = suggestion?.suggestedIds
    .map((id) => skillFields.find((field) => field.id === id)?.original)
    .filter((skill): skill is string => Boolean(skill));
  const compact = densityMode === "compact";

  return (
    <div className="border border-rule bg-white">
      <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-3", compact ? "py-1.5" : "py-2")}>
        <h4 className="text-sm font-semibold text-ink">{group.title}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink/45">{skillFields.length} skills</span>
          <button
            type="button"
            onClick={() => onRestore(group)}
            className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
          >
            Restore category
          </button>
        </div>
      </div>
      {suggestion?.changed && suggestion.matchedSkills.length > 0 ? (
        <div className={cx("border-b border-rule bg-white px-3", compact ? "py-2" : "py-3")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sage">
                Suggested order
              </p>
              <p className="mt-1 text-xs text-ink/55">
                Move job-matched skills forward: {suggestion.matchedSkills.slice(0, 5).join(", ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onApplySuggestion(group, suggestion)}
              className="border border-sage px-3 py-1.5 text-xs font-semibold text-sage hover:bg-sage hover:text-white"
            >
              Apply suggested order
            </button>
          </div>
          {suggestedNames && suggestedNames.length > 0 ? (
            <p className="mt-2 truncate text-xs text-ink/45">{suggestedNames.join(" -> ")}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cx("flex flex-wrap gap-2", compact ? "p-2" : "p-3")}>
        {skillFields.map((field, index) => (
          <div
            key={field.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(field.id)}
            className={cx(
              "flex min-h-10 items-center gap-1 border border-rule bg-paper px-2 py-1",
              draggedSkillId === field.id && "opacity-45"
            )}
          >
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                onDragStart(field.id);
              }}
              onDragEnd={onDragEnd}
              title="Drag to reorder"
              className="cursor-grab border border-rule bg-white px-2 py-1 font-mono text-xs text-ink/45 active:cursor-grabbing"
            >
              ::
            </button>
            <input
              value={field.original}
              onChange={(event) => onFieldChange(field, event.target.value)}
              className="w-[9.5rem] border-0 bg-transparent px-1 py-1 text-sm font-semibold text-ink outline-none focus:bg-white"
            />
            <button
              type="button"
              onClick={() => onMove(group, field.id, -1)}
              disabled={index === 0}
              title="Move left"
              className="border border-rule bg-white px-2 py-1 text-xs font-semibold disabled:opacity-30"
            >
              &lt;
            </button>
            <button
              type="button"
              onClick={() => onMove(group, field.id, 1)}
              disabled={index === skillFields.length - 1}
              title="Move right"
              className="border border-rule bg-white px-2 py-1 text-xs font-semibold disabled:opacity-30"
            >
              &gt;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperienceFieldCard({
  group,
  keywordHints,
  densityMode,
  expanded,
  onPreviewFocus,
  onToggleExpanded,
  onFieldChange
}: {
  group: EditorFieldGroup;
  keywordHints: string[];
  densityMode: DensityMode;
  expanded: boolean;
  onPreviewFocus: () => void;
  onToggleExpanded: () => void;
  onFieldChange: (field: ResumeField, replacement: string) => void;
}) {
  const bulletFields = group.fields.filter((field) => field.command === "item" || field.kind === "experience");
  const previewText = bulletFields[0]?.original ?? group.fields[0]?.original ?? "";
  const compact = densityMode === "compact";

  return (
    <article
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,a,input,textarea,select")) return;
        onPreviewFocus();
      }}
      className="cursor-pointer border border-rule bg-white"
    >
      <div className={cx("flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper px-3", compact ? "py-2" : "py-3")}>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-ink">{group.title}</h4>
          <p className="mt-1 text-xs text-ink/55">
            {[group.subtitle, group.meta].filter(Boolean).join(" | ")}
          </p>
          {previewText ? (
            <p className={cx("mt-2 text-xs leading-5 text-ink/60", compact ? "line-clamp-1" : "line-clamp-2")}>{previewText}</p>
          ) : null}
          {!compact || keywordHints.length > 0 ? (
            <InlineKeywordHints keywords={keywordHints} emptyText="No direct job keyword matches." />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink/45">{bulletFields.length} bullets</span>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
          >
            {expanded ? "Hide bullets" : "Edit bullets"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className={cx("grid gap-3", compact ? "p-2" : "p-3")}>
          {group.fields.map((field, fieldIndex) => (
            <StructuredFieldEditor
              key={`${field.fileName}:${field.start}:${field.command}`}
              field={field}
              index={fieldIndex}
              onChange={(replacement) => onFieldChange(field, replacement)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function InlineKeywordHints({
  keywords,
  emptyText
}: {
  keywords: string[];
  emptyText: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {keywords.slice(0, 7).map((keyword) => (
        <span key={keyword} className="border border-gold bg-white px-2 py-1 text-xs text-gold">
          {keyword}
        </span>
      ))}
      {keywords.length === 0 ? (
        <span className="text-xs font-semibold text-ink/35">{emptyText}</span>
      ) : null}
    </div>
  );
}

function ProjectFieldToggle({
  group,
  recommendation,
  keywordHints,
  densityMode,
  selectedProjectCount,
  maxProjects,
  expanded,
  onToggleExpanded,
  draggedProjectId,
  onPreviewFocus,
  onDragStart,
  onDragEnd,
  onDrop,
  onToggle,
  onRestore,
  onFieldChange
}: {
  group: EditorFieldGroup;
  recommendation?: ProjectRecommendation;
  keywordHints: string[];
  densityMode: DensityMode;
  selectedProjectCount: number;
  maxProjects: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  draggedProjectId: string | null;
  onPreviewFocus: () => void;
  onDragStart: (groupId: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
  onToggle: (group: EditorFieldGroup, selected: boolean) => void;
  onRestore: (group: EditorFieldGroup) => void;
  onFieldChange: (field: ResumeField, replacement: string) => void;
}) {
  const projectField = group.fields.find((field) => field.command === "cvproject");
  const checked = projectField ? !projectField.isCommented : !group.isCommented;
  const bulletFields = group.fields.filter((field) => field.command === "item");
  const hiddenStatus = checked
    ? selectedProjectCount > maxProjects
      ? "Included: over max project limit"
      : "Included"
    : selectedProjectCount >= maxProjects
      ? "Hidden: max project count reached"
      : projectField?.isCommented || group.isCommented
        ? "Hidden: commented in source"
        : "Hidden: unchecked for this tailoring";
  const showNoKeywordWarning = checked && keywordHints.length === 0;
  const compact = densityMode === "compact";

  return (
    <div
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,a,input,textarea,select")) return;
        onPreviewFocus();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDrop(group.id)}
      className={cx(
        "border border-rule",
        checked ? "bg-white" : "bg-paper text-ink/60",
        draggedProjectId === group.id && "opacity-45"
      )}
    >
      <label className={cx("flex cursor-pointer items-start gap-3 border-b border-rule px-3", compact ? "py-2" : "py-3")}>
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            onDragStart(group.id);
          }}
          onDragEnd={onDragEnd}
          title="Drag to reorder project card"
          className="mt-0.5 cursor-grab border border-rule bg-white px-2 py-1 font-mono text-xs text-ink/45 active:cursor-grabbing"
          onClick={(event) => event.preventDefault()}
        >
          ::
        </button>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(group, event.target.checked)}
          className="mt-1 h-4 w-4 accent-sage"
        />
        <span className="min-w-0 flex-1">
          {group.link ? (
            <a
              href={group.link}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-semibold text-sage underline-offset-2 hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {group.title}
            </a>
          ) : (
            <span className="block text-sm font-semibold text-ink">{group.title}</span>
          )}
          <span className="mt-1 block text-xs text-ink/55">
            {[group.subtitle, group.meta].filter(Boolean).join(" | ")}
          </span>
          {!compact && group.link ? (
            <span className="mt-1 block truncate font-mono text-xs text-ink/35">{group.link}</span>
          ) : null}
          {recommendation ? (
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/55">
                Relevance {recommendation.score}
              </span>
            </span>
          ) : null}
          {!compact || keywordHints.length > 0 ? (
            <InlineKeywordHints keywords={keywordHints} emptyText="No direct job keyword matches." />
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={cx("max-w-[170px] text-right text-xs font-semibold", checked ? "text-sage" : "text-ink/45")}>
            {hiddenStatus}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onToggleExpanded();
            }}
            className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
          >
            {expanded ? "Hide details" : `Show details (${bulletFields.length})`}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onRestore(group);
            }}
            className="border border-rule bg-white px-2 py-1 text-xs font-semibold text-ink/60 hover:bg-paper"
          >
            Restore
          </button>
        </span>
      </label>
      {showNoKeywordWarning ? (
        <div className="border-b border-gold bg-paper px-3 py-2 text-xs font-semibold text-gold">
          This project is selected but has no direct job keyword matches.
        </div>
      ) : null}
      {expanded && recommendation?.evidence.length ? (
        <div className="border-b border-rule bg-paper px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sage">Why this project?</p>
          <div className="mt-2 space-y-1.5">
            {recommendation.evidence.slice(0, 3).map((item, index) => (
              <p key={`${item.keyword}-${item.source}-${index}`} className="text-xs text-ink/60">
                <span className="font-semibold text-ink">{item.keyword}</span>
                <span> matched in {item.source}: </span>
                <span>{item.text}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {expanded ? (
      <div className={cx("grid gap-3", compact ? "p-2" : "p-3")}>
        {bulletFields.length > 0 ? (
          bulletFields.map((field, fieldIndex) => (
            <StructuredFieldEditor
              key={`${field.fileName}:${field.start}:${field.command}`}
              field={field}
              index={fieldIndex}
              onChange={(replacement) => onFieldChange(field, replacement)}
            />
          ))
        ) : (
          <p className="text-sm text-ink/55">No project description bullet detected.</p>
        )}
      </div>
      ) : null}
    </div>
  );
}

function StructuredFieldEditor({
  field,
  index,
  onChange
}: {
  field: ResumeField;
  index: number;
  onChange: (replacement: string) => void;
}) {
  const mode = fieldInputMode(field);
  const label = `${index + 1}. ${fieldLabel(field)}`;

  if (mode === "compact") {
    return (
      <label className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
        <span>
          <span className="block text-sm font-semibold text-ink">{label}</span>
          <span className="block font-mono text-xs text-ink/45">\\{field.command}</span>
        </span>
        <input
          value={field.original}
          onChange={(event) => onChange(event.target.value)}
          className="w-full border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-sage"
        />
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block text-sm font-semibold text-ink">{label}</span>
          <span className="block font-mono text-xs text-ink/45">
            {field.fileName} | line {field.line} | \{field.command}
          </span>
        </span>
        <span className="text-xs text-ink/45">{field.original.length} chars</span>
      </span>
      <textarea
        value={field.original}
        onChange={(event) => onChange(event.target.value)}
        rows={mode === "long" ? 4 : 3}
        className="w-full resize-y border border-rule bg-paper p-3 text-sm leading-6 outline-none focus:border-sage"
      />
    </label>
  );
}

function RawFileEditor({
  file,
  jumpLine,
  jumpNonce,
  minHeightClassName = "min-h-[560px]",
  safeModeEnabled,
  onChange
}: {
  file: ResumeSourceFile;
  jumpLine?: number;
  jumpNonce?: number;
  minHeightClassName?: string;
  safeModeEnabled: boolean;
  onChange: (content: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const locked = safeModeEnabled || !file.editable;

  useEffect(() => {
    if (!jumpLine || !textareaRef.current) return;

    const lines = file.content.split("\n");
    const clampedLine = Math.min(Math.max(1, jumpLine), lines.length);
    const selectionStart = lines.slice(0, clampedLine - 1).join("\n").length + (clampedLine > 1 ? 1 : 0);
    const selectionEnd = selectionStart + (lines[clampedLine - 1]?.length ?? 0);

    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
    textareaRef.current.scrollTop = Math.max(0, (clampedLine - 8) * 20);
  }, [file.content, jumpLine, jumpNonce]);

  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-ink">
          {file.name}
          {jumpLine ? <span className="ml-2 text-xs text-coral">line {jumpLine}</span> : null}
        </span>
        <span className={cx("text-xs font-semibold", file.editable ? "text-sage" : "text-ink/45")}>
          {locked ? (safeModeEnabled ? "safe mode locked" : "preserved") : "editable"}
        </span>
      </span>
      {safeModeEnabled && file.editable ? (
        <p className="mb-2 border border-sage bg-sage/10 px-3 py-2 text-xs font-semibold text-sage">
          Raw LaTeX editing is locked. Use Structured Editor fields, or turn Safe mode off for manual source edits.
        </p>
      ) : null}
      <textarea
        ref={textareaRef}
        value={file.content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        readOnly={locked}
        className={cx(
          minHeightClassName,
          "w-full resize-y border border-rule p-4 font-mono text-xs leading-5 outline-none focus:border-sage disabled:opacity-70",
          locked ? "bg-paper text-ink/70" : "bg-white"
        )}
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function JobDescriptionQualityPanel({ quality }: { quality: JobDescriptionQuality }) {
  const tone =
    quality.level === "good"
      ? "border-sage bg-sage/10 text-sage"
      : quality.level === "thin"
        ? "border-gold bg-gold/10 text-gold"
        : "border-coral bg-coral/10 text-coral";
  const label =
    quality.level === "good"
      ? "Good JD signal"
      : quality.level === "thin"
        ? "Thin JD signal"
        : "Vague JD signal";

  return (
    <div className={cx("mt-4 border p-3", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {quality.actionableCount} actionable terms · {quality.responsibilityCount} responsibility signals · {quality.keywordCount} keywords
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {quality.messages.map((message) => (
          <p key={message} className="border border-current/25 bg-white/70 px-3 py-2 text-xs font-semibold leading-5 text-ink/70">
            {message}
          </p>
        ))}
      </div>
    </div>
  );
}

function ChipGroup({ title, values, danger = false }: { title: string; values: string[]; danger?: boolean }) {
  return (
    <div className="border border-rule bg-paper p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">{title}</p>
      <div className="flex flex-wrap gap-2">
        {values.length > 0 ? (
          values.map((value) => (
            <span
              key={value}
              className={cx(
                "border bg-white px-2 py-1 text-xs",
                danger ? "border-coral text-coral" : "border-rule text-ink/75"
              )}
            >
              {value}
            </span>
          ))
        ) : (
          <span className="text-xs text-ink/45">None detected</span>
        )}
      </div>
    </div>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className={cx("mt-2 text-xs font-semibold", ok ? "text-sage" : "text-coral")}>
      {ok ? "Pass" : "Check"}: {label}
    </p>
  );
}

function PdfFitNotice({
  state,
  pageCount
}: {
  state: "unknown" | "stale" | "fits" | "overflow";
  pageCount?: number;
}) {
  const tone =
    state === "fits"
      ? "border-sage text-sage"
      : state === "overflow"
        ? "border-coral text-coral"
        : "border-rule text-ink/60";
  const message =
    state === "fits"
      ? `PDF fit check: fits on ${pageCount ?? 1} page.`
      : state === "overflow"
        ? `PDF fit warning: spills to ${pageCount} pages. Reduce selected projects/certificates or spacing before download.`
        : state === "stale"
          ? "PDF fit check is stale. Compile the PDF again after your project/certificate changes."
          : "PDF fit check not run yet. Compile the PDF to verify page count.";

  return <div className={cx("border bg-paper px-4 py-3 text-sm font-semibold", tone)}>{message}</div>;
}

function StatusCard({ ok, title }: { ok: boolean; title: string }) {
  return (
    <div className="border border-rule bg-paper p-3">
      <p className={cx("text-sm font-semibold", ok ? "text-sage" : "text-coral")}>{ok ? "Pass" : "Blocked"}</p>
      <p className="mt-1 text-sm text-ink/70">{title}</p>
    </div>
  );
}

function DiffBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">{label}</span>
      <div className="min-h-[130px] border border-rule bg-paper p-3 text-sm leading-6 text-ink/75">{value}</div>
    </div>
  );
}
