/**
 * Client for suite_core service (proxied via Gateway at /api/suite).
 * suite_core returns snake_case (per docs §10.3); we rely on the api wrapper's
 * snake→camel conversion so the React side sees camelCase.
 */
import { api } from "./api";
import type { Lang } from "../contexts/LangContext";

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
  replay: MatchReplay | null;  // always present (a match requires a replay)
  video: MatchVideo | null;
  hasVideo: boolean;
  // sidecar state
  hasTrimmedVideo: boolean;
  trimmedVideoPath: string | null;
  trimStartOffsetSec: number | null;
  killOffsetsInTrimmed: number[];
  hasSummary: boolean;
  hasKillCompilation: boolean;
  killCompilationPath: string | null;
  killTimesInMatch: number[];
  matchResult: "win" | "loss" | null;
}

export interface MatchStatePatch {
  trimmedVideoPath?: string;
  trimStartOffsetSec?: number;
  hasSummary?: boolean;
  killCompilationPath?: string;
}

export interface ComputeKillsResponse {
  matchId: string;
  userPlayerId: string;
  killCount: number;
  killOffsetsInTrimmed: number[];
}

export interface PostMatchAutomationResponse {
  matchId: string;
  matchResult: "win" | "loss";
  killCount: number;
  killTimesInMatch: number[];
  videoLinked: boolean;
  video: MatchVideo | null;
}

export interface VideoItem {
  path: string;
  filename: string;
  sizeBytes: number;
  mtime: string;
  durationSec: number;
}

export interface VideoListResponse {
  count: number;
  videos: VideoItem[];
}

export interface MatchStateResponse {
  matchId: string;
  state: {
    hasTrimmedVideo: boolean;
    trimmedVideoPath: string | null;
    trimStartOffsetSec: number | null;
    killOffsetsInTrimmed: number[];
    hasSummary: boolean;
    hasKillCompilation: boolean;
    killCompilationPath: string | null;
  };
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
  replayResultTemplate: string;
  uiLang: Lang;
}

export const suiteCoreApi = {
  listMatches: (limit = 50) =>
    api.get<MatchesResponse>(`${BASE}/matches?limit=${limit}`),
  getMatch: (id: string) => api.get<MatchDetail>(`${BASE}/matches/${id}`),
  refreshMatches: () => api.post<{ count: number; generatedAt: number }>(`${BASE}/matches/refresh`),
  getConfig: () => api.get<SuiteConfig>(`${BASE}/config`),
  putConfig: (partial: Partial<SuiteConfig>) =>
    api.put<SuiteConfig>(`${BASE}/config`, partial),
  patchMatchState: (id: string, patch: MatchStatePatch) =>
    api.patch<MatchStateResponse>(`${BASE}/matches/${id}/state`, patch),
  computeKills: (id: string) =>
    api.post<ComputeKillsResponse>(`${BASE}/matches/${id}/compute-kills`),
  summarizeMatch: (id: string, hasWon: boolean | null = null) =>
    api.post<PostMatchAutomationResponse>(`${BASE}/matches/${encodeURIComponent(id)}/summarize`, { hasWon }),
  linkVideo: (id: string, videoPath: string | null) =>
    api.put<{ matchId: string; videoPath: string | null }>(`${BASE}/matches/${id}/video`, { videoPath }),
  autoLinkVideo: (id: string) =>
    api.post<{ matchId: string; video: MatchVideo }>(`${BASE}/matches/${id}/auto-link-video`),
  listVideos: () =>
    api.get<VideoListResponse>(`${BASE}/videos`),
};
