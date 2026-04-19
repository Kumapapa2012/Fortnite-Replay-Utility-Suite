import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import {
  prepareUploadApi,
  type Candidate,
  type FilteredVideo,
  type KeyframeHit,
} from "../lib/prepareUpload";
import { replayParserApi, type ReplayFileInfo } from "../lib/replayParser";

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

function toolLine(t: { available: boolean; version: string | null } | undefined): string {
  if (!t) return "?";
  return t.available ? `OK (${t.version ?? "?"})` : "未検出";
}

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

export function Videos() {
  const health = useQuery({ queryKey: ["pu-health"], queryFn: prepareUploadApi.health });
  const replays = useQuery({ queryKey: ["replays"], queryFn: replayParserApi.listReplays });

  const [replayPath, setReplayPath] = useState<string | null>(null);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [chosenCandidate, setChosenCandidate] = useState<Candidate | null>(null);
  const [keyframes, setKeyframes] = useState<KeyframeHit[]>([]);
  const [chosenKeyframe, setChosenKeyframe] = useState<KeyframeHit | null>(null);

  // Newest replay first. Backend order may vary — sort defensively by modifiedAt desc.
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
  });

  const pickReplay = (p: string | null) => {
    setReplayPath(p);
    setVideoPath(null);
    setChosenCandidate(null);
    setKeyframes([]);
    setChosenKeyframe(null);
    candidatesMut.reset();
    keyframesMut.reset();
    trimMut.reset();
  };

  const pickVideo = (p: string | null) => {
    setVideoPath(p);
    setChosenCandidate(null);
    setKeyframes([]);
    setChosenKeyframe(null);
    candidatesMut.reset();
    keyframesMut.reset();
    trimMut.reset();
  };

  const filteredVideos: FilteredVideo[] = videosForReplay.data?.videos ?? [];
  const rejectedVideos = videosForReplay.data?.rejected ?? [];

  const thumbSrc = videoPath ? prepareUploadApi.thumbnailUrl(videoPath, 0) : null;

  return (
    <div>
      <PageHeader
        title="動画"
        subtitle={videosForReplay.data?.recordingsDir ?? "リプレイを選択すると候補動画を抽出します"}
        actions={
          <button
            onClick={() => replays.refetch()}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            {replays.isFetching ? "更新中…" : "再スキャン"}
          </button>
        }
      />

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-muted)] flex flex-wrap gap-4">
          <span>ffmpeg: {toolLine(health.data?.ffmpeg)}</span>
          <span>ffprobe: {toolLine(health.data?.ffprobe)}</span>
          {health.error && (
            <span className="text-rose-400">ヘルス取得失敗: {errText(health.error)}</span>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            1. リプレイを選ぶ（新しい順）
          </h3>
          {replays.isLoading ? (
            <p className="p-4 text-sm text-[var(--color-muted)]">読み込み中…</p>
          ) : replays.error ? (
            <p className="p-4 text-sm text-rose-300">{errText(replays.error)}</p>
          ) : replayList.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-muted)]">リプレイが見つかりません。</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-surface)]">
                  <tr className="text-left text-xs text-[var(--color-muted)]">
                    <th className="px-4 py-2 font-medium">ファイル</th>
                    <th className="px-4 py-2 font-medium">更新日時</th>
                    <th className="px-4 py-2 font-medium text-right">サイズ</th>
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

        {replayPath && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <h3 className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
              2. 候補の動画を選ぶ
            </h3>
            {videosForReplay.isLoading ? (
              <p className="p-4 text-sm text-[var(--color-muted)]">
                リプレイをパースして試合時間と照合しています…
              </p>
            ) : videosForReplay.error ? (
              <p className="p-4 text-sm text-rose-300">
                候補抽出失敗: {errText(videosForReplay.error)}
              </p>
            ) : videosForReplay.data ? (
              <>
                <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
                  試合:{" "}
                  {new Date(videosForReplay.data.matchStartedAt).toLocaleString()} 〜{" "}
                  {new Date(videosForReplay.data.matchEndAt).toLocaleTimeString()} (
                  {videosForReplay.data.matchLengthSec.toFixed(1)}s) / リプレイバッファ{" "}
                  {(videosForReplay.data.replayBufferSec / 60).toFixed(0)}分
                  {videosForReplay.data.durationRuleApplied ? "" : "（試合が長いため長さ判定はスキップ）"}
                  {" — 候補 "}{filteredVideos.length} / 除外 {rejectedVideos.length}
                </div>
                {filteredVideos.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--color-muted)]">
                    条件を満たす動画がありません。
                  </p>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--color-surface)]">
                        <tr className="text-left text-xs text-[var(--color-muted)]">
                          <th className="px-4 py-2 font-medium">ファイル</th>
                          <th className="px-4 py-2 font-medium">更新日時</th>
                          <th className="px-4 py-2 font-medium text-right">長さ</th>
                          <th className="px-4 py-2 font-medium text-right">サイズ</th>
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
                      除外された {rejectedVideos.length} 件を表示
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
                      {candidatesMut.isPending ? "計算中…" : "オフセット候補を計算"}
                    </button>
                    {candidatesMut.error && (
                      <p className="mt-2 text-xs text-rose-400">
                        候補計算失敗: {errText(candidatesMut.error)}
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
              3. カット開始位置を選ぶ
            </h3>
            <div className="p-4 space-y-2">
              <p className="text-xs text-[var(--color-muted)]">
                録画開始: {new Date(candidatesMut.data.video.recordingStartedAt).toLocaleString()} /
                試合開始: {new Date(candidatesMut.data.replay.matchStartedAt).toLocaleString()} /
                動画長: {candidatesMut.data.video.durationSec.toFixed(1)}s
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
                {keyframesMut.isPending ? "検索中…" : "この時刻の前後 10 秒でキーフレーム検索"}
              </button>
              {keyframesMut.error && (
                <p className="text-xs text-rose-400">
                  キーフレーム失敗: {errText(keyframesMut.error)}
                </p>
              )}
            </div>
          </section>
        )}

        {keyframes.length > 0 && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
            <h3 className="text-sm font-medium">4. キーフレームを選ぶ</h3>
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
              {trimMut.isPending ? "トリミング中…" : "ここから末尾まで切り出す"}
            </button>
            {trimMut.error && (
              <p className="text-xs text-rose-400">トリム失敗: {errText(trimMut.error)}</p>
            )}
            {trimMut.data && (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-emerald-300">完了しました。</p>
                <p className="font-mono break-all">{trimMut.data.outputPath}</p>
                <p>
                  {bytes(trimMut.data.sizeBytes)} / {trimMut.data.durationSec.toFixed(1)}s
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
