import type { JobAnalysis, MatchAnalysis, ParsedResume, ResumeSuggestion } from "@/types/tailortex";
import { extractNlpTerms, extractSentenceCandidates } from "@/lib/nlp";

const skillCatalog = [
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
  "design system",
  "documentation",
  "product managers",
  "designers"
];

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function includesTerm(text: string, term: string) {
  return text.toLowerCase().includes(term.toLowerCase());
}

function extractSectionLines(description: string, headingPattern: RegExp) {
  const lines = description.split("\n");
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) return [];

  const results: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^[A-Z][A-Za-z ]+:$/.test(line) && results.length > 0) break;
    if (/^-/.test(line)) results.push(line.replace(/^-\s*/, ""));
  }
  return results;
}

function extractSkills(lines: string[], description: string) {
  const fromCatalog = skillCatalog.filter((skill) =>
    lines.some((line) => includesTerm(line, skill)) || includesTerm(description, skill)
  );
  return unique(fromCatalog);
}

function extractKeywords(description: string, required: string[], preferred: string[]) {
  const phraseMatches = [
    "internal tools",
    "workflow products",
    "data-heavy",
    "automated testing",
    "release quality",
    "frontend",
    "customer feedback",
    "code review",
    "ambiguous requirements"
  ].filter((phrase) => includesTerm(description, phrase));

  return unique([...required, ...preferred, ...phraseMatches, ...extractNlpTerms(description)]).slice(0, 24);
}

export function analyzeJobDescription(description: string): JobAnalysis {
  const requiredLines = extractSectionLines(description, /required qualifications/i);
  const preferredLines = extractSectionLines(description, /preferred qualifications/i);
  const responsibilityLines = extractSectionLines(description, /responsibilities/i);
  const nlpRequired = extractSentenceCandidates(
    description,
    /\b(required|must|need|strong|proficient|years)\b/i
  );
  const nlpPreferred = extractSentenceCandidates(description, /\b(preferred|nice to have|familiarity|bonus)\b/i);
  const nlpResponsibilities = extractSentenceCandidates(
    description,
    /\b(build|collaborate|improve|review|mentor|own|design|ship)\b/i
  );
  const requiredSkills = extractSkills(requiredLines, requiredLines.join("\n"));
  const preferredSkills = extractSkills(preferredLines, preferredLines.join("\n"));
  const yearsMatch = description.match(/(\d+\+?)\s+years/i);

  return {
    requiredSkills: unique([...requiredSkills, ...extractSkills(nlpRequired, nlpRequired.join("\n"))]),
    preferredSkills: unique([...preferredSkills, ...extractSkills(nlpPreferred, nlpPreferred.join("\n"))]),
    responsibilities: unique([...responsibilityLines, ...nlpResponsibilities]),
    experienceLevel: yearsMatch ? `${yearsMatch[1]} years` : undefined,
    keywords: extractKeywords(description, requiredSkills, preferredSkills)
  };
}

export function compareResumeToJob(parsedResume: ParsedResume, job: JobAnalysis): MatchAnalysis {
  const resumeText = parsedResume.source.toLowerCase();
  const required = job.requiredSkills;
  const preferred = job.preferredSkills;
  const matchedSkills = unique([...required, ...preferred].filter((skill) => includesTerm(resumeText, skill)));
  const missingRequirements = required.filter((skill) => !includesTerm(resumeText, skill));
  const partiallyMatchedRequirements = job.responsibilities
    .filter((responsibility) => {
      const words = responsibility
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 5);
      const hits = words.filter((word) => resumeText.includes(word)).length;
      return hits > 0 && hits < Math.max(2, Math.ceil(words.length / 2));
    })
    .slice(0, 5);

  const requiredScore = required.length
    ? (required.filter((skill) => includesTerm(resumeText, skill)).length / required.length) * 65
    : 35;
  const preferredScore = preferred.length
    ? (preferred.filter((skill) => includesTerm(resumeText, skill)).length / preferred.length) * 20
    : 10;
  const keywordScore = job.keywords.length
    ? (job.keywords.filter((keyword) => includesTerm(resumeText, keyword)).length / job.keywords.length) *
      15
    : 5;

  return {
    score: Math.min(100, Math.round(requiredScore + preferredScore + keywordScore)),
    matchedSkills,
    partiallyMatchedRequirements,
    missingRequirements,
    importantKeywords: job.keywords
  };
}

function assertSupportedKeywords(resumeSource: string, terms: string[]) {
  return terms.filter((term) => includesTerm(resumeSource, term));
}

function unsupportedTerms(resumeSource: string, terms: string[]) {
  return terms.filter((term) => !includesTerm(resumeSource, term));
}

function improveBullet(original: string, terms: string[]) {
  if (terms.length === 0) return original;
  const firstTerm = terms[0];
  const alreadyNearFront = original.slice(0, 80).toLowerCase().includes(firstTerm.toLowerCase());
  if (alreadyNearFront) return original;

  return original.replace(
    /^([A-Z][a-z]+)\s+/,
    (_match, verb: string) => `${verb} ${terms.slice(0, 2).join(" and ")}-focused `
  );
}

export function generateStructuredSuggestions(
  parsedResume: ParsedResume,
  job: JobAnalysis,
  match: MatchAnalysis
): ResumeSuggestion[] {
  const resumeSource = parsedResume.source;
  const jobTerms = unique([...job.requiredSkills, ...job.preferredSkills, ...job.keywords]);
  const editableFields = parsedResume.fields.filter((field) =>
    ["summary", "experience", "project", "skill"].includes(field.kind)
  );

  const generated: Array<ResumeSuggestion | null> = editableFields.map((field, index) => {
      const fieldMatches = jobTerms.filter((term) => includesTerm(field.original, term));
      const supportedTerms = assertSupportedKeywords(resumeSource, fieldMatches);
      const suggested = improveBullet(field.original, supportedTerms);
      const keywordsAdded = supportedTerms.filter((term) => !includesTerm(field.original.slice(0, 80), term));
      const unsupportedClaims = unsupportedTerms(resumeSource, keywordsAdded);

      if (suggested === field.original && fieldMatches.length === 0) return null;

      return {
        id: `suggestion-${index}-${field.id}`,
        targetId: field.id,
        original: field.original,
        suggested,
        reason:
          supportedTerms.length > 0
            ? `Highlights supported resume evidence for ${supportedTerms.slice(0, 3).join(", ")}.`
            : "Keeps this field available for manual tailoring without adding unsupported claims.",
        keywordsAdded,
        confidence: unsupportedClaims.length > 0 ? "low" : "high",
        unsupportedClaims,
        status: "pending"
      };
    });

  return generated
    .filter((suggestion): suggestion is ResumeSuggestion => suggestion !== null)
    .slice(0, Math.max(5, match.matchedSkills.length));
}
