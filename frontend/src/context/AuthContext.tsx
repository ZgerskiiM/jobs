import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Application } from "../data";
import { accountApi, type AccountPayload } from "../api";

export interface OnboardingData { roles: string[]; levels: string[]; formats: string[]; }
export interface NotificationSettings { newJobs: boolean; salaryDigest: boolean; trendDigest: boolean; companyActivity: boolean; }
export interface AccountSettings { profileVisible: boolean; showSalaryExpectation: boolean; }
export interface UserSettings { notifications: NotificationSettings; account: AccountSettings; }
export interface User { id?: number; name: string; email?: string | null; telegram?: string | null; telegramPhotoUrl?: string | null; isAdmin?: boolean; }
export interface ResumeSkill { name: string; category: string; confirmed: boolean; }
export type ResumeTargetRole = "JAVA_BACKEND" | "DEVOPS" | "ONE_C_DEVELOPER" | "UNKNOWN";
export interface ResumeData {
  id: string; source?: "upload" | "hh"; sourceId?: string; sourceUrl?: string; fileName: string; uploadedAt: string; experience: string;
  experienceYears?: number | null; experienceMonths?: number | null; position: string; fullName?: string; contactEmail?: string; contactPhone?: string; contactTelegram?: string;
  hasFile?: boolean; skills: ResumeSkill[]; isActive?: boolean; targetRole?: ResumeTargetRole;
}

interface AuthState {
  user: User | null; onboarding: OnboardingData | null; settings: UserSettings; resume: ResumeData | null; resumes: ResumeData[];
  coverLetter: string; savedJobIds: number[]; savedJobNotes: Record<string, string>; applications: Application[]; isPro: boolean; isLoading: boolean;
  showAuthModal: boolean; showImportStep: boolean; showOnboarding: boolean; initialOnboarding: Partial<OnboardingData>;
  resumeSkills: ResumeSkill[]; setCoverLetter: (text: string) => Promise<void>; setResumeSkills: (skills: ResumeSkill[]) => Promise<void>;
  uploadResume: (file: File) => Promise<ResumeData>; selectResume: (id: string) => Promise<void>; updateResumeDetails: (details: Partial<Pick<ResumeData, "fullName" | "contactEmail" | "contactPhone" | "contactTelegram" | "targetRole">>) => Promise<void>; deleteResume: (id?: string) => Promise<void>; startHhImport: () => Promise<string>; clearResume: () => Promise<void>; toggleSavedJob: (id: number) => Promise<void>;
  updateSavedJobNote: (id: number, note: string) => Promise<void>;
  isJobSaved: (id: number) => boolean; addApplication: (app: Application) => Promise<void>; updateApplication: (id: number, patch: Partial<Application>) => Promise<void>;
  activatePro: () => void; loginWithEmail: (email: string, password: string, mode: "login" | "register") => Promise<void>; logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>; deleteAccount: () => Promise<void>;
  openAuthModal: () => void; closeAuthModal: () => void; finishImport: (prefill?: Partial<OnboardingData>) => void;
  completeOnboarding: (data: OnboardingData) => Promise<void>; skipOnboarding: () => void; updateSettings: (s: UserSettings) => Promise<void>; updateName: (name: string) => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
  notifications: { newJobs: true, salaryDigest: true, trendDigest: false, companyActivity: false },
  account: { profileVisible: true, showSalaryExpectation: false },
};
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [resumeSkills, setResumeSkillsState] = useState<ResumeSkill[]>([]);
  const [coverLetter, setCoverLetterState] = useState("");
  const [savedJobIds, setSavedJobIds] = useState<number[]>([]);
  const [savedJobNotes, setSavedJobNotes] = useState<Record<string, string>>({});
  const [applications, setApplications] = useState<Application[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showImportStep, setShowImportStep] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialOnboarding, setInitialOnboarding] = useState<Partial<OnboardingData>>({});

  const applyAccount = (account: AccountPayload, openSetup = false) => {
    setUser(account.user); setOnboarding(account.onboarding); setSettings(account.settings ?? DEFAULT_SETTINGS);
    const resumeList = account.resumes ?? (account.resume ? [account.resume] : []);
    setResumes(resumeList); setResume(account.resume ?? resumeList.find((item) => item.isActive) ?? resumeList[0] ?? null); setResumeSkillsState((account.resume ?? resumeList[0])?.skills ?? []); setCoverLetterState(account.coverLetter ?? "");
    setSavedJobIds(account.savedJobIds ?? []); setSavedJobNotes(account.savedJobNotes ?? {}); setApplications(account.applications ?? []); setIsPro(account.isPro ?? false);
    if (openSetup) setShowImportStep(true);
  };

  useEffect(() => {
    accountApi.csrf().then(() => accountApi.me()).then((account) => applyAccount(account)).catch(() => undefined).finally(() => setIsLoading(false));
  }, []);

  const loginWithEmail = async (email: string, password: string, mode: "login" | "register") => {
    const account = await accountApi.email(email, password, mode); applyAccount(account, Boolean(account.isNew)); setShowAuthModal(false);
  };

  const logout = async () => {
    await accountApi.logout().catch(() => undefined);
    setUser(null); setOnboarding(null); setResume(null); setResumes([]); setResumeSkillsState([]); setCoverLetterState("");
    setSavedJobIds([]); setSavedJobNotes({}); setApplications([]); setIsPro(false); setShowImportStep(false); setShowOnboarding(false);
  };
  const changePassword = async (current: string, next: string) => { await accountApi.changePassword(current, next); };
  const deleteAccount = async () => { await accountApi.deleteAccount(); await logout(); };

  const toggleSavedJob = async (id: number) => {
    const saved = !savedJobIds.includes(id); const previous = savedJobIds;
    setSavedJobIds(saved ? [id, ...previous] : previous.filter((value) => value !== id));
    try { const result = await accountApi.saveJob(id, saved); setSavedJobIds(result.savedJobIds); setSavedJobNotes(result.savedJobNotes); }
    catch (requestError) { setSavedJobIds(previous); throw requestError; }
  };
  const updateSavedJobNote = async (id: number, note: string) => {
    const result = await accountApi.saveJobNote(id, note);
    setSavedJobIds(result.savedJobIds); setSavedJobNotes(result.savedJobNotes);
  };

  const addApplication = async (app: Application) => {
    const previous = applications; setApplications((current) => [app, ...current.filter((item) => item.id !== app.id)]);
    try { await accountApi.createApplication(app); } catch (requestError) { setApplications(previous); throw requestError; }
  };

  const updateApplication = async (id: number, patch: Partial<Application>) => {
    const previous = applications; setApplications((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    try {
      const result = await accountApi.patchApplication(id, patch);
      setApplications((current) => current.map((item) => item.id === id ? result : item));
    } catch (requestError) { setApplications(previous); throw requestError; }
  };

  const setCoverLetter = async (text: string) => { setCoverLetterState(text); await accountApi.patchProfile({ coverLetter: text }); };
  const applyResumeResult = (result: { resume: ResumeData | null; resumes: ResumeData[] }) => { setResumes(result.resumes ?? []); setResume(result.resume); setResumeSkillsState(result.resume?.skills ?? []); return result.resume; };
  const setResumeSkills = async (skills: ResumeSkill[]) => { setResumeSkillsState(skills); setResume((current) => current ? { ...current, skills } : current); const result = await accountApi.patchResume({ skills }); applyResumeResult(result); };
  const uploadResume = async (file: File) => { const result = await accountApi.uploadResume(file); return applyResumeResult(result) as ResumeData; };
  const selectResume = async (id: string) => { const result = await accountApi.patchResume({ activeResumeId: id }); applyResumeResult(result); };
  const updateResumeDetails = async (details: Partial<Pick<ResumeData, "fullName" | "contactEmail" | "contactPhone" | "contactTelegram" | "targetRole">>) => { const result = await accountApi.patchResume(details); applyResumeResult(result); };
  const deleteResume = async (id?: string) => { const result = await accountApi.deleteResume(id); applyResumeResult(result); };
  const startHhImport = async () => (await accountApi.startHhImport()).url;
  const clearResume = async () => { await deleteResume(); };
  const completeOnboarding = async (data: OnboardingData) => { setOnboarding(data); setShowOnboarding(false); await accountApi.patchProfile({ onboarding: data }); };
  const updateSettings = async (next: UserSettings) => { setSettings(next); await accountApi.patchProfile({ settings: next }); };
  const updateName = async (name: string) => { setUser((current) => current ? { ...current, name } : current); await accountApi.patchProfile({ name }); };

  return <AuthContext.Provider value={{
    user, onboarding, settings, resume, resumes, coverLetter, savedJobIds, savedJobNotes, applications, isPro, isLoading, showAuthModal, showImportStep, showOnboarding, initialOnboarding, resumeSkills,
    setCoverLetter, setResumeSkills, uploadResume, selectResume, updateResumeDetails, deleteResume, startHhImport, clearResume, toggleSavedJob, updateSavedJobNote, isJobSaved: (id) => savedJobIds.includes(id), addApplication, updateApplication,
    activatePro: () => setIsPro(true), loginWithEmail, logout, changePassword, deleteAccount, openAuthModal: () => setShowAuthModal(true), closeAuthModal: () => setShowAuthModal(false),
    finishImport: (prefill) => { setShowImportStep(false); setInitialOnboarding(prefill ?? {}); setShowOnboarding(true); }, completeOnboarding, skipOnboarding: () => setShowOnboarding(false), updateSettings, updateName,
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error("useAuth must be used within AuthProvider"); return context; }
