import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { suiteCoreApi } from "../lib/suiteCore";
import { replayParserApi } from "../lib/replayParser";
import { prepareUploadApi } from "../lib/prepareUpload";

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
              </dl>
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
          </>
        )}
      </div>
    </div>
  );
}
