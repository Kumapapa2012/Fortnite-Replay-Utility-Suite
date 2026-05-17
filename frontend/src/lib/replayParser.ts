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

export interface EliminationEntry {
  nth: string;
  time: string;
  playerName: string;
  cosmeticsName: string;
  humanOrBot: string;
}

export interface ResultData {
  startedAt: string;
  endedAt: string;
  duration: string;
  totalPlayers: number;
  humanPlayers: number;
  botPlayers: number;
  playerName: string;
  cosmeticsName: string;
  humanOrBot: string;
  isWinner: boolean;
  isEliminated: boolean;
  placement: number;
  placementDisplay: string;
  eliminationCount: number;
  eliminations: EliminationEntry[];
  eliminatedByPlayerName: string | null;
  eliminatedByCosmeticsName: string | null;
  eliminatedByHumanOrBot: string | null;
  eliminatedByTime: string | null;
  os: string;
  cpu: string;
  memory: string;
  availableMemory: string;
  gpu: string;
  resolution: string;
}

const BASE = "/api/replay-parser";
// .NET replay_parser uses camelCase both ways — skip key conversion.
const RAW = { raw: true } as const;

export const replayParserApi = {
  listReplays: () => api.get<ListReplaysResponse>(`${BASE}/replays`, RAW),
  parseFromDisk: (fullPath: string) =>
    api.post<ParseResponse>(`${BASE}/replays/parse`, { fullPath }, RAW),
  renderResult: (sessionId: string, playerIndex: number, offset: number) =>
    api.post<ResultData>(`${BASE}/result`, { sessionId, playerIndex, offset }, RAW),
  deleteSession: (sessionId: string) =>
    api.del<void>(`${BASE}/session/${sessionId}`, RAW),
  exportJsonUrl: (sessionId: string) => `${BASE}/export/${sessionId}`,
};
