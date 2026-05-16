import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useLogMonitor } from "../contexts/LogMonitorContext";
import { useLangPath } from "../hooks/useLangPath";

const PHASE_COLOR: Record<string, string> = {
  idle: "bg-slate-500",
  lobby: "bg-sky-500",
  loading: "bg-amber-500",
  in_match: "bg-emerald-500",
  post_match: "bg-violet-500",
};

export function LogMonitorBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const langPath = useLangPath();
  const { status, connection, lastSystemMessage } = useLogMonitor();
  if (!status) return null;

  const phaseLabel = tc(`phase.${status.phase}`, { defaultValue: status.phase });
  const phaseColor = PHASE_COLOR[status.phase] ?? "bg-slate-500";

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              status.running ? phaseColor : "bg-slate-400"
            } ${status.running ? "animate-pulse" : ""}`}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {t("logMonitor.label")}: {status.running ? t("logMonitor.running") : t("logMonitor.stopped")}
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                {t("logMonitor.phase")}: {phaseLabel}
              </span>
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                {t("logMonitor.matchCount")}: {status.matchCount}
              </span>
            </div>
            {!compact && status.lastEvent && (
              <div className="text-xs text-[var(--color-muted)] mt-0.5 truncate">
                {t("logMonitor.latest")}: {status.lastEvent.icon} {status.lastEvent.label} (
                {status.lastEvent.detectedAt})
              </div>
            )}
            {lastSystemMessage && (
              <div className="text-xs text-[var(--color-accent)] mt-0.5 truncate">
                {t("logMonitor.autoProcess")}: {lastSystemMessage}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 ${
              connection === "open"
                ? "text-emerald-500"
                : connection === "connecting"
                  ? "text-amber-500"
                  : "text-rose-500"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            SSE: {connection}
          </span>
          {compact && (
            <Link
              to={langPath("/matches")}
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 hover:border-[var(--color-accent)]"
            >
              {t("logMonitor.details")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
