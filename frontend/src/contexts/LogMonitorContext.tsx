/**
 * Context holding a live SSE connection to /api/log-monitor/events.
 *
 * Mounted at the root so pages (Dashboard, Matches) share one stream.
 * Also exposes start/stop mutations that invalidate the snapshot after.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { keysToCamel } from "../lib/caseConvert";
import {
  logMonitorApi,
  type MonitorStatus,
  type SnapshotResponse,
  type StreamedEvent,
} from "../lib/logMonitor";

type ConnectionState = "connecting" | "open" | "closed";

interface LogMonitorContextValue {
  status: MonitorStatus | null;
  events: StreamedEvent[];
  connection: ConnectionState;
  start: (enableObs?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  busy: boolean;
  lastError: string | null;
}

const Ctx = createContext<LogMonitorContextValue | null>(null);

const DEFAULT_STATUS: MonitorStatus = {
  running: false,
  phase: "idle",
  matchCount: 0,
  logPath: null,
  obsEnabled: false,
  obsConnected: false,
  obsError: null,
  startedAt: null,
  lastEvent: null,
};

const MAX_EVENTS = 200;

export function LogMonitorProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [events, setEvents] = useState<StreamedEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let retry = 0;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setConnection("connecting");
      const es = new EventSource(logMonitorApi.eventsUrl);
      esRef.current = es;

      es.onopen = () => {
        retry = 0;
        setConnection("open");
      };
      es.onmessage = (e) => {
        try {
          const raw = JSON.parse(e.data);
          const msg = keysToCamel(raw) as Record<string, unknown>;
          if (msg.type === "snapshot") {
            const snap = msg as unknown as SnapshotResponse & { type: string };
            setStatus(snap.status);
            setEvents(snap.recentEvents ?? []);
          } else if (msg.type === "event" || msg.type === "system") {
            const ev = msg as unknown as StreamedEvent;
            setEvents((prev) => {
              const next = [...prev, ev];
              return next.length > MAX_EVENTS
                ? next.slice(next.length - MAX_EVENTS)
                : next;
            });
            if (ev.type === "event") {
              setStatus((s) => (s ? { ...s, lastEvent: ev, phase: ev.phase } : s));
            }
          }
        } catch {
          // ignore malformed frames
        }
      };
      es.onerror = () => {
        setConnection("closed");
        es.close();
        esRef.current = null;
        if (cancelled) return;
        retry = Math.min(retry + 1, 5);
        const delay = Math.min(1000 * 2 ** retry, 15_000);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (esRef.current) esRef.current.close();
      esRef.current = null;
    };
  }, []);

  const start = async (enableObs = true) => {
    setBusy(true);
    setLastError(null);
    try {
      const snap = await logMonitorApi.start(enableObs);
      setStatus(snap.status);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setLastError(null);
    try {
      const snap = await logMonitorApi.stop();
      setStatus(snap.status);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo<LogMonitorContextValue>(
    () => ({
      status: status ?? DEFAULT_STATUS,
      events,
      connection,
      start,
      stop,
      busy,
      lastError,
    }),
    [status, events, connection, busy, lastError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLogMonitor(): LogMonitorContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLogMonitor must be used inside LogMonitorProvider");
  return v;
}
