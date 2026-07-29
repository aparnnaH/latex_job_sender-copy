import { apiFetch, toQueryString } from "@/lib/api/http";
import type {
  ApplicationStatus,
  JobApplication,
  JobApplicationPatchRequest,
  JobApplicationRequest,
  JobApplicationSearchRequest,
  PageResponse,
  ResumeVersion,
  StatusSummary
} from "@/lib/api/models";

export const backendApi = {
  getStatus() {
    return apiFetch<StatusSummary>("/api/status");
  },

  listApplications(search: JobApplicationSearchRequest = {}) {
    return apiFetch<PageResponse<JobApplication>>(`/api/applications${toQueryString(search)}`);
  },

  createApplication(request: JobApplicationRequest) {
    return apiFetch<JobApplication>("/api/applications", {
      method: "POST",
      body: request
    });
  },

  getApplication(id: string) {
    return apiFetch<JobApplication>(`/api/applications/${id}`);
  },

  replaceApplication(id: string, request: JobApplicationRequest) {
    return apiFetch<JobApplication>(`/api/applications/${id}`, {
      method: "PUT",
      body: request
    });
  },

  updateApplication(id: string, request: JobApplicationPatchRequest) {
    return apiFetch<JobApplication>(`/api/applications/${id}`, {
      method: "PATCH",
      body: request
    });
  },

  updateApplicationStatus(id: string, status: ApplicationStatus) {
    return apiFetch<JobApplication>(`/api/applications/${id}/status`, {
      method: "PATCH",
      body: { status }
    });
  },

  deleteApplication(id: string) {
    return apiFetch<void>(`/api/applications/${id}`, {
      method: "DELETE"
    });
  },

  requestTailoring(applicationId: string, resume: File | Blob, fileName = "resume.tex") {
    const body = new FormData();
    body.set("resume", resume, fileName);
    return apiFetch<ResumeVersion>(`/api/applications/${applicationId}/tailor`, {
      method: "POST",
      body
    });
  },

  requestTailoringCompatibility(applicationId: string, resume: File | Blob, fileName = "resume.tex") {
    const body = new FormData();
    body.set("resume", resume, fileName);
    return apiFetch<ResumeVersion>(`/api/applications/${applicationId}/resumes/tailor`, {
      method: "POST",
      body
    });
  },

  listResumeVersions(applicationId: string) {
    return apiFetch<ResumeVersion[]>(`/api/applications/${applicationId}/resume-versions`);
  },

  getResumeVersion(id: string) {
    return apiFetch<ResumeVersion>(`/api/resume-versions/${id}`);
  },

  downloadResumeVersion(id: string) {
    return apiFetch<Blob>(`/api/resume-versions/${id}/download/tex`);
  },

  downloadResumeVersionPdf(id: string) {
    return apiFetch<Blob>(`/api/resume-versions/${id}/download/pdf`);
  },

  retryResumeVersion(id: string) {
    return apiFetch<ResumeVersion>(`/api/resume-versions/${id}/retry`, {
      method: "POST"
    });
  }
};
