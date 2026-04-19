/**
 * Thin client for the replay_parser service (proxied via Gateway).
 */
import { api } from "./api";

export interface ReplayFileInfo {
  fileName: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface ListReplaysResponse {
  dir: string;
  replays: ReplayFileInfo[];
}

export interface PlayerInfo {
  index: number;
  label: string;
  playerId: string;
  playerName: string;
  isBot: boolean;
}

export interface ParseResponse {
  sessionId: string;
  players: PlayerInfo[];
  fileName: string;
  fullPath: string;
}

export interface ResultResponse {
  result: string;
}

const BASE = "/api/replay-parser";
// .NET replay_parser uses camelCase both ways — skip key conversion.
const RAW = { raw: true } as const;

export const replayParserApi = {
  listReplays: () => api.get<ListReplaysResponse>(`${BASE}/replays`, RAW),
  parseFromDisk: (fullPath: string) =>
    api.post<ParseResponse>(`${BASE}/replays/parse`, { fullPath }, RAW),
  renderResult: (sessionId: string, playerIndex: number, offset: number) =>
    api.post<ResultResponse>(`${BASE}/result`, { sessionId, playerIndex, offset }, RAW),
  deleteSession: (sessionId: string) =>
    api.del<void>(`${BASE}/session/${sessionId}`, RAW),
  exportJsonUrl: (sessionId: string) => `${BASE}/export/${sessionId}`,
};
