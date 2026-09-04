import { useState, useRef } from "react";
import { useAuth, OnboardingData, type ResumeData } from "../context/AuthContext";

type Method = "choose" | "hh-connecting" | "hh-select" | "resume-uploading" | "resume-review";

interface ParsedData {
  name?: string;
  roles: string[];
  levels: string[];
  formats: string[];
  skills: string[];
  experience: string;
  source: "hh" | "resume";
}

// Simulated HH resumes
const HH_RESUMES = [
  {
    id: "r1",
    title: "Senior Backend Engineer",
    updatedAt: "28 авг 2024",
    parsed: {
      roles: ["backend", "devops"],
      levels: ["senior"],
      formats: ["remote", "hybrid"],
      skills: ["Go", "Python", "PostgreSQL", "K8s", "gRPC"],
      experience: "6 лет",
      source: "hh" as const,
    },
  },
  {
    id: "r2",
    title: "Fullstack Developer",
    updatedAt: "15 июл 2024",
    parsed: {
      roles: ["frontend", "backend", "fullstack"],
      levels: ["middle", "senior"],
      formats: ["remote"],
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      experience: "4 года",
      source: "hh" as const,
    },
  },
];

const ROLE_LABELS: Record<string, string> = {
  backend: "Backend", frontend: "Frontend", aiml: "AI / ML",
  devops: "DevOps / SRE", mobile: "Mobile", data: "Data",
  security: "Security", fullstack: "Fullstack",
};
const LEVEL_LABELS: Record<string, string> = {
  junior: "Junior", middle: "Middle", senior: "Senior", lead: "Lead", staff: "Staff",
};
const FORMAT_LABELS: Record<string, string> = {
  remote: "Remote", hybrid: "Гибрид", office: "Офис", any: "Не важно",
};

function ReviewCard({ data, onConfirm, onBack }: { data: ParsedData; onConfirm: (d: Partial<OnboardingData>) => void; onBack: () => void }) {
  const [roles, setRoles] = useState(data.roles);
  const [levels, setLevels] = useState(data.levels);
  const [formats, setFormats] = useState(data.formats);

  const toggle = <T extends string>(arr: T[], val: T, set: (v: T[]) => void) =>
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 p-3 border border-[rgba(51,255,119,0.2)] bg-[rgba(51,255,119,0.04)] rounded-sm">
        <svg className="w-4 h-4 text-[#33ff77] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <div className="font-sans text-xs text-white font-medium">
            {data.source === "hh" ? "Данные загружены с HH.ru" : "Резюме распознано"}
          </div>
          <div className="font-mono text-[10px] text-[#5a6070]">
            {data.experience} опыта · {data.skills.length} навыков найдено
          </div>
        </div>
      </div>

      {/* Skills found */}
      <div>
        <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-2">найденные навыки</div>
        <div className="flex flex-wrap gap-1.5">
          {data.skills.map((s) => (
            <span key={s} className="font-mono text-[10px] px-2 py-0.5 rounded-sm bg-[rgba(51,255,119,0.08)] border border-[rgba(51,255,119,0.2)] text-[#33ff77]">{s}</span>
          ))}
        </div>
      </div>

      {/* Roles */}
      <div>
        <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-2">роли — проверь и скорректируй</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(ROLE_LABELS).map((r) => (
            <button
              key={r}
              onClick={() => toggle(roles, r, setRoles)}
              className="font-mono text-xs px-3 py-1 rounded-sm border transition-all"
              style={{
                background: roles.includes(r) ? "rgba(51,255,119,0.1)" : "transparent",
                borderColor: roles.includes(r) ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.4)",
                color: roles.includes(r) ? "#33ff77" : "#5a6070",
              }}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Levels */}
      <div>
        <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-2">грейд</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(LEVEL_LABELS).map((l) => (
            <button
              key={l}
              onClick={() => toggle(levels, l, setLevels)}
              className="font-mono text-xs px-3 py-1 rounded-sm border transition-all"
              style={{
                background: levels.includes(l) ? "rgba(51,255,119,0.1)" : "transparent",
                borderColor: levels.includes(l) ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.4)",
                color: levels.includes(l) ? "#33ff77" : "#5a6070",
              }}
            >
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Formats */}
      <div>
        <div className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest mb-2">формат работы</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(FORMAT_LABELS).map((f) => (
            <button
              key={f}
              onClick={() => toggle(formats, f, setFormats)}
              className="font-mono text-xs px-3 py-1 rounded-sm border transition-all"
              style={{
                background: formats.includes(f) ? "rgba(51,255,119,0.1)" : "transparent",
                borderColor: formats.includes(f) ? "rgba(51,255,119,0.4)" : "rgba(58,64,79,0.4)",
                color: formats.includes(f) ? "#33ff77" : "#5a6070",
              }}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onConfirm({ roles, levels, formats })}
          className="flex-1 py-3 font-mono text-sm bg-[#33ff77] text-[#07080e] font-medium rounded-sm hover:bg-[#4dff8a] transition-colors"
        >
          всё верно, продолжить →
        </button>
        <button
          onClick={onBack}
          className="px-4 py-3 font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors border border-[rgba(58,64,79,0.4)] rounded-sm"
        >
          назад
        </button>
      </div>
    </div>
  );
}

export default function ImportStep() {
  const { user, finishImport, uploadResume, startHhImport } = useAuth();
  const [method, setMethod] = useState<Method>("choose");
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [selectedHHResume, setSelectedHHResume] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connectHH = async () => {
    setUploadError(null);
    setMethod("hh-connecting");
    try {
      const url = await startHhImport();
      window.location.assign(url);
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : "Не удалось подключить HH.ru");
      setMethod("choose");
    }
  };

  const selectHHResume = (id: string) => {
    setSelectedHHResume(id);
    const r = HH_RESUMES.find((r) => r.id === id);
    if (r) setParsedData({ ...r.parsed, source: "hh" });
    setMethod("resume-review");
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "docx"].includes(extension)) {
      setUploadError("Поддерживаются только файлы PDF и DOCX");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("Файл больше 8 МБ");
      return;
    }

    setUploadError(null);
    setFileName(file.name);
    setMethod("resume-uploading");
    try {
      const resume: ResumeData = await uploadResume(file);
      setParsedData({
        roles: [],
        levels: [],
        formats: [],
        skills: resume.skills.map((skill) => skill.name),
        experience: resume.experience || "не определён",
        source: "resume",
      });
      setMethod("resume-review");
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : "Не удалось проанализировать резюме");
      setMethod("choose");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#07080e] flex items-center justify-center p-4 grid-bg">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <span className="font-mono text-[#33ff77] font-medium neon-glow">{">"}</span>
          <span className="font-mono text-white font-medium">jobs<span className="text-[#33ff77]">.dev</span></span>
        </div>

        <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-2">// импорт данных</div>
        <h2 className="font-mono text-2xl text-white font-medium mb-1">
          Привет, {user?.name}
        </h2>
        <p className="font-sans text-sm text-[#5a6070] mb-8">
          Заполним профиль автоматически — выбери источник или пропусти и заполни вручную
        </p>

        {/* CHOOSE */}
        {method === "choose" && (
          <div className="space-y-3">
            {uploadError && (
              <div role="alert" className="border border-[rgba(255,62,120,0.35)] bg-[rgba(255,62,120,0.08)] rounded-sm px-4 py-3 font-sans text-xs text-[#e8eaf0]">
                <span className="font-mono text-[#ff3e78]">ошибка: </span>{uploadError}
              </div>
            )}
            {/* HH.ru */}
            <button
              onClick={connectHH}
              className="w-full flex items-center gap-4 px-5 py-4 border border-[rgba(255,62,120,0.25)] bg-[rgba(255,62,120,0.04)] hover:bg-[rgba(255,62,120,0.08)] rounded-sm transition-all group"
            >
              <div className="w-10 h-10 flex items-center justify-center rounded shrink-0 bg-[rgba(255,62,120,0.12)] border border-[rgba(255,62,120,0.3)]">
                <span className="font-mono text-sm font-bold text-[#ff3e78]">hh</span>
              </div>
              <div className="text-left flex-1">
                <div className="font-sans text-sm text-white font-medium group-hover:text-[#ff3e78] transition-colors">
                  Импортировать с HH.ru
                </div>
                <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">
                  подключим аккаунт и загрузим резюме автоматически
                </div>
              </div>
              <svg className="w-4 h-4 text-[#3a404f] group-hover:text-[#ff3e78] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Upload */}
            <div
              className={`w-full border-2 border-dashed rounded-sm transition-all cursor-pointer ${dragOver ? "border-[rgba(51,255,119,0.5)] bg-[rgba(51,255,119,0.06)]" : "border-[rgba(51,255,119,0.2)] hover:border-[rgba(51,255,119,0.4)] hover:bg-[rgba(51,255,119,0.03)]"}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 flex items-center justify-center rounded shrink-0 bg-[rgba(51,255,119,0.1)] border border-[rgba(51,255,119,0.25)]">
                  <svg className="w-5 h-5 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="text-left flex-1">
                  <div className="font-sans text-sm text-white font-medium">Загрузить резюме</div>
                  <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">
                    PDF или DOCX · до 8 МБ · распознаем автоматически
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void handleFile(f); }}
              />
            </div>

            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-[rgba(51,255,119,0.08)]" />
              <span className="font-mono text-[10px] text-[#3a404f]">или</span>
              <div className="flex-1 h-px bg-[rgba(51,255,119,0.08)]" />
            </div>

            {/* Manual */}
            <button
              onClick={() => finishImport()}
              className="w-full py-3 font-mono text-sm border border-[rgba(58,64,79,0.4)] text-[#5a6070] hover:text-[#e8eaf0] hover:border-[rgba(58,64,79,0.8)] rounded-sm transition-all"
            >
              заполнить вручную →
            </button>
          </div>
        )}

        {/* HH CONNECTING */}
        {method === "hh-connecting" && (
          <div className="text-center py-8">
            <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center rounded-full bg-[rgba(255,62,120,0.1)] border border-[rgba(255,62,120,0.3)]">
              <span className="font-mono text-xl font-bold text-[#ff3e78] animate-pulse">hh</span>
            </div>
            <div className="font-mono text-sm text-white mb-2">Подключаемся к HH.ru...</div>
            <div className="font-sans text-xs text-[#5a6070]">авторизация через OAuth</div>
            <div className="mt-5 flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#ff3e78] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* HH SELECT RESUME */}
        {method === "hh-select" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 flex items-center justify-center rounded-full bg-[rgba(51,255,119,0.15)] border border-[rgba(51,255,119,0.3)]">
                <svg className="w-3 h-3 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="font-mono text-xs text-[#33ff77]">HH.ru подключён</span>
            </div>
            <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">выбери резюме для импорта</div>
            {HH_RESUMES.map((r) => (
              <button
                key={r.id}
                onClick={() => selectHHResume(r.id)}
                className="w-full flex items-start gap-4 px-5 py-4 border border-[rgba(58,64,79,0.5)] bg-[#0e1018] hover:border-[rgba(255,62,120,0.35)] hover:bg-[rgba(255,62,120,0.04)] rounded-sm transition-all group text-left"
              >
                <div className="w-8 h-8 flex items-center justify-center rounded shrink-0 bg-[rgba(255,62,120,0.1)] border border-[rgba(255,62,120,0.25)]">
                  <svg className="w-4 h-4 text-[#ff3e78]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-sans text-sm text-[#e8eaf0] font-medium group-hover:text-white transition-colors">{r.title}</div>
                  <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">обновлено {r.updatedAt}</div>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {r.parsed.skills.slice(0, 4).map((s) => (
                      <span key={s} className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm bg-[rgba(51,255,119,0.07)] border border-[rgba(51,255,119,0.15)] text-[#33ff77]">{s}</span>
                    ))}
                    {r.parsed.skills.length > 4 && <span className="font-mono text-[10px] text-[#3a404f]">+{r.parsed.skills.length - 4}</span>}
                  </div>
                </div>
                <svg className="w-4 h-4 text-[#3a404f] group-hover:text-[#ff3e78] transition-colors shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
            <button
              onClick={() => setMethod("choose")}
              className="w-full py-2 font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
            >
              ← назад
            </button>
          </div>
        )}

        {/* RESUME UPLOADING */}
        {method === "resume-uploading" && (
          <div className="text-center py-8">
            <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center rounded-full bg-[rgba(51,255,119,0.08)] border border-[rgba(51,255,119,0.25)]">
              <svg className="w-6 h-6 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="font-mono text-xs text-[#5a6070] mb-2 truncate max-w-xs mx-auto">{fileName}</div>
            <div className="font-mono text-sm text-white mb-1">Распознаём резюме...</div>
            <div className="font-sans text-xs text-[#5a6070] mb-5">извлекаем навыки, опыт и предпочтения</div>
            <div className="h-1 bg-[#1a1d28] rounded-full max-w-xs mx-auto overflow-hidden">
              <div className="h-full bg-[#33ff77] rounded-full animate-parse-bar" style={{ animation: "parseBar 2.2s ease-out forwards" }} />
            </div>
            <style>{`
              @keyframes parseBar { from { width: 0% } to { width: 100% } }
            `}</style>
          </div>
        )}

        {/* REVIEW */}
        {method === "resume-review" && parsedData && (
          <ReviewCard
            data={parsedData}
            onConfirm={(prefill) => finishImport(prefill)}
            onBack={() => setMethod("choose")}
          />
        )}

        {/* Skip link always visible in non-review states */}
        {method !== "resume-review" && method !== "hh-connecting" && method !== "resume-uploading" && method !== "hh-select" && (
          <div className="mt-6 text-center">
            <button
              onClick={() => finishImport()}
              className="font-mono text-[10px] text-[#3a404f] hover:text-[#5a6070] transition-colors"
            >
              пропустить, заполню позже
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
