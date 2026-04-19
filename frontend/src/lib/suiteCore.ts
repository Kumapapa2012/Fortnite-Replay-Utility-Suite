/**
 * Client for suite_core service (proxied via Gateway at /api/suite).
 * suite_core returns snake_case (per docs §10.3); we rely on the api wrapper's
 * snake→camel conversion so the React side sees camelCase.
 */
import { api } from "./api";

const BASE = "/api/suite";

export interface MatchReplay {
  path: string;
  filename: string;
  sizeBytes: number;
  mtime: string;
}

export interface MatchVideo {
  path: string;
  filename: string;
  sizeBytes: number;
  mtime: string;
  durationSec: number;
}

export interface Match {
  id: string;
  matchStartedAt: string;
  replay: MatchReplay | null;
  video: MatchVideo | null;
  hasReplay: boolean;
  hasVideo: boolean;
}

export interface MatchesResponse {
  count: number;
  totalCount: number;
  generatedAt: number;
  matches: Match[];
}

export interface ReplaySummary {
  matchLengthSec: number;
  humanCount: number;
  botCount: number;
}

export interface MatchDetail extends Match {
  replaySummary?: ReplaySummary;
}

export type ObsDirSource = "obs_websocket" | "config_file" | "default";

export interface SuiteConfig {
  userPlayerId: string;
  demosDir: string;
  obsRecordingDir: string;
  obsRecordingDirSource: ObsDirSource;
  logPath: string;
}

export const suiteCoreApi = {
  listMatches: (limit = 50) =>
    api.get<MatchesResponse>(`${BASE}/matches?limit=${limit}`),
  getMatch: (id: string) => api.get<MatchDetail>(`${BASE}/matches/${id}`),
  refreshMatches: () => api.post<{ count: number; generatedAt: number }>(`${BASE}/matches/refresh`),
  getConfig: () => api.get<SuiteConfig>(`${BASE}/config`),
  putConfig: (partial: Partial<SuiteConfig>) =>
    api.put<SuiteConfig>(`${BASE}/config`, partial),
};
