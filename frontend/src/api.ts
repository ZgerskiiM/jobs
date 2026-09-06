import type { Application, CompactVacancyFeatures } from "./data";
import type { OnboardingData, ResumeSkill, ResumeTargetRole, User, UserSettings } from "./context/AuthContext";

export interface ResumeData {
  id: string;
  source?: "upload" | "hh";
  sourceId?: string;
  sourceUrl?: string;
  fileName: string;
  uploadedAt: string;
  experience: string;
  experienceYears?: number | null;
  experienceMonths?: number | null;
  position: string;
  fullName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTelegram?: string;
  targetRole?: ResumeTargetRole;
  hasFile?: boolean;
  skills: ResumeSkill[];
  isActive?: boolean;
}

export interface AccountPayload {
  user: User;
  onboarding: OnboardingData | null;
  settings: UserSettings;
  resume: ResumeData | null;
  resumes: ResumeData[];
  coverLetter: string;
  savedJobIds: number[];
  savedJobNotes: Record<string, string>;
  applications: Application[];
  isPro: boolean;
  isNew?: boolean;
}

export interface VacancyScore {
  vacancyId: string; scoringVersion: string; score: number; confidence: number; eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNCERTAIN"; eligibilityReasons: string[]; level: string; label: string; summary: string; hardMatchScore: number | null; vacancyRequirementCoverage: number | null;
  matched: Array<{ required: string; found: string; coefficient: number }>;
  partialMatches: Array<{ required: string; found: string; coefficient: number }>;
  missingImportant: string[]; negativeSignals: Array<{ id: string; penalty: number; primaryRoleConflict: boolean; matchedText: string }>;
  vacancyMissing?: string[];
  gatesApplied: Array<{ id: string; maxScore: number; reason: string }>;
  experienceMatch: { candidateYears: number | null; vacancyMinYears: number | null; coefficient: number | null };
  seniorityMatch: { candidate: string; vacancy: string; coefficient: number | null };
}

export type VacancyScoreSummary = Pick<VacancyScore, "vacancyId" | "scoringVersion" | "score" | "confidence" | "eligibility" | "level" | "label" | "summary">;
export type VacancyScoreInput = { id: number | string; source_key?: string; title?: string; description?: string; posted_at?: string; features?: CompactVacancyFeatures };

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
let csrfReady = false;

function cookie(name: string): string | null {
  const value = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : null;
}

export async function ensureCsrf(): Promise<void> {
  if (csrfReady && cookie("csrftoken")) return;
  await fetch(`${API_ORIGIN}/api/auth/csrf/`, { credentials: "include" });
  csrfReady = true;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") await ensureCsrf();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const csrfToken = cookie("csrftoken");
  if (csrfToken && method !== "GET" && method !== "HEAD") headers.set("X-CSRFToken", csrfToken);
  const response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? "Не удалось выполнить запрос");
  return body as T;
}

export const accountApi = {
  csrf: ensureCsrf,
  authConfig: () => request<{ enabled: boolean; username: string }>("/api/auth/config/"),
  me: () => request<AccountPayload>("/api/auth/me/"),
  email: (email: string, password: string, mode: "login" | "register") =>
    request<AccountPayload>("/api/auth/email/", { method: "POST", body: JSON.stringify({ email, password, mode }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout/", { method: "POST", body: "{}" }),
  changePassword: (current: string, next: string) => request<{ ok: boolean }>("/api/auth/password/", { method: "POST", body: JSON.stringify({ current, new: next }) }),
  deleteAccount: () => request<{ ok: boolean }>("/api/auth/account/", { method: "DELETE" }),
  patchProfile: (body: { name?: string; onboarding?: OnboardingData | null; settings?: UserSettings; coverLetter?: string }) =>
    request<AccountPayload>("/api/profile/", { method: "PATCH", body: JSON.stringify(body) }),
  saveJob: (jobId: number, saved: boolean) =>
    request<{ savedJobIds: number[]; savedJobNotes: Record<string, string> }>("/api/profile/saved/", { method: "POST", body: JSON.stringify({ jobId, saved }) }),
  saveJobNote: (jobId: number, note: string) =>
    request<{ savedJobIds: number[]; savedJobNotes: Record<string, string> }>("/api/profile/saved/", { method: "POST", body: JSON.stringify({ jobId, note }) }),
  uploadResume: (file: File) => {
    const body = new FormData();
    body.append("resume", file);
    return request<{ resume: ResumeData; resumes: ResumeData[] }>("/api/profile/resume/", { method: "POST", body });
  },
  patchResume: (body: { skills?: ResumeSkill[]; activeResumeId?: string; resumeId?: string; fullName?: string; contactEmail?: string; contactPhone?: string; contactTelegram?: string; targetRole?: ResumeTargetRole }) =>
    request<{ resume: ResumeData | null; resumes: ResumeData[] }>("/api/profile/resume/", { method: "PATCH", body: JSON.stringify(body) }),
  downloadExtension: async (browser: "firefox" | "chrome" = "firefox") => {
    const suffix = browser === "firefox" ? "" : `${browser}/`;
    const response = await fetch(`${API_ORIGIN}/api/extension/download/${suffix}`, { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? "Не удалось скачать расширение");
    }
    return response.blob();
  },
  deleteResume: (id?: string) => request<{ resume: ResumeData | null; resumes: ResumeData[] }>(`/api/profile/resume/${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" }),
  startHhImport: () => request<{ url: string }>("/api/profile/hh/start/", { method: "POST", body: "{}" }),
  createApplication: (application: Application) =>
    request<Application>("/api/applications/", { method: "POST", body: JSON.stringify(application) }),
  patchApplication: (id: number, patch: Partial<Application>) =>
    request<Application>(`/api/applications/${id}/`, { method: "PATCH", body: JSON.stringify(patch) }),
  scoreVacancies: (items: VacancyScoreInput[]) =>
    request<{ scoringVersion: string; taxonomyVersion: string; profile: unknown; scores: VacancyScore[] }>("/api/scoring/rank/", { method: "POST", body: JSON.stringify({ items }) }),
  scoreVacancyIndex: (items: VacancyScoreInput[]) =>
    request<{ scoringVersion: string; taxonomyVersion: string; profile: unknown; scores: VacancyScoreSummary[] }>("/api/scoring/rank/", { method: "POST", body: JSON.stringify({ items, compact: true }) }),
};
