import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { ApiError } from "../lib/api";
import { mapApi, type RenderResult } from "../lib/mapApi";
import type { ParseResponse } from "../lib/replayParser";
import { useLangPath } from "../hooks/useLangPath";

function ZLegend({ zMin, zMean, zMax }: { zMin: number; zMean: number; zMax: number }) {
  const { t } = useTranslation("pages");
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-[var(--color-muted)]">{t("replayMap.zLabel")}</span>
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
  const { t } = useTranslation("pages");
  const langPath = useLangPath();
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

  // Magnifier state (drag-to-loupe interaction)
  const CROP = 64;
  const MODAL_SIZE = CROP * 2;
  const imgRef = useRef<HTMLImageElement>(null);
  const isDragging = useRef(false);
  const [lupe, setLupe] = useState<{ left: number; top: number; dataUrl: string } | null>(null);

  useEffect(() => {
    const onUp = () => { isDragging.current = false; setLupe(null); };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const showLupe = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const srcX = Math.round((e.clientX - rect.left) * scaleX - CROP / 2);
    const srcY = Math.round((e.clientY - rect.top) * scaleY - CROP / 2);
    const canvas = document.createElement("canvas");
    canvas.width = MODAL_SIZE;
    canvas.height = MODAL_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, srcX, srcY, CROP, CROP, 0, 0, MODAL_SIZE, MODAL_SIZE);
    setLupe({
      left: e.clientX - MODAL_SIZE / 2,
      top:  e.clientY - MODAL_SIZE / 2,
      dataUrl: canvas.toDataURL(),
    });
  };

  // Default the dropdown to the first human with a playable id.
  useEffect(() => {
    if (!playerId && playersQuery.data?.players.length) {
      const first =
        playersQuery.data.players.find((p) => !p.isBot && p.playerId) ??
        playersQuery.data.players.find((p) => p.playerId);
      if (first) setPlayerId(first.playerId);
    }
  }, [playersQuery.data, playerId]);

  // Revoke blob URLs when replaced or on unmount.
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

  const errText = (e: unknown): string =>
    e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);

  if (!id) return <div className="p-6 text-sm">{t("replayMap.invalidId")}</div>;

  if (!session) {
    return (
      <div>
        <PageHeader title={t("replayMap.mapTitle")} />
        <div className="p-6 space-y-3 text-sm">
          <p className="text-rose-300">{t("replayMap.sessionLost")}</p>
          <Link to={langPath("/replays")} className="text-[var(--color-accent)] hover:underline">
            {t("replayMap.back")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
    <div>
      <PageHeader
        title={t("replayMap.title", { filename: session.fileName })}
        subtitle={session.fullPath}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-muted)] font-mono">
              map v{versionQuery.data?.version ?? "?"}
            </span>
            <button
              onClick={() => updateMapMutation.mutate()}
              disabled={updateMapMutation.isPending}
              title={t("replayMap.updateMapTitle")}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              {updateMapMutation.isPending ? t("replayMap.updating") : t("replayMap.updateMap")}
            </button>
            <Link
              to={langPath(`/replays/${id}`)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              {t("replayMap.backToDetail")}
            </Link>
          </div>
        }
      />
      {updateMapMutation.isSuccess && (
        <div className="mx-6 mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {updateMapMutation.data.updated
            ? t("replayMap.mapUpdated", {
                from: updateMapMutation.data.prevVersion ?? "?",
                to: updateMapMutation.data.version ?? "?",
              })
            : t("replayMap.mapLatest", { version: updateMapMutation.data.version ?? "?" })}
        </div>
      )}
      {updateMapMutation.error && (
        <div className="mx-6 mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {t("replayMap.mapUpdateFailed", { error: errText(updateMapMutation.error) })}
        </div>
      )}

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">{t("replayMap.player")}</span>
              <select
                value={playerId ?? ""}
                onChange={(e) => setPlayerId(e.target.value)}
                disabled={!playersQuery.data}
                className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs min-w-[16rem]"
              >
                {playersQuery.data?.players
                  .slice()
                  .sort((a, b) => a.playerName.localeCompare(b.playerName))
                  .map((p) => (
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
              {renderMutation.isPending ? t("replayMap.rendering") : t("replayMap.render")}
            </button>
            {render && (
              <a
                href={render.blobUrl}
                download={`${session.fileName.replace(/\.replay$/i, "")}_map.png`}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
              >
                {t("replayMap.downloadPng")}
              </a>
            )}
          </div>
          {playersQuery.error && (
            <p className="mt-2 text-xs text-rose-400">
              {t("replayMap.playerFetchFailed", { error: errText(playersQuery.error) })}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t("replayMap.trajectory")}</h3>
            {render && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--color-muted)]">
                  {t("replayMap.points", { count: render.meta.pointCount.toLocaleString() })}
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
            <p className="text-sm text-[var(--color-muted)]">{t("replayMap.parsePending")}</p>
          ) : renderMutation.error ? (
            <p className="text-sm text-rose-400">
              {t("replayMap.renderFailed", { error: errText(renderMutation.error) })}
            </p>
          ) : render ? (
            <div
              className="overflow-auto rounded bg-black/20"
              style={{ cursor: "crosshair" }}
              onMouseDown={(e) => { if (e.button !== 0) return; isDragging.current = true; showLupe(e); }}
              onMouseMove={(e) => { if (isDragging.current) showLupe(e); }}
              onMouseLeave={() => { isDragging.current = false; setLupe(null); }}
            >
              <img
                ref={imgRef}
                src={render.blobUrl}
                alt="Replay route map"
                className="max-w-full"
                draggable={false}
              />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">{t("replayMap.selectPlayerHint")}</p>
          )}
        </section>
      </div>
    </div>

    {lupe && (
      <div
        style={{
          position: "fixed",
          left: lupe.left,
          top: lupe.top,
          width: MODAL_SIZE,
          height: MODAL_SIZE,
          zIndex: 9999,
          border: "2px solid rgba(255,255,255,0.8)",
          borderRadius: 4,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <img
          src={lupe.dataUrl}
          style={{ display: "block", width: MODAL_SIZE, height: MODAL_SIZE, imageRendering: "pixelated" }}
        />
      </div>
    )}
    </>
  );
}
