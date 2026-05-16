import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { suiteCoreApi } from "../lib/suiteCore";
import { replayParserApi } from "../lib/replayParser";
import { prepareUploadApi, type KillClipInfo } from "../lib/prepareUpload";
import { useLangPath } from "../hooks/useLangPath";
import { useLangNavigate } from "../hooks/useLangNavigate";

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-slate-500/20 text-slate-400"
      }`}
    >
      {ok ? "✓" : "—"} {label}
    </span>
  );
}

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

export function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const langPath = useLangPath();
  const langNavigate = useLangNavigate();
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const qc = useQueryClient();
  const [manualVideoPath, setManualVideoPath] = useState("");

  const match = useQuery({
    queryKey: ["match", id],
    queryFn: () => suiteCoreApi.getMatch(id!),
    enabled: Boolean(id),
  });

  const openReplayMut = useMutation({
    mutationFn: (path: string) => replayParserApi.parseFromDisk(path),
    onSuccess: (res) => {
      qc.setQueryData(["replay-session", res.sessionId], res);
      langNavigate(`/replays/${res.sessionId}`);
    },
  });

  const computeKillsMut = useMutation({
    mutationFn: () => suiteCoreApi.computeKills(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", id] });
    },
  });

  const killCompilationMut = useMutation({
    mutationFn: async () => {
      if (!m?.trimmedVideoPath || !m.killOffsetsInTrimmed.length) return;
      const result = await prepareUploadApi.killCompilation(
        m.trimmedVideoPath,
        m.killOffsetsInTrimmed,
      );
      await suiteCoreApi.patchMatchState(id!, {
        killCompilationPath: result.outputPath,
      });
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", id] });
    },
  });

  const summarizeMut = useMutation({
    mutationFn: (hasWon: boolean | null) => suiteCoreApi.summarizeMatch(id!, hasWon),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", id] });
    },
  });

  const autoLinkMut = useMutation({
    mutationFn: () => suiteCoreApi.autoLinkVideo(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", id] });
    },
  });

  const linkVideoMut = useMutation({
    mutationFn: (path: string | null) => suiteCoreApi.linkVideo(id!, path),
    onSuccess: () => {
      setManualVideoPath("");
      qc.invalidateQueries({ queryKey: ["match", id] });
    },
  });

  const videosQuery = useQuery({
    queryKey: ["suite-videos"],
    queryFn: () => suiteCoreApi.listVideos(),
    enabled: false,
  });

  if (!id) return <div className="p-6 text-sm">{t("matchDetail.invalidId")}</div>;

  const m = match.data;

  return (
    <div>
      <PageHeader
        title={t("matchDetail.title", { id })}
        subtitle={m ? new Date(m.matchStartedAt).toLocaleString() : tc("action.loading")}
        actions={
          <Link
            to={langPath("/matches")}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            {t("matchDetail.backToMatches")}
          </Link>
        }
      />
      <div className="p-6 space-y-5">
        {match.isLoading && (
          <p className="text-sm text-[var(--color-muted)]">{tc("action.loading")}</p>
        )}
        {match.error && (
          <p className="text-sm text-rose-300">{errText(match.error)}</p>
        )}

        {m && (
          <>
            {/* Processing status badges */}
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-medium mb-3">{t("matchDetail.processingStatus")}</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge ok={true} label="Replay" />
                <StatusBadge ok={m.hasVideo} label="Video" />
                <StatusBadge ok={m.hasTrimmedVideo} label="Trimmed" />
                <StatusBadge ok={m.hasSummary} label="Summary" />
                <StatusBadge ok={m.hasKillCompilation} label="Kill Clip" />
              </div>
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-medium mb-3">{t("matchDetail.matchInfo")}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-[var(--color-muted)]">{t("matchDetail.started")}</dt>
                <dd>{new Date(m.matchStartedAt).toLocaleString()}</dd>
                {m.replaySummary && (
                  <>
                    <dt className="text-[var(--color-muted)]">{t("matchDetail.duration")}</dt>
                    <dd>{fmtDuration(m.replaySummary.matchLengthSec)}</dd>
                    <dt className="text-[var(--color-muted)]">{t("matchDetail.playerCount")}</dt>
                    <dd>
                      {t("matchDetail.playerCountValue", {
                        human: m.replaySummary.humanCount,
                        bot: m.replaySummary.botCount,
                      })}
                    </dd>
                  </>
                )}
                {m.matchResult && (
                  <>
                    <dt className="text-[var(--color-muted)]">{t("matchDetail.result")}</dt>
                    <dd className={m.matchResult === "win" ? "text-yellow-300 font-medium" : "text-slate-400"}>
                      {m.matchResult === "win" ? t("matchDetail.resultWin") : t("matchDetail.resultLoss")}
                    </dd>
                  </>
                )}
                {(m.killTimesInMatch ?? []).length > 0 && (
                  <>
                    <dt className="text-[var(--color-muted)]">{t("matchDetail.killsInMatch")}</dt>
                    <dd>
                      {t("matchDetail.killsValue", {
                        count: m.killTimesInMatch.length,
                        times: m.killTimesInMatch.map(fmtSec).join(", "),
                      })}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {/* Match summary section */}
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("matchDetail.summary")}</h3>
                {m.hasSummary && (
                  <span className="text-xs text-emerald-400">{t("matchDetail.summarized")}</span>
                )}
              </div>
              <p className="text-xs text-[var(--color-muted)]">{t("matchDetail.summaryDesc")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => summarizeMut.mutate(true)}
                  disabled={summarizeMut.isPending}
                  className="rounded-md bg-yellow-500/20 border border-yellow-500/40 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/30 disabled:opacity-40"
                >
                  {summarizeMut.isPending ? t("matchDetail.summarizing") : t("matchDetail.summarizeWin")}
                </button>
                <button
                  onClick={() => summarizeMut.mutate(false)}
                  disabled={summarizeMut.isPending}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
                >
                  {summarizeMut.isPending ? t("matchDetail.summarizing") : t("matchDetail.summarizeLoss")}
                </button>
              </div>
              {summarizeMut.isSuccess && summarizeMut.data && (
                <p className="text-xs text-emerald-400">
                  {summarizeMut.data.matchResult === "win"
                    ? t("matchDetail.summarizeResultWin", { killCount: summarizeMut.data.killCount })
                    : t("matchDetail.summarizeResultLoss", { killCount: summarizeMut.data.killCount })}
                </p>
              )}
              {summarizeMut.error && (
                <p className="text-xs text-rose-400">
                  {t("matchDetail.summarizeFailed", { error: errText(summarizeMut.error) })}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("matchDetail.replay")}</h3>
                {m.replay && (
                  <span className="text-xs text-[var(--color-muted)]">
                    {bytes(m.replay.sizeBytes)}
                  </span>
                )}
              </div>
              {m.replay ? (
                <>
                  <p className="font-mono text-xs break-all">{m.replay.path}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => openReplayMut.mutate(m.replay!.path)}
                      disabled={openReplayMut.isPending}
                      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      {openReplayMut.isPending ? tc("action.parsing") : t("matchDetail.openReport")}
                    </button>
                  </div>
                  {openReplayMut.error && (
                    <p className="text-xs text-rose-400">
                      {t("matchDetail.parseFailed", { error: errText(openReplayMut.error) })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">{t("matchDetail.noReplay")}</p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("matchDetail.video")}</h3>
                {m.video && (
                  <span className="text-xs text-[var(--color-muted)]">
                    {fmtDuration(m.video.durationSec)} / {bytes(m.video.sizeBytes)}
                  </span>
                )}
              </div>
              {m.video ? (
                <>
                  <p className="font-mono text-xs break-all">{m.video.path}</p>
                  <img
                    src={prepareUploadApi.thumbnailUrl(m.video.path, 0)}
                    alt="thumbnail"
                    className="h-28 w-48 rounded bg-black/40 object-cover"
                  />
                  <Link
                    to={langPath(`/videos?matchId=${encodeURIComponent(m.id)}`)}
                    className="inline-block rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
                  >
                    {t("matchDetail.toTrimUI")}
                  </Link>
                  <button
                    onClick={() => linkVideoMut.mutate(null)}
                    disabled={linkVideoMut.isPending}
                    className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-rose-400 disabled:opacity-50"
                  >
                    {t("matchDetail.unlinkVideo")}
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--color-muted)]">{t("matchDetail.noVideo")}</p>
                  {/* Auto-detect video */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={() => autoLinkMut.mutate()}
                      disabled={autoLinkMut.isPending}
                      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      {autoLinkMut.isPending ? t("matchDetail.detecting") : t("matchDetail.autoDetect")}
                    </button>
                    {autoLinkMut.isError && (
                      <span className="text-xs text-amber-400">{t("matchDetail.autoDetectFailed")}</span>
                    )}
                  </div>
                  {/* Manual link */}
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--color-muted)]">{t("matchDetail.manualLink")}</p>
                    <div className="flex gap-2">
                      <select
                        className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
                        value={manualVideoPath}
                        onChange={(e) => setManualVideoPath(e.target.value)}
                        onFocus={() => !videosQuery.data && videosQuery.refetch()}
                      >
                        <option value="">{t("matchDetail.selectVideo")}</option>
                        {videosQuery.data?.videos.map((v) => (
                          <option key={v.path} value={v.path}>
                            {v.filename} ({fmtDuration(v.durationSec)})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => manualVideoPath && linkVideoMut.mutate(manualVideoPath)}
                        disabled={!manualVideoPath || linkVideoMut.isPending}
                        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
                      >
                        {t("matchDetail.link")}
                      </button>
                    </div>
                    {linkVideoMut.error && (
                      <p className="text-xs text-rose-400">
                        {t("matchDetail.linkFailed", { error: errText(linkVideoMut.error) })}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Kill compilation section */}
            {m.hasTrimmedVideo && (
              <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                <h3 className="text-sm font-medium">{t("matchDetail.killClips")}</h3>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-[var(--color-muted)]">Trimmed</dt>
                  <dd className="font-mono break-all">{m.trimmedVideoPath}</dd>
                </dl>

                {/* Step 1: compute kill offsets */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--color-muted)]">
                    {t("matchDetail.killStep1")}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={() => computeKillsMut.mutate()}
                      disabled={computeKillsMut.isPending}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
                    >
                      {computeKillsMut.isPending ? t("matchDetail.computingKills") : t("matchDetail.computeKills")}
                    </button>
                    {m.killOffsetsInTrimmed.length > 0 && (
                      <span className="text-xs text-emerald-400">
                        ✓ {m.killOffsetsInTrimmed.length} /{" "}
                        {m.killOffsetsInTrimmed.map(fmtSec).join(", ")}
                      </span>
                    )}
                  </div>
                  {computeKillsMut.isSuccess && (
                    <p className="text-xs text-emerald-400">
                      {t("matchDetail.killsRegistered", {
                        playerId: computeKillsMut.data?.userPlayerId,
                        count: computeKillsMut.data?.killCount,
                      })}
                    </p>
                  )}
                  {computeKillsMut.error && (
                    <p className="text-xs text-rose-400">
                      {t("matchDetail.killsFailed", { error: errText(computeKillsMut.error) })}
                    </p>
                  )}
                </div>

                {/* Step 2: generate kill compilation */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--color-muted)]">
                    {t("matchDetail.killStep2")}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={() => killCompilationMut.mutate()}
                      disabled={
                        killCompilationMut.isPending ||
                        m.killOffsetsInTrimmed.length === 0
                      }
                      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-40"
                    >
                      {killCompilationMut.isPending
                        ? t("matchDetail.generatingKillClips")
                        : m.hasKillCompilation
                        ? t("matchDetail.recreateKillClips")
                        : t("matchDetail.createKillClips")}
                    </button>
                    {m.hasKillCompilation && (
                      <span className="text-xs text-emerald-400">{t("matchDetail.killClipsDoneLabel")}</span>
                    )}
                  </div>
                  {m.hasKillCompilation && m.killCompilationPath && (
                    <p className="font-mono text-xs break-all text-[var(--color-muted)]">
                      {m.killCompilationPath}
                    </p>
                  )}
                  {killCompilationMut.isSuccess && killCompilationMut.data && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                      <p className="text-emerald-300 font-medium">
                        {t("matchDetail.killClipsDone", {
                          count: killCompilationMut.data.clipCount,
                          size: bytes(killCompilationMut.data.sizeBytes),
                        })}
                      </p>
                      <p className="font-mono break-all text-[var(--color-muted)]">
                        {killCompilationMut.data.outputPath}
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-text)]">
                          {t("matchDetail.killClipsDetail")}
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-2">
                          {killCompilationMut.data.clips.map((c: KillClipInfo, i: number) => (
                            <li key={i}>
                              Kill {i + 1}: {fmtSec(c.actualStartSec)} →{" "}
                              {fmtSec(c.endSec)} ({c.durationSec.toFixed(1)}s)
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  )}
                  {killCompilationMut.error && (
                    <p className="text-xs text-rose-400">
                      {t("matchDetail.killCompilationFailed", { error: errText(killCompilationMut.error) })}
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
