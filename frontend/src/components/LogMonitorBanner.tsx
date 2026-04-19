import { Link } from "react-router-dom";

import { useLogMonitor } from "../contexts/LogMonitorContext";

const PHASE_LABEL: Record<string, string> = {
  idle: "待機中",
  lobby: "ロビー",
  loading: "ロード中",
  in_match: "マッチ中",
  post_match: "マッチ終了",
};

const PHASE_COLOR: Record<string, string> = {
  idle: "bg-slate-500",
  lobby: "bg-sky-500",
  loading: "bg-amber-500",
  in_match: "bg-emerald-500",
  post_match: "bg-violet-500",
};

export function LogMonitorBanner({ compact = false }: { compact?: boolean }) {
  const { status, connection } = useLogMonitor();
  if (!status) return null;

  const phaseLabel = PHASE_LABEL[status.phase] ?? status.phase;
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
              ログ監視: {status.running ? "稼働中" : "停止中"}
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                フェーズ: {phaseLabel}
              </span>
              <span className="ml-2 text-xs text-[var(--color-muted)]">
                マッチ数: {status.matchCount}
              </span>
            </div>
            {!compact && status.lastEvent && (
              <div className="text-xs text-[var(--color-muted)] mt-0.5 truncate">
                最新: {status.lastEvent.icon} {status.lastEvent.label} (
                {status.lastEvent.detectedAt})
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
              to="/matches"
              className="rounded-md border border-[var(--color-border)] px-2.5 py-1 hover:border-[var(--color-accent)]"
            >
              詳細 →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
