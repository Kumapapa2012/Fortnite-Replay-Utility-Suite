"""FastAPI app for Suite Core — Match Library + global config.

Endpoints:
- GET  /health
- GET  /api/matches                 paired replay+video list (cached)
- GET  /api/matches/{id}            single match with optional replay summary
- POST /api/matches/refresh         re-scan Demos/Videos folders
- GET  /api/config                  global config + OBS discovery source
- PUT  /api/config                  partial-update global config

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8003
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

_HERE = Path(__file__).resolve().parent
_SERVICE_DIR = _HERE.parent
_SERVICES_DIR = _SERVICE_DIR.parent

if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

from _common.logging_setup import setup_logging  # noqa: E402
from _common.ports import SERVICE_PORTS  # noqa: E402

from . import config_store, obs_discovery  # noqa: E402
from .pairing import DurationCache, pair, scan_replays, scan_videos  # noqa: E402

setup_logging("suite_core")
log = logging.getLogger("suite_core")

REPLAY_PARSER_BASE = f"http://127.0.0.1:{SERVICE_PORTS['replay_parser']}"

app = FastAPI(title="Fortnite Suite Core", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:8080", "http://127.0.0.1:8080",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

_client: httpx.AsyncClient | None = None
_ffprobe_path: str | None = None
_obs_source: str | None = None
_duration_cache = DurationCache()
_matches_cache: list[dict[str, Any]] = []
_matches_generated_at: float = 0.0


@app.on_event("startup")
async def _startup() -> None:
    global _client, _ffprobe_path, _obs_source
    _client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=None)
    )
    _ffprobe_path = shutil.which("ffprobe")

    discovered = await asyncio.to_thread(obs_discovery.try_recording_dir)
    if discovered:
        # Persist the discovered dir only if user hasn't set one explicitly.
        from _common import global_config
        cfg = global_config.load()
        obs = cfg.get("obs") or {}
        if not obs.get("recordings_dir"):
            obs["recordings_dir"] = discovered
            cfg["obs"] = obs
            global_config.save(cfg)
            _obs_source = "obs_websocket"
            log.info("OBS WebSocket returned recording dir: %s", discovered)
        else:
            _obs_source = "config_file"
    else:
        _obs_source = None  # load_for_api will fall back to config_file/default

    try:
        await _refresh()
    except Exception as e:
        log.warning("initial match scan failed: %s", e)

    log.info(
        "suite_core started (ffprobe=%s, obs_source=%s, matches=%d)",
        _ffprobe_path, _obs_source, len(_matches_cache),
    )


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "suite_core", "ts": time.time()}


async def _refresh() -> list[dict[str, Any]]:
    """Scan demos + videos folders and rebuild the match cache."""
    global _matches_cache, _matches_generated_at
    cfg = config_store.load_for_api(_obs_source)
    demos = Path(cfg["demos_dir"])
    videos = Path(cfg["obs_recording_dir"])

    replays = await asyncio.to_thread(scan_replays, demos)
    vids = await asyncio.to_thread(scan_videos, videos, _duration_cache, _ffprobe_path)
    _matches_cache = pair(replays, vids)
    _matches_generated_at = time.time()
    return _matches_cache


@app.get("/api/matches")
async def get_matches(
    limit: int = Query(50, ge=1, le=500),
    since: str | None = Query(None, description="ISO 8601 cutoff (include entries ≥ this)"),
) -> dict:
    if not _matches_cache:
        await _refresh()
    items = list(_matches_cache)
    if since:
        items = [m for m in items if m["match_started_at"] >= since]
    items = items[:limit]
    return {
        "count": len(items),
        "totalCount": len(_matches_cache),
        "generatedAt": _matches_generated_at,
        "matches": items,
    }


@app.get("/api/matches/{match_id}")
async def get_match(match_id: str) -> dict:
    if not _matches_cache:
        await _refresh()
    target = next((m for m in _matches_cache if m["id"] == match_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"match not found: {match_id}")

    result = dict(target)
    replay = target.get("replay")
    if replay and _client is not None:
        try:
            r = await _client.post(
                f"{REPLAY_PARSER_BASE}/api/replay-to-json",
                json={"replayPath": replay["path"]},
            )
            if r.status_code == 200:
                data = r.json()
                info = data.get("Info") or {}
                players = data.get("PlayerData") or []
                result["replay_summary"] = {
                    "match_length_sec": (info.get("LengthInMs") or 0) / 1000.0,
                    "human_count": sum(1 for p in players if not p.get("IsBot")),
                    "bot_count": sum(1 for p in players if p.get("IsBot")),
                }
        except Exception as e:
            log.info("replay summary fetch failed for %s: %s", match_id, e)
    return result


@app.post("/api/matches/refresh")
async def refresh_matches() -> dict:
    items = await _refresh()
    return {"count": len(items), "generatedAt": _matches_generated_at}


@app.get("/api/config")
async def get_config() -> dict:
    return config_store.load_for_api(_obs_source)


@app.put("/api/config")
async def put_config(body: dict[str, Any]) -> dict:
    try:
        updated = config_store.save_partial(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Force a rescan on next /api/matches so settings take effect immediately.
    global _matches_cache
    _matches_cache = []
    return updated
