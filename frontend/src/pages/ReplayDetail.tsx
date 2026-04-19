import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { replayParserApi, type ParseResponse } from "../lib/replayParser";
import { ApiError } from "../lib/api";

/** The /api/result endpoint returns plain text (with \r\n newlines), but we
 * display it inside an iframe. Wrap it in a minimal HTML document using <pre>
 * so whitespace and newlines survive. HTML entities are escaped first. */
function textToPreDoc(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;color:#111;}
pre{margin:0;padding:16px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;}
</style></head><body><pre>${escaped}</pre></body></html>`;
}

export function ReplayDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const session = useMemo<ParseResponse | undefined>(
    () => (id ? qc.getQueryData(["replay-session", id]) : undefined),
    [id, qc],
  );

  const [playerIndex, setPlayerIndex] = useState<number | null>(null);
  const [offset, setOffset] = useState<number>(0);

  // Default player selection once session becomes available.
  useEffect(() => {
    if (playerIndex === null && session && session.players.length > 0) {
      const first = session.players.find((p) => !p.isBot) ?? session.players[0];
      setPlayerIndex(first.index);
    }
  }, [session, playerIndex]);

  const resultQuery = useQuery({
    queryKey: ["replay-result", id, playerIndex, offset],
    queryFn: () =>
      replayParserApi.renderResult(id!, playerIndex!, offset),
    enabled: Boolean(id && playerIndex !== null),
  });

  const deleteMutation = useMutation({
    mutationFn: () => replayParserApi.deleteSession(id!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["replay-session", id] });
    },
  });

  if (!id) {
    return <div className="p-6 text-sm">セッション ID が不正です。</div>;
  }

  if (!session) {
    return (
      <div>
        <PageHeader title="リプレイ詳細" />
        <div className="p-6 space-y-3 text-sm">
          <p className="text-rose-300">
            セッションが失われました。ページがリロードされたか、サーバが再起動された可能性があります。
          </p>
          <Link to="/replays" className="text-[var(--color-accent)] hover:underline">
            ← リプレイ一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={session.fileName}
        subtitle={session.fullPath}
        actions={
          <>
            <Link
              to={`/replays/${id}/map`}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              マップを見る
            </Link>
            <a
              href={replayParserApi.exportJsonUrl(id)}
              download="replay.json"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              JSON エクスポート
            </a>
            <button
              onClick={() => deleteMutation.mutate()}
              className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
            >
              セッション破棄
            </button>
          </>
        }
      />

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-medium mb-3">表示設定</h3>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">プレイヤー</span>
              <select
                value={playerIndex ?? ""}
                onChange={(e) => setPlayerIndex(Number(e.target.value))}
                className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
              >
                {session.players.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">オフセット</span>
              <input
                type="number"
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value) || 0)}
                className="w-20 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
            <h3 className="text-sm font-medium">マッチ結果</h3>
            {resultQuery.isFetching ? (
              <span className="text-xs text-[var(--color-muted)]">生成中…</span>
            ) : null}
          </div>
          {resultQuery.error ? (
            <div className="p-4 text-sm text-rose-300">
              生成失敗:{" "}
              {resultQuery.error instanceof ApiError
                ? resultQuery.error.message
                : String(resultQuery.error)}
            </div>
          ) : resultQuery.data ? (
            <iframe
              title="replay-report"
              srcDoc={textToPreDoc(resultQuery.data.result)}
              className="w-full h-[65vh] bg-white"
            />
          ) : (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              プレイヤーを選択すると結果が表示されます。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
