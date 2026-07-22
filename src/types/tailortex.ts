export type Confidence = "high" | "medium" | "low";

export type ResumeFieldKind =
  | "summary"
  | "skill"
  | "experience"
  | "project"
  | "education"
  | "certificate"
  | "command"
  | "other";

export interface ResumeSourceFile {
  name: string;
  content: string;
  role: "main" | "tex" | "class" | "other";
  editable: boolean;
}

export interface ResumeFieldGroup {
  id: string;
  sectionId: string;
  title: string;
  subtitle?: string;
  meta?: string;
  link?: string;
  start: number;
  end: number;
  lineStart?: number;
  isCommented?: boolean;
}

export interface ResumeField {
  id: string;
  fileName: string;
  sectionId: string;
  sectionTitle: string;
  command: string;
  kind: ResumeFieldKind;
  original: string;
  start: number;
  end: number;
  lineStart?: number;
  lineEnd?: number;
  line: number;
  isCommented?: boolean;
  group?: ResumeFieldGroup;
  supportedKeywords: string[];
}

export interface ResumeSection {
  id: string;
  fileName: string;
  title: string;
  start: number;
  end: number;
  fields: ResumeField[];
}

export interface ParsedResume {
  filename: string;
  source: string;
  files: ResumeSourceFile[];
  sections: ResumeSection[];
  fields: ResumeField[];
  commandsDetected: string[];
  validation: {
    isLatexLike: boolean;
    bracesBalanced: boolean;
    warnings: string[];
  };
}

export interface JobAnalysis {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  experienceLevel?: string;
  keywords: string[];
}

export interface MatchAnalysis {
  score: number;
  matchedSkills: string[];
  partiallyMatchedRequirements: string[];
  missingRequirements: string[];
  importantKeywords: string[];
}

export interface ResumeSuggestion {
  id: string;
  targetId: string;
  original: string;
  suggested: string;
  reason: string;
  keywordsAdded: string[];
  confidence: Confidence;
  unsupportedClaims: string[];
  status: "pending" | "accepted" | "rejected" | "edited";
}

export interface AcceptedChange {
  targetId: string;
  original: string;
  replacement: string;
}

export interface AiResponseShape {
  jobAnalysis: {
    requiredSkills: string[];
    preferredSkills: string[];
    responsibilities: string[];
    keywords: string[];
  };
  matchScore: number;
  matchedSkills: string[];
  unsupportedRequirements: string[];
  suggestions: Array<{
    targetId: string;
    original: string;
    suggested: string;
    reason: string;
    keywordsAdded: string[];
    confidence: Confidence;
  }>;
}
