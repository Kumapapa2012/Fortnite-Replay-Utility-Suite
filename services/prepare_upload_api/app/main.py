"""FastAPI app for the prepare_upload service.

Endpoints:
- GET  /health                        liveness
- GET  /api/health                    ffmpeg/ffprobe availability
- GET  /api/videos                    list mp4s in OBS recordings dir
- GET  /api/thumbnail?path=...        JPEG first frame (or frame at offset)
- POST /api/candidates                replay × video → kill offsets
- POST /api/keyframes                 I-frame list around an offset
- POST /api/trim                      ffmpeg copy-cut to upload.mp4

Talks to replay_parser (/api/replay-to-json) for kill-time computation.

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8002
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timedelta
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

from _common import global_config  # noqa: E402
from _common.logging_setup import setup_logging  # noqa: E402
from _common.ports import SERVICE_PORTS  # noqa: E402

from .candidates import (  # noqa: E402
    JST,
    build_candidates,
    parse_filename_timestamp,
    replay_meta,
    video_meta,
)
from .ffmpeg_tools import (  # noqa: E402
    ToolStatus,
    detect_tools,
    extract_thumbnail,
    find_keyframes,
    probe_duration,
    seconds_to_hms,
    trim_copy,
)

setup_logging("prepare_upload_api")
log = logging.getLogger("prepare_upload_api")

REPLAY_PARSER_BASE = f"http://127.0.0.1:{SERVICE_PORTS['replay_parser']}"

app = FastAPI(title="Fortnite Prepare Upload API", version="0.1.0")
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
_tools: dict[str, ToolStatus] = {}


class CandidatesBody(BaseModel):
    video_path: str = Field(..., alias="videoPath")
    replay_path: str = Field(..., alias="replayPath")
    model_config = {"populate_by_name": True}


class KeyframesBody(BaseModel):
    video_path: str = Field(..., alias="videoPath")
    around_offset_sec: float = Field(..., alias="aroundOffsetSec")
    range_sec: float = Field(10.0, alias="rangeSec")
    model_config = {"populate_by_name": True}


class TrimBody(BaseModel):
    video_path: str = Field(..., alias="videoPath")
    start_offset_sec: float = Field(..., alias="startOffsetSec")
    output_path: str | None = Field(None, alias="outputPath")
    model_config = {"populate_by_name": True}


class VideosForReplayBody(BaseModel):
    replay_path: str = Field(..., alias="replayPath")
    model_config = {"populate_by_name": True}


@app.on_event("startup")
async def _startup() -> None:
    global _client, _tools
    _client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=None)
    )
    _tools = detect_tools()
    ff = _tools["ffmpeg"]
    fp = _tools["ffprobe"]
    log.info(
        "prepare_upload_api started — ffmpeg=%s (%s) ffprobe=%s (%s)",
        ff.available, ff.version, fp.available, fp.version,
    )


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "prepare_upload_api", "ts": time.time()}


@app.get("/api/health")
async def api_health() -> dict:
    def _dump(t: ToolStatus) -> dict:
        return {"available": t.available, "version": t.version, "path": t.path}
    return {k: _dump(v) for k, v in _tools.items()}


def _require_tools() -> tuple[str, str]:
    ff = _tools.get("ffmpeg")
    fp = _tools.get("ffprobe")
    if not (ff and ff.available and ff.path and fp and fp.available and fp.path):
        raise HTTPException(
            status_code=503,
            detail="ffmpeg / ffprobe が見つかりません。PATH を確認してください。",
        )
    return ff.path, fp.path


def _recordings_dir() -> Path | None:
    """Resolve OBS recordings directory. Config first, else %USERPROFILE%/Videos."""
    cfg = global_config.load()
    raw = (cfg.get("obs") or {}).get("recordings_dir") or ""
    if raw:
        p = Path(raw).expanduser()
        if p.is_dir():
            return p
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    fallback = Path(home) / "Videos"
    return fallback if fallback.is_dir() else None


def _validate_under(path: str, allowed_roots: list[Path]) -> Path:
    """Reject paths outside every allowed root. Returns the resolved path."""
    resolved = Path(path).resolve()
    for root in allowed_roots:
        try:
            resolved.relative_to(root.resolve())
            return resolved
        except ValueError:
            continue
    raise HTTPException(
        status_code=400,
        detail=f"許可されていないパスです: {path}",
    )


def _replays_root() -> Path | None:
    cfg = global_config.load()
    raw = (cfg.get("replays") or {}).get("dir") or ""
    return Path(raw).expanduser() if raw else None


@app.get("/api/videos")
async def list_videos() -> dict:
    root = _recordings_dir()
    if root is None:
        raise HTTPException(
            status_code=404,
            detail="録画フォルダが見つかりません。obs.recordings_dir を設定してください。",
        )
    exts = {".mp4", ".mkv", ".mov"}
    items: list[dict] = []
    for entry in root.iterdir():
        if not entry.is_file() or entry.suffix.lower() not in exts:
            continue
        st = entry.stat()
        items.append({
            "path": str(entry),
            "name": entry.name,
            "sizeBytes": st.st_size,
            "mtime": st.st_mtime,
        })
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return {"recordingsDir": str(root), "videos": items}


@app.get("/api/thumbnail")
async def thumbnail(
    path: str = Query(..., description="Absolute video path (under recordings_dir)"),
    offset_sec: float = Query(0.0, alias="offsetSec", ge=0.0),
) -> Response:
    ffmpeg, _ = _require_tools()
    root = _recordings_dir()
    if root is None:
        raise HTTPException(status_code=404, detail="録画フォルダが見つかりません。")
    resolved = _validate_under(path, [root])
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="動画ファイルが見つかりません。")
    try:
        jpeg = await asyncio.to_thread(extract_thumbnail, ffmpeg, str(resolved), offset_sec)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return Response(content=jpeg, media_type="image/jpeg")


async def _fetch_replay_json(replay_path: str) -> dict:
    assert _client is not None
    try:
        r = await _client.post(
            f"{REPLAY_PARSER_BASE}/api/replay-to-json",
            json={"replayPath": replay_path},
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"replay_parser 接続失敗: {e}")
    if r.status_code != 200:
        detail: str
        try:
            detail = r.json().get("error", r.text)
        except Exception:
            detail = r.text or f"HTTP {r.status_code}"
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()


@app.post("/api/videos-for-replay")
async def videos_for_replay(body: VideosForReplayBody) -> dict:
    """Filter the recordings directory down to videos that *could* contain the replay's match.

    Filter rules (user-specified):
      1. Reject if any of {filename timestamp, mtime, ctime} is before match_end
         (i.e. the video cannot extend through the end of the match).
      2. If match_length > OBS replay-buffer length, STOP — no single replay-buffer
         video can cover the match, so the duration filter would drop everything.
         Skip rule 3 and keep any video that survives rule 1.
      3. Otherwise (match fits within the buffer window): reject if
         match_end - video_duration > match_start  ⇔  duration < match_length.
    """
    _, ffprobe = _require_tools()
    root = _recordings_dir()
    if root is None:
        raise HTTPException(
            status_code=404,
            detail="録画フォルダが見つかりません。obs.recordings_dir を設定してください。",
        )
    cfg = global_config.load()
    try:
        replay_buffer_sec = float((cfg.get("obs") or {}).get("replay_buffer_sec") or 1500)
    except (TypeError, ValueError):
        replay_buffer_sec = 1500.0

    # --- Resolve match window from the replay.
    replay = await _fetch_replay_json(body.replay_path)
    try:
        rmeta = replay_meta(body.replay_path, replay)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    match_start = rmeta.match_started_at
    match_length = rmeta.match_length_sec
    match_end = match_start + timedelta(seconds=match_length)
    apply_duration_rule = match_length <= replay_buffer_sec

    # --- Enumerate candidate video files.
    exts = {".mp4", ".mkv", ".mov"}
    kept: list[dict] = []
    rejected: list[dict] = []

    for entry in root.iterdir():
        if not entry.is_file() or entry.suffix.lower() not in exts:
            continue
        st = entry.stat()
        mtime = datetime.fromtimestamp(st.st_mtime, tz=JST)
        ctime = datetime.fromtimestamp(st.st_ctime, tz=JST)
        filename_ts = parse_filename_timestamp(entry.name)

        reasons: list[str] = []
        # Rule 1: any of filename/mtime/ctime before match_end → reject.
        if filename_ts is not None and filename_ts < match_end:
            reasons.append(f"filename_ts {filename_ts.strftime('%H:%M:%S')} < match_end")
        if mtime < match_end:
            reasons.append(f"mtime {mtime.strftime('%H:%M:%S')} < match_end")
        if ctime < match_end:
            reasons.append(f"ctime {ctime.strftime('%H:%M:%S')} < match_end")

        # Probe duration (for display and optionally for rule 3) only if rule 1 passed.
        duration: float | None = None
        if not reasons:
            try:
                duration = await asyncio.to_thread(probe_duration, ffprobe, str(entry))
            except Exception as e:
                reasons.append(f"ffprobe 失敗: {e}")
            else:
                # Rule 3: apply only when the match fits within the replay buffer.
                if apply_duration_rule and (match_end - timedelta(seconds=duration)) > match_start:
                    reasons.append(
                        f"duration {duration:.1f}s < match_length {match_length:.1f}s"
                    )

        row = {
            "path": str(entry),
            "name": entry.name,
            "sizeBytes": st.st_size,
            "mtime": st.st_mtime,
            "ctime": st.st_ctime,
            "filenameTs": filename_ts.isoformat() if filename_ts else None,
            "durationSec": round(duration, 3) if duration is not None else None,
        }
        if reasons:
            rejected.append({**row, "reasons": reasons})
        else:
            kept.append(row)

    # Newest first within the kept list.
    kept.sort(key=lambda x: x["mtime"], reverse=True)

    return {
        "recordingsDir": str(root),
        "replayPath": body.replay_path,
        "matchStartedAt": match_start.isoformat(),
        "matchEndAt": match_end.isoformat(),
        "matchLengthSec": round(match_length, 3),
        "replayBufferSec": replay_buffer_sec,
        "durationRuleApplied": apply_duration_rule,
        "videos": kept,
        "rejected": rejected,
    }


@app.post("/api/candidates")
async def candidates(body: CandidatesBody) -> dict:
    _, ffprobe = _require_tools()
    roots = [r for r in (_recordings_dir(), _replays_root()) if r]
    if not roots:
        raise HTTPException(status_code=503, detail="録画/リプレイのルートが未設定です。")

    video = _validate_under(body.video_path, [r for r in [_recordings_dir()] if r] or roots)
    if not video.is_file():
        raise HTTPException(status_code=404, detail=f"動画が見つかりません: {body.video_path}")

    try:
        duration = await asyncio.to_thread(probe_duration, ffprobe, str(video))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ffprobe 失敗: {e}")

    vmeta = video_meta(str(video), duration)
    replay = await _fetch_replay_json(body.replay_path)
    try:
        rmeta = replay_meta(body.replay_path, replay)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    # Filter eliminations to those involving the configured user, if set.
    # (The legacy key is player.epic_display_name — see suite_core.config_store.)
    cfg = global_config.load()
    user_player_id = ((cfg.get("player") or {}).get("epic_display_name") or "").strip() or None
    cands = build_candidates(vmeta, replay, rmeta, user_player_id=user_player_id)

    return {
        "video": {
            "path": vmeta.path,
            "durationSec": round(vmeta.duration_sec, 3),
            "mtime": vmeta.mtime.isoformat(),
            "recordingStartedAt": vmeta.recording_started_at.isoformat(),
        },
        "replay": {
            "path": rmeta.path,
            "matchStartedAt": rmeta.match_started_at.isoformat(),
            "matchLengthSec": round(rmeta.match_length_sec, 3),
        },
        "candidates": cands,
    }


@app.post("/api/keyframes")
async def keyframes(body: KeyframesBody) -> dict:
    _, ffprobe = _require_tools()
    root = _recordings_dir()
    if root is None:
        raise HTTPException(status_code=404, detail="録画フォルダが見つかりません。")
    video = _validate_under(body.video_path, [root])
    if not video.is_file():
        raise HTTPException(status_code=404, detail="動画が見つかりません。")
    if body.range_sec <= 0 or body.range_sec > 120:
        raise HTTPException(status_code=400, detail="rangeSec は 0-120 秒で指定してください。")

    try:
        frames = await asyncio.to_thread(
            find_keyframes, ffprobe, str(video), body.around_offset_sec, body.range_sec
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ffprobe 失敗: {e}")

    return {
        "videoPath": str(video),
        "searchRange": {
            "startSec": body.around_offset_sec,
            "endSec": body.around_offset_sec + body.range_sec,
        },
        "keyframes": [{"offsetSec": t, "hms": seconds_to_hms(t)} for t in frames],
    }


@app.post("/api/trim")
async def trim(body: TrimBody) -> dict:
    ffmpeg, ffprobe = _require_tools()
    root = _recordings_dir()
    if root is None:
        raise HTTPException(status_code=404, detail="録画フォルダが見つかりません。")
    video = _validate_under(body.video_path, [root])
    if not video.is_file():
        raise HTTPException(status_code=404, detail="動画が見つかりません。")

    try:
        duration = await asyncio.to_thread(probe_duration, ffprobe, str(video))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ffprobe 失敗: {e}")
    if body.start_offset_sec < 0 or body.start_offset_sec >= duration:
        raise HTTPException(
            status_code=400,
            detail=f"startOffsetSec は 0 以上 duration({duration:.2f}) 未満で指定してください。",
        )

    out_path = Path(body.output_path) if body.output_path else video.parent / "upload.mp4"
    _validate_under(str(out_path.parent), [root])  # output must land under recordings root

    r = await asyncio.to_thread(trim_copy, ffmpeg, str(video), body.start_offset_sec, str(out_path))
    if r.returncode != 0 or not out_path.exists():
        stderr = (r.stderr or "").strip()[-800:]
        raise HTTPException(status_code=422, detail=f"ffmpeg 失敗: {stderr}")

    try:
        out_duration = await asyncio.to_thread(probe_duration, ffprobe, str(out_path))
    except Exception:
        out_duration = max(0.0, duration - body.start_offset_sec)

    return {
        "outputPath": str(out_path),
        "sizeBytes": out_path.stat().st_size,
        "durationSec": round(out_duration, 3),
        "ffmpegReturncode": r.returncode,
    }
