import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { accountApi } from "../api";

type Step = "choose" | "email" | "telegram-sent";

export default function AuthModal() {
  const { closeAuthModal, loginWithEmail } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const telegramWidgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && closeAuthModal();
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [closeAuthModal]);

  useEffect(() => {
    if (step !== "telegram-sent") return;
    accountApi.authConfig()
      .then((config) => setTelegramUsername(config.enabled ? config.username : ""))
      .catch(() => setTelegramUsername(""));
  }, [step]);

  useEffect(() => {
    if (step !== "telegram-sent" || !telegramUsername || !telegramWidgetRef.current) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", telegramUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-request-access", "write");
    const apiOrigin = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, "");
    script.setAttribute("data-auth-url", `${apiOrigin}/api/auth/telegram/`);
    telegramWidgetRef.current.replaceChildren(script);
    return () => telegramWidgetRef.current?.replaceChildren();
  }, [step, telegramUsername]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setError("Введи корректный email"); return; }
    if (password.length < 8) { setError("Пароль минимум 8 символов"); return; }
    setLoading(true);
    try {
      await loginWithEmail(email, password, isLogin ? "login" : "register");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(7,8,14,0.85)] backdrop-blur-sm flex items-center justify-center p-4" onClick={closeAuthModal} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-[#0a0b12] border border-[rgba(51,255,119,0.18)] rounded-sm shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[rgba(51,255,119,0.08)]">
            <div>
              <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-1">// jobs.dev</div>
              <h2 className="font-mono text-lg text-white font-medium">
                {step === "choose" ? "Вход / регистрация" : step === "email" ? (isLogin ? "Вход" : "Регистрация") : "Проверь Telegram"}
              </h2>
            </div>
            <button
              onClick={closeAuthModal}
              className="w-7 h-7 flex items-center justify-center font-mono text-xs text-[#5a6070] hover:text-white border border-[rgba(58,64,79,0.5)] rounded-sm transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="px-6 py-6">
            {/* CHOOSE */}
            {step === "choose" && (
              <div className="space-y-3">
                <button
                  onClick={() => { setStep("telegram-sent"); setError(""); }}
                  className="w-full flex items-center gap-4 px-4 py-4 border border-[rgba(0,212,255,0.25)] bg-[rgba(0,212,255,0.05)] hover:bg-[rgba(0,212,255,0.09)] rounded-sm transition-all group"
                >
                  <div className="w-9 h-9 flex items-center justify-center rounded bg-[rgba(0,212,255,0.12)] border border-[rgba(0,212,255,0.3)] shrink-0">
                    <svg className="w-5 h-5 text-[#00d4ff]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.93.44l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.52.25l.19-2.64 4.83-4.37c.21-.19-.05-.29-.32-.1L7.5 14.45 5.0 13.68c-.55-.17-.56-.55.12-.81l9.89-3.81c.46-.17.86.11.63.74z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-sans text-sm text-white font-medium group-hover:text-[#00d4ff] transition-colors">
                      Войти через Telegram
                    </div>
                    <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">
                      уведомления о вакансиях прямо в мессенджер
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[#3a404f] ml-auto group-hover:text-[#00d4ff] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  onClick={() => setStep("email")}
                  className="w-full flex items-center gap-4 px-4 py-4 border border-[rgba(51,255,119,0.2)] bg-[rgba(51,255,119,0.04)] hover:bg-[rgba(51,255,119,0.07)] rounded-sm transition-all group"
                >
                  <div className="w-9 h-9 flex items-center justify-center rounded bg-[rgba(51,255,119,0.1)] border border-[rgba(51,255,119,0.25)] shrink-0">
                    <svg className="w-4 h-4 text-[#33ff77]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-sans text-sm text-white font-medium group-hover:text-[#33ff77] transition-colors">
                      Войти по email
                    </div>
                    <div className="font-mono text-[10px] text-[#5a6070] mt-0.5">
                      классическая регистрация с паролем
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[#3a404f] ml-auto group-hover:text-[#33ff77] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <p className="font-mono text-[10px] text-[#3a404f] text-center pt-2">
                  Регистрируясь, ты принимаешь условия использования
                </p>
              </div>
            )}

            {/* EMAIL FORM */}
            {step === "email" && (
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <div className="flex gap-2 mb-4">
                  {(["Регистрация", "Вход"] as const).map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setIsLogin(i === 1); setError(""); }}
                      className={`flex-1 py-2 font-mono text-xs rounded-sm transition-all ${
                        isLogin === (i === 1)
                          ? "bg-[rgba(51,255,119,0.12)] border border-[rgba(51,255,119,0.35)] text-[#33ff77]"
                          : "border border-[rgba(58,64,79,0.4)] text-[#5a6070]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest block mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    placeholder="you@example.com"
                    className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.12)] focus:border-[rgba(51,255,119,0.4)] px-4 py-2.5 font-mono text-sm text-[#e8eaf0] rounded-sm transition-colors"
                  />
                </div>

                <div>
                  <label className="font-mono text-[10px] text-[#3a404f] uppercase tracking-widest block mb-1.5">Пароль</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    className="w-full bg-[#07080e] border border-[rgba(51,255,119,0.12)] focus:border-[rgba(51,255,119,0.4)] px-4 py-2.5 font-mono text-sm text-[#e8eaf0] rounded-sm transition-colors"
                  />
                </div>

                {error && (
                  <div className="font-mono text-xs text-[#ff3e78] bg-[rgba(255,62,120,0.08)] border border-[rgba(255,62,120,0.2)] px-3 py-2 rounded-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[rgba(51,255,119,0.14)] hover:bg-[rgba(51,255,119,0.22)] border border-[rgba(51,255,119,0.35)] text-[#33ff77] font-mono text-sm rounded-sm transition-all disabled:opacity-50"
                >
                  {loading ? "подождите..." : isLogin ? "войти →" : "создать аккаунт →"}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep("choose"); setError(""); }}
                  className="w-full py-2 font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors"
                >
                  ← назад
                </button>
              </form>
            )}

            {/* TELEGRAM WAITING */}
            {step === "telegram-sent" && (
              <div className="text-center py-4">
                <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center rounded-full bg-[rgba(0,212,255,0.1)] border border-[rgba(0,212,255,0.3)]">
                  <svg className="w-7 h-7 text-[#00d4ff] animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.93.44l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.52.25l.19-2.64 4.83-4.37c.21-.19-.05-.29-.32-.1L7.5 14.45 5.0 13.68c-.55-.17-.56-.55.12-.81l9.89-3.81c.46-.17.86.11.63.74z" />
                  </svg>
                </div>
                <div className="font-mono text-sm text-white mb-2">Войди через Telegram</div>
                {telegramUsername ? (
                  <>
                    <div className="font-sans text-xs text-[#5a6070] leading-relaxed mb-5">Telegram подтвердит личность и вернёт тебя в кабинет</div>
                    <div ref={telegramWidgetRef} className="flex justify-center min-h-11" />
                  </>
                ) : (
                  <div className="font-sans text-xs text-[#5a6070] leading-relaxed">
                    Telegram пока не настроен на сервере. Укажи <span className="text-[#00d4ff]">TELEGRAM_AUTH_BOT_TOKEN</span> и username бота.
                  </div>
                )}
                {error && <div className="mt-4 font-mono text-xs text-[#ff3e78]">{error}</div>}
                <button type="button" onClick={() => { setStep("choose"); setError(""); }} className="mt-6 font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors">← назад</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
