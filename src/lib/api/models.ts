export type ApplicationStatus = "SAVED" | "APPLIED" | "INTERVIEW" | "OFFER" | "REJECTED" | "ARCHIVED";

export type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type ApiErrorBody = {
  message?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  details?: Record<string, string>;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly details?: unknown;

  constructor(message: string, options: { status: number; code?: string; retryable?: boolean; details?: unknown }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.details = options.details;
  }
}

export type JobApplication = {
  id: string;
  company: string;
  jobTitle: string;
  jobDescription: string;
  status: ApplicationStatus;
  jobUrl?: string | null;
  location?: string | null;
  source?: string | null;
  dateFound?: string | null;
  dateApplied?: string | null;
  notes?: string | null;
  resumeUsed?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type JobApplicationRequest = {
  company: string;
  jobTitle: string;
  jobDescription: string;
  jobUrl?: string;
  location?: string;
  source?: string;
  dateFound?: string;
  dateApplied?: string;
  notes?: string;
  resumeUsed?: string;
};

export type JobApplicationPatchRequest = Partial<JobApplicationRequest>;

export type JobApplicationSearchRequest = {
  status?: ApplicationStatus;
  company?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  size?: number;
};

export type PageResponse<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
};

export type ResumeVersion = {
  id: string;
  jobApplicationId: string;
  originalFileName: string;
  baseResumeName?: string | null;
  outputFilePath?: string | null;
  versionNumber: number;
  documentServiceId?: string | null;
  tailoringStatus: ProcessingStatus;
  processingStatus: ProcessingStatus;
  failureMessage?: string | null;
  errorCode?: string | null;
  safeErrorMessage?: string | null;
  attemptCount?: number;
  createdAt?: string;
  updatedAt?: string;
  processingStartedAt?: string | null;
  processingCompletedAt?: string | null;
};

export type StatusSummary = {
  status: string;
  checks: {
    javaApplication: string;
    postgresql: string;
    rabbitmq: string;
    documentService: string;
  };
  checkedAt: string;
};
