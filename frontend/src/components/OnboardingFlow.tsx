import { useState } from "react";
import { useAuth, OnboardingData } from "../context/AuthContext";

const ROLES = [
  { id: "backend", label: "Backend", icon: "⬡", desc: "Go, Python, Rust, Java" },
  { id: "frontend", label: "Frontend", icon: "◻", desc: "React, TypeScript, Vue" },
  { id: "aiml", label: "AI / ML", icon: "◈", desc: "PyTorch, LLM, CUDA" },
  { id: "devops", label: "DevOps / SRE", icon: "◎", desc: "K8s, Terraform, Go" },
  { id: "mobile", label: "Mobile", icon: "▣", desc: "Swift, Kotlin, Flutter" },
  { id: "data", label: "Data", icon: "◐", desc: "Spark, ClickHouse, dbt" },
  { id: "security", label: "Security", icon: "◉", desc: "Pentest, AppSec, RE" },
  { id: "fullstack", label: "Fullstack", icon: "◫", desc: "Node.js + React, etc." },
];

const LEVELS = [
  { id: "junior", label: "Junior", sub: "до 2 лет опыта" },
  { id: "middle", label: "Middle", sub: "2–5 лет" },
  { id: "senior", label: "Senior", sub: "5+ лет" },
  { id: "lead", label: "Lead", sub: "команда 3–10" },
  { id: "staff", label: "Staff / Principal", sub: "системное влияние" },
];

const FORMATS = [
  { id: "remote", label: "Полностью Remote", icon: "🌐", sub: "работаю откуда угодно" },
  { id: "hybrid", label: "Гибрид", icon: "⇄", sub: "офис 1–3 дня в неделю" },
  { id: "office", label: "Офис", icon: "▤", sub: "хочу живую команду" },
  { id: "any", label: "Не важно", icon: "∅", sub: "смотрю всё" },
];

const STEPS = [
  { id: 1, key: "roles", title: "Какие роли тебя интересуют?", hint: "Выбери одну или несколько — подберём релевантные вакансии и зарплатные данные" },
  { id: 2, key: "levels", title: "Какой грейд ищешь?", hint: "Можно выбрать несколько — отфильтруем по уровню сложности и зарплатным вилкам" },
  { id: 3, key: "formats", title: "Как хочешь работать?", hint: "Применим как фильтр по умолчанию на главной странице" },
];

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-0.5 flex-1 rounded-full transition-all duration-500"
          style={{ background: i < step ? "#33ff77" : "rgba(58,64,79,0.5)" }}
        />
      ))}
    </div>
  );
}

export default function OnboardingFlow() {
  const { user, completeOnboarding, skipOnboarding, initialOnboarding } = useAuth();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<{ roles: string[]; levels: string[]; formats: string[] }>({
    roles: initialOnboarding.roles ?? [],
    levels: initialOnboarding.levels ?? [],
    formats: initialOnboarding.formats ?? [],
  });
  const hasPrefill = (initialOnboarding.roles?.length ?? 0) > 0;

  const current = STEPS[step];
  const key = current.key as "roles" | "levels" | "formats";
  const currentSelected = selected[key];

  const toggle = (id: string) => {
    setSelected((prev) => {
      const arr = prev[key];
      return { ...prev, [key]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else completeOnboarding(selected as OnboardingData);
  };

  const handleSkip = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else skipOnboarding();
  };

  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-[#07080e] flex flex-col grid-bg">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(51,255,119,0.08)]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#33ff77] font-medium">{">"}</span>
          <span className="font-mono text-white font-medium text-sm">de<span className="text-[#33ff77]">vv</span>er</span>
        </div>
        <button
          onClick={skipOnboarding}
          className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
        >
          пропустить всё →
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-2xl mx-auto w-full">
        {/* Welcome line */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 neon-badge px-3 py-1 rounded-sm mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#33ff77] animate-pulse" />
            <span className="font-mono text-xs tracking-widest uppercase">
              шаг {step + 1} из {STEPS.length}
            </span>
          </div>

          {step === 0 && hasPrefill && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm mb-4 bg-[rgba(51,255,119,0.07)] border border-[rgba(51,255,119,0.2)]">
              <svg className="w-3 h-3 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-mono text-xs text-[#33ff77]">данные предзаполнены из резюме — проверь и скорректируй</span>
            </div>
          )}
          {step === 0 && !hasPrefill && (
            <div className="font-mono text-sm text-[#5a6070] mb-4">
              привет, <span className="text-[#33ff77]">{user?.name}</span> 👋
            </div>
          )}

          <h2 className="font-mono text-2xl md:text-3xl text-white font-medium leading-tight mb-3">
            {current.title}
          </h2>
          <p className="font-sans text-sm text-[#5a6070] max-w-md mx-auto">{current.hint}</p>
        </div>

        {/* Step 1 — Roles */}
        {step === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full">
            {ROLES.map((r) => {
              const active = currentSelected.includes(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  className="flex flex-col items-start p-4 rounded-sm border transition-all text-left"
                  style={{
                    background: active ? "rgba(51,255,119,0.08)" : "rgba(14,16,24,0.8)",
                    borderColor: active ? "rgba(51,255,119,0.45)" : "rgba(58,64,79,0.5)",
                  }}
                >
                  <span className="text-lg mb-2" style={{ color: active ? "#33ff77" : "#3a404f" }}>
                    {r.icon}
                  </span>
                  <span className={`font-sans font-semibold text-sm mb-1 ${active ? "text-white" : "text-[#e8eaf0]"}`}>
                    {r.label}
                  </span>
                  <span className="font-mono text-[10px] text-[#5a6070]">{r.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2 — Levels */}
        {step === 1 && (
          <div className="flex flex-col gap-2 w-full max-w-md">
            {LEVELS.map((l) => {
              const active = currentSelected.includes(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() => toggle(l.id)}
                  className="flex items-center justify-between px-5 py-4 rounded-sm border transition-all"
                  style={{
                    background: active ? "rgba(51,255,119,0.07)" : "rgba(14,16,24,0.8)",
                    borderColor: active ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.5)",
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0 transition-all"
                      style={{ borderColor: active ? "#33ff77" : "#3a404f", background: active ? "#33ff77" : "transparent" }}
                    >
                      {active && (
                        <svg className="w-2.5 h-2.5 text-[#07080e]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className={`font-sans font-semibold text-sm ${active ? "text-white" : "text-[#e8eaf0]"}`}>
                      {l.label}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-[#5a6070]">{l.sub}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 3 — Formats */}
        {step === 2 && (
          <div className="grid grid-cols-2 gap-2 w-full max-w-md">
            {FORMATS.map((f) => {
              const active = currentSelected.includes(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className="flex flex-col items-start p-4 rounded-sm border transition-all"
                  style={{
                    background: active ? "rgba(51,255,119,0.08)" : "rgba(14,16,24,0.8)",
                    borderColor: active ? "rgba(51,255,119,0.45)" : "rgba(58,64,79,0.5)",
                  }}
                >
                  <span className="text-xl mb-2 font-mono" style={{ color: active ? "#33ff77" : "#3a404f" }}>
                    {f.icon}
                  </span>
                  <span className={`font-sans font-semibold text-sm mb-1 ${active ? "text-white" : "text-[#e8eaf0]"}`}>
                    {f.label}
                  </span>
                  <span className="font-mono text-[10px] text-[#5a6070]">{f.sub}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between w-full max-w-md mt-8 gap-4">
          <button
            onClick={handleSkip}
            className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
          >
            пропустить шаг →
          </button>

          <button
            onClick={handleNext}
            disabled={currentSelected.length === 0}
            className="flex items-center gap-2 px-6 py-3 font-mono text-sm rounded-sm transition-all disabled:opacity-30"
            style={{
              background: currentSelected.length > 0 ? "#33ff77" : "rgba(51,255,119,0.12)",
              color: currentSelected.length > 0 ? "#07080e" : "#33ff77",
              border: "1px solid rgba(51,255,119,0.4)",
            }}
          >
            {isLast ? "готово" : "далее"}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="px-6 pb-6 max-w-2xl mx-auto w-full">
        <ProgressBar step={step + 1} total={STEPS.length} />
      </div>
    </div>
  );
}
