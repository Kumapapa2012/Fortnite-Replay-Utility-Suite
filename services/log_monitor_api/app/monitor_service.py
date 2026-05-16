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


_OBS_WATCHDOG_INTERVAL = 10.0  # seconds between OBS health checks


class LogMonitorService:
    """Singleton-ish wrapper around FortniteLogMonitor.

    Methods are safe to call from the FastAPI request thread; heavy work runs
    inside the worker thread.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._obs_watchdog_thread: Optional[threading.Thread] = None
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

            # ログファイルが未検出でも起動を継続する。
            # watch() の外側ループがファイルの出現を待機する。
            log_path = flm.find_fortnite_log() or flm._default_log_path()

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
                # 接続失敗時も OBSController インスタンスは保持しておく（watchdog が使う）
                if self._obs is None:
                    self._obs = obs

            self._callbacks = flm.EventCallbacks(
                obs=self._obs if obs_connected else None,
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
                    if ev.event_id == "replay_writing" and ev.extra:
                        self._maybe_update_demos_dir(ev.extra)

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

            if obs_enabled and self._obs is not None:
                self._obs_watchdog_thread = threading.Thread(
                    target=self._obs_watchdog_loop, daemon=True
                )
                self._obs_watchdog_thread.start()

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
            if self._obs_watchdog_thread is not None and self._obs_watchdog_thread.is_alive():
                self._obs_watchdog_thread.join(timeout=2.0)
            self._thread = None
            self._obs_watchdog_thread = None
            self._monitor = None
            self._callbacks = None
            self._obs = None
            self._state.status.running = False
            self._state.status.phase = "idle"
            self._state.status.obs_connected = False
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
            self._push_system_event("scan_error", f"既存ログスキャン失敗: {e}", params={"error": str(e)})
        try:
            self._monitor.watch(poll_interval=0.5)
        except Exception as e:
            self._push_system_event("watch_error", f"監視ループ異常終了: {e}", params={"error": str(e)})
        finally:
            self._state.status.running = False

    def _obs_watchdog_loop(self) -> None:
        """OBS の死活を定期確認し、切断時は自動再接続を試みる。"""
        import logging
        log = logging.getLogger("log_monitor_api")

        while self._state.status.running:
            time.sleep(_OBS_WATCHDOG_INTERVAL)

            if not self._state.status.running:
                break

            obs = self._obs
            if obs is None:
                continue

            if obs.is_connected():
                # 接続中: 状態を正として記録
                if not self._state.status.obs_connected:
                    self._state.status.obs_connected = True
                    self._state.status.obs_error = None
                    self._push_system_event("obs_connected", "OBS 接続を確認")
                    self._broadcast_state()
                continue

            # 切断検知
            if self._state.status.obs_connected:
                self._state.status.obs_connected = False
                self._push_system_event("obs_reconnecting", "OBS 切断を検知。再接続を試みます...")
                self._broadcast_state()
                log.warning("OBS disconnected, attempting reconnect")

            success = obs.reconnect()
            if success:
                self._state.status.obs_connected = True
                self._state.status.obs_error = None
                # callbacks に OBS を紐付け直す
                if self._callbacks is not None:
                    self._callbacks.obs = obs
                self._push_system_event("obs_connected", "OBS に再接続しました")
                self._broadcast_state()
                log.info("OBS reconnected successfully")
            else:
                self._state.status.obs_error = f"OBS 再接続失敗 ({obs.host}:{obs.port})"
                log.debug("OBS reconnect failed, will retry in %ss", _OBS_WATCHDOG_INTERVAL)

    def _maybe_update_demos_dir(self, replay_dir: str) -> None:
        """replay_writing 検出時に replays.dir が未設定なら自動設定する。"""
        import logging
        from _common import global_config
        log = logging.getLogger("log_monitor_api")
        try:
            cfg = global_config.load()
            current = ((cfg.get("replays") or {}).get("dir") or "").strip()
            if current:
                return
            cfg.setdefault("replays", {})["dir"] = replay_dir
            global_config.save(cfg)
            self._push_system_event("demos_dir_updated", f"demos_dir を自動設定: {replay_dir}", params={"dir": replay_dir})
            log.info("demos_dir auto-set to %s", replay_dir)
        except Exception as e:
            log.warning("demos_dir auto-update failed: %s", e)

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

    def _push_system_event(self, kind: str, message: str, params: dict | None = None) -> None:
        payload: dict = {"type": "system", "kind": kind, "message": message, "detected_at": time.strftime("%H:%M:%S")}
        if params:
            payload["params"] = params
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
        """Full post-match automation: summarize replay + trim video + map kill offsets."""
        import logging
        from datetime import datetime, timezone, timedelta
        from pathlib import Path as _Path

        log = logging.getLogger("log_monitor_api")
        has_won = self._check_has_won()

        # Wait for OBS to finish writing the replay buffer file to disk.
        await asyncio.sleep(5.0)

        self._push_system_event("post_match_started", "自動処理開始...")

        _PREPARE_UPLOAD_BASE = f"http://127.0.0.1:{SERVICE_PORTS['prepare_upload_api']}"
        JST = timezone(timedelta(hours=9))

        try:
            # ── Step 1: Refresh suite_core match cache ────────────────────────
            self._push_system_event("post_match_refresh", "マッチリスト更新中...")
            try:
                async with httpx.AsyncClient(timeout=30.0) as c:
                    await c.post(f"{_SUITE_CORE_BASE}/api/matches/refresh")
            except Exception as e:
                log.warning("refresh failed: %s", e)

            # ── Step 2: Get latest match ──────────────────────────────────────
            async with httpx.AsyncClient(timeout=30.0) as c:
                r = await c.get(f"{_SUITE_CORE_BASE}/api/matches?limit=1")
            if r.status_code != 200:
                self._push_system_event("post_match_fetch_error", f"マッチ取得失敗: HTTP {r.status_code}", params={"code": r.status_code})
                return

            matches = r.json().get("matches", [])
            if not matches:
                self._push_system_event("post_match_no_match", "マッチが見つかりません")
                return

            latest = matches[0]
            match_id: str = latest["id"]
            has_video: bool = bool(latest.get("has_video"))

            # ── Step 3: Summarize (replay → kill times + win/loss) ────────────
            self._push_system_event("post_match_analyzing", f"リプレイ解析中... ({match_id})", params={"matchId": match_id})
            async with httpx.AsyncClient(timeout=120.0) as c:
                r = await c.post(
                    f"{_SUITE_CORE_BASE}/api/matches/{match_id}/summarize",
                    json={"hasWon": has_won},
                )
            result_key = "win" if has_won else "loss"
            result_label = "Victory Royale" if has_won else "敗北"
            kills = 0
            if r.status_code == 200:
                d = r.json()
                kills = d.get("killCount", 0)
                mr = d.get("matchResult")
                if mr:
                    result_key = mr if mr in ("win", "loss") else ("win" if mr == "win" else "loss")
                    result_label = "Victory Royale" if mr == "win" else "敗北"
                log.info("summarize: %s result=%s kills=%d", match_id, mr, kills)
            else:
                log.warning("summarize failed: %s %s", r.status_code, r.text[:200])

            # ── Step 4: Trim video ────────────────────────────────────────────
            trimmed_path: str | None = None
            trim_start_sec: float | None = None

            if has_video:
                video = latest.get("video") or {}
                vpath = video.get("path", "")
                vmtime_str = video.get("mtime", "")
                vduration = video.get("duration_sec")

                if vpath and vmtime_str and vduration:
                    try:
                        match_started = datetime.fromisoformat(latest["match_started_at"])
                        video_mtime = datetime.fromisoformat(vmtime_str)
                        if match_started.tzinfo is None:
                            match_started = match_started.replace(tzinfo=JST)
                        if video_mtime.tzinfo is None:
                            video_mtime = video_mtime.replace(tzinfo=JST)

                        recording_started = video_mtime - timedelta(seconds=float(vduration))
                        offset = (match_started - recording_started).total_seconds()

                        if 0.0 <= offset < float(vduration):
                            self._push_system_event(
                                "post_match_trimming",
                                f"動画トリミング中... (開始 {offset:.0f}s / 全体 {vduration:.0f}s)",
                                params={"offset": round(offset), "total": round(float(vduration))},
                            )
                            # Store trimmed video in _trimmed/ subdirectory to
                            # exclude it from suite_core's iterdir() video scan.
                            p = _Path(vpath)
                            out_path = str(p.parent / "_trimmed" / f"{p.stem}_trimmed{p.suffix}")
                            async with httpx.AsyncClient(timeout=600.0) as c:
                                r = await c.post(
                                    f"{_PREPARE_UPLOAD_BASE}/api/trim",
                                    json={
                                        "videoPath": vpath,
                                        "startOffsetSec": offset,
                                        "outputPath": out_path,
                                    },
                                )
                            if r.status_code == 200:
                                rd = r.json()
                                trimmed_path = rd["outputPath"]
                                trim_start_sec = rd.get("actualStartOffsetSec", offset)
                                log.info("trim done: %s (requested=%.3fs actual=%.3fs)", trimmed_path, offset, trim_start_sec)
                            else:
                                log.warning("trim failed: %s %s", r.status_code, r.text[:300])
                                self._push_system_event(
                                    "post_match_trim_http_error", f"トリム失敗: HTTP {r.status_code}",
                                    params={"code": r.status_code},
                                )
                        else:
                            log.warning("trim offset out of range: %.1f / %.1f", offset, vduration)
                            self._push_system_event(
                                "post_match_trim_offset_error", f"トリムオフセット異常: {offset:.1f}s",
                                params={"offset": f"{offset:.1f}"},
                            )
                    except Exception as e:
                        log.warning("trim error: %s", e)
                        self._push_system_event("post_match_trim_error", f"トリムエラー: {e}", params={"error": str(e)})

            # ── Step 5: Record trim info in sidecar ───────────────────────────
            if trimmed_path is not None and trim_start_sec is not None:
                self._push_system_event("post_match_saving_trim", "トリム情報を保存中...")
                try:
                    async with httpx.AsyncClient(timeout=30.0) as c:
                        await c.patch(
                            f"{_SUITE_CORE_BASE}/api/matches/{match_id}/state",
                            json={
                                "trimmedVideoPath": trimmed_path,
                                "trimStartOffsetSec": trim_start_sec,
                            },
                        )
                except Exception as e:
                    log.warning("state patch error: %s", e)

                # ── Step 6: Map kill times → video offsets ────────────────────
                self._push_system_event("post_match_mapping_kills", "キル位置を動画にマッピング中...")
                try:
                    async with httpx.AsyncClient(timeout=180.0) as c:
                        r = await c.post(
                            f"{_SUITE_CORE_BASE}/api/matches/{match_id}/compute-kills",
                        )
                    if r.status_code == 200:
                        kd = r.json()
                        log.info("compute-kills done: %d offsets", kd.get("killCount", 0))
                    else:
                        log.warning("compute-kills failed: %s %s", r.status_code, r.text[:200])
                except Exception as e:
                    log.warning("compute-kills error: %s", e)

            # ── Final event ───────────────────────────────────────────────────
            if not has_video:
                trim_key = "no_video"
                trim_note = " / 動画なし"
            elif trimmed_path:
                trim_key = "trim_done"
                trim_note = " / トリム完了"
            else:
                trim_key = "trim_failed"
                trim_note = " / トリム失敗"
            self._push_system_event(
                "post_match_automation",
                f"自動処理完了: {result_label} / {kills} kills{trim_note} ({match_id})",
                params={"result": result_key, "kills": kills, "trim": trim_key, "matchId": match_id},
            )
            log.info(
                "post_match_automation done: %s result=%s kills=%d trimmed=%s",
                match_id, result_label, kills, bool(trimmed_path),
            )

        except Exception as e:
            log.warning("post_match_automation error: %s", e)
            self._push_system_event("post_match_error", f"自動処理エラー: {type(e).__name__}: {e}", params={"error": f"{type(e).__name__}: {e}"})

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
