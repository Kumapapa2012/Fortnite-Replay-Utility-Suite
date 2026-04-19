/**
 * snake_case <-> camelCase conversion for API bodies.
 *
 * Applied in the fetcher layer so the rest of the app speaks camelCase.
 * The existing .NET replay_parser already returns camelCase, so conversion
 * is a no-op for that service; newer Python APIs use snake_case and benefit.
 * See docs/03_api_specification.md §1.4 and docs/05_frontend_design.md §6.
 */

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function mapKeys<T>(input: unknown, fn: (k: string) => string): T {
  if (Array.isArray(input)) {
    return input.map((v) => mapKeys(v, fn)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[fn(k)] = mapKeys(v, fn);
    }
    return out as T;
  }
  return input as T;
}

export function keysToCamel<T = unknown>(input: unknown): T {
  return mapKeys<T>(input, snakeToCamel);
}

export function keysToSnake<T = unknown>(input: unknown): T {
  return mapKeys<T>(input, camelToSnake);
}
