import { useState, useEffect } from "react";
import type { Job } from "../data";
import { useAuth } from "../context/AuthContext";

interface Props {
  job: Job;
  onClose: () => void;
}

export default function QuickApplyModal({ job, onClose }: Props) {
  const { coverLetter: savedCoverLetter, resume, resumes, resumeSkills, addApplication, isPro, activatePro, user } = useAuth();

  // Основное резюме отражает реально подтверждённые навыки из профиля
  const confirmedCount = resumeSkills.filter((s) => s.confirmed).length || resumeSkills.length;
  const contactSummary = (item: typeof resume) => item ? [item.fullName, item.contactEmail, item.contactPhone, item.contactTelegram].filter(Boolean).join(", ") : "Контакты не заполнены";
  const RESUMES = resumes.length > 0
    ? resumes.map((item) => ({
      id: item.id,
      label: item.fullName || item.position || item.fileName,
      desc: [item.source === "hh" ? "HH.ru" : item.fileName, item.experience, contactSummary(item)].filter(Boolean).join(" · "),
      skills: item.skills.filter((skill) => skill.confirmed).length || item.skills.length,
      contact: contactSummary(item),
    }))
    : [{
      id: "general",
      label: "Основное резюме",
      desc: resumeSkills.length ? "Из профиля — полный стек" : "Загрузите резюме в профиле",
      skills: confirmedCount,
      contact: [user?.name, user?.email, user?.telegram].filter(Boolean).join(", ") || "Контакты не заполнены",
    }];

  const [selectedResume, setSelectedResume] = useState(resume?.id ?? resumes[0]?.id ?? "general");
  const [coverLetter, setCoverLetter] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [proPaywall, setProPaywall] = useState(false);
  const [adapting, setAdapting] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (RESUMES.some((item) => item.id === selectedResume)) return;
    setSelectedResume(resume?.id ?? resumes[0]?.id ?? "general");
  }, [resume, resumes, selectedResume]);

  const adaptLetter = () => {
    setProPaywall(false);
    setAdapting(true);
    const stack = (job.parsedSkills?.length ? job.parsedSkills : job.tags).slice(0, 3).join(", ");
    setTimeout(() => {
      setCoverLetter(
        `Здравствуйте! Меня заинтересовала позиция «${job.title}» в ${job.company}. ` +
        `За плечами релевантный опыт с ${stack || "вашим стеком"}, и я хорошо понимаю задачи уровня ${job.level}. ` +
        `Буду рад обсудить, как мой опыт поможет вашей команде — готов к техническому интервью в удобное время.`
      );
      setAdapting(false);
    }, 1100);
  };

  const handleAdaptClick = () => {
    if (isPro) adaptLetter();
    else setProPaywall(true);
  };

  const handleUpgrade = () => {
    activatePro();
    adaptLetter();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await addApplication({
        id: job.id,
        title: job.title,
        company: job.company,
        logo: job.logo,
        color: job.logoColor,
        salary: job.salary,
        level: job.level,
        location: job.location,
        url: "#",
        appliedAt: "сегодня",
        status: "sent",
        updatedDaysAgo: 0,
        deadline: "",
        note: coverLetter ? `Сопроводительное письмо: ${coverLetter}` : "",
        contact: selectedResumeData.contact,
        tags: job.tags,
        timeline: [{ date: "сегодня", label: "Отклик отправлен" }],
        notificationsOn: true,
      });
      setSubmitted(true);
    } catch (requestError) {
      setSubmitError(requestError instanceof Error ? requestError.message : "Не удалось сохранить отклик");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedResumeData = RESUMES.find((r) => r.id === selectedResume)!;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      style={{ background: "rgba(7,8,14,0.88)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full md:max-w-[540px] rounded-t-sm md:rounded-sm overflow-hidden"
        style={{
          background: "#0e1018",
          border: "1px solid rgba(51,255,119,0.18)",
          boxShadow: "0 0 60px rgba(51,255,119,0.06)",
        }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(58,64,79,0.4)]">
          <div>
            <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-0.5">// быстрый отклик</div>
            <div className="font-sans text-sm font-semibold text-[#e8eaf0] truncate max-w-[340px]">{job.title}</div>
            <div className="font-mono text-xs text-[#5a6070]">{job.company} · {job.location}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#3a404f] hover:text-[#e8eaf0] transition-colors rounded-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {submitted ? (
          <div className="px-6 py-14 flex flex-col items-center text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
              style={{ background: "rgba(51,255,119,0.1)", border: "1px solid rgba(51,255,119,0.3)" }}
            >
              <svg className="w-7 h-7 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="font-mono text-base text-[#33ff77] mb-2">отклик отправлен</div>
            <div className="font-sans text-sm text-[#5a6070] mb-1">
              Резюме «{selectedResumeData.label}» отправлено в {job.company}
            </div>
            <div className="font-mono text-xs text-[#3a404f] mt-1">
              статус появится в трекере откликов
            </div>
            <button
              onClick={onClose}
              className="mt-8 font-mono text-xs text-[#33ff77] hover:underline"
            >
              закрыть
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {/* resume picker */}
            <div>
              <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">
                выберите версию резюме
              </div>
              <div className="space-y-2">
                {RESUMES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedResume(r.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-sm text-left transition-all"
                    style={{
                      background: selectedResume === r.id ? "rgba(51,255,119,0.07)" : "rgba(58,64,79,0.1)",
                      border: selectedResume === r.id
                        ? "1px solid rgba(51,255,119,0.35)"
                        : "1px solid rgba(58,64,79,0.35)",
                    }}
                  >
                    {/* radio */}
                    <div
                      className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center"
                      style={{
                        border: selectedResume === r.id
                          ? "1px solid rgba(51,255,119,0.7)"
                          : "1px solid rgba(90,96,112,0.6)",
                      }}
                    >
                      {selectedResume === r.id && (
                        <div className="w-2 h-2 rounded-full bg-[#33ff77]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-sm text-[#e8eaf0]">{r.label}</div>
                      <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">{r.desc}</div>
                    </div>
                    <div className="font-mono text-[10px] text-[#3a404f] shrink-0">
                      {r.skills} навыков
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* cover letter */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest">
                  сопроводительное письмо
                </div>
                <div className="flex items-center gap-3">
                  {savedCoverLetter && (
                    <button
                      onClick={() => setCoverLetter(savedCoverLetter)}
                      className="font-mono text-[10px] text-[#00d4ff] hover:underline transition-colors"
                    >
                      вставить из профиля
                    </button>
                  )}
                  <div className="font-mono text-[10px] text-[#3a404f]">необязательно</div>
                </div>
              </div>
              <textarea
                className="w-full h-28 bg-[#07080e] border border-[rgba(58,64,79,0.4)] rounded-sm px-4 py-3 font-sans text-sm text-[#e8eaf0] placeholder-[#3a404f] resize-none focus:outline-none focus:border-[rgba(51,255,119,0.3)] transition-colors"
                placeholder="Кратко о себе и почему эта роль интересна..."
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
              />
              <div className="flex items-center justify-between mt-2">
                <div className="font-mono text-[10px] text-[#3a404f]">
                  {coverLetter.length} / 500
                </div>

                {/* Adapt button — paid feature */}
                {!proPaywall ? (
                  <button
                    onClick={handleAdaptClick}
                    disabled={adapting}
                    className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] rounded-sm transition-all"
                    style={{
                      background: "rgba(255,62,120,0.07)",
                      border: "1px solid rgba(255,62,120,0.25)",
                      color: "#ff3e78",
                      cursor: adapting ? "not-allowed" : "pointer",
                    }}
                  >
                    {adapting ? (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
                      </svg>
                    )}
                    {adapting ? "адаптируем..." : "адаптировать под вакансию"}
                    {!isPro && !adapting && (
                      <span
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm ml-0.5"
                        style={{ background: "rgba(255,62,120,0.15)", color: "#ff3e78", border: "1px solid rgba(255,62,120,0.3)" }}
                      >
                        PRO
                      </span>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => setProPaywall(false)}
                    className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070] transition-colors"
                  >
                    скрыть
                  </button>
                )}
              </div>

              {/* Pro paywall panel */}
              {proPaywall && (
                <div
                  className="mt-3 rounded-sm overflow-hidden"
                  style={{ border: "1px solid rgba(255,62,120,0.25)", background: "rgba(255,62,120,0.04)" }}
                >
                  <div className="px-4 py-3 border-b border-[rgba(255,62,120,0.12)]">
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-3.5 h-3.5 text-[#ff3e78]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span className="font-mono text-xs text-[#ff3e78]">функция Pro</span>
                    </div>
                    <p className="font-sans text-xs text-[#b0b6c4] leading-relaxed">
                      ИИ переписывает твоё письмо под конкретную вакансию — учитывает стек, грейд и культуру компании. Займёт 10 секунд.
                    </p>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-sm text-white font-medium">490 ₽ / мес</div>
                      <div className="font-mono text-[10px] text-[#5a6070]">или 3 490 ₽ / год · безлимит</div>
                    </div>
                    <button
                      onClick={handleUpgrade}
                      className="px-4 py-2 font-mono text-xs rounded-sm transition-all"
                      style={{ background: "#ff3e78", color: "#07080e" }}
                    >
                      подключить Pro →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 font-mono text-sm rounded-sm transition-all"
                style={{
                  background: submitting ? "rgba(51,255,119,0.08)" : "rgba(51,255,119,0.15)",
                  border: "1px solid rgba(51,255,119,0.4)",
                  color: submitting ? "#5a6070" : "#33ff77",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    отправляем...
                  </span>
                ) : "отправить отклик →"}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-3 font-mono text-xs text-[#5a6070] hover:text-[#e8eaf0] border border-[rgba(58,64,79,0.4)] rounded-sm transition-all"
              >
                отмена
              </button>
            </div>
            {submitError && <div className="font-mono text-xs text-[#ff3e78]">{submitError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
