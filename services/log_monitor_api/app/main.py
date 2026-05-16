"""FastAPI app for the Fortnite log monitor service.

Exposes:
- GET  /health           liveness
- POST /start            start the monitor (optional body: {enable_obs: bool})
- POST /stop             stop the monitor
- GET  /status           current snapshot (status + recent events ring buffer)
- GET  /events           Server-Sent Events stream of live events

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Make services/_common importable.
_HERE = Path(__file__).resolve().parent
_SERVICES_DIR = _HERE.parent.parent
if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

from _common.logging_setup import setup_logging  # noqa: E402

from .monitor_service import service  # noqa: E402

setup_logging("log_monitor_api")
log = logging.getLogger("log_monitor_api")

app = FastAPI(title="Fortnite Log Monitor API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartBody(BaseModel):
    enable_obs: bool = True


@app.on_event("startup")
async def _on_startup() -> None:
    service.bind_loop(asyncio.get_running_loop())
    log.info("log_monitor_api started")
    try:
        service.start(enable_obs=True)
        log.info("log monitor auto-started on service startup")
    except Exception as e:
        log.warning("log monitor auto-start failed (will retry via /start): %s", e)


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    try:
        service.stop()
    except Exception:
        pass


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "log_monitor_api", "ts": time.time()}


@app.post("/start")
async def start(body: Optional[StartBody] = None) -> dict:
    enable_obs = body.enable_obs if body is not None else True
    try:
        status = service.start(enable_obs=enable_obs)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.snapshot()


@app.post("/stop")
async def stop() -> dict:
    service.stop()
    return service.snapshot()


@app.get("/status")
async def status() -> dict:
    return service.snapshot()


@app.get("/events")
async def events() -> StreamingResponse:
    """SSE stream. Sends the current snapshot immediately, then live events."""
    queue = service.subscribe()

    async def gen():
        try:
            # Prime with current snapshot so late subscribers see state.
            snap = {"type": "snapshot", **service.snapshot()}
            yield f"data: {json.dumps(snap, ensure_ascii=False)}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat comment to keep the connection alive through proxies.
                    yield ": ping\n\n"
        finally:
            service.unsubscribe(queue)

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)
