import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { suiteCoreApi } from "../lib/suiteCore";
import { replayParserApi } from "../lib/replayParser";
import { prepareUploadApi, type KillClipInfo } from "../lib/prepareUpload";

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
  const navigate = useNavigate();
  const qc = useQueryClient();

  const match = useQuery({
    queryKey: ["match", id],
    queryFn: () => suiteCoreApi.getMatch(id!),
    enabled: Boolean(id),
  });

  const openReplayMut = useMutation({
    mutationFn: (path: string) => replayParserApi.parseFromDisk(path),
    onSuccess: (res) => {
      qc.setQueryData(["replay-session", res.sessionId], res);
      navigate(`/replays/${res.sessionId}`);
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

  if (!id) return <div className="p-6 text-sm">マッチ ID が不正です。</div>;

  const m = match.data;

  return (
    <div>
      <PageHeader
        title={`マッチ詳細: ${id}`}
        subtitle={m ? new Date(m.matchStartedAt).toLocaleString() : "読み込み中…"}
        actions={
          <Link
            to="/matches"
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            ← マッチ一覧
          </Link>
        }
      />
      <div className="p-6 space-y-5">
        {match.isLoading && (
          <p className="text-sm text-[var(--color-muted)]">読み込み中…</p>
        )}
        {match.error && (
          <p className="text-sm text-rose-300">{errText(match.error)}</p>
        )}

        {m && (
          <>
            {/* 処理状態 */}
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-medium mb-3">処理状態</h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge ok={m.hasReplay} label="Replay" />
                <StatusBadge ok={m.hasVideo} label="Video" />
                <StatusBadge ok={m.hasTrimmedVideo} label="Trimmed" />
                <StatusBadge ok={m.hasSummary} label="Summary" />
                <StatusBadge ok={m.hasKillCompilation} label="Kill Clip" />
              </div>
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 className="text-sm font-medium mb-3">試合情報</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-[var(--color-muted)]">開始</dt>
                <dd>{new Date(m.matchStartedAt).toLocaleString()}</dd>
                {m.replaySummary && (
                  <>
                    <dt className="text-[var(--color-muted)]">長さ</dt>
                    <dd>{fmtDuration(m.replaySummary.matchLengthSec)}</dd>
                    <dt className="text-[var(--color-muted)]">プレイヤー</dt>
                    <dd>
                      人間 {m.replaySummary.humanCount} / ボット {m.replaySummary.botCount}
                    </dd>
                  </>
                )}
                {m.matchResult && (
                  <>
                    <dt className="text-[var(--color-muted)]">結果</dt>
                    <dd className={m.matchResult === "win" ? "text-yellow-300 font-medium" : "text-slate-400"}>
                      {m.matchResult === "win" ? "👑 Victory Royale" : "敗北"}
                    </dd>
                  </>
                )}
                {(m.killTimesInMatch ?? []).length > 0 && (
                  <>
                    <dt className="text-[var(--color-muted)]">キル (試合内)</dt>
                    <dd>
                      {m.killTimesInMatch.length} 件 /{" "}
                      {m.killTimesInMatch.map(fmtSec).join(", ")}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {/* 試合集計 (Summary) */}
            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">📊 試合集計</h3>
                {m.hasSummary && (
                  <span className="text-xs text-emerald-400">✓ 集計済み</span>
                )}
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                リプレイを解析してキルタイムと勝敗を記録します。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => summarizeMut.mutate(true)}
                  disabled={summarizeMut.isPending || !m.hasReplay}
                  className="rounded-md bg-yellow-500/20 border border-yellow-500/40 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/30 disabled:opacity-40"
                >
                  {summarizeMut.isPending ? "集計中…" : "👑 勝利として集計"}
                </button>
                <button
                  onClick={() => summarizeMut.mutate(false)}
                  disabled={summarizeMut.isPending || !m.hasReplay}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
                >
                  {summarizeMut.isPending ? "集計中…" : "敗北として集計"}
                </button>
              </div>
              {summarizeMut.isSuccess && summarizeMut.data && (
                <p className="text-xs text-emerald-400">
                  ✓ 集計完了 — {summarizeMut.data.matchResult === "win" ? "Victory Royale 👑" : "敗北"} /{" "}
                  キル {summarizeMut.data.killCount} 件
                </p>
              )}
              {summarizeMut.error && (
                <p className="text-xs text-rose-400">失敗: {errText(summarizeMut.error)}</p>
              )}
              {!m.hasReplay && (
                <p className="text-xs text-amber-400">リプレイファイルが必要です。</p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">📼 リプレイ</h3>
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
                      {openReplayMut.isPending ? "解析中…" : "結果レポートを開く"}
                    </button>
                  </div>
                  {openReplayMut.error && (
                    <p className="text-xs text-rose-400">
                      解析失敗: {errText(openReplayMut.error)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">
                  この試合のリプレイはありません。
                </p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">🎬 録画動画</h3>
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
                    to="/videos"
                    className="inline-block rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
                  >
                    トリミング UI へ
                  </Link>
                </>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">
                  この試合の録画はありません。
                </p>
              )}
            </section>

            {/* Kill クリップ集 */}
            {m.hasTrimmedVideo && (
              <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                <h3 className="text-sm font-medium">💥 Kill クリップ集</h3>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-[var(--color-muted)]">Trimmed</dt>
                  <dd className="font-mono break-all">{m.trimmedVideoPath}</dd>
                </dl>

                {/* Step 1: Kill オフセット計算 */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--color-muted)]">
                    Step 1 — 自プレイヤーの Kill オフセットを計算
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={() => computeKillsMut.mutate()}
                      disabled={computeKillsMut.isPending || !m.hasReplay}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-40"
                    >
                      {computeKillsMut.isPending ? "計算中…" : "Kill オフセットを計算"}
                    </button>
                    {m.killOffsetsInTrimmed.length > 0 && (
                      <span className="text-xs text-emerald-400">
                        ✓ {m.killOffsetsInTrimmed.length} 件 /{" "}
                        {m.killOffsetsInTrimmed.map(fmtSec).join(", ")}
                      </span>
                    )}
                    {!m.hasReplay && (
                      <span className="text-xs text-amber-400">リプレイが必要です</span>
                    )}
                  </div>
                  {computeKillsMut.isSuccess && (
                    <p className="text-xs text-emerald-400">
                      ✓ {computeKillsMut.data?.userPlayerId} のキル{" "}
                      {computeKillsMut.data?.killCount} 件を登録しました
                    </p>
                  )}
                  {computeKillsMut.error && (
                    <p className="text-xs text-rose-400">
                      失敗: {errText(computeKillsMut.error)}
                    </p>
                  )}
                </div>

                {/* Step 2: クリップ集生成 */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--color-muted)]">
                    Step 2 — クリップ集を生成（各 Kill 前後 10 秒）
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
                        ? "生成中…"
                        : m.hasKillCompilation
                        ? "再生成"
                        : "Kill クリップ集を作成"}
                    </button>
                    {m.hasKillCompilation && (
                      <span className="text-xs text-emerald-400">✓ 生成済み</span>
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
                        ✓ {killCompilationMut.data.clipCount} クリップ /{" "}
                        {bytes(killCompilationMut.data.sizeBytes)}
                      </p>
                      <p className="font-mono break-all text-[var(--color-muted)]">
                        {killCompilationMut.data.outputPath}
                      </p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-text)]">
                          クリップ詳細
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
                      失敗: {errText(killCompilationMut.error)}
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
