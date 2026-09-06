import { useEffect, useRef, useState } from "react";
import { Navigate, Link } from "react-router";
import { useAuth, OnboardingData, UserSettings, ResumeSkill, type ResumeData, type ResumeTargetRole } from "../context/AuthContext";
import QuickApplyModal from "../components/QuickApplyModal";
import LogoBadge from "../components/LogoBadge";
import { type Job } from "../data";
import { useVacancyData } from "../context/VacancyDataContext";
import { accountApi } from "../api";

// Jobs that match confirmed skills
const MATCHED_JOBS = [
  { id: 1, title: "Senior Rust Engineer", company: "Yandex Cloud", logo: "YC", color: "#ff3e78", salary: "350–500 000 ₽", match: 87, matchedSkills: ["Rust", "Docker", "PostgreSQL"] },
  { id: 2, title: "Platform Engineer (Staff)", company: "Avito", logo: "AV", color: "#00d4ff", salary: "450–700 000 ₽", match: 92, matchedSkills: ["Go", "Kubernetes", "Terraform", "gRPC"] },
  { id: 3, title: "Backend Engineer (Golang)", company: "Тинькофф", logo: "TK", color: "#fbbf24", salary: "300–450 000 ₽", match: 95, matchedSkills: ["Go", "PostgreSQL", "gRPC", "Kafka"] },
  { id: 4, title: "ML Infrastructure Engineer", company: "Sber AI", logo: "SA", color: "#33ff77", salary: "400–600 000 ₽", match: 74, matchedSkills: ["Python", "Kubernetes", "Docker"] },
  { id: 5, title: "Site Reliability Engineer", company: "Авито", logo: "AV", color: "#00d4ff", salary: "380–580 000 ₽", match: 89, matchedSkills: ["Go", "Prometheus", "Kubernetes"] },
];

const ROLES = [
  { id: "backend", label: "Backend", desc: "Go, Python, Rust, Java" },
  { id: "frontend", label: "Frontend", desc: "React, TypeScript, Vue" },
  { id: "aiml", label: "AI / ML", desc: "PyTorch, LLM, CUDA" },
  { id: "devops", label: "DevOps / SRE", desc: "K8s, Terraform, Go" },
  { id: "mobile", label: "Mobile", desc: "Swift, Kotlin, Flutter" },
  { id: "data", label: "Data", desc: "Spark, ClickHouse, dbt" },
  { id: "security", label: "Security", desc: "Pentest, AppSec, RE" },
  { id: "fullstack", label: "Fullstack", desc: "Node.js + React, etc." },
];

const LEVELS = [
  { id: "junior", label: "Junior", sub: "до 2 лет опыта" },
  { id: "middle", label: "Middle", sub: "2–5 лет" },
  { id: "senior", label: "Senior", sub: "5+ лет" },
  { id: "lead", label: "Lead", sub: "команда 3–10" },
  { id: "staff", label: "Staff / Principal", sub: "системное влияние" },
];

const FORMATS = [
  { id: "remote", label: "Remote", sub: "откуда угодно" },
  { id: "hybrid", label: "Гибрид", sub: "1–3 дня в офисе" },
  { id: "office", label: "Офис", sub: "живая команда" },
  { id: "any", label: "Не важно", sub: "смотрю всё" },
];

type Tab = "preferences" | "resume" | "saved" | "settings";

function TagToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-sm border font-mono text-xs transition-all"
      style={{
        background: active ? "rgba(51,255,119,0.1)" : "rgba(14,16,24,0.6)",
        borderColor: active ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.5)",
        color: active ? "#33ff77" : "#5a6070",
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="w-9 h-5 rounded-full relative cursor-pointer transition-colors shrink-0 block"
      style={{ background: on ? "rgba(51,255,119,0.3)" : "#1a1d28" }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full transition-all block"
        style={{ left: on ? "calc(100% - 1.1rem)" : "0.125rem", background: on ? "#33ff77" : "#3a404f" }}
      />
    </button>
  );
}

function SavedBadge() {
  return (
    <span className="font-mono text-xs text-[#33ff77] flex items-center gap-1.5">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      сохранено
    </span>
  );
}

function resumeExperienceLabel(item: Pick<ResumeData, "experience" | "experienceYears" | "experienceMonths">) {
  if (item.experienceYears == null) return item.experience || "опыт не найден";
  const years = Math.max(0, Math.floor(item.experienceYears));
  const months = item.experienceMonths ?? Math.round((item.experienceYears - years) * 12);
  return months > 0 ? `${years} лет ${months} мес.` : `${years} лет`;
}

export default function Profile() {
  const { jobs } = useVacancyData();
  const { user, isLoading, onboarding, settings, completeOnboarding, updateSettings, updateName, logout, changePassword, deleteAccount, resume, resumes, resumeSkills, setResumeSkills, uploadResume, selectResume, updateResumeDetails, deleteResume, startHhImport, coverLetter, setCoverLetter, savedJobIds, toggleSavedJob, isPro } = useAuth();
  const [tab, setTab] = useState<Tab>("preferences");
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [clDraft, setClDraft] = useState(coverLetter);
  const [clSaved, setClSaved] = useState(false);

  // Resume state
  const [resumeData, setResumeData] = useState<ResumeData | null>(resume);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [contactDraft, setContactDraft] = useState({ fullName: "", contactEmail: "", contactPhone: "", contactTelegram: "" });
  const [contactSaved, setContactSaved] = useState(false);
  const [targetRoleSaving, setTargetRoleSaving] = useState(false);
  const [hhImporting, setHhImporting] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  const [extensionDownloading, setExtensionDownloading] = useState<"firefox" | "chrome" | null>(null);
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const resumeFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setResumeData(resume);
    setContactDraft({
      fullName: resume?.fullName ?? "",
      contactEmail: resume?.contactEmail ?? "",
      contactPhone: resume?.contactPhone ?? "",
      contactTelegram: resume?.contactTelegram ?? "",
    });
    setContactSaved(false);
  }, [resume]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imported = params.get("hh_imported");
    const error = params.get("hh_error");
    if (imported) setResumeNotice(`Импортировано резюме с HH.ru: ${imported}`);
    if (error) setResumeError(error);
    if (imported || error) setTab("resume");
  }, []);

  const openResumePicker = () => resumeFileRef.current?.click();

  const handleExtensionDownload = async (browser: "firefox" | "chrome") => {
    setExtensionError(null);
    setExtensionDownloading(browser);
    try {
      const blob = await accountApi.downloadExtension(browser);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = browser === "chrome" ? "jobs-dev-zen-extension-chrome.zip" : "jobs-dev-zen-extension.zip";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setExtensionError(requestError instanceof Error ? requestError.message : "Не удалось скачать расширение");
    } finally {
      setExtensionDownloading(null);
    }
  };

  const handleResumeFile = async (file: File) => {
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "docx"].includes(extension)) {
      setResumeError("Поддерживаются только файлы PDF и DOCX");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setResumeError("Файл больше 8 МБ");
      return;
    }

    setResumeError(null);
    setResumeUploading(true);
    try {
      const data = await uploadResume(file);
      setResumeData(data);
      setShowMatches(false);
    } catch (requestError) {
      setResumeError(requestError instanceof Error ? requestError.message : "Не удалось проанализировать резюме");
    } finally {
      setResumeUploading(false);
    }
  };

  const handleContactChange = (key: keyof typeof contactDraft, value: string) => {
    setContactDraft((current) => ({ ...current, [key]: value }));
    setContactSaved(false);
  };

  const handleSaveContacts = async () => {
    if (!resumeData) return;
    setResumeError(null);
    try {
      await updateResumeDetails(contactDraft);
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 2500);
    } catch (requestError) {
      setResumeError(requestError instanceof Error ? requestError.message : "Не удалось сохранить контакты");
    }
  };

  const handleTargetRoleChange = async (targetRole: ResumeTargetRole) => {
    if (!resumeData || resumeData.targetRole === targetRole) return;
    setResumeError(null);
    setTargetRoleSaving(true);
    try {
      await updateResumeDetails({ targetRole });
      const targetRoleLabel = targetRole === "DEVOPS" ? "DevOps / SRE" : targetRole === "ONE_C_DEVELOPER" ? "1С-разработчик" : "Java Backend";
      setResumeNotice(`Профиль «${targetRoleLabel}» выбран для этого резюме`);
      setShowMatches(false);
    } catch (requestError) {
      setResumeError(requestError instanceof Error ? requestError.message : "Не удалось сохранить специализацию");
    } finally {
      setTargetRoleSaving(false);
    }
  };

  const handleHhImport = async () => {
    setResumeError(null);
    setResumeNotice(null);
    setHhImporting(true);
    try {
      const url = await startHhImport();
      window.location.assign(url);
    } catch (requestError) {
      setResumeError(requestError instanceof Error ? requestError.message : "Не удалось запустить импорт с HH.ru");
    } finally {
      setHhImporting(false);
    }
  };

  const handleDeleteResume = async (target: ResumeData | null = resumeData) => {
    if (!target) return;
    if (!window.confirm(`Удалить резюме «${target.position || target.fileName}»?`)) return;
    setResumeError(null);
    try {
      await deleteResume(target.id);
      setShowMatches(false);
    } catch (requestError) {
      setResumeError(requestError instanceof Error ? requestError.message : "Не удалось удалить резюме");
    }
  };

  const handleResumeInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) void handleResumeFile(file);
  };

  const toggleSkill = (name: string) => {
    setResumeSkills(resumeSkills.map((s) => s.name === name ? { ...s, confirmed: !s.confirmed } : s));
  };

  const confirmedSkills = resumeSkills.filter((s) => s.confirmed);
  const confirmedNames = new Set(confirmedSkills.map((s) => s.name));
  const categories = Array.from(new Set(resumeSkills.map((s) => s.category)));

  // Preferences state
  const [roles, setRoles] = useState<string[]>(onboarding?.roles ?? []);
  const [levels, setLevels] = useState<string[]>(onboarding?.levels ?? []);
  const [formats, setFormats] = useState<string[]>(onboarding?.formats ?? []);
  const [prefDirty, setPrefDirty] = useState(false);
  const [prefSaved, setPrefSaved] = useState(false);

  // Settings state — mirror from context
  const [localSettings, setLocalSettings] = useState<UserSettings>(settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [telegramFilters, setTelegramFilters] = useState({
    keywords: (settings.notifications.telegramKeywords ?? []).join(", "),
    companies: (settings.notifications.telegramCompanies ?? []).join(", "),
    locations: (settings.notifications.telegramLocations ?? []).join(", "),
    technologies: (settings.notifications.telegramTechnologies ?? []).join(", "),
  });

  // Account form state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name ?? "");
  const [pwForm, setPwForm] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  if (isLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  const togglePref = <T extends string>(arr: T[], val: T, set: (v: T[]) => void) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
    setPrefDirty(true);
    setPrefSaved(false);
  };

  const handleSavePrefs = () => {
    completeOnboarding({ roles, levels, formats } as OnboardingData);
    setPrefDirty(false);
    setPrefSaved(true);
    setTimeout(() => setPrefSaved(false), 2500);
  };

  const patchNotif = (key: "newJobs" | "salaryDigest" | "trendDigest" | "companyActivity" | "telegramEnabled", val: boolean) => {
    const next = { ...localSettings, notifications: { ...localSettings.notifications, [key]: val } };
    setLocalSettings(next);
    setSettingsDirty(true);
    setSettingsSaved(false);
  };

  const patchTelegramFilter = (key: keyof typeof telegramFilters, value: string) => {
    setTelegramFilters((current) => ({ ...current, [key]: value }));
    setSettingsDirty(true);
    setSettingsSaved(false);
  };

  const patchAccount = (key: keyof typeof localSettings.account, val: boolean) => {
    const next = { ...localSettings, account: { ...localSettings.account, [key]: val } };
    setLocalSettings(next);
    setSettingsDirty(true);
    setSettingsSaved(false);
  };

  const handleSaveSettings = () => {
    const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
    updateSettings({
      ...localSettings,
      notifications: {
        ...localSettings.notifications,
        telegramKeywords: split(telegramFilters.keywords),
        telegramCompanies: split(telegramFilters.companies),
        telegramLocations: split(telegramFilters.locations),
        telegramTechnologies: split(telegramFilters.technologies),
      },
    });
    setSettingsDirty(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2500);
  };

  const handleSaveName = () => {
    if (nameInput.trim()) { updateName(nameInput.trim()); setEditingName(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    if (pwCurrent.length < 6) { setPwError("Введи текущий пароль"); return; }
    if (pwNew.length < 8) { setPwError("Новый пароль — минимум 8 символов"); return; }
    if (pwNew !== pwConfirm) { setPwError("Пароли не совпадают"); return; }
    try {
      await changePassword(pwCurrent, pwNew);
      setPwSaved(true);
      setPwForm(false);
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
      setTimeout(() => setPwSaved(false), 3000);
    } catch (requestError) {
      setPwError(requestError instanceof Error ? requestError.message : "Не удалось изменить пароль");
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "preferences", label: "Предпочтения" },
    { id: "resume", label: "Резюме" },
    { id: "saved", label: "Сохранённые" },
    { id: "settings", label: "Настройки" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header — no avatar */}
      <div className="flex items-start justify-between gap-6 mb-10">
        <div>
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// профиль</div>

          {editingName ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                className="bg-transparent border-b border-[rgba(51,255,119,0.4)] font-mono text-2xl text-white font-medium focus:outline-none pb-0.5 w-48"
              />
              <button onClick={handleSaveName} className="font-mono text-xs text-[#33ff77] hover:underline">сохранить</button>
              <button onClick={() => setEditingName(false)} className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070]">отмена</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2 group">
              <h1 className="font-mono text-2xl text-white font-medium">{user.name}</h1>
              {isPro && (
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm tracking-wider bg-[rgba(255,62,120,0.12)] border border-[rgba(255,62,120,0.35)] text-[#ff3e78]">
                  PRO
                </span>
              )}
              <button
                onClick={() => { setNameInput(user.name); setEditingName(true); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[#3a404f] hover:text-[#5a6070]"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            {user.email && <span className="font-mono text-xs text-[#5a6070]">{user.email}</span>}
            {user.telegram && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-[#00d4ff]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.93.44l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.52.25l.19-2.64 4.83-4.37c-.21-.19-.05-.29-.32-.1L7.5 14.45 5.0 13.68c-.55-.17-.56-.55.12-.81l9.89-3.81c.46-.17.86.11.63.74z" />
                </svg>
                <span className="font-mono text-xs text-[#00d4ff]">{user.telegram}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              {roles.slice(0, 4).map((r) => (
                <span key={r} className="tag neon-badge">{ROLES.find((x) => x.id === r)?.label ?? r}</span>
              ))}
              {roles.length > 4 && <span className="font-mono text-[10px] text-[#3a404f]">+{roles.length - 4}</span>}
              {roles.length === 0 && <span className="font-mono text-xs text-[#3a404f]">роли не выбраны</span>}
            </div>
          </div>
        </div>
        <button onClick={logout} className="font-mono text-xs text-[#3a404f] hover:text-[#ff3e78] transition-colors shrink-0 hidden sm:block">
          выйти
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-px mb-8 border-b border-[rgba(51,255,119,0.08)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`font-mono text-xs px-5 py-3 border-b-2 transition-all -mb-px ${
              tab === t.id ? "border-[#33ff77] text-[#33ff77]" : "border-transparent text-[#5a6070] hover:text-[#e8eaf0]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PREFERENCES ── */}
      {tab === "preferences" && (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// роли</div>
                <p className="font-sans text-xs text-[#5a6070]">Показываем вакансии и зарплатные данные по выбранным специализациям</p>
              </div>
              <span className="font-mono text-xs text-[#3a404f]">{roles.length} выбрано</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {ROLES.map((r) => {
                const active = roles.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => togglePref(roles, r.id, setRoles)}
                    className="flex flex-col items-start p-3 rounded-sm border transition-all text-left"
                    style={{
                      background: active ? "rgba(51,255,119,0.07)" : "rgba(14,16,24,0.6)",
                      borderColor: active ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.4)",
                    }}
                  >
                    <span className={`font-sans font-semibold text-sm mb-0.5 ${active ? "text-white" : "text-[#e8eaf0]"}`}>{r.label}</span>
                    <span className="font-mono text-[10px] text-[#5a6070]">{r.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// грейд</div>
                <p className="font-sans text-xs text-[#5a6070]">Уровень вакансий, которые тебе интересны</p>
              </div>
              <span className="font-mono text-xs text-[#3a404f]">{levels.length} выбрано</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <TagToggle key={l.id} active={levels.includes(l.id)} onClick={() => togglePref(levels, l.id, setLevels)}>
                  {l.label} <span className="opacity-50 ml-1">· {l.sub}</span>
                </TagToggle>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// формат работы</div>
                <p className="font-sans text-xs text-[#5a6070]">Применяется как фильтр по умолчанию на главной</p>
              </div>
              <span className="font-mono text-xs text-[#3a404f]">{formats.length} выбрано</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <TagToggle key={f.id} active={formats.includes(f.id)} onClick={() => togglePref(formats, f.id, setFormats)}>
                  {f.label} <span className="opacity-50 ml-1">· {f.sub}</span>
                </TagToggle>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2 border-t border-[rgba(51,255,119,0.08)]">
            <button
              onClick={handleSavePrefs}
              disabled={!prefDirty}
              className="px-6 py-2.5 font-mono text-sm rounded-sm transition-all disabled:opacity-30"
              style={{
                background: prefDirty ? "#33ff77" : "rgba(51,255,119,0.1)",
                color: prefDirty ? "#07080e" : "#33ff77",
                border: "1px solid rgba(51,255,119,0.4)",
              }}
            >
              сохранить изменения
            </button>
            {prefSaved && <SavedBadge />}
          </div>
        </div>
      )}

      {/* ── RESUME ── */}
      {tab === "resume" && (
        <div>
          <input ref={resumeFileRef} id="resume-upload" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={handleResumeInputChange} />
          <div className="mb-6 border border-[rgba(0,212,255,0.14)] rounded-sm overflow-hidden">
            <div className="px-5 py-3 bg-[rgba(0,212,255,0.04)] border-b border-[rgba(0,212,255,0.1)]">
              <div className="font-mono text-xs text-[#00d4ff] uppercase tracking-widest">// расширение для быстрого отклика</div>
              <div className="font-sans text-[11px] text-[#5a6070] mt-0.5">Показывает подсказку на страницах вакансий и заполняет форму выбранным резюме</div>
            </div>
            <div className="p-5 bg-[#0e1018] flex items-center justify-between gap-4 flex-wrap">
              <div className="font-mono text-[11px] text-[#5a6070]">доступно для авторизованного аккаунта · Zen / Firefox / Chrome</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => void handleExtensionDownload("firefox")} disabled={extensionDownloading !== null} className="px-4 py-2 min-h-11 font-mono text-xs rounded-sm bg-[rgba(0,212,255,0.1)] border border-[rgba(0,212,255,0.35)] text-[#00d4ff] hover:bg-[rgba(0,212,255,0.18)] disabled:opacity-40 transition-all">
                  {extensionDownloading === "firefox" ? "готовим архив..." : "скачать для Firefox →"}
                </button>
                <button type="button" onClick={() => void handleExtensionDownload("chrome")} disabled={extensionDownloading !== null} className="px-4 py-2 min-h-11 font-mono text-xs rounded-sm bg-[rgba(0,212,255,0.1)] border border-[rgba(0,212,255,0.35)] text-[#00d4ff] hover:bg-[rgba(0,212,255,0.18)] disabled:opacity-40 transition-all">
                  {extensionDownloading === "chrome" ? "готовим архив..." : "скачать для Chrome →"}
                </button>
              </div>
            </div>
            {extensionError && <div role="alert" className="px-5 pb-4 bg-[#0e1018] font-sans text-xs text-[#ff3e78]">{extensionError}</div>}
          </div>
          {resumeNotice && (
            <div role="status" className="mb-5 border border-[rgba(51,255,119,0.25)] bg-[rgba(51,255,119,0.06)] rounded-sm px-4 py-3 flex items-center justify-between gap-4">
              <div className="font-sans text-xs text-[#e8eaf0]">{resumeNotice}</div>
              <button type="button" onClick={() => setResumeNotice(null)} className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] min-h-11 px-2">закрыть</button>
            </div>
          )}
          {resumeError && (
            <div role="alert" className="mb-5 border border-[rgba(255,62,120,0.35)] bg-[rgba(255,62,120,0.08)] rounded-sm px-4 py-3 flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-xs text-[#ff3e78] mb-1">не удалось загрузить резюме</div>
                <div className="font-sans text-xs text-[#e8eaf0]">{resumeError}</div>
              </div>
              <button type="button" onClick={openResumePicker} className="font-mono text-xs text-[#ff3e78] hover:text-white transition-colors shrink-0 min-h-11 px-2">
                попробовать снова
              </button>
            </div>
          )}
          {resumes.length > 0 && (
            <div className="mb-6 border border-[rgba(51,255,119,0.1)] rounded-sm overflow-hidden">
              <div className="px-4 py-3 bg-[#0a0b12] border-b border-[rgba(51,255,119,0.06)] flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// мои резюме</div>
                  <div className="font-sans text-[11px] text-[#5a6070] mt-0.5">Выбери резюме для текущего отклика</div>
                </div>
                <span className="font-mono text-xs text-[#33ff77]">{resumes.length}</span>
              </div>
              <div className="divide-y divide-[rgba(51,255,119,0.05)]">
                {resumes.map((item) => (
                  <div key={item.id} className={`px-4 py-3 flex items-center gap-3 transition-colors ${item.id === resumeData?.id ? "bg-[rgba(51,255,119,0.07)]" : "bg-[#0e1018]"}`}>
                    <button
                      type="button"
                      aria-pressed={item.id === resumeData?.id}
                      onClick={() => { setResumeError(null); void selectResume(item.id); }}
                      className="min-w-0 flex-1 text-left py-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33ff77]"
                    >
                      <span className={`block truncate font-sans text-sm ${item.id === resumeData?.id ? "text-white" : "text-[#e8eaf0]"}`}>{item.position || item.fileName}</span>
                      <span className="block truncate font-mono text-[10px] text-[#5a6070] mt-0.5">{resumeExperienceLabel(item)}</span>
                    </button>
                    <span className={`font-mono text-[10px] shrink-0 ${item.id === resumeData?.id ? "text-[#33ff77]" : "text-[#3a404f]"}`}>{item.id === resumeData?.id ? "активно" : "выбрать"}</span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteResume(item)}
                      aria-label={`Удалить резюме ${item.position || item.fileName}`}
                      className="font-mono text-[10px] text-[#5a6070] hover:text-[#ff3e78] transition-colors min-h-11 px-2 shrink-0"
                    >
                      удалить
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-[#0a0b12] flex flex-wrap items-center gap-3">
                <button type="button" onClick={openResumePicker} className="font-mono text-xs text-[#33ff77] hover:text-white min-h-11 px-2">+ загрузить ещё</button>
                <button type="button" onClick={() => void handleHhImport()} disabled={hhImporting} className="font-mono text-xs text-[#00d4ff] hover:text-white disabled:opacity-40 min-h-11 px-2">{hhImporting ? "переходим на HH.ru..." : "импортировать с HH.ru"}</button>
              </div>
            </div>
          )}
          {/* Empty state */}
          {!resumeData && !resumeUploading && (
            <div>
              <p className="font-sans text-sm text-[#5a6070] mb-6">
                Загрузи резюме — извлечём навыки и найдём вакансии с максимальным совпадением
              </p>
              <button
                type="button"
                aria-label="Загрузить резюме в формате PDF или DOCX"
                aria-describedby="resume-upload-hint"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openResumePicker(); } }}
                className={`w-full p-0 text-left bg-transparent border-2 border-dashed rounded-sm transition-all cursor-pointer focus-visible:outline-1 focus-visible:outline-[#33ff77] ${resumeDragOver ? "border-[rgba(51,255,119,0.5)] bg-[rgba(51,255,119,0.05)]" : "border-[rgba(51,255,119,0.2)] hover:border-[rgba(51,255,119,0.4)] hover:bg-[rgba(51,255,119,0.02)]"}`}
                onClick={openResumePicker}
                onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
                onDragLeave={() => setResumeDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setResumeDragOver(false); const f = e.dataTransfer.files[0]; if (f) void handleResumeFile(f); }}
              >
                <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                  <div className="w-12 h-12 flex items-center justify-center rounded-sm bg-[rgba(51,255,119,0.08)] border border-[rgba(51,255,119,0.2)] mb-4">
                    <svg className="w-6 h-6 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="font-sans text-sm text-white font-medium mb-1">Перетащи файл или нажми для выбора</div>
                  <div id="resume-upload-hint" className="font-mono text-xs text-[#5a6070]">PDF или DOCX · до 8 МБ</div>
                </div>
              </button>
              <div className="flex items-center justify-center gap-3 mt-3">
                <span className="font-mono text-[10px] text-[#3a404f]">или</span>
                <button type="button" onClick={() => void handleHhImport()} disabled={hhImporting} className="font-mono text-xs text-[#00d4ff] hover:text-white disabled:opacity-40 min-h-11 px-2">{hhImporting ? "переходим на HH.ru..." : "импортировать своё с HH.ru"}</button>
              </div>
            </div>
          )}

          {/* Uploading */}
          {resumeUploading && (
            <div role="status" aria-live="polite" aria-busy="true" className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-10 text-center">
              <div className="font-mono text-sm text-white mb-1">Анализируем резюме...</div>
              <div className="font-sans text-xs text-[#5a6070] mb-6">извлекаем навыки, определяем грейд и специализации</div>
              <div className="h-1 bg-[#1a1d28] rounded-full max-w-xs mx-auto overflow-hidden">
                <div className="resume-parse-bar h-full bg-[#33ff77] rounded-full" style={{ animation: "parseBar 2.4s ease-out forwards" }} />
              </div>
              <style>{`@keyframes parseBar { from { width: 0% } to { width: 100% } } @media (prefers-reduced-motion: reduce) { .resume-parse-bar { animation-duration: 0.01ms !important; } }`}</style>
            </div>
          )}

          {/* Parsed result */}
          {resumeData && !resumeUploading && (
            <div className="space-y-6">
              {/* File info + stats */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 flex items-center justify-center rounded bg-[rgba(51,255,119,0.08)] border border-[rgba(51,255,119,0.2)] shrink-0">
                    <svg className="w-4 h-4 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-sans text-sm text-white font-medium">{resumeData.position || "Резюме загружено"}</div>
                    <div className="font-mono text-xs text-[#5a6070]">
                      {[resumeData.fileName, resumeData.source === "hh" ? "импортировано с HH.ru" : resumeData.uploadedAt, `${resumeExperienceLabel(resumeData)} опыта`, resumeData.hasFile === false ? "файл отсутствует — загрузи заново" : "файл сохранён"].filter(Boolean).join(" · ")}
                    </div>
                    {resumeData.sourceUrl && <a href={resumeData.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-[#00d4ff] hover:text-white">открыть на HH.ru ↗</a>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDeleteResume}
                    className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors min-h-11 px-2"
                  >
                    удалить
                  </button>
                  <button
                    onClick={openResumePicker}
                    className="font-mono text-xs px-3 py-1.5 min-h-11 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)] rounded-sm transition-all"
                  >
                    загрузить другое
                  </button>
                </div>
              </div>

              <div className="border border-[rgba(51,255,119,0.14)] rounded-sm overflow-hidden">
                <div className="px-5 py-3 bg-[rgba(51,255,119,0.03)] border-b border-[rgba(51,255,119,0.08)]">
                  <div className="font-mono text-xs text-[#33ff77] uppercase tracking-widest">// специализация для поиска</div>
                  <div className="font-sans text-[11px] text-[#5a6070] mt-0.5">Она определяет, по какому стеку оценивать вакансии для этого резюме</div>
                </div>
                <div role="group" aria-label="Специализация резюме" className="p-4 bg-[#0e1018] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {([
                    { value: "JAVA_BACKEND", title: "Java Backend", text: "Java, Spring, базы данных и backend-архитектура" },
                    { value: "DEVOPS", title: "DevOps / SRE", text: "Linux, Kubernetes, облака, CI/CD и инфраструктура" },
                    { value: "ONE_C_DEVELOPER", title: "1С-разработчик", text: "1С:Предприятие, конфигурации, запросы и интеграции" },
                  ] as const).map((option) => {
                    const selected = (resumeData.targetRole ?? "JAVA_BACKEND") === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={targetRoleSaving}
                        onClick={() => void handleTargetRoleChange(option.value)}
                        className={`min-h-16 px-4 py-3 text-left rounded-sm border transition-all disabled:opacity-50 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#33ff77] ${selected ? "border-[rgba(51,255,119,0.48)] bg-[rgba(51,255,119,0.10)]" : "border-[rgba(58,64,79,0.48)] bg-[#07080e] hover:border-[rgba(51,255,119,0.3)]"}`}
                      >
                        <span className={`block font-mono text-xs ${selected ? "text-[#33ff77]" : "text-[#e8eaf0]"}`}>{option.title}{selected ? " · выбрано" : ""}</span>
                        <span className="block font-sans text-[11px] text-[#5a6070] mt-1">{option.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Contact details used by applications */}
              <div className="border border-[rgba(0,212,255,0.14)] rounded-sm overflow-hidden">
                <div className="px-5 py-3 bg-[rgba(0,212,255,0.04)] border-b border-[rgba(0,212,255,0.1)]">
                  <div className="font-mono text-xs text-[#00d4ff] uppercase tracking-widest">// данные для отклика</div>
                  <div className="font-sans text-[11px] text-[#5a6070] mt-0.5">Заполнено из резюме автоматически — при необходимости можно поправить</div>
                </div>
                <div className="p-5 bg-[#0e1018] grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {([
                    ["fullName", "ФИО", "Как к тебе обращаться"],
                    ["contactEmail", "Email", "name@example.com"],
                    ["contactPhone", "Телефон", "+7 ..."],
                    ["contactTelegram", "Telegram", "@username"],
                  ] as const).map(([key, label, placeholder]) => (
                    <label key={key} className="block">
                      <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-wider block mb-1">{label}</span>
                      <input
                        value={contactDraft[key]}
                        onChange={(event) => handleContactChange(key, event.target.value)}
                        placeholder={placeholder}
                        className="w-full min-h-11 bg-[#07080e] border border-[rgba(58,64,79,0.4)] focus:border-[rgba(51,255,119,0.35)] px-3 py-2 font-mono text-sm text-[#e8eaf0] placeholder-[#3a404f] rounded-sm transition-colors focus:outline-none"
                      />
                    </label>
                  ))}
                  <div className="sm:col-span-2 flex items-center gap-4 pt-1">
                    <button type="button" onClick={() => void handleSaveContacts()} className="px-4 py-2 min-h-11 font-mono text-xs rounded-sm bg-[rgba(51,255,119,0.12)] border border-[rgba(51,255,119,0.3)] text-[#33ff77] hover:bg-[rgba(51,255,119,0.2)] transition-all">сохранить контакты</button>
                    {contactSaved && <SavedBadge />}
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-px bg-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden">
                {[
                  { value: resumeSkills.length, label: "найдено навыков" },
                  { value: confirmedSkills.length, label: "подтверждено" },
                  { value: resumeSkills.length - confirmedSkills.length, label: "отключено" },
                ].map((s) => (
                  <div key={s.label} className="bg-[#07080e] px-4 py-3 text-center">
                    <div className="font-mono text-xl font-medium text-[#33ff77]">{s.value}</div>
                    <div className="font-sans text-[10px] text-[#3a404f] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Skills by category */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">навыки — нажми чтобы убрать лишнее</div>
                  <span className="font-mono text-[10px] text-[#3a404f]">{confirmedSkills.length} выбрано</span>
                </div>

                <div className="space-y-4">
                  {categories.map((cat) => {
                    const catSkills = resumeSkills.filter((s) => s.category === cat);
                    return (
                      <div key={cat}>
                        <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-2">{cat}</div>
                        <div className="flex flex-wrap gap-2">
                          {catSkills.map((skill) => (
                            <button
                              key={skill.name}
                              onClick={() => toggleSkill(skill.name)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border transition-all"
                              style={{
                                background: skill.confirmed ? "rgba(51,255,119,0.08)" : "transparent",
                                borderColor: skill.confirmed ? "rgba(51,255,119,0.35)" : "rgba(58,64,79,0.3)",
                                opacity: skill.confirmed ? 1 : 0.4,
                              }}
                            >
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: skill.confirmed ? "#33ff77" : "#3a404f" }} />
                              <span className="font-mono text-xs" style={{ color: skill.confirmed ? "#33ff77" : "#3a404f" }}>
                                {skill.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cover letter */}
              <div className="border border-[rgba(51,255,119,0.1)] rounded-sm overflow-hidden">
                <div className="px-5 py-3 bg-[rgba(51,255,119,0.03)] border-b border-[rgba(51,255,119,0.08)] flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// универсальное сопроводительное</div>
                    <div className="font-sans text-[11px] text-[#5a6070] mt-0.5">Вставляется в отклик одной кнопкой · можно адаптировать под конкретную вакансию</div>
                  </div>
                  {clSaved && (
                    <span className="font-mono text-xs text-[#33ff77] flex items-center gap-1 shrink-0">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      сохранено
                    </span>
                  )}
                </div>
                <div className="p-5 bg-[#0e1018]">
                  <textarea
                    className="w-full h-36 bg-[#07080e] border border-[rgba(58,64,79,0.4)] rounded-sm px-4 py-3 font-sans text-sm text-[#e8eaf0] placeholder-[#3a404f] resize-none focus:outline-none focus:border-[rgba(51,255,119,0.3)] transition-colors"
                    placeholder={"Привет! Я senior backend-инженер с 6+ годами опыта в Go, Rust и Python.\nСпециализируюсь на высоконагруженных системах и микросервисной архитектуре...\n\nНапиши здесь — и это письмо можно будет вставить в любой отклик одной кнопкой."}
                    value={clDraft}
                    onChange={(e) => { setClDraft(e.target.value); setClSaved(false); }}
                  />
                  <div className="flex items-center justify-between mt-3">
                    <div className="font-mono text-[10px] text-[#3a404f]">{clDraft.length} символов</div>
                    <button
                      onClick={() => { setCoverLetter(clDraft); setClSaved(true); setTimeout(() => setClSaved(false), 2500); }}
                      disabled={clDraft === coverLetter}
                      className="px-4 py-2 font-mono text-xs rounded-sm transition-all disabled:opacity-30"
                      style={{
                        background: clDraft !== coverLetter ? "rgba(51,255,119,0.12)" : "transparent",
                        border: "1px solid rgba(51,255,119,0.3)",
                        color: "#33ff77",
                      }}
                    >
                      сохранить письмо
                    </button>
                  </div>
                </div>
              </div>

              {/* Find matches CTA */}
              <div className="border-t border-[rgba(51,255,119,0.08)] pt-5">
                <button
                  onClick={() => setShowMatches(!showMatches)}
                  className="flex items-center gap-2 px-6 py-3 bg-[#33ff77] text-[#07080e] font-mono text-sm font-medium rounded-sm hover:bg-[#4dff8a] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  найти совпадения в вакансиях
                  <span className="font-mono text-xs opacity-70">({confirmedSkills.length} навыков)</span>
                </button>
              </div>

              {/* Matches */}
              {showMatches && (
                <div className="space-y-3">
                  <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">вакансии с совпадением навыков</div>
                  {MATCHED_JOBS.sort((a, b) => b.match - a.match).map((job) => {
                    const matchColor = job.match >= 90 ? "#33ff77" : job.match >= 75 ? "#00d4ff" : "#fbbf24";
                    return (
                      <div key={job.id} className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] hover:bg-[#141620] rounded-sm px-5 py-4 transition-colors group cursor-pointer">
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 flex items-center justify-center rounded font-mono text-xs font-medium shrink-0"
                            style={{ background: `${job.color}18`, border: `1px solid ${job.color}40`, color: job.color }}
                          >
                            {job.logo}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-sans font-semibold text-sm text-[#e8eaf0] group-hover:text-white transition-colors">{job.title}</div>
                                <div className="font-mono text-xs text-[#5a6070] mt-0.5">{job.company}</div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-xs text-[#33ff77]">{job.salary}</span>
                                <div
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-sm font-mono text-xs font-medium"
                                  style={{ background: `${matchColor}12`, border: `1px solid ${matchColor}35`, color: matchColor }}
                                >
                                  {job.match}%
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className="font-mono text-[10px] text-[#3a404f]">совпадают:</span>
                              {job.matchedSkills.map((s) => (
                                <span
                                  key={s}
                                  className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm"
                                  style={{
                                    background: confirmedNames.has(s) ? "rgba(51,255,119,0.1)" : "rgba(58,64,79,0.2)",
                                    border: `1px solid ${confirmedNames.has(s) ? "rgba(51,255,119,0.3)" : "rgba(58,64,79,0.4)"}`,
                                    color: confirmedNames.has(s) ? "#33ff77" : "#5a6070",
                                  }}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>

                            {/* Match bar */}
                            <div className="mt-3 h-0.5 bg-[#1a1d28] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{ width: `${job.match}%`, background: matchColor }}
                              />
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setApplyJob({ id: job.id, title: job.title, company: job.company, companyId: "", logo: job.logo, logoColor: job.color, location: "Remote", salary: job.salary, tags: [], type: "Fulltime", posted: "", featured: false, category: "Backend", level: "Senior", description: "", parsedSkills: [] }); }}
                                className="px-3 py-1.5 font-mono text-[10px] rounded-sm transition-all"
                                style={{ background: "rgba(51,255,119,0.1)", border: "1px solid rgba(51,255,119,0.3)", color: "#33ff77" }}
                              >
                                быстрый отклик →
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <Link
                    to="/"
                    className="flex items-center justify-center gap-2 w-full py-3 font-mono text-xs border border-[rgba(51,255,119,0.2)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] rounded-sm transition-all mt-2"
                  >
                    смотреть все вакансии →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SAVED ── */}
      {tab === "saved" && (
        <div className="space-y-2">
          {savedJobIds.length === 0 && (
            <div className="text-center py-16">
              <div className="font-mono text-[#3a404f] text-sm">// нет сохранённых вакансий</div>
              <Link to="/" className="font-mono text-xs text-[#33ff77] hover:underline mt-3 inline-block">смотреть вакансии →</Link>
            </div>
          )}
          {savedJobIds
            .map((sid) => jobs.find((j) => j.id === sid))
            .filter((j): j is Job => Boolean(j))
            .map((job) => (
              <div key={job.id} className="card-surface rounded-sm px-5 py-4 flex items-center gap-4 group">
                <Link to={`/jobs/${job.id}`} className="shrink-0">
                  <LogoBadge logo={job.logo} logoUrl={job.logoUrl} color={job.logoColor} className="w-10 h-10 rounded text-sm" loading="lazy" />
                </Link>
                <Link to={`/jobs/${job.id}`} className="flex-1 min-w-0">
                  <div className="font-sans font-semibold text-sm text-[#e8eaf0] group-hover:text-white transition-colors">{job.title}</div>
                  <div className="font-mono text-xs text-[#5a6070] mt-0.5">{job.company} · {job.location}</div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="font-mono text-sm text-[#33ff77]">{job.salary}</div>
                </div>
                <button
                  onClick={() => setApplyJob(job)}
                  className="font-mono text-xs px-3 py-1.5 rounded-sm transition-all shrink-0"
                  style={{ background: "rgba(51,255,119,0.1)", border: "1px solid rgba(51,255,119,0.3)", color: "#33ff77" }}
                >
                  отклик →
                </button>
                <button
                  onClick={() => toggleSavedJob(job.id)}
                  title="убрать из сохранённых"
                  className="w-7 h-7 flex items-center justify-center text-[#3a404f] hover:text-[#ff3e78] transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === "settings" && (
        <div className="space-y-10 max-w-lg">

          {/* Notifications */}
          <div>
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// уведомления</div>
            <p className="font-sans text-xs text-[#5a6070] mb-5">
              {user.telegram ? `Отправляем в Telegram ${user.telegram}` : `Отправляем на ${user.email}`}
            </p>
            <div className="space-y-0 border border-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden">
              {([
                { key: "newJobs", label: "Новые вакансии по моим ролям", sub: "Раз в день, только совпадающие с предпочтениями" },
                { key: "salaryDigest", label: "Изменения зарплат", sub: "Еженедельный срез по выбранным специализациям" },
                { key: "trendDigest", label: "Дайджест трендов рынка", sub: "По понедельникам — что выросло, что упало" },
                { key: "companyActivity", label: "Активность компаний", sub: "Когда компания из вишлиста открывает вакансии" },
              ] as { key: keyof typeof localSettings.notifications; label: string; sub: string }[]).map((item, i, arr) => (
                <div
                  key={item.key}
                  className={`flex items-center justify-between px-5 py-4 bg-[#0e1018] hover:bg-[#141620] transition-colors ${i < arr.length - 1 ? "border-b border-[rgba(51,255,119,0.06)]" : ""}`}
                >
                  <div>
                    <div className="font-sans text-sm text-[#e8eaf0]">{item.label}</div>
                    <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">{item.sub}</div>
                  </div>
                  <Toggle label={item.label} on={localSettings.notifications[item.key]} onChange={(v) => patchNotif(item.key, v)} />
                </div>
              ))}
            </div>

            <div className="mt-5 border border-[rgba(0,212,255,0.2)] bg-[rgba(0,212,255,0.035)] rounded-sm p-5">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <div className="font-mono text-xs text-[#00d4ff] uppercase tracking-widest">// telegram-канал</div>
                  <div className="font-sans text-sm text-[#e8eaf0] mt-2">Новые вакансии после каждого обновления</div>
                </div>
                <Toggle label="Новые вакансии в Telegram" on={Boolean(localSettings.notifications.telegramEnabled)} onChange={(v) => patchNotif("telegramEnabled", v)} />
              </div>
              <p className="font-sans text-xs text-[#5a6070] mb-4">
                {user.telegram ? `Сообщения будут приходить в Telegram ${user.telegram}.` : "Сначала войди через Telegram, чтобы бот мог отправлять сообщения."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  ["keywords", "Ключевые слова", "java, backend, kafka"],
                  ["technologies", "Технологии", "Java, Python, Docker"],
                  ["companies", "Компании", "Яндекс, Ozon"],
                  ["locations", "Города", "Москва, удалённо"],
                ] as const).map(([key, label, placeholder]) => (
                  <label key={key} className="block">
                    <span className="font-mono text-[10px] text-[#5a6070] uppercase tracking-wider">{label}</span>
                    <input
                      value={telegramFilters[key]}
                      onChange={(event) => patchTelegramFilter(key, event.target.value)}
                      placeholder={placeholder}
                      className="mt-1 w-full bg-[#07080e] border border-[rgba(58,64,79,0.55)] rounded-sm px-3 py-2 font-mono text-xs text-[#e8eaf0] placeholder:text-[#3a404f] focus:border-[#00d4ff] focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              <div className="font-mono text-[10px] text-[#3a404f] mt-3">через запятую · пустое поле не ограничивает выдачу · применяются только новые вакансии</div>
            </div>
          </div>

          {/* Privacy */}
          <div>
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// приватность</div>
            <p className="font-sans text-xs text-[#5a6070] mb-5">Управляй видимостью профиля для работодателей</p>
            <div className="space-y-0 border border-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden">
              {([
                { key: "profileVisible", label: "Профиль виден работодателям", sub: "Компании могут найти тебя через поиск кандидатов" },
                { key: "showSalaryExpectation", label: "Показывать ожидаемую зарплату", sub: "Работодатели увидят твою вилку при просмотре профиля" },
              ] as { key: keyof typeof localSettings.account; label: string; sub: string }[]).map((item, i, arr) => (
                <div
                  key={item.key}
                  className={`flex items-center justify-between px-5 py-4 bg-[#0e1018] hover:bg-[#141620] transition-colors ${i < arr.length - 1 ? "border-b border-[rgba(51,255,119,0.06)]" : ""}`}
                >
                  <div>
                    <div className="font-sans text-sm text-[#e8eaf0]">{item.label}</div>
                    <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">{item.sub}</div>
                  </div>
                  <Toggle label={item.label} on={localSettings.account[item.key]} onChange={(v) => patchAccount(item.key, v)} />
                </div>
              ))}
            </div>
          </div>

          {/* Save settings */}
          <div className="flex items-center gap-4 pt-0 border-t border-[rgba(51,255,119,0.08)] pt-2">
            <button
              onClick={handleSaveSettings}
              disabled={!settingsDirty}
              className="px-6 py-2.5 font-mono text-sm rounded-sm transition-all disabled:opacity-30"
              style={{
                background: settingsDirty ? "#33ff77" : "rgba(51,255,119,0.1)",
                color: settingsDirty ? "#07080e" : "#33ff77",
                border: "1px solid rgba(51,255,119,0.4)",
              }}
            >
              сохранить настройки
            </button>
            {settingsSaved && <SavedBadge />}
          </div>

          {/* Account */}
          <div>
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// аккаунт</div>

            {/* Change name */}
            <div className="border border-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden mb-3">
              <div className="px-5 py-4 bg-[#0e1018] flex items-center justify-between">
                <div>
                  <div className="font-sans text-sm text-[#e8eaf0]">Отображаемое имя</div>
                  <div className="font-mono text-xs text-[#5a6070] mt-0.5">{user.name}</div>
                </div>
                <button
                  onClick={() => { setNameInput(user.name); setEditingName(true); }}
                  className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors"
                >
                  изменить
                </button>
              </div>
            </div>

            {/* Change password — only for email users */}
            {user.email && (
              <div className="border border-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden mb-3">
                <div
                  className="px-5 py-4 bg-[#0e1018] flex items-center justify-between cursor-pointer hover:bg-[#141620] transition-colors"
                  onClick={() => { setPwForm(!pwForm); setPwError(""); setPwSaved(false); }}
                >
                  <div>
                    <div className="font-sans text-sm text-[#e8eaf0]">Пароль</div>
                    <div className="font-mono text-xs text-[#5a6070] mt-0.5">последнее изменение — сегодня</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pwSaved && <span className="font-mono text-xs text-[#33ff77]">изменён ✓</span>}
                    <svg
                      className={`w-4 h-4 text-[#3a404f] transition-transform ${pwForm ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {pwForm && (
                  <form onSubmit={handleChangePassword} className="px-5 py-4 border-t border-[rgba(51,255,119,0.06)] bg-[#0a0b12] space-y-3">
                    {[
                      { label: "Текущий пароль", val: pwCurrent, set: setPwCurrent, placeholder: "••••••••" },
                      { label: "Новый пароль", val: pwNew, set: setPwNew, placeholder: "минимум 6 символов" },
                      { label: "Повтор нового", val: pwConfirm, set: setPwConfirm, placeholder: "••••••••" },
                    ].map((f) => (
                      <div key={f.label}>
                        <label className="font-mono text-[10px] text-[#3a404f] uppercase tracking-wider block mb-1">{f.label}</label>
                        <input
                          type="password"
                          value={f.val}
                          onChange={(e) => { f.set(e.target.value); setPwError(""); }}
                          placeholder={f.placeholder}
                          className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.12)] focus:border-[rgba(51,255,119,0.35)] px-4 py-2 font-mono text-sm text-[#e8eaf0] rounded-sm transition-colors"
                        />
                      </div>
                    ))}
                    {pwError && (
                      <div className="font-mono text-xs text-[#ff3e78] bg-[rgba(255,62,120,0.08)] border border-[rgba(255,62,120,0.2)] px-3 py-2 rounded-sm">
                        {pwError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" className="px-5 py-2 bg-[rgba(51,255,119,0.12)] border border-[rgba(51,255,119,0.3)] text-[#33ff77] font-mono text-xs rounded-sm hover:bg-[rgba(51,255,119,0.2)] transition-all">
                        сохранить пароль
                      </button>
                      <button type="button" onClick={() => setPwForm(false)} className="px-5 py-2 font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors">
                        отмена
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Connected accounts */}
            <div className="border border-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden mb-6">
              <div className="px-5 py-3 bg-[#0a0b12] border-b border-[rgba(51,255,119,0.06)]">
                <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest">подключённые аккаунты</div>
              </div>
              <div className="divide-y divide-[rgba(51,255,119,0.05)]">
                <div className="px-5 py-4 bg-[#0e1018] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#00d4ff]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.93.44l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.52.25l.19-2.64 4.83-4.37c-.21-.19-.05-.29-.32-.1L7.5 14.45 5.0 13.68c-.55-.17-.56-.55.12-.81l9.89-3.81c.46-.17.86.11.63.74z" />
                    </svg>
                    <span className="font-sans text-sm text-[#e8eaf0]">Telegram</span>
                  </div>
                  {user.telegram ? (
                    <span className="font-mono text-xs text-[#00d4ff]">{user.telegram} · подключён</span>
                  ) : (
                    <button className="font-mono text-xs text-[#5a6070] hover:text-[#00d4ff] transition-colors">подключить</button>
                  )}
                </div>
                <div className="px-5 py-4 bg-[#0e1018] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#5a6070]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="font-sans text-sm text-[#e8eaf0]">Email</span>
                  </div>
                  {user.email ? (
                    <span className="font-mono text-xs text-[#5a6070]">{user.email} · подключён</span>
                  ) : (
                    <button className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">добавить</button>
                  )}
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div className="border border-[rgba(255,62,120,0.15)] rounded-sm overflow-hidden">
              <div className="px-5 py-3 bg-[rgba(255,62,120,0.04)] border-b border-[rgba(255,62,120,0.1)]">
                <div className="font-mono text-[10px] text-[#ff3e78] uppercase tracking-widest">опасная зона</div>
              </div>
              <div className="px-5 py-4 bg-[#0e1018] flex items-center justify-between">
                <div>
                  <div className="font-sans text-sm text-[#e8eaf0]">Удалить аккаунт</div>
                  <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">Все данные будут удалены безвозвратно</div>
                </div>
                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="font-mono text-xs text-[#ff3e78] border border-[rgba(255,62,120,0.3)] px-3 py-1.5 rounded-sm hover:bg-[rgba(255,62,120,0.08)] transition-all"
                  >
                    удалить
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#5a6070]">уверен?</span>
                    <button
                      onClick={() => { void deleteAccount(); }}
                      className="font-mono text-xs text-white bg-[#ff3e78] px-3 py-1.5 rounded-sm hover:bg-[#ff5590] transition-colors"
                    >
                      да, удалить
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
                    >
                      отмена
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      )}

      {applyJob && (
        <QuickApplyModal job={applyJob} onClose={() => setApplyJob(null)} />
      )}
    </div>
  );
}
