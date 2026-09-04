import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Company, Job } from "../data";
import LogoBadgeImage from "../components/LogoBadge";
import { useVacancyData } from "../context/VacancyDataContext";
import CompanyJobsPanel from "../components/CompanyJobsPanel";
import { useAuth } from "../context/AuthContext";
import QuickApplyModal from "../components/QuickApplyModal";
import { accountApi, type VacancyScoreSummary } from "../api";

const TRENDS = [
  { label: "AI / ML Engineer", delta: "+34%", count: "2,841", hot: true },
  { label: "Rust Developer", delta: "+28%", count: "1,203", hot: true },
  { label: "Platform Engineer", delta: "+22%", count: "3,107", hot: false },
  { label: "Security Engineer", delta: "+19%", count: "1,874", hot: false },
  { label: "Go Developer", delta: "+17%", count: "2,455", hot: false },
  { label: "DevOps / SRE", delta: "+14%", count: "4,218", hot: false },
];

const CATEGORIES = ["Все", "Backend", "Frontend", "AI/ML", "DevOps", "Mobile", "Security", "Data", "Аналитика", "1С", "HR", "QA", "Дизайн", "Embedded", "Поддержка", "Менеджмент", "Стажировка", "Другое"];

const STATS = [
  { value: "12 400+", label: "активных вакансий" },
  { value: "840+", label: "компаний в каталоге" },
  { value: "от работодателя", label: "без посредников" },
  { value: "91%", label: "технических ролей" },
];

const VACANCIES_PER_PAGE = 15;
const MATCH_THRESHOLDS = [
  { value: 0, label: "любое" },
  { value: 40, label: "40%+" },
  { value: 55, label: "55%+" },
  { value: 70, label: "70%+" },
  { value: 80, label: "80%+" },
];

function LogoBadge({ logo, logoUrl, color, size = "md" }: { logo: string; logoUrl?: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-lg" };
  return <LogoBadgeImage logo={logo} logoUrl={logoUrl} color={color} className={`${sizes[size]} rounded`} loading="lazy" />;
}

function TagBadge({ tag }: { tag: string }) {
  return <span className="tag neon-badge">{tag}</span>;
}

export default function Home() {
  const { jobs, companies, loading, error, hhError, updatedAt } = useVacancyData();
  const [activeCategory, setActiveCategory] = useState("Все");
  const [activeTechs, setActiveTechs] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [activeCompany, setActiveCompany] = useState("Все компании");
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [applyJob, setApplyJob] = useState<Job | null>(null);
  const { user, resume, onboarding, openAuthModal, isJobSaved, toggleSavedJob } = useAuth();
  const [vacancyScores, setVacancyScores] = useState<Record<string, VacancyScoreSummary>>({});
  const [matchThreshold, setMatchThreshold] = useState(0);
  const [scoringLoading, setScoringLoading] = useState(false);

  const toggleTech = (tech: string) => {
    setActiveTechs((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  const allTechs = Array.from(new Set(jobs.flatMap((j) => j.tags))).sort();
  const companyOptions = Array.from(new Set(jobs.map((j) => j.company))).sort((a, b) => a.localeCompare(b, "ru"));
  const visibleCompanyOptions = companyOptions.filter((company) =>
    company.toLowerCase().includes(companySearch.toLowerCase().trim()),
  );
  const filtered = jobs.filter((j) => {
    const matchCat = activeCategory === "Все" || j.category === activeCategory || j.tags.includes(activeCategory);
    const matchCompany = activeCompany === "Все компании" || j.company === activeCompany;
    const matchSearch =
      search.length === 0 ||
      j.title.toLowerCase().includes(search.toLowerCase());
    const matchRemote = !remoteOnly || j.location.toLowerCase().includes("remote");
    const matchTechs =
      activeTechs.length === 0 || activeTechs.every((t) => j.tags.includes(t) || j.parsedSkills.includes(t));
    const score = vacancyScores[`catalog:${j.id}`]?.score;
    const matchScore = matchThreshold === 0 || !user || !resume || scoringLoading || (score !== undefined && score >= matchThreshold);
    return matchCat && matchCompany && matchSearch && matchRemote && matchTechs && matchScore;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / VACANCIES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageJobs = filtered.slice((currentPage - 1) * VACANCIES_PER_PAGE, currentPage * VACANCIES_PER_PAGE);
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4)) + index,
  );

  useEffect(() => {
    setPage(1);
  }, [search, activeCategory, activeCompany, activeTechs, remoteOnly, matchThreshold]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !resume || jobs.length === 0) {
      setVacancyScores({});
      setScoringLoading(false);
      setMatchThreshold(0);
      return () => { cancelled = true; };
    }
    setScoringLoading(true);
    accountApi.scoreVacancyIndex(jobs.map((job) => job.scoringFeatures
      ? { id: job.id, features: job.scoringFeatures }
      : { id: job.id, title: job.title, description: job.description, posted_at: job.posted }))
      .then(({ scores }) => {
        if (!cancelled) setVacancyScores(Object.fromEntries(scores.map((score) => [score.vacancyId, score])));
      })
      .catch(() => {
        if (!cancelled) {
          setVacancyScores({});
          setMatchThreshold(0);
        }
      })
      .finally(() => { if (!cancelled) setScoringLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, resume?.id, jobs]);

  const roleLabels: Record<string, string> = {
    backend: "Backend", frontend: "Frontend", aiml: "AI/ML",
    devops: "DevOps", mobile: "Mobile", data: "Data",
    security: "Security", fullstack: "Fullstack",
  };

  return (
    <>
      {/* PERSONALISED BANNER */}
      {user && onboarding && (
        <div className="border-b border-[rgba(51,255,119,0.08)] bg-[rgba(51,255,119,0.03)]">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xs text-[#3a404f]">// персонализировано для</span>
            <span className="font-mono text-xs text-[#33ff77]">{user.name}</span>
            {onboarding.roles.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {onboarding.roles.map((r) => (
                  <span key={r} className="tag neon-badge">{roleLabels[r] ?? r}</span>
                ))}
              </div>
            )}
            {onboarding.formats.includes("remote") && (
              <span className="tag cyan-badge">Remote</span>
            )}
          </div>
        </div>
      )}

      {/* AUTH NUDGE — shown to logged-out users on scroll */}
      {!user && (
        <div className="border-b border-[rgba(51,255,119,0.07)] bg-[rgba(51,255,119,0.02)]">
          <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-between gap-4">
            <span className="font-sans text-xs text-[#5a6070]">
              Войди, чтобы сохранять вакансии и получать уведомления о новых
            </span>
            <button
              onClick={openAuthModal}
              className="font-mono text-xs text-[#33ff77] hover:underline whitespace-nowrap shrink-0"
            >
              войти →
            </button>
          </div>
        </div>
      )}

      {/* HERO */}
      <section className="relative max-w-7xl mx-auto px-6 pt-20 pb-16 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-[rgba(51,255,119,0.04)] blur-3xl pointer-events-none" />
        <div className="absolute top-20 right-0 w-[400px] h-[400px] rounded-full bg-[rgba(255,62,120,0.03)] blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-16 items-start">
          <div>
            <div className="inline-flex items-center gap-2 neon-badge px-3 py-1 rounded-sm mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#33ff77] animate-pulse" />
              <span className="font-mono text-xs tracking-widest uppercase">{jobs.length.toLocaleString("ru")} активных вакансий</span>
            </div>

            <h1 className="font-mono text-4xl md:text-6xl font-medium leading-[1.1] tracking-tight mb-6">
              <span className="text-white">Работа в</span>
              <br />
              <span className="text-[#33ff77] neon-glow">tech-компаниях</span>
              <br />
              <span className="text-white">напрямую</span>
            </h1>

            <p className="font-sans text-[#5a6070] text-lg leading-relaxed max-w-lg mb-10">
              Вакансии от работодателей без посредников и рекрутинговых агентств.
              Только технические роли — Backend, AI/ML, DevOps, Security и другие.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden">
              {[
                { value: jobs.length.toLocaleString("ru"), label: "активных вакансий" },
                { value: companies.length.toLocaleString("ru"), label: "компаний в каталоге" },
                ...STATS.slice(2),
              ].map((s) => (
                <div key={s.label} className="bg-[#07080e] px-4 py-4">
                  <div className="font-mono text-xl font-medium text-[#33ff77] mb-0.5">{s.value}</div>
                  <div className="font-sans text-xs text-[#3a404f]">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// тренды рынка</span>
              <Link to="/trends" className="font-mono text-xs text-[#33ff77] hover:underline">
                подробнее →
              </Link>
            </div>
            <div className="space-y-2">
              {TRENDS.map((t, i) => (
                <div key={t.label} className="card-surface flex items-center gap-4 px-4 py-3.5 rounded-sm cursor-pointer group">
                  <span className="font-mono text-[#3a404f] text-xs w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-sans text-sm text-[#e8eaf0] flex-1 group-hover:text-white transition-colors">{t.label}</span>
                  <span className="font-mono text-xs text-[#5a6070]">{t.count}</span>
                  <span className={`font-mono text-xs font-medium px-2 py-0.5 rounded-sm ${t.hot ? "bg-[rgba(51,255,119,0.12)] text-[#33ff77]" : "bg-[rgba(90,96,112,0.15)] text-[#5a6070]"}`}>
                    {t.delta}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 border border-[rgba(255,62,120,0.2)] bg-[rgba(255,62,120,0.04)] rounded-sm">
              <div className="font-mono text-xs text-[#ff3e78] mb-1 uppercase tracking-widest">// рост недели</div>
              <div className="flex items-baseline gap-3">
                <span className="font-sans text-white font-medium">AI / ML Engineer</span>
                <span className="font-mono text-[#ff3e78] text-xl font-medium pink-glow">+34%</span>
              </div>
              <div className="font-mono text-xs text-[#3a404f] mt-1">2 841 активная вакансия</div>
            </div>
          </div>
        </div>
      </section>

      {/* SEARCH */}
      <section className="max-w-7xl mx-auto px-6 mb-8">
        <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 flex items-center gap-3 bg-[#07080e] border border-[rgba(51,255,119,0.12)] px-4 py-3 rounded-sm">
              <svg className="w-4 h-4 text-[#3a404f] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="flex-1 bg-transparent font-mono text-sm text-[#e8eaf0] placeholder-[#3a404f]"
                placeholder="название вакансии..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="relative md:w-56">
              <button
                type="button"
                aria-label="Фильтр по компании"
                aria-expanded={companyMenuOpen}
                onClick={() => setCompanyMenuOpen((open) => !open)}
                className="w-full flex items-center justify-between gap-2 bg-[#07080e] border border-[rgba(51,255,119,0.12)] px-3 py-2.5 rounded-sm font-mono text-sm text-[#e8eaf0] text-left"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {activeCompany !== "Все компании" && (() => {
                    const selected = jobs.find((job) => job.company === activeCompany);
                    return selected ? <LogoBadge logo={selected.logo} logoUrl={selected.logoUrl} color={selected.logoColor} size="sm" /> : null;
                  })()}
                  <span className="truncate">{activeCompany === "Все компании" ? "все компании" : activeCompany}</span>
                </span>
                <span className="text-[#5a6070]">⌄</span>
              </button>
              {companyMenuOpen && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-[#0e1018] border border-[rgba(51,255,119,0.25)] rounded-sm">
                  <div className="sticky top-0 p-2 bg-[#0e1018] border-b border-[rgba(58,64,79,0.35)]">
                    <input
                      autoFocus
                      aria-label="Поиск компании"
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      placeholder="найти компанию..."
                      className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.12)] px-2.5 py-2 rounded-sm font-mono text-xs text-[#e8eaf0] placeholder-[#3a404f]"
                    />
                  </div>
                  {["Все компании", ...visibleCompanyOptions].map((company) => {
                    const companyJob = jobs.find((job) => job.company === company);
                    return (
                      <button
                        key={company}
                        type="button"
                        onClick={() => { setActiveCompany(company); setCompanyMenuOpen(false); setCompanySearch(""); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-xs text-[#5a6070] hover:bg-[rgba(51,255,119,0.08)] hover:text-[#e8eaf0]"
                      >
                        {companyJob && <LogoBadge logo={companyJob.logo} logoUrl={companyJob.logoUrl} color={companyJob.logoColor} size="sm" />}
                        <span className="truncate">{company === "Все компании" ? "все компании" : company}</span>
                      </button>
                    );
                  })}
                  {visibleCompanyOptions.length === 0 && (
                    <p className="px-3 py-3 font-mono text-xs text-[#5a6070]">компания не найдена</p>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={remoteOnly}
              onClick={() => setRemoteOnly(!remoteOnly)}
              className="flex items-center gap-2.5 px-4 py-3 bg-[#07080e] border border-[rgba(51,255,119,0.12)] rounded-sm cursor-pointer group"
            >
              <span
                className={`w-9 h-5 rounded-full relative transition-colors block ${remoteOnly ? "bg-[rgba(51,255,119,0.3)]" : "bg-[#1a1d28]"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all block ${remoteOnly ? "left-[calc(100%-1.1rem)] bg-[#33ff77]" : "left-0.5 bg-[#3a404f]"}`} />
              </span>
              <span className="font-mono text-xs text-[#5a6070] group-hover:text-[#e8eaf0] transition-colors whitespace-nowrap">
                только remote
              </span>
            </button>
            <button className="px-6 py-3 bg-[rgba(51,255,119,0.12)] hover:bg-[rgba(51,255,119,0.2)] border border-[rgba(51,255,119,0.3)] text-[#33ff77] font-mono text-sm rounded-sm transition-all">
              найти →
            </button>
          </div>

          {/* category row */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`font-mono text-xs px-3 py-1.5 rounded-sm transition-all ${
                  activeCategory === c
                    ? "bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.4)] text-[#33ff77]"
                    : "border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* resume match row */}
          <div className="mt-3 pt-3 border-t border-[rgba(58,64,79,0.3)]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">соответствие:</span>
              {MATCH_THRESHOLDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={matchThreshold === option.value}
                  disabled={option.value > 0 && (!user || !resume)}
                  onClick={() => setMatchThreshold(option.value)}
                  className={`font-mono text-[10px] min-h-9 px-3 rounded-sm border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    matchThreshold === option.value
                      ? "bg-[rgba(51,255,119,0.15)] border-[rgba(51,255,119,0.4)] text-[#33ff77]"
                      : "border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              {scoringLoading && <span className="font-mono text-[10px] text-[#5a6070]">считаем соответствие…</span>}
              {!user && (
                <button type="button" onClick={openAuthModal} className="font-mono text-[10px] text-[#33ff77] hover:underline ml-1">
                  войти для фильтра →
                </button>
              )}
              {user && !resume && (
                <Link to="/profile" className="font-mono text-[10px] text-[#33ff77] hover:underline ml-1">
                  загрузить резюме →
                </Link>
              )}
            </div>
          </div>

          {/* tech stack row */}
          <div className="mt-3 pt-3 border-t border-[rgba(58,64,79,0.3)]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">стек:</span>
              {allTechs.map((t) => {
                const active = activeTechs.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTech(t)}
                    className="font-mono text-[10px] px-2.5 py-1 rounded-sm transition-all"
                    style={{
                      background: active ? "rgba(0,212,255,0.12)" : "transparent",
                      border: active ? "1px solid rgba(0,212,255,0.4)" : "1px solid rgba(58,64,79,0.4)",
                      color: active ? "#00d4ff" : "#5a6070",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
              {activeTechs.length > 0 && (
                <button
                  onClick={() => setActiveTechs([])}
                  className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070] transition-colors ml-1"
                >
                  сбросить ×
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* JOB LISTINGS */}
      <section className="max-w-7xl mx-auto px-6 mb-20">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// вакансии</span>
            <span className="font-mono text-xs text-[#33ff77] bg-[rgba(51,255,119,0.1)] px-2 py-0.5 rounded-sm">{filtered.length}</span>
          </div>
          <div className="font-mono text-xs text-[#3a404f] hidden md:block">сортировка: новые сначала</div>
        </div>

        <div className="grid gap-2">
          {pageJobs.map((job) => (
            <div key={job.id} className="card-surface rounded-sm px-5 py-4 group">
              {(() => {
                const score = vacancyScores[`catalog:${job.id}`];
                return (
              <div className="flex items-start gap-4">
                <Link to={`/jobs/${job.id}`} className="shrink-0">
                  <LogoBadge logo={job.logo} logoUrl={job.logoUrl} color={job.logoColor} size="md" />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-3 flex-wrap">
                    <Link to={`/jobs/${job.id}`} className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-sans font-semibold text-[#e8eaf0] group-hover:text-white transition-colors text-sm">
                          {job.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-[#5a6070]">{job.company}</span>
                        <span className="text-[#3a404f]">·</span>
                        <span className="font-mono text-xs text-[#5a6070]">{job.location}</span>
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-[#33ff77] font-medium mb-1">{job.salary}</div>
                      <div className="flex items-center justify-end gap-2">
                        {score && <span className="font-mono text-[10px] text-[#33ff77]" title={score.summary}>{Math.round(score.score)}% match</span>}
                        <span className="font-mono text-xs text-[#3a404f]">{job.posted}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {job.tags.map((t) => <TagBadge key={t} tag={t} />)}
                    <button
                      onClick={() => user ? toggleSavedJob(job.id) : openAuthModal()}
                      aria-pressed={isJobSaved(job.id)}
                      title={isJobSaved(job.id) ? "убрать из сохранённых" : "сохранить вакансию"}
                      className="ml-auto w-8 h-8 flex items-center justify-center rounded-sm border transition-all"
                      style={{
                        background: isJobSaved(job.id) ? "rgba(0,212,255,0.1)" : "transparent",
                        borderColor: isJobSaved(job.id) ? "rgba(0,212,255,0.35)" : "rgba(58,64,79,0.5)",
                        color: isJobSaved(job.id) ? "#00d4ff" : "#5a6070",
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill={isJobSaved(job.id) ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => user ? setApplyJob(job) : openAuthModal()}
                      className="px-3 py-1.5 font-mono text-xs rounded-sm transition-all"
                      style={{
                        background: "rgba(51,255,119,0.1)",
                        border: "1px solid rgba(51,255,119,0.3)",
                        color: "#33ff77",
                      }}
                    >
                      откликнуться →
                    </button>
                  </div>
                </div>
              </div>
                );
              })()}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-20">
              <div className="font-mono text-[#3a404f] text-sm">// вакансий не найдено</div>
              <div className="font-mono text-xs text-[#3a404f] mt-2">попробуйте другой запрос</div>
            </div>
          )}
        </div>

        {filtered.length > VACANCIES_PER_PAGE && (
          <nav aria-label="Навигация по вакансиям" className="mt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-t border-[rgba(51,255,119,0.08)] pt-5">
            <div className="font-mono text-xs text-[#5a6070]">
              Показаны {(currentPage - 1) * VACANCIES_PER_PAGE + 1}–{Math.min(currentPage * VACANCIES_PER_PAGE, filtered.length)} из {filtered.length.toLocaleString("ru")} вакансий
            </div>
            <div className="flex items-center gap-1" role="list">
              <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1} aria-label="Первая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] disabled:opacity-40 disabled:cursor-not-allowed rounded-sm font-mono text-xs">«</button>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] disabled:opacity-40 disabled:cursor-not-allowed rounded-sm font-mono text-xs">←</button>
              <span className="md:hidden h-11 min-w-11 px-3 inline-flex items-center justify-center border border-[rgba(51,255,119,0.45)] bg-[rgba(51,255,119,0.15)] text-[#33ff77] rounded-sm font-mono text-xs" aria-current="page">
                {currentPage}
              </span>
              {pageNumbers.map((number) => (
                <button key={number} type="button" onClick={() => setPage(number)} aria-current={currentPage === number ? "page" : undefined} className={`hidden md:inline-flex h-11 min-w-11 px-3 items-center justify-center rounded-sm font-mono text-xs border transition-colors ${currentPage === number ? "bg-[rgba(51,255,119,0.15)] border-[rgba(51,255,119,0.45)] text-[#33ff77]" : "border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)]"}`}>{number}</button>
              ))}
              <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Следующая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] disabled:opacity-40 disabled:cursor-not-allowed rounded-sm font-mono text-xs">→</button>
              <button type="button" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} aria-label="Последняя страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] disabled:opacity-40 disabled:cursor-not-allowed rounded-sm font-mono text-xs">»</button>
            </div>
          </nav>
        )}
      </section>

      {/* COMPANIES */}
      <section className="border-t border-[rgba(51,255,119,0.08)] py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-end justify-between mb-10">
            <div>
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">// каталог компаний</div>
              <h2 className="font-mono text-2xl md:text-3xl text-white font-medium">
                {companies.length.toLocaleString("ru")} работодателей<br />
                <span className="text-[#33ff77]">нанимают прямо сейчас</span>
              </h2>
            </div>
            <Link to="/companies" className="hidden md:flex items-center gap-2 font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">
              все компании →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {companies.slice(0, 12).map((co) => (
              <div key={co.id} className="card-surface rounded-sm p-5 group flex flex-col relative">
                <div className="flex items-center gap-3 mb-3">
                  <LogoBadgeImage logo={co.logo} logoUrl={co.logoUrl} color={co.color} className="w-10 h-10 rounded text-sm" loading="lazy" />
                  <div className="min-w-0">
                    <Link
                      to={`/companies/${co.id}`}
                      className="font-sans font-semibold text-sm text-[#e8eaf0] group-hover:text-white transition-colors truncate block hover:underline"
                    >
                      {co.name}
                    </Link>
                    <div className="font-mono text-xs text-[#3a404f]">{co.industry} · {co.size}</div>
                  </div>
                </div>

                <p className="font-sans text-xs text-[#5a6070] leading-relaxed mb-4 flex-1">
                  {co.about}
                </p>

                <div className="flex gap-1.5 mt-auto">
                  <a
                    href={co.site}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 border border-[rgba(58,64,79,0.6)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,1)] font-mono text-[10px] rounded-sm transition-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Сайт
                  </a>
                  <button
                    onClick={() => setSelectedCompany(co)}
                    className="flex items-center gap-1 px-2.5 py-1 font-mono text-[10px] rounded-sm transition-all"
                    style={{
                      background: `${co.color}12`,
                      border: `1px solid ${co.color}35`,
                      color: co.color,
                    }}
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Вакансии · {co.jobs}
                  </button>
                  <Link
                    to={`/companies/${co.id}`}
                    className="flex items-center gap-1 px-2.5 py-1 border border-[rgba(58,64,79,0.6)] text-[#5a6070] hover:text-[#33ff77] hover:border-[rgba(51,255,119,0.4)] font-mono text-[10px] rounded-sm transition-all"
                  >
                    профиль →
                  </Link>
                </div>

                <div
                  className="mt-3 h-px w-0 group-hover:w-full transition-all duration-300 rounded-full"
                  style={{ background: co.color, opacity: 0.4 }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPANY JOBS PANEL */}
      {selectedCompany && (
        <CompanyJobsPanel
          company={selectedCompany}
          jobs={jobs.filter((j) => j.companyId === selectedCompany.id)}
          onClose={() => setSelectedCompany(null)}
        />
      )}

      {applyJob && (
        <QuickApplyModal job={applyJob} onClose={() => setApplyJob(null)} />
      )}
      {(loading || error || hhError || updatedAt) && <div role={error || hhError ? "alert" : "status"} className={`max-w-7xl mx-auto px-6 pb-8 font-mono text-xs ${error || hhError ? "text-[#ff3e78]" : "text-[#5a6070]"}`}>{loading ? "Загружаем актуальные вакансии…" : error ? `Не удалось загрузить данные: ${error}` : hhError ? `Источник HH.ru: ${hhError}` : `Данные обновлены: ${new Date(updatedAt!).toLocaleString("ru")}`}</div>}
    </>
  );
}
