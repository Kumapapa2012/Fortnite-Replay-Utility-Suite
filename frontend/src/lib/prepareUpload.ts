/**
 * Thin client for the prepare_upload_api service (proxied via Gateway).
 * JSON responses go through snake→camel conversion handled by the generic api
 * wrapper; our FastAPI models use Field aliases that already emit camelCase,
 * so most payloads round-trip unchanged. We still pass `raw: true` because the
 * upstream already speaks camelCase on both sides.
 */
import { api } from "./api";

const BASE = "/api/prepare-upload";
const RAW = { raw: true } as const;

export interface VideoEntry {
  path: string;
  name: string;
  sizeBytes: number;
  mtime: number;
}

export interface ListVideosResponse {
  recordingsDir: string;
  videos: VideoEntry[];
}

export interface FilteredVideo extends VideoEntry {
  ctime: number;
  filenameTs: string | null;
  durationSec: number | null;
}

export interface RejectedVideo extends FilteredVideo {
  reasons: string[];
}

export interface VideosForReplayResponse {
  recordingsDir: string;
  replayPath: string;
  matchStartedAt: string;
  matchEndAt: string;
  matchLengthSec: number;
  replayBufferSec: number;
  durationRuleApplied: boolean;
  videos: FilteredVideo[];
  rejected: RejectedVideo[];
}

export interface ToolHealth {
  available: boolean;
  version: string | null;
  path: string | null;
}

export type HealthResponse = Record<"ffmpeg" | "ffprobe", ToolHealth>;

export interface Candidate {
  kind: "elimination" | "match_start" | "match_end" | "manual";
  absoluteTime: string;
  videoOffsetSec: number;
  label: string;
  killIndex?: number;
  matchTime?: string;
}

export interface CandidatesResponse {
  video: {
    path: string;
    durationSec: number;
    mtime: string;
    recordingStartedAt: string;
  };
  replay: {
    path: string;
    matchStartedAt: string;
    matchLengthSec: number;
  };
  candidates: Candidate[];
}

export interface KeyframeHit {
  offsetSec: number;
  hms: string;
}

export interface KeyframesResponse {
  videoPath: string;
  searchRange: { startSec: number; endSec: number };
  keyframes: KeyframeHit[];
}

export interface TrimResponse {
  outputPath: string;
  sizeBytes: number;
  durationSec: number;
  ffmpegReturncode: number;
}

export const prepareUploadApi = {
  health: () => api.get<HealthResponse>(`${BASE}/api/health`, RAW),
  listVideos: () => api.get<ListVideosResponse>(`${BASE}/videos`, RAW),
  videosForReplay: (replayPath: string) =>
    api.post<VideosForReplayResponse>(`${BASE}/videos-for-replay`, { replayPath }, RAW),
  thumbnailUrl: (videoPath: string, offsetSec = 0) =>
    `${BASE}/thumbnail?path=${encodeURIComponent(videoPath)}&offsetSec=${offsetSec}`,
  candidates: (videoPath: string, replayPath: string) =>
    api.post<CandidatesResponse>(`${BASE}/candidates`, { videoPath, replayPath }, RAW),
  keyframes: (videoPath: string, aroundOffsetSec: number, rangeSec = 10) =>
    api.post<KeyframesResponse>(
      `${BASE}/keyframes`,
      { videoPath, aroundOffsetSec, rangeSec },
      RAW,
    ),
  trim: (videoPath: string, startOffsetSec: number, outputPath?: string) =>
    api.post<TrimResponse>(
      `${BASE}/trim`,
      { videoPath, startOffsetSec, outputPath: outputPath ?? null },
      RAW,
    ),
};
