"""FastAPI app for the map rendering service.

Exposes:
- GET  /health                             liveness
- GET  /api/players?replay_path=...        dropdown list from a replay
- POST /api/render  {replayPath,playerId}  PNG bytes with Z-colored route

Pulls the source-of-truth replay JSON from the Replay Parser's /api/replay-to-json
endpoint, so we no longer need the bundled ReplayToJson.exe.

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8001
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

_HERE = Path(__file__).resolve().parent
_SERVICE_DIR = _HERE.parent
_SERVICES_DIR = _SERVICE_DIR.parent

if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

from _common.logging_setup import setup_logging  # noqa: E402
from _common.ports import SERVICE_PORTS  # noqa: E402

from .renderer import extract_player_list, render_route  # noqa: E402

setup_logging("map_api")
log = logging.getLogger("map_api")

REPLAY_PARSER_BASE = f"http://127.0.0.1:{SERVICE_PORTS['replay_parser']}"
ASSETS_DIR = _SERVICE_DIR  # base_params.json + map_tool/ live at the service root
BASE_PARAMS_PATH = ASSETS_DIR / "base_params.json"
MAP_TOOL_DIR = ASSETS_DIR / "map_tool"
MAP_TOOL_SCRIPT = MAP_TOOL_DIR / "download_and_combine.js"
MAP_VERSION_FILE = MAP_TOOL_DIR / ".map_version"
MAP_UPDATE_TIMEOUT_SEC = 120.0

app = FastAPI(title="Fortnite Map API", version="0.1.0")
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
_base_params: dict | None = None
_map_update_lock = asyncio.Lock()


class RenderBody(BaseModel):
    replay_path: str = Field(..., alias="replayPath")
    player_id: str = Field(..., alias="playerId")

    model_config = {"populate_by_name": True}


def _read_map_version() -> str | None:
    try:
        return MAP_VERSION_FILE.read_text(encoding="utf-8").strip() or None
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _run_map_update_sync(timeout: float) -> dict:
    """Invoke node download_and_combine.js. Returns a result dict.

    Never raises — failures surface as {"ok": False, "error": ...} so the
    caller can decide whether to 503 (endpoint) or just log (startup).
    """
    node = shutil.which("node")
    if node is None:
        return {"ok": False, "error": "node.exe が PATH に見つかりません。Node.js 20+ をインストールしてください。"}
    if not MAP_TOOL_SCRIPT.exists():
        return {"ok": False, "error": f"スクリプトが見つかりません: {MAP_TOOL_SCRIPT}"}

    prev = _read_map_version()
    try:
        proc = subprocess.run(
            [node, str(MAP_TOOL_SCRIPT)],
            cwd=str(MAP_TOOL_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"スクリプトが {timeout:.0f} 秒を超えても終了しませんでした。"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    current = _read_map_version()
    tail = (proc.stdout or "").splitlines()[-20:]
    ok = proc.returncode == 0
    return {
        "ok": ok,
        "returncode": proc.returncode,
        "prev_version": prev,
        "version": current,
        "updated": ok and prev != current,
        "stdout_tail": tail,
        "stderr": (proc.stderr or "").strip()[-400:] if not ok else "",
    }


async def _run_map_update_async(timeout: float) -> dict:
    """Serialize concurrent updates; offload subprocess to a worker thread."""
    async with _map_update_lock:
        return await asyncio.to_thread(_run_map_update_sync, timeout)


@app.on_event("startup")
async def _startup() -> None:
    global _client, _base_params
    # Parser returns ~100MB JSON for a full match — allow generous timeouts.
    _client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=None))
    try:
        _base_params = json.loads(BASE_PARAMS_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        log.error("failed to load base_params.json: %s", e)
        _base_params = None
    log.info("map_api started (parser base=%s)", REPLAY_PARSER_BASE)

    # Fire-and-forget: refresh combined_map.webp against fortnite.gg.
    # No-op when versions match (~1-2s); full rebuild on mismatch (~20-30s).
    asyncio.create_task(_startup_map_refresh())


async def _startup_map_refresh() -> None:
    try:
        result = await _run_map_update_async(MAP_UPDATE_TIMEOUT_SEC)
    except Exception as e:  # defensive; _run_map_update_async swallows most
        log.warning("map refresh task crashed: %s", e)
        return
    if result["ok"]:
        if result.get("updated"):
            log.info("map updated: %s -> %s", result.get("prev_version"), result.get("version"))
        else:
            log.info("map up-to-date (version=%s)", result.get("version"))
    else:
        log.warning("map refresh skipped: %s", result.get("error"))


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "map_api", "ts": time.time()}


@app.get("/api/map-version")
async def map_version() -> dict:
    return {"version": _read_map_version()}


@app.post("/api/map/update")
async def map_update() -> dict:
    result = await _run_map_update_async(MAP_UPDATE_TIMEOUT_SEC)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result.get("error") or "update failed")
    return {
        "updated": result.get("updated", False),
        "version": result.get("version"),
        "prev_version": result.get("prev_version"),
        "stdout_tail": result.get("stdout_tail", []),
    }


async def _fetch_replay_json(replay_path: str) -> dict:
    assert _client is not None
    try:
        r = await _client.post(
            f"{REPLAY_PARSER_BASE}/api/replay-to-json",
            json={"replayPath": replay_path},
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"replay_parser への接続に失敗: {e}")
    if r.status_code != 200:
        detail: str
        try:
            detail = r.json().get("error", r.text)
        except Exception:
            detail = r.text or f"HTTP {r.status_code}"
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()


@app.get("/api/players")
async def players(replay_path: str = Query(..., alias="replayPath")) -> dict:
    replay = await _fetch_replay_json(replay_path)
    return {"replayPath": replay_path, "players": extract_player_list(replay)}


@app.post("/api/render")
async def render(body: RenderBody) -> Response:
    if _base_params is None:
        raise HTTPException(status_code=500, detail="base_params.json の読込に失敗しています。")
    replay = await _fetch_replay_json(body.replay_path)
    try:
        result = render_route(
            replay, body.player_id, _base_params, assets_dir=ASSETS_DIR
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    headers = {
        "X-Map-Z-Min": f"{result.z_min:.2f}",
        "X-Map-Z-Mean": f"{result.z_mean:.2f}",
        "X-Map-Z-Max": f"{result.z_max:.2f}",
        "X-Map-Point-Count": str(result.point_count),
    }
    return Response(content=result.png, media_type="image/png", headers=headers)
