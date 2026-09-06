import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { accountApi, type AdminStats } from "../api";

function formatDuration(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)} с`;
  return `${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} с`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function StatCard({ label, value, detail, tone = "green" }: { label: string; value: string | number; detail?: string; tone?: "green" | "cyan" | "pink" }) {
  const colors = { green: "#33ff77", cyan: "#00d4ff", pink: "#ff3e78" };
  return (
    <div className="card-surface rounded-sm p-5">
      <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">// {label}</div>
      <div className="font-mono text-3xl text-white font-medium" style={{ color: colors[tone] }}>{value}</div>
      {detail && <div className="font-sans text-xs text-[#5a6070] mt-2">{detail}</div>}
    </div>
  );
}

export default function Admin() {
  const { user, isLoading } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.isAdmin) return;
    accountApi.adminStats().then(setStats).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить статистику")).finally(() => setLoading(false));
  }, [user?.isAdmin]);

  const maxRegistrations = useMemo(() => Math.max(1, ...(stats?.registrationsByDay.map((day) => day.count) || [1])), [stats]);

  if (isLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!user.isAdmin) {
    return <div className="max-w-7xl mx-auto px-6 py-32 text-center"><div className="font-mono text-[#ff3e78] text-sm mb-3">// доступ запрещён</div><div className="font-sans text-sm text-[#5a6070] mb-5">Панель доступна только администраторам.</div><Link to="/" className="font-mono text-xs text-[#33ff77] hover:underline">← на главную</Link></div>;
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-12">
      <div className="flex items-center gap-3 mb-8">
        <Link to="/" className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">← главная</Link>
        <span className="text-[#3a404f]">/</span>
        <span className="font-mono text-xs text-[#3a404f]">админка</span>
      </div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-10">
        <div>
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">// контроль проекта</div>
          <h1 className="font-mono text-3xl md:text-5xl text-white font-medium leading-tight">Статистика<br /><span className="text-[#33ff77] neon-glow">jobs.dev</span></h1>
        </div>
        {stats && <div className="font-mono text-[10px] text-[#5a6070]">обновлено {new Date(stats.snapshotAt).toLocaleString("ru-RU")}</div>}
      </div>

      {loading && <div className="card-surface rounded-sm p-10 text-center font-mono text-xs text-[#5a6070]">собираем показатели...</div>}
      {error && <div role="alert" className="border border-[rgba(255,62,120,0.3)] bg-[rgba(255,62,120,0.06)] rounded-sm p-5 font-mono text-xs text-[#ff3e78]">{error}</div>}
      {stats && (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-8" aria-label="Основные показатели">
            <StatCard label="вакансии" value={stats.vacancies.total.toLocaleString("ru-RU")} detail={`+${stats.vacancies.added} добавилось · −${stats.vacancies.removed} убавилось`} />
            <StatCard label="компании" value={stats.companies.total} detail="в текущем каталоге" tone="cyan" />
            <StatCard label="пользователи" value={stats.users.total} detail={`${stats.users.active} активных · +${stats.users.last7Days} за 7 дней`} />
            <StatCard label="отклики" value={stats.applications} detail={`${stats.resumes} резюме · ${stats.savedVacancies} сохранённых вакансий`} tone="pink" />
          </section>

          <section className="mb-8" aria-labelledby="refresh-title">
            <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
              <div>
                <div id="refresh-title" className="font-mono text-xs text-[#33ff77] uppercase tracking-widest">// обновление каталога</div>
                <div className="font-sans text-xs text-[#5a6070] mt-1">Длительность прохода, полнота обработки источников и причины ошибок</div>
              </div>
              {stats.refresh.latest && <div className="font-mono text-[10px] text-[#5a6070]">запуск {formatDate(stats.refresh.latest.startedAt)}</div>}
            </div>
            {!stats.refresh.available || !stats.refresh.latest ? (
              <div className="border border-[rgba(0,212,255,0.25)] bg-[rgba(0,212,255,0.04)] rounded-sm p-5 font-sans text-sm text-[#b0b6c4]">
                {stats.refresh.message || "История проходов пока не передана в приложение."}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
                  <StatCard label="длительность" value={formatDuration(stats.refresh.latest.durationSeconds)} detail={formatDate(stats.refresh.latest.finishedAt)} tone="cyan" />
                  <StatCard label="источники" value={`${stats.refresh.latest.succeededSources}/${stats.refresh.latest.totalSources}`} detail={`${stats.refresh.latest.failedSources} с ошибками`} tone={stats.refresh.latest.failedSources ? "pink" : "green"} />
                  <StatCard label="получено" value={stats.refresh.latest.jobsReceived.toLocaleString("ru-RU")} detail={`${stats.refresh.latest.jobsAccepted.toLocaleString("ru-RU")} прошло фильтры`} />
                  <StatCard label="изменения" value={`+${stats.refresh.latest.newJobs}`} detail={`${stats.refresh.latest.updatedJobs} обновлено`} />
                  <StatCard label="закрыто" value={stats.refresh.latest.closedJobs} detail={`${stats.refresh.latest.staleJobs} помечено устаревшими`} tone="pink" />
                </div>

                {stats.refresh.sources.some((source) => source.status === "error") && (
                  <div className="border border-[rgba(255,62,120,0.3)] bg-[rgba(255,62,120,0.05)] rounded-sm p-5 mb-4" role="alert">
                    <div className="font-mono text-xs text-[#ff3e78] uppercase tracking-widest mb-3">// источники с ошибками</div>
                    <div className="space-y-3">
                      {stats.refresh.sources.filter((source) => source.status === "error").map((source) => (
                        <div key={source.sourceKey} className="border-b border-[rgba(255,62,120,0.15)] pb-3 last:border-0 last:pb-0">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="font-mono text-sm text-white">{source.company}</span>
                            <span className="font-mono text-[10px] text-[#5a6070]">{formatDuration(source.durationSeconds)}</span>
                          </div>
                          <div className="font-sans text-xs text-[#ff9ab5] mt-1 break-words">{source.error || "Источник не вернул объяснение ошибки"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="card-surface rounded-sm overflow-hidden">
                  <div className="p-5 pb-3 font-mono text-xs text-[#3a404f] uppercase tracking-widest">// детализация по компаниям</div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left">
                      <thead className="border-y border-[rgba(58,64,79,0.4)] font-mono text-[10px] text-[#5a6070] uppercase tracking-wider">
                        <tr><th className="px-5 py-3 font-normal">компания</th><th className="px-3 py-3 font-normal">статус</th><th className="px-3 py-3 font-normal text-right">время</th><th className="px-3 py-3 font-normal text-right">получено</th><th className="px-3 py-3 font-normal text-right">принято</th><th className="px-5 py-3 font-normal text-right">новых</th></tr>
                      </thead>
                      <tbody className="font-sans text-xs text-[#b0b6c4]">
                        {stats.refresh.sources.map((source) => (
                          <tr key={source.sourceKey} className="border-b border-[rgba(58,64,79,0.22)] last:border-0">
                            <td className="px-5 py-3"><div className="font-mono text-sm text-white">{source.company}</div><div className="font-mono text-[10px] text-[#3a404f]">{source.sourceKey}</div></td>
                            <td className={`px-3 py-3 font-mono ${source.status === "ok" ? "text-[#33ff77]" : "text-[#ff3e78]"}`}>{source.status === "ok" ? "готово" : "ошибка"}</td>
                            <td className="px-3 py-3 text-right font-mono">{formatDuration(source.durationSeconds)}</td>
                            <td className="px-3 py-3 text-right">{source.jobsReceived.toLocaleString("ru-RU")}</td>
                            <td className="px-3 py-3 text-right">{source.jobsAccepted.toLocaleString("ru-RU")}</td>
                            <td className="px-5 py-3 text-right font-mono text-[#33ff77]">+{source.newJobs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>

          {stats.refresh.history.length > 1 && (
            <section className="card-surface rounded-sm p-5 md:p-6 mb-8" aria-labelledby="history-title">
              <div id="history-title" className="font-mono text-xs text-[#33ff77] uppercase tracking-widest mb-4">// история проходов</div>
              <div className="space-y-2">
                {stats.refresh.history.map((run) => (
                  <div key={run.runId} className="flex items-center gap-3 flex-wrap border-b border-[rgba(58,64,79,0.22)] last:border-0 pb-2 last:pb-0 font-mono text-xs">
                    <span className={run.status === "ok" ? "text-[#33ff77]" : "text-[#ff3e78]"}>{run.status === "ok" ? "ok" : "error"}</span>
                    <span className="text-[#b0b6c4]">{formatDate(run.startedAt)}</span>
                    <span className="text-[#5a6070]">{formatDuration(run.durationSeconds)}</span>
                    <span className="text-[#5a6070]">{run.succeededSources}/{run.totalSources} источников</span>
                    <span className="text-[#5a6070]">+{run.newJobs} новых · −{run.closedJobs} закрыто</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card-surface rounded-sm p-5 md:p-6" aria-labelledby="registration-title">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <div id="registration-title" className="font-mono text-xs text-[#33ff77] uppercase tracking-widest">// регистрации</div>
                <div className="font-sans text-xs text-[#5a6070] mt-1">Новые пользователи за последние 14 дней</div>
              </div>
              <div className="font-mono text-xs text-[#5a6070]">всего: {stats.users.total}</div>
            </div>
            <div className="h-40 flex items-end gap-1 sm:gap-2 border-b border-[rgba(58,64,79,0.35)]" role="img" aria-label="График регистраций по дням">
              {stats.registrationsByDay.map((day) => (
                <div key={day.date} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-2 group">
                  <span className="font-mono text-[10px] text-[#5a6070] opacity-0 group-hover:opacity-100 transition-opacity">{day.count}</span>
                  <div className="w-full max-w-8 bg-[rgba(51,255,119,0.55)] group-hover:bg-[#33ff77] transition-colors rounded-t-sm" style={{ height: `${Math.max(day.count ? 8 : 2, (day.count / maxRegistrations) * 100)}%` }} />
                  <span className="font-mono text-[9px] text-[#3a404f] -mb-5">{day.label}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
