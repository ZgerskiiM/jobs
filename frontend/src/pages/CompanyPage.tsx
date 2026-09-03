import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { useVacancyData } from "../context/VacancyDataContext";
import LogoBadge from "../components/LogoBadge";

const JOBS_PER_PAGE = 10;

export default function CompanyPage() {
  const { companies, jobs: allJobs } = useVacancyData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const company = companies.find((c) => c.id === id);
  const jobs = allJobs.filter((j) => j.companyId === (company?.id ?? ""));
  const [activeTab, setActiveTab] = useState<"jobs" | "reviews" | "hiring">("jobs");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Все");
  const [activeTechs, setActiveTechs] = useState<string[]>([]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);

  const categories = ["Все", ...Array.from(new Set(jobs.map((job) => job.category)))];
  const allTechs = Array.from(new Set(jobs.flatMap((job) => job.tags))).sort();
  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const query = search.trim().toLowerCase();
    const matchSearch = !query || job.title.toLowerCase().includes(query) || job.tags.some((tag) => tag.toLowerCase().includes(query));
    const matchCategory = activeCategory === "Все" || job.category === activeCategory;
    const matchTechs = activeTechs.length === 0 || activeTechs.every((tech) => job.tags.includes(tech) || job.parsedSkills.includes(tech));
    const matchRemote = !remoteOnly || /remote|удалён|удален|гибрид/i.test(`${job.location} ${job.type}`);
    return matchSearch && matchCategory && matchTechs && matchRemote;
  }), [jobs, search, activeCategory, activeTechs, remoteOnly]);
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageJobs = filteredJobs.slice((currentPage - 1) * JOBS_PER_PAGE, currentPage * JOBS_PER_PAGE);
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => Math.min(Math.max(1, currentPage - 2), Math.max(1, totalPages - 4)) + index,
  );
  const categoryGroups = pageJobs.reduce<Record<string, typeof jobs>>((acc, job) => {
    if (!acc[job.category]) acc[job.category] = [];
    acc[job.category].push(job);
    return acc;
  }, {});

  useEffect(() => {
    setPage(1);
  }, [search, activeCategory, activeTechs, remoteOnly]);

  const toggleTech = (tech: string) => setActiveTechs((current) => current.includes(tech) ? current.filter((item) => item !== tech) : [...current, tech]);

  if (!company) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-32 text-center">
        <div className="font-mono text-[#3a404f] text-sm mb-4">// компания не найдена</div>
        <Link to="/" className="font-mono text-xs text-[#33ff77] hover:underline">← на главную</Link>
      </div>
    );
  }

  const levelColors: Record<string, string> = {
    Junior: "#33ff77",
    Middle: "#00d4ff",
    Senior: "#a78bfa",
    Lead: "#fbbf24",
    Staff: "#ff3e78",
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          назад
        </button>
        <span className="text-[#3a404f]">/</span>
        <Link to="/" className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070]">компании</Link>
        <span className="text-[#3a404f]">/</span>
        <span className="font-mono text-xs text-[#5a6070]">{company.name}</span>
      </div>

      {/* hero */}
      <div
        className="relative rounded-sm overflow-hidden mb-8 p-8"
        style={{
          background: `linear-gradient(135deg, ${company.color}08 0%, transparent 60%)`,
          border: `1px solid ${company.color}25`,
        }}
      >
        <div
          className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl pointer-events-none"
          style={{ background: `${company.color}06` }}
        />
        <div className="relative flex items-start gap-6 flex-wrap">
          <LogoBadge logo={company.logo} logoUrl={company.logoUrl} color={company.color} className="w-20 h-20 rounded-sm text-2xl" />
          <div className="flex-1 min-w-0">
            <h1 className="font-mono text-3xl font-medium text-white mb-1">{company.name}</h1>
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <span className="font-mono text-xs text-[#5a6070]">{company.industry}</span>
              <span className="text-[#3a404f]">·</span>
              <span className="font-mono text-xs text-[#5a6070]">{company.size} сотрудников</span>
              {company.founded && (
                <>
                  <span className="text-[#3a404f]">·</span>
                  <span className="font-mono text-xs text-[#5a6070]">основана {company.founded}</span>
                </>
              )}
              {company.hq && (
                <>
                  <span className="text-[#3a404f]">·</span>
                  <span className="font-mono text-xs text-[#5a6070]">{company.hq}</span>
                </>
              )}
            </div>
            <p className="font-sans text-sm text-[#b0b6c4] leading-relaxed max-w-2xl mb-6">{company.about}</p>

            {company.vacancyStatus === "external" && (
              <div className="tag cyan-badge inline-flex mb-6">вакансии на сайте компании</div>
            )}

            <div className="flex flex-wrap gap-2">
              {company.culture.map((tag) => (
                <span
                  key={tag}
                  className="font-mono text-[10px] px-2.5 py-1 rounded-sm"
                  style={{ background: `${company.color}10`, border: `1px solid ${company.color}25`, color: company.color }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <div
              className="font-mono text-2xl font-medium px-5 py-3 rounded-sm text-center"
              style={{ background: `${company.color}12`, border: `1px solid ${company.color}30`, color: company.color }}
            >
              {company.jobs > 0 ? company.jobs : "—"}
              <div className="font-mono text-[10px] text-[#5a6070] mt-0.5 font-normal">{company.jobs > 0 ? "открытых вакансий" : "внешний каталог"}</div>
            </div>
            <div className="card-surface rounded-sm px-5 py-3 text-center">
              <div className="font-mono text-2xl font-medium text-[#fbbf24]">{company.rating.overall.toFixed(1)}</div>
              <div className="flex justify-center gap-0.5 my-1">
                {[1,2,3,4,5].map((s) => (
                  <span key={s} style={{ color: s <= Math.round(company.rating.overall) ? "#fbbf24" : "#3a404f" }}>★</span>
                ))}
              </div>
              <div className="font-mono text-[10px] text-[#3a404f]">{company.reviews.length} отзывов</div>
            </div>
            <a
              href={company.site}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs px-4 py-2.5 border border-[rgba(58,64,79,0.6)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,1)] rounded-sm transition-all text-center flex items-center justify-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {company.domain}
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">
        {/* LEFT */}
        <div>
          {/* tab nav */}
          <div className="flex gap-1 mb-6 border-b border-[rgba(58,64,79,0.3)]">
            {([
              { key: "jobs", label: `Вакансии · ${jobs.length}` },
              { key: "reviews", label: `Отзывы · ${company.reviews.length}` },
              { key: "hiring", label: `Процесс найма · ${company.hiringInsights.length}` },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="font-mono text-xs px-4 py-2.5 transition-colors border-b-2 -mb-px"
                style={{
                  color: activeTab === t.key ? "#33ff77" : "#5a6070",
                  borderColor: activeTab === t.key ? "#33ff77" : "transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "jobs" && (
            <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-4 mb-6">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex items-center gap-3 bg-[#07080e] border border-[rgba(51,255,119,0.12)] px-4 py-3 rounded-sm">
                  <svg className="w-4 h-4 text-[#3a404f] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    className="flex-1 bg-transparent font-mono text-sm text-[#e8eaf0] placeholder-[#3a404f] focus:outline-none"
                    placeholder="должность, технология..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRemoteOnly((value) => !value)}
                  aria-pressed={remoteOnly}
                  className={`font-mono text-xs px-3 py-1.5 rounded-sm border transition-all ${remoteOnly ? "bg-[rgba(51,255,119,0.15)] border-[rgba(51,255,119,0.4)] text-[#33ff77]" : "border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0]"}`}
                >
                  удалёнка
                </button>
              </div>
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">роль:</span>
                {categories.map((category) => (
                  <button key={category} type="button" onClick={() => setActiveCategory(category)} className={`font-mono text-xs px-3 py-1.5 rounded-sm transition-all ${activeCategory === category ? "bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.4)] text-[#33ff77]" : "border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0]"}`}>
                    {category}
                  </button>
                ))}
              </div>
              {allTechs.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[rgba(58,64,79,0.3)] flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">стек:</span>
                  {allTechs.map((tech) => {
                    const active = activeTechs.includes(tech);
                    return <button key={tech} type="button" onClick={() => toggleTech(tech)} aria-pressed={active} className={`font-mono text-[10px] px-2.5 py-1 rounded-sm transition-all ${active ? "bg-[rgba(0,212,255,0.12)] border border-[rgba(0,212,255,0.4)] text-[#00d4ff]" : "border border-[rgba(58,64,79,0.4)] text-[#5a6070] hover:text-[#e8eaf0]"}`}>{tech}</button>;
                  })}
                </div>
              )}
            </div>
          )}

          {/* JOBS tab */}
          {activeTab === "jobs" && <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">
            // {filteredJobs.length} открытых позиций
          </div>}

          {activeTab === "jobs" && filteredJobs.length === 0 && (
            <div className="card-surface rounded-sm p-10 text-center">
              <div className="font-mono text-[#3a404f] text-sm">// вакансии не импортируются</div>
              <div className="font-mono text-xs text-[#5a6070] mt-2">актуальные позиции смотрите на сайте компании</div>
              {company.site !== "#" && (
                <a href={company.site} target="_blank" rel="noopener noreferrer" className="inline-flex mt-5 font-mono text-xs text-[#00d4ff] hover:text-white transition-colors">
                  открыть карьерный сайт →
                </a>
              )}
            </div>
          )}

          {activeTab === "jobs" && <div className="space-y-6">
            {Object.entries(categoryGroups).map(([cat, catJobs]) => (
              <div key={cat}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest">{cat}</span>
                  <div className="flex-1 h-px bg-[rgba(58,64,79,0.3)]" />
                  <span className="font-mono text-[10px] text-[#3a404f]">{catJobs.length}</span>
                </div>
                <div className="space-y-2">
                  {catJobs.map((job) => {
                    const levelColor = levelColors[job.level] ?? "#5a6070";
                    return (
                      <Link
                        key={job.id}
                        to={`/jobs/${job.id}`}
                        className="card-surface rounded-sm px-5 py-4 flex items-center gap-4 group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-sans font-medium text-sm text-[#e8eaf0] group-hover:text-white transition-colors">
                              {job.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-[#5a6070]">{job.location}</span>
                            <span className="text-[#3a404f]">·</span>
                            <span className="font-mono text-xs text-[#3a404f]">{job.posted}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {job.tags.map((t) => (
                              <span key={t} className="tag neon-badge">{t}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0 hidden md:block">
                          <div className="font-mono text-sm font-medium mb-1.5" style={{ color: levelColor }}>
                            {job.level}
                          </div>
                          <div className="font-mono text-sm text-[#33ff77]">{job.salary}</div>
                        </div>
                        <svg className="w-4 h-4 text-[#3a404f] group-hover:text-[#33ff77] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>}

          {activeTab === "jobs" && filteredJobs.length > JOBS_PER_PAGE && (
            <nav aria-label="Навигация по вакансиям компании" className="mt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-t border-[rgba(51,255,119,0.08)] pt-5">
              <div className="font-mono text-xs text-[#5a6070]">
                Показаны {(currentPage - 1) * JOBS_PER_PAGE + 1}–{Math.min(currentPage * JOBS_PER_PAGE, filteredJobs.length)} из {filteredJobs.length.toLocaleString("ru")} вакансий
              </div>
              <div className="flex items-center gap-1" role="list">
                <button type="button" onClick={() => setPage(1)} disabled={currentPage === 1} aria-label="Первая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] disabled:opacity-40 rounded-sm font-mono text-xs">«</button>
                <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] disabled:opacity-40 rounded-sm font-mono text-xs">←</button>
                {pageNumbers.map((number) => (
                  <button key={number} type="button" onClick={() => setPage(number)} aria-current={currentPage === number ? "page" : undefined} className={`h-11 min-w-11 px-3 rounded-sm font-mono text-xs border transition-colors ${currentPage === number ? "bg-[rgba(51,255,119,0.15)] border-[rgba(51,255,119,0.45)] text-[#33ff77]" : "border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0]"}`}>{number}</button>
                ))}
                <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Следующая страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] disabled:opacity-40 rounded-sm font-mono text-xs">→</button>
                <button type="button" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} aria-label="Последняя страница" className="h-11 min-w-11 px-3 border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#33ff77] disabled:opacity-40 rounded-sm font-mono text-xs">»</button>
              </div>
            </nav>
          )}

          {/* REVIEWS tab */}
          {activeTab === "reviews" && (
            <div className="space-y-4">
              {/* rating breakdown */}
              <div className="card-surface rounded-sm p-5 mb-6">
                <div className="flex items-center gap-8 flex-wrap">
                  <div className="text-center">
                    <div className="font-mono text-4xl font-medium text-[#fbbf24]">{company.rating.overall.toFixed(1)}</div>
                    <div className="flex gap-0.5 justify-center my-1">
                      {[1,2,3,4,5].map((s) => (
                        <span key={s} style={{ color: s <= Math.round(company.rating.overall) ? "#fbbf24" : "#3a404f" }}>★</span>
                      ))}
                    </div>
                    <div className="font-mono text-[10px] text-[#3a404f]">общий</div>
                  </div>
                  <div className="flex-1 space-y-2.5 min-w-[200px]">
                    {[
                      { label: "Work-life balance", val: company.rating.wlb },
                      { label: "Рост и развитие", val: company.rating.growth },
                      { label: "Менеджмент", val: company.rating.management },
                    ].map(({ label, val }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="font-mono text-[10px] text-[#5a6070] w-36 shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-[#1a1d28] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#fbbf24]" style={{ width: `${(val / 5) * 100}%` }} />
                        </div>
                        <span className="font-mono text-xs text-[#fbbf24] w-6 text-right">{val.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {company.reviews.map((r) => {
                const verdictColor = r.verdict === "рекомендую" ? "#33ff77" : r.verdict === "нейтрально" ? "#fbbf24" : "#ff3e78";
                return (
                  <div key={r.id} className="card-surface rounded-sm p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {[1,2,3,4,5].map((s) => (
                            <span key={s} className="text-xs" style={{ color: s <= r.rating ? "#fbbf24" : "#3a404f" }}>★</span>
                          ))}
                        </div>
                        <div className="font-mono text-xs text-[#5a6070]">{r.author} · {r.date}</div>
                      </div>
                      <span
                        className="font-mono text-[10px] px-2.5 py-1 rounded-sm shrink-0"
                        style={{ background: `${verdictColor}12`, border: `1px solid ${verdictColor}35`, color: verdictColor }}
                      >
                        {r.verdict}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="font-mono text-[10px] text-[#33ff77] uppercase tracking-widest mb-1.5">плюсы</div>
                        <p className="font-sans text-xs text-[#b0b6c4] leading-relaxed">{r.pros}</p>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-[#ff3e78] uppercase tracking-widest mb-1.5">минусы</div>
                        <p className="font-sans text-xs text-[#b0b6c4] leading-relaxed">{r.cons}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* HIRING tab */}
          {activeTab === "hiring" && (
            <div className="space-y-4">
              <div className="font-mono text-xs text-[#3a404f] mb-2">
                Реальный опыт прохождения интервью — от людей, которые проходили найм в {company.name}.
              </div>
              {company.hiringInsights.map((h) => {
                const outcomeColor = h.outcome === "оффер" ? "#33ff77" : h.outcome === "отказ" ? "#ff3e78" : "#5a6070";
                const outcomeLabel = h.outcome === "оффер" ? "получил оффер" : h.outcome === "отказ" ? "отказ" : "ответа нет";
                return (
                  <div key={h.id} className="card-surface rounded-sm p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <div className="font-sans font-medium text-sm text-[#e8eaf0] mb-1">{h.role}</div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-mono text-xs text-[#5a6070]">{h.date}</span>
                          <span className="text-[#3a404f]">·</span>
                          <span className="font-mono text-xs text-[#5a6070]">{h.duration}</span>
                          <span className="text-[#3a404f]">·</span>
                          <span className="font-mono text-xs text-[#5a6070]">сложность:</span>
                          {[1,2,3,4,5].map((s) => (
                            <span key={s} className="text-xs" style={{ color: s <= h.difficulty ? "#a78bfa" : "#3a404f" }}>◆</span>
                          ))}
                        </div>
                      </div>
                      <span
                        className="font-mono text-[10px] px-2.5 py-1 rounded-sm shrink-0"
                        style={{ background: `${outcomeColor}12`, border: `1px solid ${outcomeColor}35`, color: outcomeColor }}
                      >
                        {outcomeLabel}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {h.stages.map((stage, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-[#33ff77]">{i + 1}</span>
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm bg-[rgba(58,64,79,0.3)] text-[#b0b6c4]">{stage}</span>
                          {i < h.stages.length - 1 && <span className="text-[#3a404f] text-xs">→</span>}
                        </div>
                      ))}
                    </div>

                    <p className="font-sans text-xs text-[#5a6070] leading-relaxed italic">"{h.comment}"</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20">
          {/* tech stack */}
          <div className="card-surface rounded-sm p-5">
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// стек технологий</div>
            <div className="flex flex-wrap gap-2">
              {company.tech_stack.map((t) => (
                <span
                  key={t}
                  className="font-mono text-xs px-2.5 py-1 rounded-sm bg-[rgba(58,64,79,0.25)] border border-[rgba(58,64,79,0.5)] text-[#b0b6c4]"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* perks */}
          <div className="card-surface rounded-sm p-5">
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// плюшки и льготы</div>
            <ul className="space-y-2.5">
              {company.perks.map((p) => (
                <li key={p} className="flex items-start gap-2.5">
                  <span className="text-[#33ff77] mt-0.5 shrink-0">◆</span>
                  <span className="font-sans text-xs text-[#b0b6c4] leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div
            className="rounded-sm p-5 text-center"
            style={{ background: `${company.color}08`, border: `1px solid ${company.color}20` }}
          >
            <div className="font-mono text-xs mb-3" style={{ color: company.color }}>
              {company.jobs} открытых вакансий
            </div>
            <a
              href={company.site}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-xs px-4 py-2 rounded-sm transition-all"
              style={{
                background: `${company.color}15`,
                border: `1px solid ${company.color}40`,
                color: company.color,
              }}
            >
              карьерный сайт
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
