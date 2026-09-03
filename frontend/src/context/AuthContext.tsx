import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Application } from "../data";
import { accountApi, type AccountPayload } from "../api";

export interface OnboardingData { roles: string[]; levels: string[]; formats: string[]; }
export interface NotificationSettings { newJobs: boolean; salaryDigest: boolean; trendDigest: boolean; companyActivity: boolean; }
export interface AccountSettings { profileVisible: boolean; showSalaryExpectation: boolean; }
export interface UserSettings { notifications: NotificationSettings; account: AccountSettings; }
export interface User { id?: number; name: string; email?: string | null; telegram?: string | null; telegramPhotoUrl?: string | null; }
export interface ResumeSkill { name: string; category: string; confirmed: boolean; }
export interface ResumeData { fileName: string; uploadedAt: string; experience: string; position: string; skills: ResumeSkill[]; }

interface AuthState {
  user: User | null; onboarding: OnboardingData | null; settings: UserSettings; resume: ResumeData | null;
  coverLetter: string; savedJobIds: number[]; savedJobNotes: Record<string, string>; applications: Application[]; isPro: boolean; isLoading: boolean;
  showAuthModal: boolean; showImportStep: boolean; showOnboarding: boolean; initialOnboarding: Partial<OnboardingData>;
  resumeSkills: ResumeSkill[]; setCoverLetter: (text: string) => Promise<void>; setResumeSkills: (skills: ResumeSkill[]) => Promise<void>;
  uploadResume: (file: File) => Promise<ResumeData>; clearResume: () => Promise<void>; toggleSavedJob: (id: number) => Promise<void>;
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
    setResume(account.resume); setResumeSkillsState(account.resume?.skills ?? []); setCoverLetterState(account.coverLetter ?? "");
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
    setUser(null); setOnboarding(null); setResume(null); setResumeSkillsState([]); setCoverLetterState("");
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
  const setResumeSkills = async (skills: ResumeSkill[]) => { setResumeSkillsState(skills); setResume((current) => current ? { ...current, skills } : current); await accountApi.patchResume(skills); };
  const uploadResume = async (file: File) => { const result = await accountApi.uploadResume(file); setResume(result.resume); setResumeSkillsState(result.resume.skills); return result.resume; };
  const clearResume = async () => { await accountApi.deleteResume(); setResume(null); setResumeSkillsState([]); };
  const completeOnboarding = async (data: OnboardingData) => { setOnboarding(data); setShowOnboarding(false); await accountApi.patchProfile({ onboarding: data }); };
  const updateSettings = async (next: UserSettings) => { setSettings(next); await accountApi.patchProfile({ settings: next }); };
  const updateName = async (name: string) => { setUser((current) => current ? { ...current, name } : current); await accountApi.patchProfile({ name }); };

  return <AuthContext.Provider value={{
    user, onboarding, settings, resume, coverLetter, savedJobIds, savedJobNotes, applications, isPro, isLoading, showAuthModal, showImportStep, showOnboarding, initialOnboarding, resumeSkills,
    setCoverLetter, setResumeSkills, uploadResume, clearResume, toggleSavedJob, updateSavedJobNote, isJobSaved: (id) => savedJobIds.includes(id), addApplication, updateApplication,
    activatePro: () => setIsPro(true), loginWithEmail, logout, changePassword, deleteAccount, openAuthModal: () => setShowAuthModal(true), closeAuthModal: () => setShowAuthModal(false),
    finishImport: (prefill) => { setShowImportStep(false); setInitialOnboarding(prefill ?? {}); setShowOnboarding(true); }, completeOnboarding, skipOnboarding: () => setShowOnboarding(false), updateSettings, updateName,
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error("useAuth must be used within AuthProvider"); return context; }
