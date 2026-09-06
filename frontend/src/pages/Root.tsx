import { Outlet, NavLink, Link } from "react-router";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import AuthModal from "../components/AuthModal";
import ImportStep from "../components/ImportStep";
import OnboardingFlow from "../components/OnboardingFlow";

const NAV_LINKS = [
  { to: "/", label: "Вакансии" },
  { to: "/companies", label: "Компании" },
  { to: "/trends", label: "Тренды" },
];

export default function Root() {
  const { user, isPro, showAuthModal, showImportStep, showOnboarding, openAuthModal, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user && new URLSearchParams(window.location.search).get("extension_login") === "1") {
      openAuthModal();
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    }
  }, [user, openAuthModal]);

  return (
    <div className="min-h-full bg-[#07080e] text-[#e8eaf0] font-sans grid-bg">
      <nav className="sticky top-0 z-40 border-b border-[rgba(51,255,119,0.1)] bg-[rgba(7,8,14,0.92)] backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="font-mono text-[#33ff77] text-lg font-medium neon-glow">{">"}</span>
            <span className="font-mono text-white font-medium tracking-tight">
              jobs<span className="text-[#33ff77]">.dev</span>
            </span>
          </NavLink>

          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/"}
                className={({ isActive }) =>
                  `font-mono text-xs transition-colors tracking-wide uppercase ${
                    isActive ? "text-[#33ff77]" : "text-[#5a6070] hover:text-[#33ff77]"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <>
                  <NavLink to="/activity" className={({ isActive }) =>
                    `font-mono text-xs transition-colors tracking-wide uppercase ${isActive ? "text-[#33ff77]" : "text-[#5a6070] hover:text-[#33ff77]"}`
                  }>
                    Отклики
                  </NavLink>
                  {user.isAdmin && <NavLink to="/admin" className={({ isActive }) =>
                    `font-mono text-xs transition-colors tracking-wide uppercase ${isActive ? "text-[#33ff77]" : "text-[#5a6070] hover:text-[#33ff77]"}`
                  }>Админка</NavLink>}
                  <Link to="/profile" className="group flex items-center gap-1.5">
                    <span className="font-mono text-xs text-[#5a6070] group-hover:text-[#33ff77] transition-colors">{user.name}</span>
                    {isPro && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm tracking-wider bg-[rgba(255,62,120,0.12)] border border-[rgba(255,62,120,0.35)] text-[#ff3e78]">
                        PRO
                      </span>
                    )}
                  </Link>
                  <button onClick={logout} className="font-mono text-xs text-[#3a404f] hover:text-[#5a6070] transition-colors">
                    выйти
                  </button>
                </>
              ) : (
                <button onClick={openAuthModal} className="font-mono text-xs text-[#5a6070] hover:text-white transition-colors">
                  войти
                </button>
              )}
            </div>

            {/* mobile hamburger */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex flex-col items-center justify-center w-9 h-9 gap-1.5"
              aria-label="меню"
            >
              <span
                className="block w-5 h-px transition-all duration-200"
                style={{
                  background: "#5a6070",
                  transform: menuOpen ? "translateY(4px) rotate(45deg)" : undefined,
                }}
              />
              <span
                className="block w-5 h-px transition-all duration-200"
                style={{
                  background: "#5a6070",
                  opacity: menuOpen ? 0 : 1,
                }}
              />
              <span
                className="block w-5 h-px transition-all duration-200"
                style={{
                  background: "#5a6070",
                  transform: menuOpen ? "translateY(-4px) rotate(-45deg)" : undefined,
                }}
              />
            </button>
          </div>
        </div>
      </nav>

      {/* mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-b border-[rgba(51,255,119,0.1)] bg-[rgba(7,8,14,0.97)] px-6 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block py-3 font-mono text-sm tracking-wide uppercase border-b border-[rgba(58,64,79,0.3)] last:border-0 ${
                  isActive ? "text-[#33ff77]" : "text-[#5a6070]"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
          {user && (
            <NavLink
              to="/activity"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block py-3 font-mono text-sm tracking-wide uppercase border-b border-[rgba(58,64,79,0.3)] ${
                  isActive ? "text-[#33ff77]" : "text-[#5a6070]"
                }`
              }
            >
              Отклики
            </NavLink>
          )}
          {user?.isAdmin && (
            <NavLink to="/admin" onClick={() => setMenuOpen(false)} className={({ isActive }) => `block py-3 font-mono text-sm tracking-wide uppercase border-b border-[rgba(58,64,79,0.3)] ${isActive ? "text-[#33ff77]" : "text-[#5a6070]"}`}>
              Админка
            </NavLink>
          )}
          <div className="pt-3 flex flex-col gap-2">
            {user ? (
              <>
                <Link
                  to="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="font-mono text-sm text-[#5a6070] py-1"
                >
                  {user.name}
                </Link>
                <button
                  onClick={() => { logout(); setMenuOpen(false); }}
                  className="font-mono text-sm text-[#3a404f] text-left py-1"
                >
                  выйти
                </button>
              </>
            ) : (
              <button
                onClick={() => { openAuthModal(); setMenuOpen(false); }}
                className="font-mono text-sm text-[#5a6070] text-left py-1"
              >
                войти
              </button>
            )}
          </div>
        </div>
      )}

      <Outlet />

      <footer className="border-t border-[rgba(51,255,119,0.08)] mt-4">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start justify-between gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[#33ff77] font-medium">{">"}</span>
              <span className="font-mono text-white font-medium">jobs<span className="text-[#33ff77]">.dev</span></span>
            </div>
            <p className="font-sans text-xs text-[#3a404f] max-w-xs">
              Вакансии напрямую от технологических компаний.<br />
              Без агентств, только реальные работодатели.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
            {[
              {
                title: "Для соискателей",
                links: [
                  { label: "Все вакансии", to: "/" },
                  { label: "Компании", to: "/companies" },
                  { label: "Тренды рынка", to: "/trends" },
                  { label: "Зарплаты", to: "/trends" },
                ],
              },
              {
                title: "Проект",
                links: [
                  { label: "О нас", href: "#" },
                  { label: "Блог", href: "#" },
                  { label: "Telegram", href: "#" },
                  { label: "Связаться", href: "#" },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <div className="font-mono text-xs text-[#3a404f] uppercase tracking-widest mb-3">{col.title}</div>
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {"to" in l ? (
                        <Link to={l.to} className="font-sans text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">{l.label}</Link>
                      ) : (
                        <a href={l.href} className="font-sans text-xs text-[#5a6070] hover:text-[#33ff77] transition-colors">{l.label}</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 py-4 border-t border-[rgba(51,255,119,0.05)] flex items-center justify-between">
          <span className="font-mono text-xs text-[#3a404f]">© 2024 jobs.dev</span>
          <span className="font-mono text-xs text-[#3a404f]">made for tech people</span>
        </div>
      </footer>

      {showAuthModal && <AuthModal />}
      {showImportStep && <ImportStep />}
      {showOnboarding && <OnboardingFlow />}
    </div>
  );
}
