import { useState, useRef } from "react";
import { Navigate, Link } from "react-router";
import { useAuth, OnboardingData, UserSettings, ResumeSkill } from "../context/AuthContext";
import QuickApplyModal from "../components/QuickApplyModal";
import { type Job } from "../data";
import { useVacancyData } from "../context/VacancyDataContext";

interface ResumeData {
  fileName: string;
  uploadedAt: string;
  experience: string;
  position: string;
  skills: ResumeSkill[];
}

const PARSED_RESUME: ResumeData = {
  fileName: "resume_2024.pdf",
  uploadedAt: "1 сент 2024",
  experience: "6 лет",
  position: "Senior Backend Engineer",
  skills: [
    { name: "Go", category: "Языки", confirmed: true },
    { name: "Python", category: "Языки", confirmed: true },
    { name: "Rust", category: "Языки", confirmed: true },
    { name: "TypeScript", category: "Языки", confirmed: true },
    { name: "Kubernetes", category: "Инфраструктура", confirmed: true },
    { name: "Terraform", category: "Инфраструктура", confirmed: true },
    { name: "Docker", category: "Инфраструктура", confirmed: true },
    { name: "Prometheus", category: "Инфраструктура", confirmed: true },
    { name: "Ansible", category: "Инфраструктура", confirmed: false },
    { name: "PostgreSQL", category: "Базы данных", confirmed: true },
    { name: "Redis", category: "Базы данных", confirmed: true },
    { name: "ClickHouse", category: "Базы данных", confirmed: true },
    { name: "MongoDB", category: "Базы данных", confirmed: false },
    { name: "gRPC", category: "Протоколы и фреймворки", confirmed: true },
    { name: "Kafka", category: "Протоколы и фреймворки", confirmed: true },
    { name: "REST API", category: "Протоколы и фреймворки", confirmed: true },
    { name: "GraphQL", category: "Протоколы и фреймворки", confirmed: false },
    { name: "System Design", category: "Практики", confirmed: true },
    { name: "CI/CD", category: "Практики", confirmed: true },
    { name: "Code Review", category: "Практики", confirmed: true },
    { name: "Technical Leadership", category: "Практики", confirmed: true },
  ],
};

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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
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

export default function Profile() {
  const { jobs } = useVacancyData();
  const { user, isLoading, onboarding, settings, completeOnboarding, updateSettings, updateName, logout, changePassword, deleteAccount, resume, resumeSkills, setResumeSkills, uploadResume, clearResume, coverLetter, setCoverLetter, savedJobIds, toggleSavedJob, isPro } = useAuth();
  const [tab, setTab] = useState<Tab>("preferences");
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const [clDraft, setClDraft] = useState(coverLetter);
  const [clSaved, setClSaved] = useState(false);

  // Resume state
  const [resumeData, setResumeData] = useState<ResumeData | null>(resume);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement>(null);

  const handleResumeFile = async (file: File) => {
    setResumeUploading(true);
    try {
      const data = await uploadResume(file);
      setResumeData(data);
    } finally {
      setResumeUploading(false);
    }
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

  const patchNotif = (key: keyof typeof localSettings.notifications, val: boolean) => {
    const next = { ...localSettings, notifications: { ...localSettings.notifications, [key]: val } };
    setLocalSettings(next);
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
    updateSettings(localSettings);
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
          {/* Empty state */}
          {!resumeData && !resumeUploading && (
            <div>
              <p className="font-sans text-sm text-[#5a6070] mb-6">
                Загрузи резюме — извлечём навыки и найдём вакансии с максимальным совпадением
              </p>
              <div
                className={`border-2 border-dashed rounded-sm transition-all cursor-pointer ${resumeDragOver ? "border-[rgba(51,255,119,0.5)] bg-[rgba(51,255,119,0.05)]" : "border-[rgba(51,255,119,0.2)] hover:border-[rgba(51,255,119,0.4)] hover:bg-[rgba(51,255,119,0.02)]"}`}
                onClick={() => resumeFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
                onDragLeave={() => setResumeDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setResumeDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleResumeFile(f); }}
              >
                <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                  <div className="w-12 h-12 flex items-center justify-center rounded-sm bg-[rgba(51,255,119,0.08)] border border-[rgba(51,255,119,0.2)] mb-4">
                    <svg className="w-6 h-6 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="font-sans text-sm text-white font-medium mb-1">Перетащи файл или нажми для выбора</div>
                  <div className="font-mono text-xs text-[#5a6070]">PDF или DOCX · до 10 МБ</div>
                </div>
              </div>
              <input ref={resumeFileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeFile(f); }} />
            </div>
          )}

          {/* Uploading */}
          {resumeUploading && (
            <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-10 text-center">
              <div className="font-mono text-sm text-white mb-1">Анализируем резюме...</div>
              <div className="font-sans text-xs text-[#5a6070] mb-6">извлекаем навыки, определяем грейд и специализации</div>
              <div className="h-1 bg-[#1a1d28] rounded-full max-w-xs mx-auto overflow-hidden">
                <div className="h-full bg-[#33ff77] rounded-full" style={{ animation: "parseBar 2.4s ease-out forwards" }} />
              </div>
              <style>{`@keyframes parseBar { from { width: 0% } to { width: 100% } }`}</style>
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
                    <div className="font-sans text-sm text-white font-medium">{resumeData.position}</div>
                    <div className="font-mono text-xs text-[#5a6070]">{resumeData.fileName} · {resumeData.uploadedAt} · {resumeData.experience} опыта</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void clearResume(); setResumeData(null); setShowMatches(false); }}
                    className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
                  >
                    заменить
                  </button>
                  <button
                    onClick={() => resumeFileRef.current?.click()}
                    className="font-mono text-xs px-3 py-1.5 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)] rounded-sm transition-all"
                  >
                    загрузить другое
                  </button>
                  <input ref={resumeFileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeFile(f); }} />
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
                  <div
                    className="w-10 h-10 flex items-center justify-center rounded font-mono font-medium shrink-0 text-sm"
                    style={{ background: `${job.logoColor}18`, border: `1px solid ${job.logoColor}40`, color: job.logoColor }}
                  >
                    {job.logo}
                  </div>
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
                  <Toggle on={localSettings.notifications[item.key]} onChange={(v) => patchNotif(item.key, v)} />
                </div>
              ))}
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
                  <Toggle on={localSettings.account[item.key]} onChange={(v) => patchAccount(item.key, v)} />
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
