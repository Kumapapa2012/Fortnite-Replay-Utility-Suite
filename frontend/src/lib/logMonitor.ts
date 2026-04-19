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
