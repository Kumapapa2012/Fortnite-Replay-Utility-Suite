/**
 * Thin client for the map_api service (proxied via Gateway).
 * JSON responses go through snake→camel conversion; /render returns PNG bytes.
 */
import { ApiError } from "./api";
import { keysToCamel } from "./caseConvert";

export interface MapPlayer {
  playerId: string;
  playerName: string;
  isBot: boolean;
  teamIndex: number | null;
}

export interface ListPlayersResponse {
  replayPath: string;
  players: MapPlayer[];
}

export interface RenderMeta {
  zMin: number;
  zMean: number;
  zMax: number;
  pointCount: number;
}

export interface RenderResult {
  blobUrl: string;
  meta: RenderMeta;
}

export interface MapVersionResponse {
  version: string | null;
}

export interface MapUpdateResponse {
  updated: boolean;
  version: string | null;
  prevVersion: string | null;
  stdoutTail: string[];
}

const BASE = "/api/map";

export const mapApi = {
  listPlayers: async (replayPath: string): Promise<ListPlayersResponse> => {
    const url = `${BASE}/players?replayPath=${encodeURIComponent(replayPath)}`;
    const res = await fetch(url);
    if (!res.ok) throw await toError(res);
    const raw = await res.json();
    return keysToCamel(raw) as ListPlayersResponse;
  },
  render: async (replayPath: string, playerId: string): Promise<RenderResult> => {
    const res = await fetch(`${BASE}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replayPath, playerId }),
    });
    if (!res.ok) throw await toError(res);
    const blob = await res.blob();
    const meta: RenderMeta = {
      zMin: Number(res.headers.get("X-Map-Z-Min") ?? "0"),
      zMean: Number(res.headers.get("X-Map-Z-Mean") ?? "0"),
      zMax: Number(res.headers.get("X-Map-Z-Max") ?? "0"),
      pointCount: Number(res.headers.get("X-Map-Point-Count") ?? "0"),
    };
    return { blobUrl: URL.createObjectURL(blob), meta };
  },
  getVersion: async (): Promise<MapVersionResponse> => {
    const res = await fetch(`${BASE}/map-version`);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as MapVersionResponse;
  },
  updateMap: async (): Promise<MapUpdateResponse> => {
    const res = await fetch(`${BASE}/map/update`, { method: "POST" });
    if (!res.ok) throw await toError(res);
    const raw = await res.json();
    return keysToCamel(raw) as MapUpdateResponse;
  },
};

async function toError(res: Response): Promise<ApiError> {
  let payload: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
  } else {
    payload = await res.text();
  }
  const msg =
    payload && typeof payload === "object" && payload !== null && "detail" in payload
      ? String((payload as { detail: unknown }).detail)
      : `HTTP ${res.status}`;
  return new ApiError(res.status, payload, msg);
}
