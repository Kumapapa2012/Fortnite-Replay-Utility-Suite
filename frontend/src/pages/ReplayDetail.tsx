import { useEffect, useMemo, useState } from "react";
import Mustache from "mustache";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

Mustache.escape = (text: string) => text;
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { replayParserApi, type ParseResponse } from "../lib/replayParser";
import { suiteCoreApi } from "../lib/suiteCore";
import { ApiError } from "../lib/api";
import { useLangPath } from "../hooks/useLangPath";

function buildTemplateData(data: ReturnType<typeof replayParserApi.renderResult> extends Promise<infer T> ? T : never) {
  return {
    started_at: data.startedAt,
    ended_at: data.endedAt,
    duration: data.duration,
    total_players: data.totalPlayers,
    human_players: data.humanPlayers,
    bot_players: data.botPlayers,
    player_name: data.playerName,
    cosmetics_name: data.cosmeticsName,
    human_or_bot: data.humanOrBot,
    is_winner: data.isWinner,
    is_eliminated: data.isEliminated,
    placement: data.placement,
    placement_display: data.placementDisplay,
    elimination_count: data.eliminationCount,
    eliminations: data.eliminations.map((e) => ({
      nth: e.nth,
      time: e.time,
      player_name: e.playerName,
      cosmetics_name: e.cosmeticsName,
      human_or_bot: e.humanOrBot,
    })),
    eliminated_by_player_name: data.eliminatedByPlayerName,
    eliminated_by_cosmetics_name: data.eliminatedByCosmeticsName,
    eliminated_by_human_or_bot: data.eliminatedByHumanOrBot,
    eliminated_by_time: data.eliminatedByTime,
    os: data.os,
    cpu: data.cpu,
    memory: data.memory,
    available_memory: data.availableMemory,
    gpu: data.gpu,
    resolution: data.resolution,
  };
}

export function ReplayDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("pages");
  const langPath = useLangPath();
  const qc = useQueryClient();

  const session = useMemo<ParseResponse | undefined>(
    () => (id ? qc.getQueryData(["replay-session", id]) : undefined),
    [id, qc],
  );

  const [playerIndex, setPlayerIndex] = useState<number | null>(null);
  const [offset, setOffset] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (playerIndex === null && session && session.players.length > 0) {
      const first = session.players.find((p) => !p.isBot) ?? session.players[0];
      setPlayerIndex(first.index);
    }
  }, [session, playerIndex]);

  const resultQuery = useQuery({
    queryKey: ["replay-result", id, playerIndex, offset],
    queryFn: () => replayParserApi.renderResult(id!, playerIndex!, offset),
    enabled: Boolean(id && playerIndex !== null),
  });

  const configQuery = useQuery({
    queryKey: ["suite-config"],
    queryFn: suiteCoreApi.getConfig,
  });

  const renderedText = useMemo(() => {
    if (!resultQuery.data || !configQuery.data) return null;
    try {
      return Mustache.render(
        configQuery.data.replayResultTemplate,
        buildTemplateData(resultQuery.data),
      );
    } catch {
      return null;
    }
  }, [resultQuery.data, configQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: () => replayParserApi.deleteSession(id!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["replay-session", id] });
    },
  });

  const handleCopy = () => {
    if (!renderedText) return;
    navigator.clipboard.writeText(renderedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!id) {
    return <div className="p-6 text-sm">{t("replayDetail.invalidId")}</div>;
  }

  if (!session) {
    return (
      <div>
        <PageHeader title={t("replayDetail.title")} />
        <div className="p-6 space-y-3 text-sm">
          <p className="text-rose-300">{t("replayDetail.sessionLost")}</p>
          <Link to={langPath("/replays")} className="text-[var(--color-accent)] hover:underline">
            {t("replayDetail.back")}
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
              to={langPath(`/replays/${id}/map`)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              {t("replayDetail.viewMap")}
            </Link>
            <a
              href={replayParserApi.exportJsonUrl(id)}
              download="replay.json"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              {t("replayDetail.exportJson")}
            </a>
            <button
              onClick={() => deleteMutation.mutate()}
              className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
            >
              {t("replayDetail.discardSession")}
            </button>
          </>
        }
      />

      <div className="p-6 space-y-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-medium mb-3">{t("replayDetail.displaySettings")}</h3>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-muted)]">{t("replayDetail.player")}</span>
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
              <span className="text-[var(--color-muted)]">{t("replayDetail.offset")}</span>
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
            <h3 className="text-sm font-medium">{t("replayDetail.matchResult")}</h3>
            <div className="flex items-center gap-2">
              {resultQuery.isFetching && (
                <span className="text-xs text-[var(--color-muted)]">{t("replayDetail.generating")}</span>
              )}
              {renderedText && (
                <button
                  onClick={handleCopy}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs hover:border-[var(--color-accent)]"
                >
                  {copied ? t("replayDetail.copied") : t("replayDetail.copy")}
                </button>
              )}
            </div>
          </div>
          {resultQuery.error ? (
            <div className="p-4 text-sm text-rose-300">
              {t("replayDetail.generateFailed", {
                error: resultQuery.error instanceof ApiError
                  ? resultQuery.error.message
                  : String(resultQuery.error),
              })}
            </div>
          ) : renderedText ? (
            <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-white text-gray-900 min-h-[40vh]">
              {renderedText}
            </pre>
          ) : (
            <div className="p-4 text-sm text-[var(--color-muted)]">
              {t("replayDetail.selectPlayer")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
