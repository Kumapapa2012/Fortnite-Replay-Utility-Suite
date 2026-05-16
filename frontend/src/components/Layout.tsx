import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useParams, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ThemeToggle } from "./ThemeToggle";
import { LangContext, parseLang, SUPPORTED_LANGS, type Lang } from "../contexts/LangContext";
import { useLang } from "../contexts/LangContext";

export function LangLayout() {
  const { lang } = useParams<{ lang: string }>();
  const { i18n } = useTranslation();
  const parsed = parseLang(lang);

  useEffect(() => {
    i18n.changeLanguage(parsed);
  }, [parsed, i18n]);

  if (!SUPPORTED_LANGS.includes(lang as Lang)) {
    return <Navigate to="/ja/" replace />;
  }

  return (
    <LangContext.Provider value={parsed}>
      <Layout />
    </LangContext.Provider>
  );
}

export function Layout() {
  const lang = useLang();
  const location = useLocation();
  const { t } = useTranslation();

  const NAV = [
    { to: `/${lang}/`, label: t("nav.dashboard"), end: true },
    { to: `/${lang}/matches`, label: t("nav.matches"), end: false },
    { to: `/${lang}/replays`, label: t("nav.replays"), end: false },
    { to: `/${lang}/videos`, label: t("nav.videos"), end: false },
    { to: `/${lang}/logs`, label: t("nav.logs"), end: false },
    { to: `/${lang}/settings`, label: t("nav.settings"), end: false },
  ];

  const switchLangPath = (l: string) =>
    location.pathname.replace(`/${lang}`, `/${l}`);

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <div className="px-4 py-5 border-b border-[var(--color-border)]">
          <h1 className="text-sm font-semibold tracking-wide">
            Fortnite Replay Suite
          </h1>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">v0.1.0</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  "block rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium"
                    : "hover:bg-white/5 text-[var(--color-fg)]/90",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[var(--color-border)] space-y-2">
          <div className="flex gap-1">
            {SUPPORTED_LANGS.map((l) => (
              <Link
                key={l}
                to={switchLangPath(l)}
                className={[
                  "rounded px-2 py-0.5 text-xs",
                  l === lang
                    ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
                ].join(" ")}
              >
                {t(`lang.${l}`)}
              </Link>
            ))}
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
