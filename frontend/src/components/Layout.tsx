import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { to: "/", label: "ダッシュボード" },
  { to: "/matches", label: "マッチ" },
  { to: "/replays", label: "リプレイ" },
  { to: "/videos", label: "動画" },
  { to: "/logs", label: "ログ" },
  { to: "/settings", label: "設定" },
];

export function Layout() {
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
              end={item.to === "/"}
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
        <div className="p-3 border-t border-[var(--color-border)]">
          <ThemeToggle />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
