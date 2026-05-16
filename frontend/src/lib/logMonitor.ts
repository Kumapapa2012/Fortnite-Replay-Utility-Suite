/**
 * Thin client for the log_monitor_api service (proxied via Gateway).
 * The Python service speaks snake_case, so we let the fetcher convert.
 */
import { api } from "./api";

export type MonitorPhase =
  | "idle"
  | "lobby"
  | "loading"
  | "in_match"
  | "post_match"
  | string;

export interface MonitorStatus {
  running: boolean;
  phase: MonitorPhase;
  matchCount: number;
  logPath: string | null;
  obsEnabled: boolean;
  obsConnected: boolean;
  obsError: string | null;
  startedAt: number | null;
  lastEvent: MonitorEvent | null;
}

export interface MonitorEvent {
  type: "event";
  eventId: string;
  label: string;
  icon: string;
  phase: MonitorPhase;
  timestamp: string | null;
  detectedAt: string;
  extra?: Record<string, unknown> | null;
}

export interface SystemEvent {
  type: "system";
  kind: string;
  message: string;
  detectedAt: string;
  params?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFunc = (...args: any[]) => string;

/** Format a system event using i18n. Falls back to raw `message` if no key found. */
export function formatSystemEvent(ev: SystemEvent, t: TFunc): string {
  const { kind, params, message } = ev;
  if (kind === "post_match_automation" && params) {
    const result = t(`systemEvent.result.${params.result}`, { defaultValue: String(params.result ?? "") });
    const trim   = t(`systemEvent.trim.${params.trim}`,   { defaultValue: String(params.trim   ?? "") });
    return t(`systemEvent.${kind}`, { ...params, result, trim, defaultValue: message });
  }
  return t(`systemEvent.${kind}`, { ...(params ?? {}), defaultValue: message });
}

export type StreamedEvent = MonitorEvent | SystemEvent;

export interface SnapshotResponse {
  status: MonitorStatus;
  recentEvents: StreamedEvent[];
}

export interface SseSnapshot extends SnapshotResponse {
  type: "snapshot";
}

const BASE = "/api/log-monitor";

export const logMonitorApi = {
  status: () => api.get<SnapshotResponse>(`${BASE}/status`),
  start: (enableObs = true) =>
    api.post<SnapshotResponse>(`${BASE}/start`, { enableObs }),
  stop: () => api.post<SnapshotResponse>(`${BASE}/stop`),
  eventsUrl: `${BASE}/events`,
};
