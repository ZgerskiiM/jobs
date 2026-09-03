import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { useVacancyData } from "../context/VacancyDataContext";
import LogoBadge from "../components/LogoBadge";
import { useAuth } from "../context/AuthContext";
import QuickApplyModal from "../components/QuickApplyModal";

type DescriptionBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] };

function formatDescription(description: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) blocks.push({ type: "list", items: listItems });
    listItems = [];
  };

  const lines = description.replace(/\s*([•◦▪‣])\s*/g, "\n$1 ").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = line.match(/^(?:[•◦▪‣]|[-–—])\s*(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }

    const isHeading = line.endsWith(":") && line.length <= 96;
    if (isHeading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: line.slice(0, -1) });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: "paragraph", text: description }];
}

export default function JobDetail() {
  const { jobs, companies, loading } = useVacancyData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, openAuthModal, resumeSkills, isJobSaved, toggleSavedJob } = useAuth();
  const [applyOpen, setApplyOpen] = useState(false);

  const job = jobs.find((j) => j.id === Number(id));
  if (loading) return <div className="max-w-7xl mx-auto px-6 py-32 font-mono text-xs text-[#5a6070]">Загружаем вакансию…</div>;
  if (!job) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-32 text-center">
        <div className="font-mono text-[#3a404f] text-sm mb-4">// 404 — вакансия не найдена</div>
        <Link to="/" className="font-mono text-xs text-[#33ff77] hover:underline">← все вакансии</Link>
      </div>
    );
  }

  const company = companies.find((c) => c.id === job.companyId);
  const relatedJobs = jobs.filter((j) => j.companyId === job.companyId && j.id !== job.id).slice(0, 3);
  const descriptionBlocks = formatDescription(job.description);

  const confirmedSkillNames = new Set(
    resumeSkills.filter((s) => s.confirmed).map((s) => s.name.toLowerCase())
  );
  const matchedSkills = job.parsedSkills.filter((s) => confirmedSkillNames.has(s.toLowerCase()));
  const missingSkills = job.parsedSkills.filter((s) => !confirmedSkillNames.has(s.toLowerCase()));
  const matchPct = resumeSkills.length > 0 && job.parsedSkills.length > 0
    ? Math.round((matchedSkills.length / job.parsedSkills.length) * 100)
    : null;

  const levelColors: Record<string, string> = {
    Junior: "#33ff77",
    Middle: "#00d4ff",
    Senior: "#a78bfa",
    Lead: "#fbbf24",
    Staff: "#ff3e78",
  };
  const levelColor = levelColors[job.level] ?? "#5a6070";

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
        <Link to="/" className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors">вакансии</Link>
        <span className="text-[#3a404f]">/</span>
        <span className="font-mono text-xs text-[#5a6070] truncate max-w-[200px]">{job.title}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
        {/* LEFT */}
        <div className="space-y-6">
          {/* header */}
          <div className="card-surface rounded-sm p-6">
            <div className="flex items-start gap-4 mb-5">
              <LogoBadge logo={job.logo} logoUrl={job.logoUrl} color={job.logoColor} className="w-14 h-14 rounded text-lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 rounded-sm"
                    style={{ background: `${levelColor}15`, color: levelColor, border: `1px solid ${levelColor}35` }}
                  >
                    {job.level}
                  </span>
                </div>
                <h1 className="font-mono text-xl md:text-2xl font-medium text-white leading-tight mb-1">{job.title}</h1>
                <div className="flex items-center gap-3 flex-wrap">
                  {company ? (
                    <Link
                      to={`/companies/${company.id}`}
                      className="font-mono text-sm hover:underline transition-colors"
                      style={{ color: company.color }}
                    >
                      {job.company}
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-[#5a6070]">{job.company}</span>
                  )}
                  <span className="text-[#3a404f]">·</span>
                  <span className="font-mono text-xs text-[#5a6070]">{job.location}</span>
                  <span className="text-[#3a404f]">·</span>
                  <span className="font-mono text-xs text-[#3a404f]">{job.posted}</span>
                </div>
              </div>
              <div className="text-right shrink-0 hidden md:block">
                <div className="font-mono text-lg font-medium text-[#33ff77] mb-1">{job.salary}</div>
              </div>
            </div>

            <div className="md:hidden mb-4">
              <div className="font-mono text-lg font-medium text-[#33ff77]">{job.salary}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              {job.tags.map((t) => (
                <span key={t} className="tag neon-badge">{t}</span>
              ))}
              <span className="tag cyan-badge ml-auto">{job.category}</span>
            </div>
          </div>

          {/* description */}
          <section className="card-surface rounded-sm p-6">
            <h2 className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// описание вакансии</h2>
            <>
              {descriptionBlocks.map((block, index) => {
                if (block.type === "heading") {
                  return <h3 key={`${block.text}-${index}`} className="font-mono text-xs text-[#33ff77] uppercase tracking-widest mt-6 first:mt-0 mb-2">{block.text}</h3>;
                }
                if (block.type === "list") {
                  return (
                    <ul key={`${block.items[0]}-${index}`} className="space-y-2 mb-5 pl-4 list-disc marker:text-[#33ff77]">
                      {block.items.map((item) => <li key={item} className="font-sans text-sm text-[var(--color-text)] leading-relaxed pl-1">{item}</li>)}
                    </ul>
                  );
                }
                return <p key={`${block.text.slice(0, 24)}-${index}`} className="font-sans text-sm text-[var(--color-text)] leading-relaxed mb-5 last:mb-0">{block.text}</p>;
              })}
            </>
          </section>

          {/* parsed skills */}
          <section className="card-surface rounded-sm p-6">
            <div className="flex flex-wrap gap-2">
              {job.parsedSkills.map((skill) => (
                <span
                  key={skill}
                  className="font-mono text-xs px-3 py-1.5 rounded-sm border transition-all"
                  style={{
                    background: "rgba(51,255,119,0.06)",
                    borderColor: "rgba(51,255,119,0.25)",
                    color: "#33ff77",
                  }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </section>

          {/* related jobs */}
          {relatedJobs.length > 0 && (
            <section>
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">
                // ещё от {company?.name ?? job.company}
              </div>
              <div className="space-y-2">
                {relatedJobs.map((j) => (
                  <Link
                    key={j.id}
                    to={`/jobs/${j.id}`}
                    className="card-surface rounded-sm px-5 py-4 flex items-center gap-4 group block"
                  >
                    <LogoBadge logo={j.logo} logoUrl={j.logoUrl} color={j.logoColor} className="w-8 h-8 rounded text-xs" loading="lazy" />
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-sm text-[#e8eaf0] group-hover:text-white transition-colors">{j.title}</div>
                      <div className="font-mono text-xs text-[#5a6070] mt-0.5">{j.location}</div>
                    </div>
                    <div className="font-mono text-sm text-[#33ff77] shrink-0">{j.salary}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT — sticky sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20">
          {/* skill match */}
          {matchPct !== null && (
            <div className="card-surface rounded-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs text-[#3a404f] uppercase tracking-widest">// совпадение навыков</span>
                <span
                  className="font-mono text-lg font-medium"
                  style={{ color: matchPct >= 70 ? "#33ff77" : matchPct >= 40 ? "#fbbf24" : "#ff3e78" }}
                >
                  {matchPct}%
                </span>
              </div>

              {/* progress bar */}
              <div className="h-1 bg-[rgba(58,64,79,0.4)] rounded-full mb-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${matchPct}%`,
                    background: matchPct >= 70 ? "#33ff77" : matchPct >= 40 ? "#fbbf24" : "#ff3e78",
                  }}
                />
              </div>

              {/* matched skills */}
              {matchedSkills.length > 0 && (
                <div className="mb-3">
                  <div className="font-mono text-[9px] text-[#33ff77] uppercase tracking-widest mb-1.5 opacity-60">есть в резюме</div>
                  <div className="flex flex-wrap gap-1.5">
                    {matchedSkills.map((s) => (
                      <span
                        key={s}
                        className="font-mono text-[10px] px-2 py-0.5 rounded-sm"
                        style={{ background: "rgba(51,255,119,0.1)", border: "1px solid rgba(51,255,119,0.3)", color: "#33ff77" }}
                      >
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* missing skills */}
              {missingSkills.length > 0 && (
                <div className="mb-3">
                  <div className="font-mono text-[9px] text-[#ff3e78] uppercase tracking-widest mb-1.5 opacity-60">не хватает</div>
                  <div className="flex flex-wrap gap-1.5">
                    {missingSkills.map((s) => (
                      <span
                        key={s}
                        className="font-mono text-[10px] px-2 py-0.5 rounded-sm"
                        style={{ background: "rgba(255,62,120,0.07)", border: "1px solid rgba(255,62,120,0.25)", color: "#ff3e78" }}
                      >
                        + {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="font-mono text-[10px] text-[#3a404f]">
                {matchedSkills.length} из {job.parsedSkills.length} навыков совпадает
              </div>
            </div>
          )}

          {/* no resume nudge */}
          {user && resumeSkills.length === 0 && (
            <div className="card-surface rounded-sm p-5 border border-[rgba(58,64,79,0.3)]">
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// совпадение навыков</div>
              <p className="font-sans text-xs text-[#5a6070] leading-relaxed mb-3">
                Загрузи резюме в профиле — покажем насколько твои навыки совпадают с вакансией.
              </p>
              <Link to="/profile" className="font-mono text-xs text-[#33ff77] hover:underline">
                добавить резюме →
              </Link>
            </div>
          )}

          {/* apply */}
          <div className="card-surface rounded-sm p-5 border border-[rgba(51,255,119,0.15)]">
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">// откликнуться</div>
            <button
              onClick={user ? () => setApplyOpen(true) : openAuthModal}
              className="w-full py-3 font-mono text-sm rounded-sm transition-all mb-3"
              style={{
                background: "rgba(51,255,119,0.15)",
                border: "1px solid rgba(51,255,119,0.4)",
                color: "#33ff77",
              }}
            >
              {user ? "быстрый отклик →" : "войти и откликнуться →"}
            </button>
            {!user && (
              <p className="font-sans text-[10px] text-[#3a404f] text-center">нужна авторизация</p>
            )}
            {user && (
              <button
                onClick={() => toggleSavedJob(job.id)}
                aria-pressed={isJobSaved(job.id)}
                className="w-full py-2.5 font-mono text-xs rounded-sm transition-all flex items-center justify-center gap-1.5"
                style={{
                  background: isJobSaved(job.id) ? "rgba(0,212,255,0.08)" : "transparent",
                  border: `1px solid ${isJobSaved(job.id) ? "rgba(0,212,255,0.35)" : "rgba(58,64,79,0.4)"}`,
                  color: isJobSaved(job.id) ? "#00d4ff" : "#5a6070",
                }}
              >
                <svg className="w-3.5 h-3.5" fill={isJobSaved(job.id) ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                {isJobSaved(job.id) ? "в сохранённых" : "сохранить вакансию"}
              </button>
            )}
          </div>

          {/* company */}
          {company && (
            <div className="card-surface rounded-sm p-5">
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// компания</div>
              <div className="flex items-center gap-3 mb-3">
                <LogoBadge logo={company.logo} logoUrl={company.logoUrl} color={company.color} className="w-10 h-10 rounded text-sm" />
                <div>
                  <div className="font-sans font-semibold text-sm text-[#e8eaf0]">{company.name}</div>
                  <div className="font-mono text-xs text-[#3a404f]">{company.industry} · {company.size}</div>
                </div>
              </div>
              <p className="font-sans text-xs text-[#5a6070] leading-relaxed mb-4">{company.about}</p>
              <Link
                to={`/companies/${company.id}`}
                className="font-mono text-xs hover:underline transition-colors"
                style={{ color: company.color }}
              >
                профиль компании →
              </Link>
            </div>
          )}

          {/* meta */}
          <div className="card-surface rounded-sm p-5">
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// детали</div>
            <div className="space-y-3">
              {[
                { label: "формат", value: job.location },
                { label: "категория", value: job.category },
                { label: "грейд", value: job.level },
                { label: "опубликовано", value: job.posted },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="font-mono text-xs text-[#3a404f]">{item.label}</span>
                  <span className="font-mono text-xs text-[#e8eaf0]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {applyOpen && (
        <QuickApplyModal job={job} onClose={() => setApplyOpen(false)} />
      )}
    </div>
  );
}
