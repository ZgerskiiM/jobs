import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { accountApi, type AdminStats } from "../api";

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
