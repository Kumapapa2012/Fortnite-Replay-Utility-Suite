/**
 * Minimal fetch wrapper.
 *
 * - Base URL is empty in dev (Vite proxy forwards /api/* to Gateway on :8080)
 *   and should be the Gateway's own origin in prod.
 * - Converts response bodies snake_case -> camelCase and request bodies
 *   camelCase -> snake_case. Existing .NET endpoints already use camelCase,
 *   so the round-trip is effectively a no-op for them.
 */
import { keysToCamel, keysToSnake } from "./caseConvert";

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
    message?: string,
  ) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  /** When true, request/response bodies are passed through verbatim (no key-case conversion).
   *  Use for the legacy .NET replay_parser which already speaks camelCase both ways. */
  raw?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  opts: ApiOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.raw ? init.json : keysToSnake(init.json));
  }

  const res = await fetch(path, { ...init, headers, body });
  const ct = res.headers.get("content-type") ?? "";

  let payload: unknown = null;
  if (ct.includes("application/json")) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, payload, message);
  }

  if (!ct.includes("application/json")) return payload as T;
  return (opts.raw ? payload : keysToCamel(payload)) as T;
}

export const api = {
  get: <T>(path: string, opts?: ApiOptions) =>
    request<T>(path, { method: "GET" }, opts),
  post: <T>(path: string, json?: unknown, opts?: ApiOptions) =>
    request<T>(path, { method: "POST", json }, opts),
  put: <T>(path: string, json?: unknown, opts?: ApiOptions) =>
    request<T>(path, { method: "PUT", json }, opts),
  del: <T>(path: string, opts?: ApiOptions) =>
    request<T>(path, { method: "DELETE" }, opts),
};
