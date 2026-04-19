import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { mapApi, type RenderResult } from "../lib/mapApi";
import type { ParseResponse } from "../lib/replayParser";

function ZLegend({ zMin, zMean, zMax }: { zMin: number; zMean: number; zMax: number }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-[var(--color-muted)]">Z (高度)</span>
      <div
        className="h-2 w-40 rounded-full"
        style={{
          background:
            "linear-gradient(to right, rgb(0,0,255), rgb(0,255,0), rgb(255,0,0))",
        }}
      />
      <span className="font-mono">
        {zMin.toFixed(0)} / {zMean.toFixed(0)} / {zMax.toFixed(0)}
      </span>
    </div>
  );
}

export function ReplayMap() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const session = useMemo<ParseResponse | undefined>(
    () => (id ? qc.getQueryData(["replay-session", id]) : undefined),
    [id, qc],
  );

  const playersQuery = useQuery({
    queryKey: ["map-players", session?.fullPath],
    queryFn: () => mapApi.listPlayers(session!.fullPath),
    enabled: Boolean(session?.fullPath),
  });

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [render, setRender] = useState<RenderResult | null>(null);

  // Default the dropdown to the first human with a playable id.
  useEffect(() => {
    if (!playerId && playersQuery.data?.players.length) {
      const first =
        playersQuery.data.players.find((p) => !p.isBot && p.playerId) ??
        playersQuery.data.players.find((p) => p.playerId);
      if (first) setPlayerId(first.playerId);
    }
  }, [playersQuery.data, playerId]);

  // Revoke blob URLs when replaced / on unmount.
  useEffect(() => {
    return () => {
      if (render) URL.revokeObjectURL(render.blobUrl);
    };
  }, [render]);

  const renderMutation = useMutation({
    mutationFn: () => mapApi.render(session!.fullPath, playerId!),
    onSuccess: (result) => {
      setRender((prev) => {
        if (prev) URL.revokeObjectURL(prev.blobUrl);
        return result;
      });
    },
  });

  const versionQuery = useQuery({
    queryKey: ["map-version"],
    queryFn: mapApi.getVersion,
    staleTime: 60_000,
  });

  const updateMapMutation = useMutation({
    mutationFn: mapApi.updateMap,
    onSuccess: (res) => {
      qc.setQueryData(["map-version"], { version: res.version });
      // Force re-render of the map image with the new background.
      setRender((prev) => {
        if (prev) URL.revokeObjectURL(prev.blobUrl);
        return null;
      });
    },
  });

  if (!id) return <div className="p-6 text-sm">セッション ID が不正です。</div>;

  if (!session) {
    return (
      <div>
        <PageHeader title="マップ" />
        <div className="p-6 space-y-3 text-sm">
          <p className="text-rose-300">
            セッションが失われました。リプレイ一覧から再度開いてください。
          </p>
          <Link to="/replays" className="text-[var(--color-accent)] hover:underline">
            ← リプレイ一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  const errorText = (e: unknown): string =>
    e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

  return (
    <div>
      <PageHeader
        title={`マップ: ${session.fileName}`}
        subtitle={session.fullPath}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-muted)] font-mono">
              map v{versionQuery.data?.version ?? "?"}
            </span>
            <button
              onClick={() => updateMapMutation.mutate()}
              disabled={updateMapMutation.isPending}
              title="fortnite.gg から最新マップをダウンロード"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              {updateMapMutation.isPending ? "更新中…" : "マップを更新"}
            </button>
            <Link
              to={`/replays/${id}`}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              ← リプレイ詳細
            </Link>
          </div>
        }
      />
      {updateMapMutation.isSuccess && (
        <div className="mx-6 mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {updateMapMutation.data.updated
            ? `マップを更新しました: ${updateMapMutation.data.prevVersion ?? "?"} → ${updateMapMutation.data.version ?? "?"}`
            : `最新バージョンです (v${updateMapMutation.data.version ?? "?"})`}
        </div>
      )}
      {updateMapMutation.error && (
        <div className="mx-6 mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          マップ更新失敗: {errorText(updateMapMutation.error)}
        </div>
      )}

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">プレイヤー</span>
              <select
                value={playerId ?? ""}
                onChange={(e) => setPlayerId(e.target.value)}
                disabled={!playersQuery.data}
                className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs min-w-[16rem]"
              >
                {playersQuery.data?.players.map((p) => (
                  <option key={p.playerId || p.playerName} value={p.playerId}>
                    {p.playerName}
                    {p.isBot ? " [bot]" : ""}
                    {p.playerId ? ` — ${p.playerId.slice(0, 8)}…` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => renderMutation.mutate()}
              disabled={!playerId || renderMutation.isPending}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {renderMutation.isPending ? "レンダリング中…" : "マップを描画"}
            </button>
            {render && (
              <a
                href={render.blobUrl}
                download={`${session.fileName.replace(/\.replay$/i, "")}_map.png`}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
              >
                PNG をダウンロード
              </a>
            )}
          </div>
          {playersQuery.error && (
            <p className="mt-2 text-xs text-rose-400">
              プレイヤー取得失敗: {errorText(playersQuery.error)}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">軌跡</h3>
            {render && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--color-muted)]">
                  {render.meta.pointCount.toLocaleString()} 点
                </span>
                <ZLegend
                  zMin={render.meta.zMin}
                  zMean={render.meta.zMean}
                  zMax={render.meta.zMax}
                />
              </div>
            )}
          </div>
          {renderMutation.isPending ? (
            <p className="text-sm text-[var(--color-muted)]">
              リプレイをパース→画像生成中です。30〜90 秒かかることがあります。
            </p>
          ) : renderMutation.error ? (
            <p className="text-sm text-rose-400">
              レンダリング失敗: {errorText(renderMutation.error)}
            </p>
          ) : render ? (
            <div className="overflow-auto rounded bg-black/20">
              <img
                src={render.blobUrl}
                alt="Replay route map"
                className="max-w-full"
              />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              プレイヤーを選んで「マップを描画」を押してください。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
