import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { replayParserApi, type ReplayFileInfo } from "../lib/replayParser";
import { ApiError } from "../lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ReplayList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["replays"],
    queryFn: replayParserApi.listReplays,
  });

  const parseMutation = useMutation({
    mutationFn: (fullPath: string) => replayParserApi.parseFromDisk(fullPath),
    onSuccess: (res) => {
      qc.setQueryData(["replay-session", res.sessionId], res);
      navigate(`/replays/${res.sessionId}`);
    },
  });

  const filtered = useMemo<ReplayFileInfo[]>(() => {
    const list = data?.replays ?? [];
    if (!filter.trim()) return list;
    const q = filter.toLowerCase();
    return list.filter((r) => r.fileName.toLowerCase().includes(q));
  }, [data, filter]);

  return (
    <div>
      <PageHeader
        title="リプレイ"
        subtitle={data?.dir ? `ディレクトリ: ${data.dir}` : "リプレイファイル一覧"}
        actions={
          <button
            onClick={() => refetch()}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
          >
            {isFetching ? "更新中…" : "再スキャン"}
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <input
          type="text"
          placeholder="ファイル名で絞り込み"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />

        {isLoading ? (
          <p className="text-sm text-[var(--color-muted)]">読み込み中…</p>
        ) : error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-300">
            <p className="font-medium">リプレイ一覧の取得に失敗しました。</p>
            <p className="text-xs mt-1 opacity-80">
              {error instanceof ApiError ? error.message : String(error)}
            </p>
            <p className="text-xs mt-2">
              Gateway と replay_parser が起動しているか確認してください。
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            {data?.replays?.length
              ? "フィルタに一致するファイルがありません。"
              : "リプレイファイルが見つかりませんでした。"}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface)]">
                <tr className="text-left text-xs text-[var(--color-muted)]">
                  <th className="px-4 py-2 font-medium">ファイル名</th>
                  <th className="px-4 py-2 font-medium">更新日時</th>
                  <th className="px-4 py-2 font-medium text-right">サイズ</th>
                  <th className="px-4 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.fullPath}
                    className="border-t border-[var(--color-border)] hover:bg-white/5"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.fileName}</td>
                    <td className="px-4 py-2 text-xs">{formatDate(r.modifiedAt)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {formatBytes(r.sizeBytes)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        disabled={parseMutation.isPending}
                        onClick={() => parseMutation.mutate(r.fullPath)}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {parseMutation.isPending &&
                        parseMutation.variables === r.fullPath
                          ? "解析中…"
                          : "開く"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {parseMutation.error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-300">
            解析失敗:{" "}
            {parseMutation.error instanceof ApiError
              ? parseMutation.error.message
              : String(parseMutation.error)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
