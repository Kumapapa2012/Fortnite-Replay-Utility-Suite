"""Background service wrapping FortniteLogMonitor for the FastAPI layer.

Design:
- FortniteLogMonitor.watch() is blocking and runs in a daemon thread.
- Events detected in that thread are fan-out to any number of SSE subscriber
  queues via a thread-safe bridge (asyncio.Queue + loop.call_soon_threadsafe).
- /status reflects a snapshot of live state: running, phase, obs_connected,
  match_count, last_event, recent_events (ring buffer).
"""
from __future__ import annotations

import asyncio
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

# Import the existing monitor module (physically copied into this service dir).
import sys

_HERE = Path(__file__).resolve().parent
_SERVICE_DIR = _HERE.parent
_SERVICES_DIR = _HERE.parent.parent  # services/ — gives access to _common
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))
if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

# Load .env for OBS_* before importing the monitor module (the module reads env at call time,
# but we want values visible to OBSController.__init__ below).
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(_SERVICE_DIR / ".env")
except Exception:
    pass

import httpx  # noqa: E402
import fortnite_log_monitor as flm  # noqa: E402

from _common.ports import SERVICE_PORTS  # noqa: E402

RING_BUFFER_SIZE = 100
_SUITE_CORE_BASE = f"http://127.0.0.1:{SERVICE_PORTS['suite_core']}"


@dataclass
class MonitorStatus:
    running: bool = False
    phase: str = "idle"
    match_count: int = 0
    log_path: Optional[str] = None
    obs_enabled: bool = False
    obs_connected: bool = False
    obs_error: Optional[str] = None
    started_at: Optional[float] = None
    last_event: Optional[dict] = None


@dataclass
class ServiceState:
    status: MonitorStatus = field(default_factory=MonitorStatus)
    recent_events: list[dict] = field(default_factory=list)


class LogMonitorService:
    """Singleton-ish wrapper around FortniteLogMonitor.

    Methods are safe to call from the FastAPI request thread; heavy work runs
    inside the worker thread.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._monitor: Optional[flm.FortniteLogMonitor] = None
        self._obs: Optional[flm.OBSController] = None
        self._callbacks: Optional[flm.EventCallbacks] = None
        self._state = ServiceState()
        # SSE subscribers: bound to the FastAPI event loop.
        self._subscribers: list[asyncio.Queue] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ---- lifecycle ----

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once at FastAPI startup so background thread can push events."""
        self._loop = loop

    def start(self, *, enable_obs: bool = True) -> MonitorStatus:
        with self._lock:
            if self._state.status.running:
                return self.status()

            log_path = flm.find_fortnite_log()
            if not log_path:
                raise RuntimeError(
                    "FortniteGame.log が見つかりません。Fortnite を起動済みか確認してください。"
                )

            self._obs = None
            obs_enabled = enable_obs
            obs_error: Optional[str] = None
            obs_connected = False

            if enable_obs:
                host = os.environ.get("OBS_HOST", "localhost")
                port = int(os.environ.get("OBS_PORT", "4455"))
                password = os.environ.get("OBS_PASSWORD", "")
                save_delay = float(os.environ.get("OBS_SAVE_DELAY", "10"))
                obs = flm.OBSController(
                    host=host, port=port, password=password, save_delay=save_delay,
                    post_save_callback=self._make_post_save_callback(),
                )
                if obs.connect():
                    self._obs = obs
                    obs_connected = True
                else:
                    obs_error = f"OBS 接続失敗 ({host}:{port})"

            self._callbacks = flm.EventCallbacks(
                obs=self._obs,
                enable_sound=False,
                discord_webhook=None,
                csv_path=None,
                verbose=False,
            )
            # Inject our SSE fan-out into the callbacks chain.
            original_on_event = self._callbacks.on_event

            def on_event(ev: flm.DetectedEvent) -> None:
                try:
                    original_on_event(ev)
                finally:
                    self._record_and_broadcast(ev)

            self._callbacks.on_event = on_event  # type: ignore[assignment]

            self._monitor = flm.FortniteLogMonitor(log_path, self._callbacks)

            self._state.status = MonitorStatus(
                running=True,
                phase="idle",
                match_count=0,
                log_path=log_path,
                obs_enabled=obs_enabled,
                obs_connected=obs_connected,
                obs_error=obs_error,
                started_at=time.time(),
                last_event=None,
            )
            self._state.recent_events = []

            self._thread = threading.Thread(target=self._watch_loop, daemon=True)
            self._thread.start()
            self._broadcast_state()
            return self.status()

    def stop(self) -> MonitorStatus:
        with self._lock:
            if self._monitor is not None:
                self._monitor.stop()
            if self._callbacks is not None:
                try:
                    self._callbacks.close()
                except Exception:
                    pass
            if self._obs is not None:
                try:
                    self._obs.close()
                except Exception:
                    pass
            if self._thread is not None and self._thread.is_alive():
                self._thread.join(timeout=2.0)
            self._thread = None
            self._monitor = None
            self._callbacks = None
            self._obs = None
            self._state.status.running = False
            self._state.status.phase = "idle"
            self._broadcast_state()
            return self.status()

    def status(self) -> MonitorStatus:
        # Pull live phase from monitor if running.
        if self._monitor is not None and self._state.status.running:
            self._state.status.phase = self._monitor.current_phase
            self._state.status.match_count = self._monitor.match_count
        return self._state.status

    def snapshot(self) -> dict[str, Any]:
        s = self.status()
        return {
            "status": asdict(s),
            "recent_events": list(self._state.recent_events),
        }

    # ---- SSE ----

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    # ---- private ----

    def _watch_loop(self) -> None:
        assert self._monitor is not None
        try:
            self._monitor.scan_existing()
        except Exception as e:  # non-fatal; continue into tail loop
            self._push_system_event("scan_error", f"既存ログスキャン失敗: {e}")
        try:
            self._monitor.watch(poll_interval=0.5)
        except Exception as e:
            self._push_system_event("watch_error", f"監視ループ異常終了: {e}")
        finally:
            self._state.status.running = False

    def _record_and_broadcast(self, ev: flm.DetectedEvent) -> None:
        payload = {
            "type": "event",
            "event_id": ev.event_id,
            "label": ev.label,
            "icon": ev.icon,
            "phase": ev.phase,
            "timestamp": ev.timestamp,
            "detected_at": ev.detected_at,
            "extra": ev.extra,
        }
        self._state.status.last_event = payload
        self._state.recent_events.append(payload)
        if len(self._state.recent_events) > RING_BUFFER_SIZE:
            self._state.recent_events = self._state.recent_events[-RING_BUFFER_SIZE:]
        self._broadcast(payload)

    def _push_system_event(self, kind: str, message: str) -> None:
        payload = {"type": "system", "kind": kind, "message": message, "detected_at": time.strftime("%H:%M:%S")}
        self._state.recent_events.append(payload)
        self._broadcast(payload)

    # ---- post-match automation ----

    def _check_has_won(self) -> bool:
        """Scan recent_events ring buffer to determine if last match was a win."""
        for ev in reversed(self._state.recent_events):
            eid = ev.get("event_id")
            if eid == "victory_royale":
                return True
            if eid == "matchmaking_start":
                return False
        return False

    def _make_post_save_callback(self):
        """Return a sync callback for OBSController.post_save_callback."""
        def callback():
            loop = self._loop
            if loop is not None and loop.is_running():
                asyncio.run_coroutine_threadsafe(self._post_save_automation(), loop)
        return callback

    async def _post_save_automation(self) -> None:
        """Call suite_core post-match-automation after OBS replay buffer save."""
        import logging
        log = logging.getLogger("log_monitor_api")
        has_won = self._check_has_won()
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    f"{_SUITE_CORE_BASE}/api/matches/post-match-automation",
                    json={"hasWon": has_won},
                )
            if r.status_code == 200:
                data = r.json()
                log.info(
                    "post-match automation: matchId=%s result=%s kills=%d",
                    data.get("matchId"), data.get("matchResult"), data.get("killCount", 0),
                )
                self._push_system_event(
                    "post_match_automation",
                    f"自動集計完了: {data.get('matchResult')} / {data.get('killCount', 0)} kills",
                )
            else:
                log.warning("post-match automation HTTP %s: %s", r.status_code, r.text[:300])
        except Exception as e:
            log.warning("post-match automation error: %s", e)

    # ---- broadcast helpers ----

    def _broadcast_state(self) -> None:
        """Push a fresh snapshot to SSE subscribers (e.g. after start/stop)."""
        self._broadcast({"type": "snapshot", **self.snapshot()})

    def _broadcast(self, payload: dict) -> None:
        loop = self._loop
        if loop is None:
            return
        # Copy the list since subscribers can unregister during iteration.
        for q in list(self._subscribers):
            try:
                loop.call_soon_threadsafe(q.put_nowait, payload)
            except Exception:
                # Queue full or loop closed — drop for that subscriber.
                pass


# Process-wide singleton.
service = LogMonitorService()
