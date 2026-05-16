import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import {
  prepareUploadApi,
  type Candidate,
  type FilteredVideo,
  type KeyframeHit,
} from "../lib/prepareUpload";
import { replayParserApi, type ReplayFileInfo } from "../lib/replayParser";
import { suiteCoreApi } from "../lib/suiteCore";
import { useLangPath } from "../hooks/useLangPath";

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fromEpoch(s: number): string {
  try {
    return new Date(s * 1000).toLocaleString();
  } catch {
    return "";
  }
}

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

export function Videos() {
  const { t } = useTranslation("pages");
  const { t: tc } = useTranslation();
  const langPath = useLangPath();
  const [searchParams] = useSearchParams();
  const matchId = searchParams.get("matchId") ?? null;
  const qc = useQueryClient();

  const health = useQuery({ queryKey: ["pu-health"], queryFn: prepareUploadApi.health });
  const replays = useQuery({ queryKey: ["replays"], queryFn: replayParserApi.listReplays });

  // When launched from a match, pre-populate replay/video from match data.
  const matchQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => suiteCoreApi.getMatch(matchId!),
    enabled: Boolean(matchId),
  });

  const [replayPath, setReplayPath] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current || !matchQuery.data) return;
    didInit.current = true;
    if (matchQuery.data.replay?.path) setReplayPath(matchQuery.data.replay.path);
    if (matchQuery.data.video?.path) setVideoPath(matchQuery.data.video.path);
  }, [matchQuery.data]);

  const [chosenCandidate, setChosenCandidate] = useState<Candidate | null>(null);
  const [keyframes, setKeyframes] = useState<KeyframeHit[]>([]);
  const [chosenKeyframe, setChosenKeyframe] = useState<KeyframeHit | null>(null);

  // Newest replay first — sort defensively by modifiedAt desc.
  const replayList = useMemo<ReplayFileInfo[]>(() => {
    const list = replays.data?.replays ?? [];
    return [...list].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }, [replays.data]);

  // Auto-fetch filtered videos whenever a replay is picked.
  const videosForReplay = useQuery({
    queryKey: ["pu-videos-for-replay", replayPath],
    queryFn: () => prepareUploadApi.videosForReplay(replayPath!),
    enabled: Boolean(replayPath),
  });

  const candidatesMut = useMutation({
    mutationFn: () => prepareUploadApi.candidates(videoPath!, replayPath!),
    onSuccess: () => {
      setChosenCandidate(null);
      setKeyframes([]);
      setChosenKeyframe(null);
    },
  });

  const keyframesMut = useMutation({
    mutationFn: () =>
      prepareUploadApi.keyframes(videoPath!, chosenCandidate!.videoOffsetSec, 10),
    onSuccess: (res) => {
      setKeyframes(res.keyframes);
      setChosenKeyframe(res.keyframes[0] ?? null);
    },
  });

  const trimMut = useMutation({
    mutationFn: () => prepareUploadApi.trim(videoPath!, chosenKeyframe!.offsetSec),
    onSuccess: async (result) => {
      if (!matchId) return;
      await suiteCoreApi.patchMatchState(matchId, {
        trimmedVideoPath: result.outputPath,
        trimStartOffsetSec: chosenKeyframe!.offsetSec,
      });
      qc.invalidateQueries({ queryKey: ["match", matchId] });
    },
  });

  const resetDerivedState = () => {
    setChosenCandidate(null);
    setKeyframes([]);
    setChosenKeyframe(null);
    candidatesMut.reset();
    keyframesMut.reset();
    trimMut.reset();
  };

  const pickReplay = (p: string | null) => {
    setReplayPath(p);
    setVideoPath(null);
    resetDerivedState();
  };

  const pickVideo = (p: string | null) => {
    setVideoPath(p);
    resetDerivedState();
  };

  const toolAvailable = (tool: { available: boolean; version: string | null } | undefined) => {
    if (!tool) return "?";
    return tool.available ? `OK (${tool.version ?? "?"})` : t("videos.ffmpegMissing");
  };

  const stepOffset = matchId ? -1 : 0;

  const filteredVideos: FilteredVideo[] = videosForReplay.data?.videos ?? [];
  const rejectedVideos = videosForReplay.data?.rejected ?? [];

  const thumbSrc = videoPath ? prepareUploadApi.thumbnailUrl(videoPath, 0) : null;

  return (
    <div>
      <PageHeader
        title={t("videos.title")}
        subtitle={videosForReplay.data?.recordingsDir ?? t("videos.subtitle")}
        actions={
          <button
            onClick={() => replays.refetch()}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            {replays.isFetching ? tc("action.refreshing") : tc("action.rescan")}
          </button>
        }
      />

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-muted)] flex flex-wrap gap-4">
          <span>ffmpeg: {toolAvailable(health.data?.ffmpeg)}</span>
          <span>ffprobe: {toolAvailable(health.data?.ffprobe)}</span>
          {health.error && (
            <span className="text-rose-400">
              {t("videos.healthFailed", { error: errText(health.error) })}
            </span>
          )}
        </section>

        {matchId ? (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-xs flex items-center justify-between">
            <span className="text-[var(--color-muted)]">
              {t("videos.trimTitle", { id: matchId })}
              {replayPath && (
                <span className="ml-2 opacity-60">— {replayPath.split(/[\\/]/).pop()}</span>
              )}
            </span>
            <Link
              to={langPath(`/matches/${encodeURIComponent(matchId)}`)}
              className="rounded border border-[var(--color-border)] px-2 py-1 hover:border-[var(--color-accent)]"
            >
              {t("videos.backToMatch")}
            </Link>
          </section>
        ) : (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
              {t("videos.step1SelectReplay")}
            </h3>
            {replays.isLoading ? (
              <p className="p-4 text-sm text-[var(--color-muted)]">{tc("action.loading")}</p>
            ) : replays.error ? (
              <p className="p-4 text-sm text-rose-300">{errText(replays.error)}</p>
            ) : replayList.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-muted)]">{t("videos.noReplays")}</p>
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--color-surface)]">
                    <tr className="text-left text-xs text-[var(--color-muted)]">
                      <th className="px-4 py-2 font-medium">{t("videos.colFile")}</th>
                      <th className="px-4 py-2 font-medium">{t("videos.colDate")}</th>
                      <th className="px-4 py-2 font-medium text-right">{t("videos.colSize")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replayList.map((r) => (
                      <tr
                        key={r.fullPath}
                        onClick={() => pickReplay(r.fullPath)}
                        className={`cursor-pointer border-t border-[var(--color-border)] hover:bg-white/5 ${
                          r.fullPath === replayPath ? "bg-[var(--color-accent)]/20" : ""
                        }`}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{r.fileName}</td>
                        <td className="px-4 py-2 text-xs">
                          {new Date(r.modifiedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          {bytes(r.sizeBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {replayPath && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
              {t("videos.stepCandidates", { n: 2 + stepOffset })}
            </h3>
            {videosForReplay.isLoading ? (
              <p className="p-4 text-sm text-[var(--color-muted)]">{t("videos.parsing")}</p>
            ) : videosForReplay.error ? (
              <p className="p-4 text-sm text-rose-300">
                {t("videos.candidateFailed", { error: errText(videosForReplay.error) })}
              </p>
            ) : videosForReplay.data ? (
              <>
                <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
                  {t("videos.timeRange", {
                    start: new Date(videosForReplay.data.matchStartedAt).toLocaleString(),
                    end: new Date(videosForReplay.data.matchEndAt).toLocaleTimeString(),
                    len: videosForReplay.data.matchLengthSec.toFixed(1),
                    buf: (videosForReplay.data.replayBufferSec / 60).toFixed(0),
                    included: filteredVideos.length,
                    excluded: rejectedVideos.length,
                  })}
                </div>
                {filteredVideos.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--color-muted)]">{t("videos.noCandidates")}</p>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--color-surface)]">
                        <tr className="text-left text-xs text-[var(--color-muted)]">
                          <th className="px-4 py-2 font-medium">{t("videos.colFile")}</th>
                          <th className="px-4 py-2 font-medium">{t("videos.colDate")}</th>
                          <th className="px-4 py-2 font-medium text-right">{t("videos.colDuration")}</th>
                          <th className="px-4 py-2 font-medium text-right">{t("videos.colSize")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredVideos.map((v) => (
                          <tr
                            key={v.path}
                            onClick={() => pickVideo(v.path)}
                            className={`cursor-pointer border-t border-[var(--color-border)] hover:bg-white/5 ${
                              v.path === videoPath ? "bg-[var(--color-accent)]/20" : ""
                            }`}
                          >
                            <td className="px-4 py-2 font-mono text-xs">{v.name}</td>
                            <td className="px-4 py-2 text-xs">{fromEpoch(v.mtime)}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">
                              {v.durationSec != null ? `${v.durationSec.toFixed(1)}s` : "?"}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs">
                              {bytes(v.sizeBytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {rejectedVideos.length > 0 && (
                  <details className="border-t border-[var(--color-border)] px-4 py-2 text-xs">
                    <summary className="cursor-pointer text-[var(--color-muted)]">
                      {t("videos.showExcluded", { count: rejectedVideos.length })}
                    </summary>
                    <ul className="mt-2 space-y-1 font-mono">
                      {rejectedVideos.map((r) => (
                        <li key={r.path} className="text-[var(--color-muted)]">
                          <span className="text-[var(--color-fg)]">{r.name}</span>
                          {" — "}
                          {r.reasons.join(" / ")}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {videoPath && thumbSrc && (
                  <div className="border-t border-[var(--color-border)] p-4 flex gap-4 items-start">
                    <img
                      src={thumbSrc}
                      alt="thumbnail"
                      className="h-24 w-40 rounded bg-black/40 object-cover"
                    />
                    <div className="text-xs font-mono break-all">{videoPath}</div>
                  </div>
                )}
                {videoPath && (
                  <div className="border-t border-[var(--color-border)] p-4">
                    <button
                      disabled={candidatesMut.isPending}
                      onClick={() => candidatesMut.mutate()}
                      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      {candidatesMut.isPending ? t("videos.calcOffsetting") : t("videos.calcOffset")}
                    </button>
                    {candidatesMut.error && (
                      <p className="mt-2 text-xs text-rose-400">
                        {t("videos.calcFailed", { error: errText(candidatesMut.error) })}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </section>
        )}

        {candidatesMut.data && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
              {t("videos.stepCutStart", { n: 3 + stepOffset })}
            </h3>
            <div className="p-4 space-y-2">
              <p className="text-xs text-[var(--color-muted)]">
                {t("videos.recStart")}: {new Date(candidatesMut.data.video.recordingStartedAt).toLocaleString()} /
                {t("videos.matchStart")}: {new Date(candidatesMut.data.replay.matchStartedAt).toLocaleString()} /
                {t("videos.videoLen")}: {candidatesMut.data.video.durationSec.toFixed(1)}s
              </p>
              <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                {candidatesMut.data.candidates.map((c) => (
                  <button
                    key={`${c.kind}-${c.videoOffsetSec}`}
                    onClick={() => {
                      setChosenCandidate(c);
                      setKeyframes([]);
                      setChosenKeyframe(null);
                    }}
                    className={`rounded border px-3 py-1.5 text-left text-xs font-mono ${
                      chosenCandidate?.videoOffsetSec === c.videoOffsetSec
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border)] hover:bg-white/5"
                    }`}
                  >
                    [{c.kind}] {c.label} — {c.videoOffsetSec.toFixed(1)}s
                  </button>
                ))}
              </div>
              <button
                disabled={!chosenCandidate || keyframesMut.isPending}
                onClick={() => keyframesMut.mutate()}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {keyframesMut.isPending ? t("videos.searching") : t("videos.searchKeyframe")}
              </button>
              {keyframesMut.error && (
                <p className="text-xs text-rose-400">
                  {t("videos.keyframeFailed", { error: errText(keyframesMut.error) })}
                </p>
              )}
            </div>
          </section>
        )}

        {keyframes.length > 0 && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
            <h3 className="text-sm font-medium">
              {t("videos.stepSelectKf", { n: 4 + stepOffset })}
            </h3>
            <div className="flex flex-wrap gap-2">
              {keyframes.map((k) => (
                <button
                  key={k.offsetSec}
                  onClick={() => setChosenKeyframe(k)}
                  className={`rounded border px-2 py-1 text-xs font-mono ${
                    chosenKeyframe?.offsetSec === k.offsetSec
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : "border-[var(--color-border)] hover:bg-white/5"
                  }`}
                >
                  {k.hms} ({k.offsetSec.toFixed(3)}s)
                </button>
              ))}
            </div>
            <button
              disabled={!chosenKeyframe || trimMut.isPending}
              onClick={() => trimMut.mutate()}
              className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {trimMut.isPending ? t("videos.trimming") : t("videos.trimFrom")}
            </button>
            {trimMut.error && (
              <p className="text-xs text-rose-400">
                {t("videos.trimFailed", { error: errText(trimMut.error) })}
              </p>
            )}
            {trimMut.data && (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
                <p className="font-medium text-emerald-300">{t("videos.done")}</p>
                <p className="font-mono break-all">{trimMut.data.outputPath}</p>
                <p>
                  {bytes(trimMut.data.sizeBytes)} / {trimMut.data.durationSec.toFixed(1)}s
                </p>
                {matchId && (
                  <Link
                    to={langPath(`/matches/${encodeURIComponent(matchId)}`)}
                    className="inline-block rounded-md border border-emerald-500/50 px-3 py-1.5 text-emerald-300 hover:bg-emerald-500/10"
                  >
                    {t("videos.backToMatchDetail")}
                  </Link>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
