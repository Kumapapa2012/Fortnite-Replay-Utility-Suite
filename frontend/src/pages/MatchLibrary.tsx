import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { suiteCoreApi, type Match } from "../lib/suiteCore";
import { useLangPath } from "../hooks/useLangPath";

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        ok
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-slate-500/20 text-slate-400"
      }`}
    >
      {label}
    </span>
  );
}

function MatchCard({ m }: { m: Match }) {
  const { t } = useTranslation("pages");
  const langPath = useLangPath();

  return (
    <Link
      to={langPath(`/matches/${encodeURIComponent(m.id)}`)}
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium font-mono">{m.id}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {fmtDate(m.matchStartedAt)}
            {m.matchResult === "win" && (
              <span className="ml-1.5 text-yellow-300">👑</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge ok={m.hasVideo} label="Video" />
          <Badge ok={m.hasTrimmedVideo} label="Trimmed" />
          <Badge ok={m.hasSummary} label="Summary" />
          <Badge ok={m.hasKillCompilation} label="Kill Clip" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1 text-[11px]">
        <p className="font-mono truncate" title={m.replay?.filename}>
          📼 {m.replay?.filename} ({bytes(m.replay?.sizeBytes ?? 0)})
        </p>
        {m.video ? (
          <p className="font-mono truncate" title={m.video.filename}>
            🎬 {m.video.filename} — {fmtDuration(m.video.durationSec)} /{" "}
            {bytes(m.video.sizeBytes)}
          </p>
        ) : (
          <p className="text-[var(--color-muted)] text-[11px]">🎬 {t("matches.noVideoLinked")}</p>
        )}
      </div>
    </Link>
  );
}

export function MatchLibrary() {
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const qc = useQueryClient();
  const matches = useQuery({
    queryKey: ["matches"],
    queryFn: () => suiteCoreApi.listMatches(100),
  });
  const refreshMut = useMutation({
    mutationFn: suiteCoreApi.refreshMatches,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["matches"] }),
  });

  return (
    <div>
      <PageHeader
        title={t("matches.title")}
        subtitle={
          matches.data
            ? t("matches.count", { total: matches.data.totalCount, count: matches.data.count })
            : t("matches.subtitle")
        }
        actions={
          <button
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {refreshMut.isPending ? tc("action.scanning") : tc("action.rescan")}
          </button>
        }
      />

      <div className="p-6">
        {matches.isLoading ? (
          <p className="text-sm text-[var(--color-muted)]">{tc("action.loading")}</p>
        ) : matches.error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-300">
            <p>{t("matches.fetchFailed")}</p>
            <p className="text-xs mt-1 opacity-80">{errText(matches.error)}</p>
            <p className="text-xs mt-2">{t("matches.fetchHint")}</p>
          </div>
        ) : !matches.data?.matches.length ? (
          <p className="text-sm text-[var(--color-muted)]">{t("matches.noMatches")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {matches.data.matches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        )}
        {refreshMut.error && (
          <p className="mt-3 text-xs text-rose-400">
            {t("matches.rescanFailed", { error: errText(refreshMut.error) })}
          </p>
        )}
      </div>
    </div>
  );
}
