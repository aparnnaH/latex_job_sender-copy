import { z } from "zod";

export const latexSourceSchema = z
  .string()
  .min(40, "Paste or upload a LaTeX resume before continuing.")
  .refine(
    (value) =>
      /\\documentclass|\\begin\{document\}|\\section|\\resumeItem|\\resumeSubheading/.test(
        value
      ),
    "This does not look like a LaTeX resume yet."
  );

export const jobInputSchema = z.object({
  title: z.string().min(2, "Add the job title."),
  company: z.string().min(2, "Add the company name."),
  url: z.string().url("Use a valid URL.").or(z.literal("")),
  description: z.string().min(80, "Paste the full job description.")
});

export const autofillProfileSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedIn: z.string(),
  github: z.string(),
  portfolio: z.string(),
  workAuthorization: z.string(),
  sponsorship: z.string(),
  graduationDate: z.string(),
  preferredJobTitles: z.string(),
  eeoAnswers: z.string(),
  shortBio: z.string()
});

export const resumeSuggestionSchema = z.object({
  targetId: z.string(),
  original: z.string(),
  suggested: z.string(),
  reason: z.string(),
  keywordsAdded: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"])
});

export const aiResponseSchema = z.object({
  jobAnalysis: z.object({
    requiredSkills: z.array(z.string()),
    preferredSkills: z.array(z.string()),
    responsibilities: z.array(z.string()),
    keywords: z.array(z.string())
  }),
  matchScore: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  unsupportedRequirements: z.array(z.string()),
  suggestions: z.array(resumeSuggestionSchema)
});
