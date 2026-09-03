import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router";

const WEEKLY_SUMMARY = {
  date: "26 авг — 1 сент 2024",
  headline: "Рынок AI/ML перегрет: спрос опережает предложение в 3.4×",
  body: "За последние 30 дней количество вакансий в сфере AI/ML выросло на 34% — это рекордный показатель с 2021 года. При этом пул кандидатов вырос всего на 10%, что создаёт острый дефицит. Средняя зарплата ML Engineer уже пробила отметку 550 000 ₽/мес в топовых компаниях.",
  signals: [
    { icon: "↑", text: "12 400 активных вакансий — +8% к прошлой неделе", positive: true },
    { icon: "↑", text: "Средний оффер вырос до 390 000 ₽/мес (+4%)", positive: true },
    { icon: "↓", text: "Время закрытия вакансии: 47 дней (было 38)", positive: false },
    { icon: "↑", text: "Remote-позиций стало больше: 61% от всех вакансий", positive: true },
  ],
};

const ROLES = [
  { role: "AI / ML Engineer", count: 2841, prev: 2120, salary: "400 000 — 700 000", remote: 68, category: "AI/ML" },
  { role: "Platform Engineer", count: 3107, prev: 2545, salary: "380 000 — 650 000", remote: 72, category: "DevOps" },
  { role: "Rust Developer", count: 1203, prev: 940, salary: "350 000 — 580 000", remote: 78, category: "Backend" },
  { role: "Go Developer", count: 2455, prev: 2100, salary: "300 000 — 520 000", remote: 75, category: "Backend" },
  { role: "Security Engineer", count: 1874, prev: 1572, salary: "320 000 — 550 000", remote: 45, category: "Security" },
  { role: "DevOps / SRE", count: 4218, prev: 3700, salary: "280 000 — 500 000", remote: 70, category: "DevOps" },
  { role: "Data Engineer", count: 2103, prev: 1890, salary: "290 000 — 480 000", remote: 65, category: "Data" },
  { role: "Frontend (React/TS)", count: 3891, prev: 3650, salary: "250 000 — 430 000", remote: 80, category: "Frontend" },
  { role: "Backend (Python)", count: 5120, prev: 4980, salary: "240 000 — 420 000", remote: 73, category: "Backend" },
  { role: "iOS Developer", count: 987, prev: 920, salary: "300 000 — 500 000", remote: 55, category: "Mobile" },
];

const SALARY_DATA = [
  { level: "Junior", ml: 180, backend: 140, devops: 160, frontend: 130, security: 170 },
  { level: "Middle", ml: 320, backend: 260, devops: 290, frontend: 240, security: 310 },
  { level: "Senior", ml: 520, backend: 400, devops: 430, frontend: 370, security: 470 },
  { level: "Lead", ml: 720, backend: 560, devops: 580, frontend: 500, security: 620 },
  { level: "Staff", ml: 950, backend: 720, devops: 740, frontend: 650, security: 800 },
];

const TECH_HEATMAP = [
  { tech: "Python", demand: 95, trend: "+8%", category: "Language" },
  { tech: "Go", demand: 82, trend: "+17%", category: "Language" },
  { tech: "Rust", demand: 61, trend: "+28%", category: "Language" },
  { tech: "TypeScript", demand: 88, trend: "+12%", category: "Language" },
  { tech: "Kubernetes", demand: 79, trend: "+21%", category: "Infra" },
  { tech: "Terraform", demand: 71, trend: "+18%", category: "Infra" },
  { tech: "PostgreSQL", demand: 86, trend: "+5%", category: "Data" },
  { tech: "ClickHouse", demand: 58, trend: "+31%", category: "Data" },
  { tech: "PyTorch", demand: 74, trend: "+42%", category: "AI/ML" },
  { tech: "LLM / RAG", demand: 67, trend: "+89%", category: "AI/ML" },
  { tech: "React", demand: 91, trend: "+7%", category: "Frontend" },
  { tech: "gRPC", demand: 63, trend: "+23%", category: "Infra" },
];

const COMPANY_ACTIVITY = [
  { name: "Sber AI", posted: 47, change: "+12", color: "#33ff77" },
  { name: "Yandex", posted: 38, change: "+5", color: "#ff3e78" },
  { name: "Ozon Tech", posted: 31, change: "+8", color: "#a78bfa" },
  { name: "Avito", posted: 28, change: "+3", color: "#00d4ff" },
  { name: "VK Tech", posted: 22, change: "-2", color: "#00d4ff" },
  { name: "Тинькофф", posted: 19, change: "+4", color: "#fbbf24" },
];

function getDelta(curr: number, prev: number) {
  const d = Math.round(((curr - prev) / prev) * 100);
  return `+${d}%`;
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = Math.round((value / max) * 100);
  return (
    <div className="h-1 bg-[#1a1d28] rounded-full overflow-hidden w-full">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${w}%`, background: color }}
      />
    </div>
  );
}

const CAT_COLORS: Record<string, string> = {
  "AI/ML": "#ff3e78",
  Backend: "#33ff77",
  DevOps: "#00d4ff",
  Security: "#a78bfa",
  Data: "#fbbf24",
  Frontend: "#34d399",
  Mobile: "#f97316",
};

const BENCHMARK_DATA: Record<string, Record<string, [number, number]>> = {
  backend: {
    Junior:  [100, 200],
    Middle:  [220, 350],
    Senior:  [350, 520],
    Lead:    [500, 700],
    Staff:   [650, 900],
  },
  frontend: {
    Junior:  [90, 180],
    Middle:  [200, 320],
    Senior:  [320, 480],
    Lead:    [450, 620],
    Staff:   [580, 800],
  },
  ml: {
    Junior:  [130, 230],
    Middle:  [270, 420],
    Senior:  [420, 650],
    Lead:    [600, 850],
    Staff:   [800, 1100],
  },
  devops: {
    Junior:  [110, 210],
    Middle:  [240, 380],
    Senior:  [370, 560],
    Lead:    [520, 720],
    Staff:   [680, 920],
  },
  security: {
    Junior:  [120, 220],
    Middle:  [260, 400],
    Senior:  [400, 600],
    Lead:    [560, 760],
    Staff:   [720, 980],
  },
  data: {
    Junior:  [100, 190],
    Middle:  [220, 350],
    Senior:  [340, 510],
    Lead:    [480, 680],
    Staff:   [620, 860],
  },
  mobile: {
    Junior:  [100, 190],
    Middle:  [210, 340],
    Senior:  [330, 520],
    Lead:    [480, 670],
    Staff:   [620, 840],
  },
};

const BENCHMARK_ROLE_LABELS: Record<string, string> = {
  backend: "Backend",
  frontend: "Frontend",
  ml: "AI / ML",
  devops: "DevOps / SRE",
  security: "Security",
  data: "Data",
  mobile: "Mobile",
};

const LEVELS_ORDER = ["Junior", "Middle", "Senior", "Lead", "Staff"];

type TechData = { techs: string[]; data: Record<string, Record<string, [number, number]>> };

const BENCHMARK_TECH_DATA: Record<string, TechData> = {
  backend: {
    techs: ["Go", "Python", "Rust", "Java / Kotlin", "PHP", "C++"],
    data: {
      Go:           { Junior: [120,215], Middle: [260,395], Senior: [400,585], Lead: [560,765], Staff: [730,995] },
      Python:       { Junior: [100,190], Middle: [230,360], Senior: [360,530], Lead: [500,700], Staff: [660,900] },
      Rust:         { Junior: [135,235], Middle: [285,430], Senior: [445,640], Lead: [610,830], Staff: [800,1080] },
      "Java / Kotlin": { Junior: [110,200], Middle: [245,375], Senior: [375,550], Lead: [525,715], Staff: [685,930] },
      PHP:          { Junior: [80,160],  Middle: [180,290], Senior: [280,420], Lead: [400,565], Staff: [525,720] },
      "C++":        { Junior: [130,225], Middle: [270,405], Senior: [405,595], Lead: [565,775], Staff: [745,1015] },
    },
  },
  frontend: {
    techs: ["React / TS", "Vue", "Angular", "Svelte", "React Native"],
    data: {
      "React / TS":   { Junior: [95,185],  Middle: [215,335], Senior: [335,500], Lead: [465,640], Staff: [595,815] },
      Vue:            { Junior: [85,170],  Middle: [195,310], Senior: [305,455], Lead: [435,595], Staff: [555,755] },
      Angular:        { Junior: [90,175],  Middle: [200,315], Senior: [315,465], Lead: [445,605], Staff: [565,770] },
      Svelte:         { Junior: [90,175],  Middle: [205,320], Senior: [320,475], Lead: [455,620], Staff: [580,790] },
      "React Native": { Junior: [100,195], Middle: [225,350], Senior: [350,515], Lead: [480,655], Staff: [615,835] },
    },
  },
  mobile: {
    techs: ["iOS (Swift)", "Android (Kotlin)", "Flutter", "React Native"],
    data: {
      "iOS (Swift)":       { Junior: [115,205], Middle: [240,370], Senior: [370,555], Lead: [525,715], Staff: [685,920] },
      "Android (Kotlin)":  { Junior: [110,200], Middle: [230,355], Senior: [355,535], Lead: [510,695], Staff: [665,895] },
      Flutter:             { Junior: [95,185],  Middle: [215,335], Senior: [335,500], Lead: [475,655], Staff: [620,840] },
      "React Native":      { Junior: [100,190], Middle: [218,342], Senior: [340,508], Lead: [480,660], Staff: [625,848] },
    },
  },
};

export default function Trends() {
  const [salaryCategory, setSalaryCategory] = useState<"ml" | "backend" | "devops" | "frontend" | "security">("ml");
  const maxSalary = 1000;

  const [benchRole, setBenchRole] = useState("backend");
  const [benchLevel, setBenchLevel] = useState("Senior");
  const [benchTech, setBenchTech] = useState<string | null>("Go");

  useEffect(() => {
    const techMeta = BENCHMARK_TECH_DATA[benchRole];
    setBenchTech(techMeta ? techMeta.techs[0] : null);
  }, [benchRole]);

  const benchResult = useMemo(() => {
    const techMeta = BENCHMARK_TECH_DATA[benchRole];
    const levelMap =
      techMeta && benchTech
        ? techMeta.data[benchTech]
        : BENCHMARK_DATA[benchRole];
    if (!levelMap) return null;
    const [lo, hi] = levelMap[benchLevel] ?? [0, 0];
    const allLevels = LEVELS_ORDER.map((l) => ({ level: l, range: levelMap[l] ?? [0, 0] as [number, number] }));
    return { lo, hi, allLevels };
  }, [benchRole, benchLevel, benchTech]);

  const salaryLabels: Record<string, string> = {
    ml: "AI/ML Engineer",
    backend: "Backend Developer",
    devops: "DevOps / SRE",
    frontend: "Frontend Developer",
    security: "Security Engineer",
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="font-mono text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">← главная</Link>
          <span className="text-[#3a404f]">/</span>
          <span className="font-mono text-xs text-[#3a404f]">тренды</span>
        </div>
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">// еженедельная сводка</div>
        <h1 className="font-mono text-3xl md:text-5xl text-white font-medium leading-tight mb-2">
          Рынок tech-вакансий<br />
          <span className="text-[#33ff77] neon-glow">в реальном времени</span>
        </h1>
        <div className="font-mono text-xs text-[#5a6070] mt-3">{WEEKLY_SUMMARY.date}</div>
      </div>

      {/* Weekly digest */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 mb-10">
        <div className="border border-[rgba(255,62,120,0.2)] bg-[rgba(255,62,120,0.03)] rounded-sm p-6">
          <div className="font-mono text-xs text-[#ff3e78] uppercase tracking-widest mb-3">// главный сигнал недели</div>
          <h2 className="font-sans text-lg font-semibold text-white mb-3 leading-snug">{WEEKLY_SUMMARY.headline}</h2>
          <p className="font-sans text-sm text-[#5a6070] leading-relaxed">{WEEKLY_SUMMARY.body}</p>
        </div>
        <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-5">
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// сигналы</div>
          <div className="space-y-3">
            {WEEKLY_SUMMARY.signals.map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`font-mono text-sm font-medium shrink-0 ${s.positive ? "text-[#33ff77]" : "text-[#ff3e78]"}`}>
                  {s.icon}
                </span>
                <span className="font-sans text-xs text-[#5a6070] leading-relaxed">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Role demand table */}
      <div className="mb-10">
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// спрос по специализациям</div>
        <div className="border border-[rgba(51,255,119,0.1)] rounded-sm overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-0 border-b border-[rgba(51,255,119,0.08)] px-5 py-3 bg-[#0a0b12]">
            {["Специализация", "Вакансий", "Рост", "Зарплата, ₽/мес", "Remote"].map((h) => (
              <div key={h} className="font-mono text-[10px] text-[#3a404f] uppercase tracking-wider">{h}</div>
            ))}
          </div>
          {ROLES.map((r, i) => (
            <div
              key={r.role}
              className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-0 px-5 py-4 border-b border-[rgba(51,255,119,0.05)] hover:bg-[#0e1018] transition-colors group ${i === ROLES.length - 1 ? "border-0" : ""}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: CAT_COLORS[r.category] || "#5a6070" }}
                />
                <span className="font-sans text-sm text-[#e8eaf0] group-hover:text-white transition-colors">{r.role}</span>
              </div>
              <div className="font-mono text-sm text-[#e8eaf0]">{r.count.toLocaleString("ru")}</div>
              <div className="font-mono text-sm font-medium text-[#33ff77]">{getDelta(r.count, r.prev)}</div>
              <div className="font-mono text-xs text-[#5a6070]">{r.salary}</div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1 bg-[#1a1d28] rounded-full overflow-hidden">
                  <div className="h-full bg-[#00d4ff] rounded-full" style={{ width: `${r.remote}%` }} />
                </div>
                <span className="font-mono text-xs text-[#5a6070]">{r.remote}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Salary chart + tech heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
        {/* Salary bars */}
        <div className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm p-5">
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// зарплаты по грейдам</div>
          <div className="flex flex-wrap gap-2 mb-5">
            {(Object.keys(salaryLabels) as Array<keyof typeof salaryLabels>).map((k) => (
              <button
                key={k}
                onClick={() => setSalaryCategory(k as typeof salaryCategory)}
                className={`font-mono text-[10px] px-3 py-1 rounded-sm transition-all ${
                  salaryCategory === k
                    ? "bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.4)] text-[#33ff77]"
                    : "border border-[rgba(58,64,79,0.4)] text-[#5a6070]"
                }`}
              >
                {salaryLabels[k]}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {SALARY_DATA.map((row) => {
              const val = row[salaryCategory];
              const pct = Math.round((val / maxSalary) * 100);
              return (
                <div key={row.level} className="flex items-center gap-4">
                  <div className="font-mono text-xs text-[#5a6070] w-12 shrink-0">{row.level}</div>
                  <div className="flex-1 h-6 bg-[#141620] rounded-sm overflow-hidden relative">
                    <div
                      className="h-full rounded-sm flex items-center px-3 transition-all duration-500"
                      style={{ width: `${pct}%`, background: "rgba(51,255,119,0.18)", borderRight: "2px solid #33ff77" }}
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[#33ff77]">
                      {val.toLocaleString("ru")} 000 ₽
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="font-mono text-[10px] text-[#3a404f] mt-4">медианные значения по рынку · август 2024</div>
        </div>

        {/* Tech heatmap */}
        <div className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm p-5">
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-4">// технологии в вакансиях</div>
          <div className="grid grid-cols-2 gap-2">
            {TECH_HEATMAP.map((t) => {
              const isHot = parseFloat(t.trend) > 25;
              return (
                <div
                  key={t.tech}
                  className="p-3 rounded-sm border transition-all hover:scale-[1.02] cursor-default"
                  style={{
                    background: `rgba(51,255,119,${(t.demand / 100) * 0.07 + 0.02})`,
                    borderColor: isHot ? "rgba(255,62,120,0.3)" : "rgba(51,255,119,0.1)",
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-sans text-xs text-[#e8eaf0] font-medium">{t.tech}</span>
                    <span className={`font-mono text-[10px] font-medium ${isHot ? "text-[#ff3e78]" : "text-[#33ff77]"}`}>
                      {t.trend}
                    </span>
                  </div>
                  <MiniBar value={t.demand} max={100} color={isHot ? "#ff3e78" : "#33ff77"} />
                  <div className="font-mono text-[10px] text-[#3a404f] mt-1.5">{t.category} · {t.demand}% вакансий</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Salary benchmark */}
      <div className="mb-10">
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// зарплатный бенчмарк</div>
        <div className="border border-[rgba(51,255,119,0.12)] bg-[#0e1018] rounded-sm p-6">
          {/* row 1: role + result */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end mb-5">
            <div>
              <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">специализация</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(BENCHMARK_ROLE_LABELS).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setBenchRole(k)}
                    className="font-mono text-xs px-3 py-1.5 rounded-sm transition-all"
                    style={{
                      background: benchRole === k ? "rgba(51,255,119,0.12)" : "transparent",
                      border: benchRole === k ? "1px solid rgba(51,255,119,0.4)" : "1px solid rgba(58,64,79,0.4)",
                      color: benchRole === k ? "#33ff77" : "#5a6070",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {benchResult && (
              <div className="text-right">
                <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-1">диапазон</div>
                <div className="font-mono text-2xl font-medium text-[#33ff77] leading-none">
                  {benchResult.lo.toLocaleString("ru")} — {benchResult.hi.toLocaleString("ru")}
                </div>
                <div className="font-mono text-xs text-[#3a404f] mt-1">тыс. ₽ / мес</div>
              </div>
            )}
          </div>

          {/* row 2: tech picker (if available) + level picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-end mb-8">
            {BENCHMARK_TECH_DATA[benchRole] ? (
              <div>
                <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">технология</div>
                <div className="flex flex-wrap gap-2">
                  {BENCHMARK_TECH_DATA[benchRole].techs.map((t) => (
                    <button
                      key={t}
                      onClick={() => setBenchTech(t)}
                      className="font-mono text-xs px-3 py-1.5 rounded-sm transition-all"
                      style={{
                        background: benchTech === t ? "rgba(0,212,255,0.12)" : "transparent",
                        border: benchTech === t ? "1px solid rgba(0,212,255,0.45)" : "1px solid rgba(58,64,79,0.4)",
                        color: benchTech === t ? "#00d4ff" : "#5a6070",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : <div />}

            <div>
              <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-3">грейд</div>
              <div className="flex flex-wrap gap-2">
                {LEVELS_ORDER.map((l) => (
                  <button
                    key={l}
                    onClick={() => setBenchLevel(l)}
                    className="font-mono text-xs px-3 py-1.5 rounded-sm transition-all"
                    style={{
                      background: benchLevel === l ? "rgba(167,139,250,0.12)" : "transparent",
                      border: benchLevel === l ? "1px solid rgba(167,139,250,0.4)" : "1px solid rgba(58,64,79,0.4)",
                      color: benchLevel === l ? "#a78bfa" : "#5a6070",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* all levels bar chart for selected role */}
          {benchResult && (
            <div className="space-y-3">
              <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-4">
                все грейды — {BENCHMARK_ROLE_LABELS[benchRole]}{benchTech ? ` · ${benchTech}` : ""}
              </div>
              {benchResult.allLevels.map(({ level, range }) => {
                const [lo, hi] = range;
                const maxVal = 1100;
                const loP = Math.round((lo / maxVal) * 100);
                const hiP = Math.round((hi / maxVal) * 100);
                const isActive = level === benchLevel;
                return (
                  <button
                    key={level}
                    onClick={() => setBenchLevel(level)}
                    className="w-full flex items-center gap-4 group"
                  >
                    <div className="font-mono text-xs w-14 shrink-0 text-left transition-colors"
                      style={{ color: isActive ? "#a78bfa" : "#5a6070" }}>
                      {level}
                    </div>
                    <div className="flex-1 h-6 bg-[#141620] rounded-sm relative overflow-hidden">
                      <div
                        className="absolute top-0 h-full rounded-sm transition-all duration-300"
                        style={{
                          left: `${loP}%`,
                          width: `${hiP - loP}%`,
                          background: isActive ? "rgba(167,139,250,0.25)" : "rgba(51,255,119,0.12)",
                          borderLeft: isActive ? "2px solid #a78bfa" : "2px solid rgba(51,255,119,0.4)",
                          borderRight: isActive ? "2px solid #a78bfa" : "2px solid rgba(51,255,119,0.4)",
                        }}
                      />
                    </div>
                    <div className="font-mono text-xs w-36 text-right shrink-0 transition-colors"
                      style={{ color: isActive ? "#a78bfa" : "#5a6070" }}>
                      {lo.toLocaleString("ru")} — {hi.toLocaleString("ru")} тыс.
                    </div>
                  </button>
                );
              })}
              <div className="font-mono text-[10px] text-[#3a404f] mt-2">медианные значения по рынку · август 2024</div>
            </div>
          )}
        </div>
      </div>

      {/* Company activity */}
      <div className="mb-10">
        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-5">// активность компаний на этой неделе</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {COMPANY_ACTIVITY.map((co) => {
            const isPositive = co.change.startsWith("+");
            return (
              <div
                key={co.name}
                className="border border-[rgba(51,255,119,0.1)] bg-[#0e1018] rounded-sm p-4 hover:bg-[#141620] transition-colors"
              >
                <div className="font-sans text-xs text-[#e8eaf0] font-medium mb-3 leading-tight">{co.name}</div>
                <div className="font-mono text-2xl font-medium mb-1" style={{ color: co.color }}>{co.posted}</div>
                <div className="font-mono text-[10px] text-[#3a404f]">вакансий</div>
                <div className={`font-mono text-xs mt-2 ${isPositive ? "text-[#33ff77]" : "text-[#ff3e78]"}`}>
                  {co.change} к пр. нед.
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="border border-[rgba(51,255,119,0.15)] bg-[rgba(51,255,119,0.02)] rounded-sm p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// не упусти момент</div>
          <div className="font-mono text-xl text-white font-medium">Рынок горячий — вакансии закрываются быстро</div>
          <div className="font-sans text-sm text-[#5a6070] mt-1">Подпишись на еженедельную сводку в Telegram</div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button className="font-mono text-sm px-6 py-3 bg-[#33ff77] text-[#07080e] font-medium hover:bg-[#4dff8a] transition-colors rounded-sm whitespace-nowrap">
            подписаться →
          </button>
          <Link
            to="/"
            className="font-mono text-sm px-6 py-3 border border-[rgba(51,255,119,0.3)] text-[#33ff77] hover:bg-[rgba(51,255,119,0.08)] transition-all rounded-sm whitespace-nowrap"
          >
            смотреть вакансии
          </Link>
        </div>
      </div>
    </div>
  );
}
