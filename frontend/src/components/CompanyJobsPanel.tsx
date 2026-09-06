import { useEffect } from "react";
import type { Company, Job } from "../data";
import LogoBadge from "./LogoBadge";


interface Props {
  company: Company;
  jobs: Job[];
  onClose: () => void;
}

export default function CompanyJobsPanel({ company, jobs, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-[rgba(7,8,14,0.8)] backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl flex flex-col bg-[#0a0b12] border-l border-[rgba(51,255,119,0.15)] shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-[rgba(51,255,119,0.1)]">
          <div className="flex items-center gap-4">
            <LogoBadge logo={company.logo} logoUrl={company.logoUrl} color={company.color} className="w-12 h-12 rounded text-base" />
            <div>
              <h2 className="font-mono text-lg text-white font-medium">{company.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-xs text-[#5a6070]">{company.industry}</span>
                <span className="text-[#3a404f]">·</span>
                <span className="font-mono text-xs text-[#5a6070]">{company.size} сотрудников</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#5a6070] hover:text-white transition-colors border border-[rgba(58,64,79,0.5)] rounded-sm hover:border-[rgba(58,64,79,1)]"
          >
            ✕
          </button>
        </div>

        {/* About */}
        <div className="px-6 py-4 border-b border-[rgba(51,255,119,0.06)]">
          <p className="font-sans text-sm text-[#5a6070] leading-relaxed">{company.about}</p>
          <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Бизнес-направления">
            {(company.businessDomains || [company.industry]).map((domain) => (
              <span key={domain} className="font-mono text-[10px] px-2 py-0.5 rounded-sm bg-[rgba(0,212,255,0.06)] border border-[rgba(0,212,255,0.18)] text-[#7dcae0]">
                {domain}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <a
              href={company.site}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mono text-xs px-4 py-2 border border-[rgba(58,64,79,0.6)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,1)] rounded-sm transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              {company.domain}
            </a>
            <div className="font-mono text-xs px-3 py-2 rounded-sm" style={{ background: `${company.color}10`, border: `1px solid ${company.color}30`, color: company.color }}>
              {company.jobs} вакансий всего
            </div>
          </div>
        </div>

        {/* Jobs list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">
            // открытые позиции ({jobs.length})
          </div>

          {jobs.length === 0 ? (
            <div className="text-center py-16">
              <div className="font-mono text-[#3a404f] text-sm">// вакансии не найдены</div>
              <div className="font-mono text-xs text-[#3a404f] mt-2">в нашем каталоге пока нет вакансий этой компании</div>
              <a
                href={company.site}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-6 font-mono text-xs px-4 py-2 border border-[rgba(58,64,79,0.6)] text-[#5a6070] hover:text-[#e8eaf0] rounded-sm transition-all"
              >
                смотреть на сайте компании →
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="group p-4 rounded-sm cursor-pointer transition-all"
                  style={{
                    background: `${company.color}06`,
                    border: `1px solid ${company.color}20`,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = `${company.color}45`;
                    (e.currentTarget as HTMLElement).style.background = `${company.color}0c`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = `${company.color}20`;
                    (e.currentTarget as HTMLElement).style.background = `${company.color}06`;
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="font-sans font-semibold text-sm text-[#e8eaf0] group-hover:text-white transition-colors">
                        {job.title}
                      </div>
                      <div className="font-mono text-xs text-[#5a6070] mt-0.5">{job.location}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-medium" style={{ color: company.color }}>
                        {job.salary}
                      </div>
                      <div className="font-mono text-xs text-[#3a404f] mt-0.5">{job.posted}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap mt-3">
                    {job.tags.map((t) => (
                      <span
                        key={t}
                        className="font-mono text-[10px] px-2 py-0.5 rounded-sm"
                        style={{ background: `${company.color}10`, border: `1px solid ${company.color}25`, color: company.color, opacity: 0.85 }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <button
                    className="mt-3 w-full py-2 font-mono text-xs rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `${company.color}18`, border: `1px solid ${company.color}40`, color: company.color }}
                  >
                    откликнуться →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[rgba(51,255,119,0.08)]">
          <a
            href={company.site}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 font-mono text-sm rounded-sm transition-all"
            style={{ background: `${company.color}14`, border: `1px solid ${company.color}40`, color: company.color }}
          >
            все вакансии на сайте {company.name} →
          </a>
        </div>
      </div>

      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slide-in 0.25s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </>
  );
}
