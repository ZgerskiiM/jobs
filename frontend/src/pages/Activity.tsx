import { useState } from "react";
import { Navigate, Link } from "react-router";
import { useAuth } from "../context/AuthContext";
import { type Application, type AppStatus } from "../data";
import LogoBadgeImage from "../components/LogoBadge";
import { useVacancyData } from "../context/VacancyDataContext";

const STATUS_META: Record<AppStatus, { label: string; color: string; bg: string; border: string }> = {
  sent:      { label: "Отправлен",  color: "#5a6070", bg: "rgba(90,96,112,0.12)",  border: "rgba(90,96,112,0.3)"  },
  viewed:    { label: "Просмотрен", color: "#00d4ff", bg: "rgba(0,212,255,0.08)",  border: "rgba(0,212,255,0.25)" },
  interview: { label: "Интервью",   color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  border: "rgba(251,191,36,0.3)" },
  offer:     { label: "Оффер 🎉",   color: "#33ff77", bg: "rgba(51,255,119,0.1)",  border: "rgba(51,255,119,0.35)"},
  rejected:  { label: "Отказ",      color: "#ff3e78", bg: "rgba(255,62,120,0.08)", border: "rgba(255,62,120,0.2)" },
};

const STATUS_ORDER: AppStatus[] = ["sent", "viewed", "interview", "offer", "rejected"];

type Tab = "applications" | "saved" | "stats";

function LogoBadge({ logo, logoUrl, color }: { logo: string; logoUrl?: string; color: string }) {
  return <LogoBadgeImage logo={logo} logoUrl={logoUrl} color={color} className="w-9 h-9 rounded text-xs" loading="lazy" />;
}

function BellIcon({ on }: { on: boolean }) {
  return on ? (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function canonicalUrl(value?: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

function AppCard({
  app,
  onStatusChange,
  onNoteChange,
  onContactChange,
  onDeadlineChange,
  onToggleNotif,
}: {
  app: Application;
  onStatusChange: (id: number, s: AppStatus) => void;
  onNoteChange: (id: number, note: string) => void;
  onContactChange: (id: number, contact: string) => void;
  onDeadlineChange: (id: number, deadline: string) => void;
  onToggleNotif: (id: number) => void;
}) {
  const { jobs } = useVacancyData();
  const [expanded, setExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteVal, setNoteVal] = useState(app.note);
  const [contactVal, setContactVal] = useState(app.contact);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineVal, setDeadlineVal] = useState(app.deadline);

  const isStale = app.updatedDaysAgo >= 7 && app.status !== "offer" && app.status !== "rejected";
  const m = STATUS_META[app.status];
  const linkedJob = jobs.find((job) =>
    (job.url && canonicalUrl(job.url) === canonicalUrl(app.submittedUrl || app.url))
    || (job.id === app.id && app.detectedBy === "extension")
  );

  return (
    <div className={`rounded-sm border transition-colors ${isStale ? "border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.02)]" : "border-[rgba(51,255,119,0.1)] bg-[#0e1018]"}`}>

      {/* Stale warning */}
      {isStale && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[rgba(251,191,36,0.15)] bg-[rgba(251,191,36,0.05)]">
          <span className="text-[#fbbf24] text-xs">⚠</span>
          <span className="font-mono text-[10px] text-[#fbbf24]">
            нет активности {app.updatedDaysAgo} дней — напиши рекрутеру или закрой вакансию
          </span>
          <button
            onClick={() => onToggleNotif(app.id)}
            className={`ml-auto flex items-center gap-1 font-mono text-[10px] transition-colors ${app.notificationsOn ? "text-[#fbbf24]" : "text-[#3a404f] hover:text-[#5a6070]"}`}
            title={app.notificationsOn ? "уведомления включены" : "уведомления выключены"}
          >
            <BellIcon on={app.notificationsOn} />
          </button>
        </div>
      )}

      {/* Main info */}
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <LogoBadge
          logo={app.logo || linkedJob?.logo || app.company.slice(0, 2).toUpperCase()}
          logoUrl={linkedJob?.logoUrl}
          color={app.color || linkedJob?.logoColor || "#33ff77"}
        />

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {linkedJob ? (
                <Link to={`/jobs/${linkedJob.id}`} className="font-sans font-semibold text-sm text-[#e8eaf0] hover:text-[#33ff77] transition-colors" title="открыть вакансию на jobs.dev">
                  {app.title}
                </Link>
              ) : (
                <div className="font-sans font-semibold text-sm text-[#e8eaf0]">{app.title}</div>
              )}
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="font-mono text-xs text-[#5a6070]">{app.company}</span>
                <span className="text-[#3a404f]">·</span>
                <span className="font-mono text-xs text-[#5a6070]">{app.location}</span>
              </div>
            </div>

            {/* Status badge + notif toggle */}
            <div className="flex items-center gap-2 shrink-0">
              {!isStale && (
                <button
                  onClick={() => onToggleNotif(app.id)}
                  className={`transition-colors ${app.notificationsOn ? "text-[#33ff77] opacity-70 hover:opacity-100" : "text-[#3a404f] hover:text-[#5a6070]"}`}
                  title={app.notificationsOn ? "уведомления включены" : "уведомления выключены"}
                >
                  <BellIcon on={app.notificationsOn} />
                </button>
              )}
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm" style={{ color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
                {m.label}
              </span>
            </div>
          </div>

          {/* Salary + level + tags */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="font-mono text-xs text-[#33ff77] font-medium">{app.salary}</span>
            <span className="text-[#3a404f]">·</span>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm bg-[rgba(0,212,255,0.08)] border border-[rgba(0,212,255,0.2)] text-[#00d4ff]">{app.level}</span>
            <span className="text-[#3a404f]">·</span>
            {app.tags.map((t) => (
              <span key={t} className="tag neon-badge">{t}</span>
            ))}
          </div>

          {/* Deadline */}
          <div className="flex items-center gap-3 mt-2">
            {editingDeadline ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={deadlineVal}
                  onChange={(e) => setDeadlineVal(e.target.value)}
                  placeholder="напр. 10 сент"
                  className="bg-transparent border-b border-[rgba(51,255,119,0.3)] font-mono text-xs text-[#e8eaf0] focus:outline-none pb-0.5 w-28"
                  onKeyDown={(e) => { if (e.key === "Enter") { onDeadlineChange(app.id, deadlineVal); setEditingDeadline(false); } if (e.key === "Escape") setEditingDeadline(false); }}
                />
                <button onClick={() => { onDeadlineChange(app.id, deadlineVal); setEditingDeadline(false); }} className="font-mono text-[10px] text-[#33ff77]">ок</button>
              </div>
            ) : app.deadline ? (
              <button onClick={() => setEditingDeadline(true)} className="flex items-center gap-1.5 font-mono text-[10px] text-[#ff3e78] hover:opacity-80 transition-opacity">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                дедлайн: {app.deadline}
              </button>
            ) : (
              <button onClick={() => setEditingDeadline(true)} className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070] transition-colors">
                + дедлайн
              </button>
            )}
            <span className="font-mono text-[10px] text-[#3a404f]">отклик: {app.appliedAt}</span>
          </div>
        </div>
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-5 py-2 border-t border-[rgba(51,255,119,0.06)] text-[#3a404f] hover:text-[#5a6070] hover:bg-[rgba(51,255,119,0.02)] transition-all"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="font-mono text-[10px]">
          {expanded ? "свернуть" : `хронология · ${app.timeline.length} событий${app.note ? " · есть заметка" : ""}${app.contact ? " · контакт" : ""}`}
        </span>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-[rgba(51,255,119,0.06)] pt-4 space-y-5">

          {/* Timeline */}
          <div>
            <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">хронология</div>
            <div className="relative pl-4">
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-[rgba(51,255,119,0.1)]" />
              <div className="space-y-3">
                {app.timeline.map((ev, i) => (
                  <div key={i} className="relative flex items-start gap-3">
                    <div
                      className="absolute -left-[11px] top-1 w-2 h-2 rounded-full border border-[#0e1018]"
                      style={{ background: i === app.timeline.length - 1 ? "#33ff77" : "#3a404f" }}
                    />
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-sans text-xs text-[#e8eaf0]">{ev.label}</span>
                        <span className="font-mono text-[10px] text-[#3a404f]">{ev.date}</span>
                      </div>
                      {ev.note && <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">{ev.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Contact */}
          <div>
            <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-1.5">контакт рекрутера</div>
            <input
              value={contactVal}
              onChange={(e) => setContactVal(e.target.value)}
              onBlur={() => onContactChange(app.id, contactVal)}
              placeholder="имя, телеграм или email..."
              className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.1)] focus:border-[rgba(51,255,119,0.3)] px-3 py-2 font-mono text-xs text-[#e8eaf0] rounded-sm transition-colors"
            />
          </div>

          {/* Note */}
          <div>
            <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-1.5">заметка</div>
            {editingNote ? (
              <div>
                <textarea
                  autoFocus
                  rows={3}
                  value={noteVal}
                  onChange={(e) => setNoteVal(e.target.value)}
                  placeholder="договорённости, вопросы на интервью, впечатления..."
                  className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.2)] focus:border-[rgba(51,255,119,0.4)] px-3 py-2 font-mono text-xs text-[#e8eaf0] rounded-sm resize-none transition-colors"
                />
                <div className="flex gap-2 mt-1.5">
                  <button
                    onClick={() => { onNoteChange(app.id, noteVal); setEditingNote(false); }}
                    className="font-mono text-[10px] text-[#33ff77] hover:underline"
                  >сохранить</button>
                  <button onClick={() => { setNoteVal(app.note); setEditingNote(false); }} className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070]">отмена</button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingNote(true)}
                className={`min-h-[36px] px-3 py-2 rounded-sm border cursor-text transition-colors ${app.note ? "border-[rgba(51,255,119,0.08)] hover:border-[rgba(51,255,119,0.2)]" : "border-dashed border-[rgba(58,64,79,0.4)] hover:border-[rgba(58,64,79,0.8)]"}`}
              >
                {app.note
                  ? <span className="font-sans text-xs text-[#5a6070] leading-relaxed">{app.note}</span>
                  : <span className="font-mono text-[10px] text-[#3a404f]">нажми чтобы добавить заметку...</span>
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-1.5 px-5 py-3 border-t border-[rgba(51,255,119,0.06)] flex-wrap">
        <span className="font-mono text-[10px] text-[#3a404f] mr-1">статус:</span>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(app.id, s)}
            className="font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-all"
            style={{
              background: app.status === s ? STATUS_META[s].bg : "transparent",
              borderColor: app.status === s ? STATUS_META[s].border : "rgba(58,64,79,0.3)",
              color: app.status === s ? STATUS_META[s].color : "#3a404f",
            }}
          >
            {STATUS_META[s].label}
          </button>
        ))}
        <a
          href={linkedJob ? `/jobs/${linkedJob.id}` : app.url}
          target={linkedJob ? undefined : "_blank"}
          rel={linkedJob ? undefined : "noopener noreferrer"}
          className={`ml-auto flex items-center gap-1 font-mono text-[10px] border px-2.5 py-1 rounded-sm transition-all ${linkedJob ? "text-[#33ff77] border-[rgba(51,255,119,0.3)] hover:border-[rgba(51,255,119,0.6)]" : "text-[#5a6070] hover:text-[#e8eaf0] border-[rgba(58,64,79,0.5)] hover:border-[rgba(58,64,79,0.9)]"}`}
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          вакансия
        </a>
      </div>
    </div>
  );
}

export default function Activity() {
  const { jobs } = useVacancyData();
  const { user, isLoading, applications: apps, updateApplication, savedJobIds, toggleSavedJob, savedJobNotes, updateSavedJobNote } = useAuth();
  const [tab, setTab] = useState<Tab>("applications");
  const [statusFilter, setStatusFilter] = useState<AppStatus | "all">("all");
  const [savedNoteId, setSavedNoteId] = useState<number | null>(null);
  const [savedNoteText, setSavedNoteText] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(savedJobNotes).map(([id, note]) => [Number(id), note])));

  const savedJobs = savedJobIds
    .map((sid) => jobs.find((j) => j.id === sid))
    .filter((j): j is (typeof jobs)[number] => Boolean(j));

  if (isLoading) return null;
  if (!user) return <Navigate to="/" replace />;

  const updateApp = (id: number, patch: Partial<Application>) => updateApplication(id, patch);

  const onStatusChange = (id: number, status: AppStatus) =>
    updateApp(id, { status, updatedDaysAgo: 0 });

  const filtered = statusFilter === "all" ? apps : apps.filter((a) => a.status === statusFilter);

  const total = apps.length;
  const responded = apps.filter((a) => a.status !== "sent").length;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;
  const offers = apps.filter((a) => a.status === "offer").length;
  const interviews = apps.filter((a) => a.status === "interview" || a.status === "offer").length;
  const staleCount = apps.filter((a) => a.updatedDaysAgo >= 7 && a.status !== "offer" && a.status !== "rejected").length;

  const statusCounts = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = apps.filter((a) => a.status === s).length;
    return acc;
  }, {} as Record<AppStatus, number>);

  const ENOUGH_DATA = total >= 10;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "applications", label: "Отклики", count: apps.length },
    { id: "saved", label: "Сохранённые", count: savedJobs.length },
    { id: "stats", label: "Статистика" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-10">
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// поиск работы</div>
        <h1 className="font-mono text-3xl text-white font-medium mb-1">Мои отклики</h1>
        <p className="font-sans text-sm text-[#5a6070]">Трекер поиска работы — всё в одном месте</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[rgba(51,255,119,0.08)] rounded-sm overflow-hidden mb-8">
        {[
          { label: "всего откликов", value: total, color: "#e8eaf0" },
          { label: "процент ответов", value: `${responseRate}%`, color: "#00d4ff" },
          { label: "на интервью", value: interviews, color: "#fbbf24" },
          { label: "офферов", value: offers, color: "#33ff77" },
        ].map((s) => (
          <div key={s.label} className="bg-[#07080e] px-5 py-4">
            <div className="font-mono text-2xl font-medium mb-0.5" style={{ color: s.color }}>{s.value}</div>
            <div className="font-sans text-xs text-[#3a404f]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Stale nudge */}
      {staleCount > 0 && (
        <div className="flex items-center gap-3 mb-6 px-4 py-3 border border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.04)] rounded-sm">
          <span className="text-[#fbbf24]">⚠</span>
          <span className="font-sans text-xs text-[#5a6070]">
            <span className="text-[#fbbf24]">{staleCount} {staleCount === 1 ? "вакансия" : "вакансии"}</span> без движения больше 7 дней — возможно, стоит написать рекрутеру или обновить статус
          </span>
          <button
            onClick={() => setStatusFilter("all")}
            className="ml-auto font-mono text-[10px] text-[#fbbf24] hover:underline whitespace-nowrap"
          >
            посмотреть →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-px mb-8 border-b border-[rgba(51,255,119,0.08)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 font-mono text-xs px-5 py-3 border-b-2 transition-all -mb-px ${
              tab === t.id ? "border-[#33ff77] text-[#33ff77]" : "border-transparent text-[#5a6070] hover:text-[#e8eaf0]"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${tab === t.id ? "bg-[rgba(51,255,119,0.15)] text-[#33ff77]" : "bg-[#1a1d28] text-[#3a404f]"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── APPLICATIONS ── */}
      {tab === "applications" && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <button
              onClick={() => setStatusFilter("all")}
              className={`font-mono text-xs px-3 py-1.5 rounded-sm border transition-all ${statusFilter === "all" ? "bg-[rgba(51,255,119,0.1)] border-[rgba(51,255,119,0.4)] text-[#33ff77]" : "border-[rgba(58,64,79,0.5)] text-[#5a6070]"}`}
            >
              Все · {total}
            </button>
            {STATUS_ORDER.map((s) => statusCounts[s] > 0 && (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="font-mono text-xs px-3 py-1.5 rounded-sm border transition-all"
                style={{
                  background: statusFilter === s ? STATUS_META[s].bg : "transparent",
                  borderColor: statusFilter === s ? STATUS_META[s].border : "rgba(58,64,79,0.5)",
                  color: statusFilter === s ? STATUS_META[s].color : "#5a6070",
                }}
              >
                {STATUS_META[s].label} · {statusCounts[s]}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onStatusChange={onStatusChange}
                onNoteChange={(id, note) => updateApp(id, { note })}
                onContactChange={(id, contact) => updateApp(id, { contact })}
                onDeadlineChange={(id, deadline) => updateApp(id, { deadline })}
                onToggleNotif={(id) => updateApp(id, { notificationsOn: !apps.find((a) => a.id === id)!.notificationsOn })}
              />
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-16">
                <div className="font-mono text-[#3a404f] text-sm">// нет откликов в этом статусе</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SAVED ── */}
      {tab === "saved" && (
        <div className="space-y-2">
          {savedJobs.map((job) => {
            const note = savedNoteText[job.id] ?? "";
            return (
            <div key={job.id} className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm">
              <div className="flex items-start gap-4 px-5 py-4">
                <LogoBadge logo={job.logo} logoUrl={job.logoUrl} color={job.logoColor} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link to={`/jobs/${job.id}`} className="font-sans font-semibold text-sm text-[#e8eaf0] hover:text-white transition-colors">{job.title}</Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-xs text-[#5a6070]">{job.company}</span>
                        <span className="text-[#3a404f]">·</span>
                        <span className="font-mono text-xs text-[#5a6070]">{job.location}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-[#33ff77]">{job.salary}</div>
                      <div className="font-mono text-[10px] text-[#3a404f] mt-0.5">{job.level}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {job.tags.map((t) => <span key={t} className="tag neon-badge">{t}</span>)}
                  </div>
                  {savedNoteId === job.id ? (
                    <div className="mt-3">
                      <textarea
                        autoFocus rows={2}
                        value={note}
                        onChange={(e) => setSavedNoteText((p) => ({ ...p, [job.id]: e.target.value }))}
                        placeholder="заметка к вакансии..."
                        className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.2)] px-3 py-2 font-mono text-xs text-[#e8eaf0] rounded-sm resize-none"
                      />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={() => { void updateSavedJobNote(job.id, note); setSavedNoteId(null); }} className="font-mono text-[10px] text-[#33ff77] hover:underline">сохранить</button>
                        <button onClick={() => { setSavedNoteText((p) => ({ ...p, [job.id]: "" })); void updateSavedJobNote(job.id, ""); setSavedNoteId(null); }} className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070]">очистить</button>
                      </div>
                    </div>
                  ) : note ? (
                    <div onClick={() => setSavedNoteId(job.id)} className="mt-3 px-3 py-2 bg-[#07080e] border border-[rgba(51,255,119,0.07)] hover:border-[rgba(51,255,119,0.2)] rounded-sm font-sans text-xs text-[#5a6070] cursor-pointer transition-colors">
                      {note}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 py-3 border-t border-[rgba(51,255,119,0.06)]">
                <Link to={`/jobs/${job.id}`} className="flex items-center gap-1.5 px-4 py-1.5 bg-[rgba(51,255,119,0.12)] border border-[rgba(51,255,119,0.3)] text-[#33ff77] font-mono text-xs rounded-sm hover:bg-[rgba(51,255,119,0.2)] transition-all">откликнуться →</Link>
                <button onClick={() => setSavedNoteId(job.id)} className="font-mono text-xs text-[#5a6070] hover:text-[#e8eaf0] transition-colors">{note ? "изменить заметку" : "+ заметка"}</button>
                <button onClick={() => toggleSavedJob(job.id)} className="ml-auto font-mono text-[10px] text-[#3a404f] hover:text-[#ff3e78] transition-colors">убрать</button>
              </div>
            </div>
          );})}
          {savedJobs.length === 0 && (
            <div className="text-center py-16">
              <div className="font-mono text-[#3a404f] text-sm">// нет сохранённых вакансий</div>
              <Link to="/" className="font-mono text-xs text-[#33ff77] hover:underline mt-3 inline-block">смотреть вакансии →</Link>
            </div>
          )}
        </div>
      )}

      {/* ── STATS ── */}
      {tab === "stats" && (
        !ENOUGH_DATA ? (
          <div className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm p-12 text-center">
            <div className="font-mono text-4xl text-[#33ff77] font-medium mb-3">{total} / 10</div>
            <div className="font-sans text-sm text-white font-medium mb-2">Накапливаем данные</div>
            <div className="font-sans text-xs text-[#5a6070] max-w-xs mx-auto leading-relaxed mb-6">
              Статистика станет полезной после 10 откликов — тогда появятся воронка, метрики и сравнение с рынком
            </div>
            <div className="h-1.5 bg-[#1a1d28] rounded-full max-w-xs mx-auto overflow-hidden">
              <div className="h-full bg-[#33ff77] rounded-full transition-all" style={{ width: `${Math.round((total / 10) * 100)}%` }} />
            </div>
            <div className="font-mono text-[10px] text-[#3a404f] mt-2">ещё {10 - total} откликов</div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Funnel */}
            <div>
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// воронка откликов</div>
              <div className="space-y-2">
                {["sent", "viewed", "interview", "offer"].map((s) => {
                  const count = statusCounts[s as AppStatus];
                  const pct = total ? Math.round((count / total) * 100) : 0;
                  const m = STATUS_META[s as AppStatus];
                  return (
                    <div key={s} className="flex items-center gap-4">
                      <div className="w-24 shrink-0 text-right font-mono text-xs text-[#5a6070]">{m.label}</div>
                      <div className="flex-1 h-8 bg-[#141620] rounded-sm overflow-hidden relative">
                        <div className="h-full rounded-sm" style={{ width: `${Math.max(pct, 3)}%`, background: `${m.color}22`, borderRight: `2px solid ${m.color}` }} />
                        <div className="absolute inset-0 flex items-center px-3">
                          <span className="font-mono text-xs" style={{ color: m.color }}>{count}</span>
                        </div>
                      </div>
                      <div className="w-10 shrink-0 font-mono text-xs text-[#3a404f]">{pct}%</div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 pt-2 border-t border-[rgba(51,255,119,0.06)]">
                  <div className="w-24 shrink-0 text-right font-mono text-xs text-[#5a6070]">Отказы</div>
                  <div className="flex-1 h-8 bg-[#141620] rounded-sm overflow-hidden relative">
                    <div className="h-full rounded-sm" style={{ width: `${Math.max(total ? Math.round((statusCounts.rejected / total) * 100) : 0, 3)}%`, background: "rgba(255,62,120,0.12)", borderRight: "2px solid #ff3e78" }} />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span className="font-mono text-xs text-[#ff3e78]">{statusCounts.rejected}</span>
                    </div>
                  </div>
                  <div className="w-10 shrink-0 font-mono text-xs text-[#3a404f]">{total ? Math.round((statusCounts.rejected / total) * 100) : 0}%</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { label: "Процент ответов", value: `${responseRate}%`, sub: "компаний ответили", color: "#00d4ff", note: responseRate >= 35 ? "выше среднего (35%)" : "ниже среднего (35%)", good: responseRate >= 35 },
                { label: "Конверсия в интервью", value: total ? `${Math.round((interviews / total) * 100)}%` : "0%", sub: "от всех откликов", color: "#fbbf24", note: "среднее ~15%", good: true },
                { label: "Конверсия в оффер", value: interviews ? `${Math.round((offers / interviews) * 100)}%` : "—", sub: "из дошедших до интервью", color: "#33ff77", note: "среднее ~20%", good: true },
              ].map((m) => (
                <div key={m.label} className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm p-5">
                  <div className="font-mono text-xs text-[#3a404f] mb-3">{m.label}</div>
                  <div className="font-mono text-3xl font-medium mb-1" style={{ color: m.color }}>{m.value}</div>
                  <div className="font-sans text-xs text-[#5a6070] mb-2">{m.sub}</div>
                  <div className="font-mono text-[10px]" style={{ color: m.good ? "#33ff77" : "#ff3e78" }}>{m.note}</div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
