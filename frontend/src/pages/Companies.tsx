import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useVacancyData } from "../context/VacancyDataContext";
import LogoBadge from "../components/LogoBadge";

type SortKey = "jobs" | "rating" | "name";

export default function Companies() {
  const { companies, jobs } = useVacancyData();
  const [search, setSearch] = useState("");
  const [activeStack, setActiveStack] = useState<string[]>([]);
  const [industry, setIndustry] = useState("Все");
  const [sort, setSort] = useState<SortKey>("jobs");

  const toggleStack = (t: string) =>
    setActiveStack((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const filtered = useMemo(() => {
    const list = companies.filter((c) => {
      const matchSearch =
        search.length === 0 ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.about.toLowerCase().includes(search.toLowerCase()) ||
        (c.businessDomains || []).some((domain) => domain.toLowerCase().includes(search.toLowerCase())) ||
        c.tech_stack.some((t) => t.toLowerCase().includes(search.toLowerCase()));
      const matchIndustry = industry === "Все" || c.industry === industry;
      const matchStack = activeStack.length === 0 || activeStack.every((t) => c.tech_stack.includes(t));
      return matchSearch && matchIndustry && matchStack;
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ru");
      if (sort === "rating") return b.rating.overall - a.rating.overall;
      return b.jobs - a.jobs;
    });
  }, [companies, search, activeStack, industry, sort]);

  const allStack = Array.from(new Set(companies.flatMap((c) => c.tech_stack))).sort();
  const industries = ["Все", ...Array.from(new Set(companies.map((c) => c.industry)))];
  const totalOpen = jobs.length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">← главная</Link>
          <span className="text-[#3a404f]">/</span>
          <span className="font-mono text-xs text-[#3a404f]">компании</span>
        </div>
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">// каталог работодателей</div>
        <h1 className="font-mono text-3xl md:text-5xl text-white font-medium leading-tight mb-3">
          {companies.length} tech-компаний<br />
          <span className="text-[#33ff77] neon-glow">нанимают напрямую</span>
        </h1>
        <p className="font-sans text-[#5a6070] text-sm max-w-lg">
          {totalOpen.toLocaleString("ru")} открытых вакансий · без агентств и посредников. Фильтруй по стеку и находи компании под свой профиль.
        </p>
      </div>

      {/* Search + filters */}
      <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-4 mb-8">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 flex items-center gap-3 bg-[#07080e] border border-[rgba(51,255,119,0.12)] px-4 py-3 rounded-sm">
            <svg className="w-4 h-4 text-[#3a404f] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="flex-1 bg-transparent font-mono text-sm text-[#e8eaf0] placeholder-[#3a404f] focus:outline-none"
              placeholder="название, индустрия, технология..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">сорт:</span>
            {([
              { k: "jobs", label: "вакансии" },
              { k: "rating", label: "рейтинг" },
              { k: "name", label: "а-я" },
            ] as { k: SortKey; label: string }[]).map((s) => (
              <button
                key={s.k}
                onClick={() => setSort(s.k)}
                className={`font-mono text-xs px-3 py-1.5 rounded-sm transition-all ${
                  sort === s.k
                    ? "bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.4)] text-[#33ff77]"
                    : "border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* industry row */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {industries.map((c) => (
            <button
              key={c}
              onClick={() => setIndustry(c)}
              className={`font-mono text-xs px-3 py-1.5 rounded-sm transition-all ${
                industry === c
                  ? "bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.4)] text-[#33ff77]"
                  : "border border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.9)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* stack row */}
        <div className="mt-3 pt-3 border-t border-[rgba(58,64,79,0.3)]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest shrink-0">стек:</span>
            {allStack.map((t) => {
              const active = activeStack.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleStack(t)}
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
            {activeStack.length > 0 && (
              <button
                onClick={() => setActiveStack([])}
                className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070] transition-colors ml-1"
              >
                сбросить ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* count */}
      <div className="flex items-center gap-3 mb-5">
        <span className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// компаний</span>
        <span className="font-mono text-xs text-[#33ff77] bg-[rgba(51,255,119,0.1)] px-2 py-0.5 rounded-sm">{filtered.length}</span>
      </div>

      {/* grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map((co) => {
          const openJobs = jobs.filter((j) => j.companyId === co.id).length;
          return (
            <Link
              key={co.id}
              to={`/companies/${co.id}`}
              className="card-surface rounded-sm p-5 group flex flex-col relative block"
            >
              <div className="flex items-center gap-3 mb-3">
                <LogoBadge logo={co.logo} logoUrl={co.logoUrl} color={co.color} className="w-11 h-11 rounded text-base" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <div className="font-sans font-semibold text-sm text-[#e8eaf0] group-hover:text-white transition-colors truncate">
                    {co.name}
                  </div>
                  <div className="font-mono text-xs text-[#3a404f]">{co.industry} · {co.size}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0 font-mono text-xs" style={{ color: "#fbbf24" }}>
                  <span>★</span>{co.rating.overall.toFixed(1)}
                </div>
              </div>

                <p className="font-sans text-xs text-[#5a6070] leading-relaxed mb-3 flex-1 line-clamp-3">
                  {co.about}
                </p>

                <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Бизнес-направления">
                  {(co.businessDomains || [co.industry]).slice(0, 4).map((domain) => (
                    <span key={domain} className="font-mono text-[10px] px-2 py-0.5 rounded-sm bg-[rgba(0,212,255,0.06)] border border-[rgba(0,212,255,0.18)] text-[#7dcae0]">
                      {domain}
                    </span>
                  ))}
                </div>

                {co.vacancyStatus === "external" && (
                  <div className="tag cyan-badge mb-4 self-start">вакансии на сайте компании</div>
                )}

              <div className="flex flex-wrap gap-1.5 mb-4">
                {co.tech_stack.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] px-2 py-0.5 rounded-sm"
                    style={{
                      background: activeStack.includes(t) ? "rgba(0,212,255,0.12)" : "rgba(58,64,79,0.25)",
                      border: `1px solid ${activeStack.includes(t) ? "rgba(0,212,255,0.4)" : "rgba(58,64,79,0.5)"}`,
                      color: activeStack.includes(t) ? "#00d4ff" : "#b0b6c4",
                    }}
                  >
                    {t}
                  </span>
                ))}
                {co.tech_stack.length > 4 && (
                  <span className="font-mono text-[10px] text-[#3a404f] px-1 py-0.5">+{co.tech_stack.length - 4}</span>
                )}
              </div>

              <div className="flex items-center justify-between mt-auto pt-3 border-t border-[rgba(58,64,79,0.25)]">
                <span className="font-mono text-xs" style={{ color: co.color }}>
                  {co.jobs > 0 ? `${co.jobs} вакансий${openJobs > 0 ? ` · ${openJobs} тут` : ""}` : "в каталоге не импортируются"}
                </span>
                <span className="font-mono text-xs text-[#3a404f] group-hover:text-[#33ff77] transition-colors">профиль →</span>
              </div>

              <div
                className="mt-3 h-px w-0 group-hover:w-full transition-all duration-300 rounded-full"
                style={{ background: co.color, opacity: 0.4 }}
              />
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20">
          <div className="font-mono text-[#3a404f] text-sm">// компаний не найдено</div>
          <div className="font-mono text-xs text-[#3a404f] mt-2">попробуйте сбросить фильтры</div>
        </div>
      )}
    </div>
  );
}
