import { Link } from "react-router";
import type { VacancyScore, VacancyScoreSummary } from "../api";
import type { Job } from "../data";
import LogoBadge from "./LogoBadge";

interface Props {
  jobs: Job[];
  scores: Record<string, VacancyScoreSummary>;
  details: Record<string, VacancyScore>;
  profileLabel: string;
  loading: boolean;
  detailsLoading: boolean;
  appliedJobIds: ReadonlySet<number>;
  isJobSaved: (id: number) => boolean;
  onToggleSaved: (id: number) => void;
  onShowAll: () => void;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function scoreColor(score: number) {
  if (score >= 80) return "#33ff77";
  if (score >= 60) return "#00d4ff";
  return "#fbbf24";
}

function RecommendationRow({
  job,
  score,
  detail,
  isSaved,
  onToggleSaved,
}: {
  job: Job;
  score: VacancyScoreSummary;
  detail?: VacancyScore;
  isSaved: boolean;
  onToggleSaved: (id: number) => void;
}) {
  const matched = unique([
    ...(detail?.matched ?? []).map((item) => item.found),
    ...(detail?.partialMatches ?? []).map((item) => item.found),
  ]).slice(0, 4);
  const missing = unique([
    ...(detail?.missingImportant ?? []),
    ...(detail?.vacancyMissing ?? []),
  ]).slice(0, 3);
  const color = scoreColor(score.score);

  return (
    <li>
      <article className="card-surface rounded-sm px-4 py-4 sm:px-5">
        <header className="flex items-start gap-3">
          <Link to={`/jobs/${job.id}`} className="shrink-0" aria-label={`Открыть вакансию: ${job.title}`}>
            <LogoBadge logo={job.logo} logoUrl={job.logoUrl} color={job.logoColor} className="w-10 h-10 rounded text-sm" loading="lazy" />
          </Link>
          <Link to={`/jobs/${job.id}`} className="min-w-0 flex-1 group">
            <h3 className="font-sans text-sm font-semibold text-[#e8eaf0] group-hover:text-white transition-colors line-clamp-2">
              {job.title}
            </h3>
            <p className="font-mono text-xs text-[#5a6070] mt-1 truncate">
              {job.company} <span className="text-[#3a404f]">·</span> {job.location}
            </p>
          </Link>
          <span
            className="shrink-0 min-w-14 text-right font-mono text-lg font-medium"
            style={{ color }}
            aria-label={`Соответствие резюме: ${Math.round(score.score)} процентов`}
          >
            {Math.round(score.score)}%
          </span>
        </header>

        <p className="font-sans text-xs text-[#b0b6c4] leading-relaxed mt-3">
          {detail?.summary ?? score.label ?? "Оценка вакансии по профилю"}
        </p>

        {(matched.length > 0 || missing.length > 0) && (
          <section className="mt-3 grid gap-1.5 font-mono text-[10px] leading-relaxed" aria-label="Объяснение соответствия">
            {matched.length > 0 && (
              <p className="text-[#5a6070]">
                <span className="text-[#33ff77]">совпадает:</span> {matched.join(", ")}
              </p>
            )}
            {missing.length > 0 && (
              <p className="text-[#5a6070]">
                <span className="text-[#fbbf24]">проверь:</span> {missing.join(", ")}
              </p>
            )}
          </section>
        )}

        <footer className="flex items-center gap-3 flex-wrap mt-4 pt-3 border-t border-[rgba(58,64,79,0.28)]">
          <span className="font-mono text-[10px] text-[#3a404f]">
            {detail ? `уверенность оценки: ${Math.round(detail.confidence)}%` : "уточняем требования..."}
          </span>
          <Link to={`/jobs/${job.id}`} className="font-mono text-[10px] text-[#33ff77] hover:underline min-h-11 inline-flex items-center">
            открыть вакансию →
          </Link>
          <button
            type="button"
            aria-pressed={isSaved}
            onClick={() => onToggleSaved(job.id)}
            className={`ml-auto min-h-11 px-3 font-mono text-[10px] rounded-sm border transition-colors ${isSaved ? "border-[rgba(0,212,255,0.35)] bg-[rgba(0,212,255,0.1)] text-[#00d4ff]" : "border-[rgba(58,64,79,0.5)] text-[#5a6070] hover:border-[rgba(58,64,79,0.9)] hover:text-[#e8eaf0]"}`}
          >
            {isSaved ? "сохранено" : "сохранить"}
          </button>
        </footer>
      </article>
    </li>
  );
}

function LoadingRows() {
  return (
    <ol className="grid gap-2" aria-label="Загрузка персональных рекомендаций" aria-busy="true">
      {["one", "two", "three"].map((item) => (
        <li key={item} className="card-surface rounded-sm px-4 py-5 sm:px-5 animate-pulse" aria-hidden="true">
          <span className="block h-4 w-2/3 bg-[#1a1d28] rounded-sm" />
          <span className="block h-3 w-1/3 bg-[#1a1d28] rounded-sm mt-3" />
          <span className="block h-3 w-4/5 bg-[#1a1d28] rounded-sm mt-5" />
        </li>
      ))}
    </ol>
  );
}

export default function PersonalizedFeed({
  jobs,
  scores,
  details,
  profileLabel,
  loading,
  detailsLoading,
  appliedJobIds,
  isJobSaved,
  onToggleSaved,
  onShowAll,
}: Props) {
  const recommendations = jobs
    .filter((job) => {
      const score = scores[`catalog:${job.id}`];
      return score && score.eligibility !== "INELIGIBLE" && !appliedJobIds.has(job.id);
    })
    .sort((left, right) => (scores[`catalog:${right.id}`]?.score ?? -1) - (scores[`catalog:${left.id}`]?.score ?? -1))
    .slice(0, 5);

  return (
    <section className="max-w-7xl mx-auto px-6 mb-12" aria-labelledby="personalized-feed-title">
      <header className="flex items-end justify-between gap-4 mb-5">
        <section>
          <p className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// персональная лента</p>
          <h2 id="personalized-feed-title" className="font-mono text-2xl md:text-3xl text-white font-medium">
            Вакансии под твой профиль
          </h2>
          <p className="font-sans text-xs text-[#5a6070] mt-2">
            Рекомендации по резюме: {profileLabel}
          </p>
        </section>
        <button type="button" onClick={onShowAll} className="hidden sm:inline-flex min-h-11 items-center font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">
          весь каталог по match →
        </button>
      </header>

      {loading ? (
        <LoadingRows />
      ) : recommendations.length > 0 ? (
        <>
          <ol className="grid gap-2" aria-label="Персональные рекомендации">
            {recommendations.map((job) => {
              const score = scores[`catalog:${job.id}`];
              if (!score) return null;
              return (
                <RecommendationRow
                  key={job.id}
                  job={job}
                  score={score}
                  detail={details[`catalog:${job.id}`]}
                  isSaved={isJobSaved(job.id)}
                  onToggleSaved={onToggleSaved}
                />
              );
            })}
          </ol>
          <p className="font-mono text-[10px] text-[#3a404f] mt-3" role="status">
            {detailsLoading ? "Проверяем требования в лучших совпадениях..." : "Сначала показываем вакансии с самым высоким совпадением"}
          </p>
        </>
      ) : (
        <article className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-6">
          <p className="font-mono text-sm text-[#e8eaf0]">Пока нет новых вакансий с уверенным совпадением</p>
          <p className="font-sans text-xs text-[#5a6070] leading-relaxed mt-2 max-w-xl">
            Подтверди навыки в резюме или снизь порог соответствия, чтобы увидеть больше вариантов.
          </p>
          <Link to="/profile" className="inline-flex min-h-11 items-center mt-4 font-mono text-xs text-[#33ff77] hover:underline">
            настроить резюме →
          </Link>
        </article>
      )}
    </section>
  );
}
