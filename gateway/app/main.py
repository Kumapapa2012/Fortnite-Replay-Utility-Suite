"""Fortnite Replay Suite - API Gateway (FastAPI).

Phase 0 scaffold: exposes only /health. Upstream routes are added in later
phases per docs/04_gateway_design.md.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# Make services/_common importable when running from repo root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services._common.logging_setup import setup_logging  # noqa: E402
from services._common.ports import SERVICE_PORTS  # noqa: E402

from .proxy import forward  # noqa: E402

log = setup_logging("gateway")

REPLAY_PARSER_BASE = f"http://127.0.0.1:{SERVICE_PORTS['replay_parser']}"
LOG_MONITOR_BASE = f"http://127.0.0.1:{SERVICE_PORTS['log_monitor_api']}"
MAP_API_BASE = f"http://127.0.0.1:{SERVICE_PORTS['map_api']}"
PREPARE_UPLOAD_BASE = f"http://127.0.0.1:{SERVICE_PORTS['prepare_upload_api']}"
SUITE_CORE_BASE = f"http://127.0.0.1:{SERVICE_PORTS['suite_core']}"
# /api/map/render can take 30-90s for large replays — give it headroom.
_LONG_TIMEOUT = httpx.Timeout(connect=5.0, read=180.0, write=30.0, pool=None)
# /api/prepare-upload/trim runs ffmpeg copy-cut; large mp4s can hit several minutes.
_TRIM_TIMEOUT = httpx.Timeout(connect=5.0, read=600.0, write=30.0, pool=None)

# SSE streams: disable read timeout so connections survive long idle periods.
_SSE_TIMEOUT = httpx.Timeout(connect=5.0, read=None, write=30.0, pool=None)

app = FastAPI(title="Fortnite Replay Suite Gateway", version="0.1.0")
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    assert _client is not None, "httpx client not initialized"
    return _client

# Dev only: Vite dev server runs on 5173.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    """Gateway liveness probe. Does not check upstreams - see /health/full."""
    return {"status": "ok", "service": "gateway", "ts": time.time()}


@app.get("/health/full")
async def health_full() -> dict:
    """Aggregated upstream health.

    Queries each upstream /health endpoint with a short timeout and reports
    the collective state. Upstreams that don't yet exist (Phase 0) will show
    as 'down' which is expected.
    """
    upstreams = {k: v for k, v in SERVICE_PORTS.items() if k != "gateway"}
    results: dict[str, dict] = {}

    async with httpx.AsyncClient(timeout=1.5) as client:
        for name, port in upstreams.items():
            url = f"http://127.0.0.1:{port}/health"
            try:
                r = await client.get(url)
                results[name] = {"status": "ok" if r.status_code == 200 else "degraded", "port": port}
            except Exception as e:
                results[name] = {"status": "down", "port": port, "error": type(e).__name__}

    overall = "ok" if all(v["status"] == "ok" for v in results.values()) else "degraded"
    return {"status": overall, "upstreams": results}


# --- Reverse proxy: replay_parser ---
# Frontend hits /api/replay-parser/<...>. Gateway forwards to replay_parser /<...>.
@app.api_route(
    "/api/replay-parser/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_replay_parser(rest: str, request: Request):
    upstream_path = "/" + rest if rest else "/"
    # .NET app exposes /api/... and /health at root; add /api prefix unless already /health.
    if rest.startswith("api/") or rest == "health":
        pass
    else:
        upstream_path = "/api/" + rest
    return await forward(request, REPLAY_PARSER_BASE, upstream_path, client=_get_client())


# --- Reverse proxy: log_monitor_api ---
# Frontend hits /api/log-monitor/<...>. Gateway forwards to log_monitor_api /<...>.
# /events is SSE and needs no read timeout; everything else uses the default.
@app.api_route(
    "/api/log-monitor/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_log_monitor(rest: str, request: Request):
    upstream_path = "/" + rest if rest else "/"
    timeout = _SSE_TIMEOUT if rest == "events" else None
    return await forward(
        request, LOG_MONITOR_BASE, upstream_path, client=_get_client(), timeout=timeout
    )


# --- Reverse proxy: map_api ---
# Frontend hits /api/map/<...>. Gateway forwards to map_api /<...>.
# /render may take ~1 min for large replays; extend the read timeout.
@app.api_route(
    "/api/map/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_map(rest: str, request: Request):
    upstream_path = "/" + rest if rest else "/"
    if rest.startswith("api/") or rest == "health":
        pass
    else:
        upstream_path = "/api/" + rest
    return await forward(
        request, MAP_API_BASE, upstream_path, client=_get_client(), timeout=_LONG_TIMEOUT
    )


# --- Reverse proxy: prepare_upload_api ---
# Frontend hits /api/prepare-upload/<...>. Gateway forwards to prepare_upload_api /<...>.
# /trim / /candidates can be slow (ffprobe + ffmpeg); extend the read timeout.
@app.api_route(
    "/api/prepare-upload/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_prepare_upload(rest: str, request: Request):
    upstream_path = "/" + rest if rest else "/"
    if rest.startswith("api/") or rest == "health":
        pass
    else:
        upstream_path = "/api/" + rest
    timeout = _TRIM_TIMEOUT if rest in {"trim", "api/trim"} else _LONG_TIMEOUT
    return await forward(
        request, PREPARE_UPLOAD_BASE, upstream_path, client=_get_client(), timeout=timeout
    )


# --- Reverse proxy: suite_core ---
# Frontend hits /api/suite/<...>. Gateway forwards to suite_core /<...>.
# /matches can invoke ffprobe on many files during the first cold scan.
@app.api_route(
    "/api/suite/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_suite(rest: str, request: Request):
    upstream_path = "/" + rest if rest else "/"
    if rest.startswith("api/") or rest == "health":
        pass
    else:
        upstream_path = "/api/" + rest
    return await forward(
        request, SUITE_CORE_BASE, upstream_path, client=_get_client(), timeout=_LONG_TIMEOUT
    )


@app.on_event("startup")
async def _startup() -> None:
    global _client
    _client = httpx.AsyncClient(timeout=30.0)
    log.info("gateway starting on port %d", SERVICE_PORTS["gateway"])


@app.on_event("shutdown")
async def _shutdown() -> None:
    log.info("gateway shutting down")
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
