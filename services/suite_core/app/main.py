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
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

_HERE = Path(__file__).resolve().parent
_SERVICE_DIR = _HERE.parent
_SERVICES_DIR = _SERVICE_DIR.parent

if str(_SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICES_DIR))

from _common.logging_setup import setup_logging  # noqa: E402
from _common.ports import SERVICE_PORTS  # noqa: E402

from . import config_store, match_state, obs_discovery  # noqa: E402
from .pairing import DurationCache, pair, scan_replays, scan_videos, _match_id  # noqa: E402

setup_logging("suite_core")
log = logging.getLogger("suite_core")

REPLAY_PARSER_BASE = f"http://127.0.0.1:{SERVICE_PORTS['replay_parser']}"
PREPARE_UPLOAD_BASE = f"http://127.0.0.1:{SERVICE_PORTS['prepare_upload_api']}"

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


def _merge_state(m: dict[str, Any]) -> dict[str, Any]:
    """Merge per-match sidecar state into a match dict from pair()."""
    state = match_state.load(m["id"])
    return {
        **m,
        "has_trimmed_video": state["trimmed_video_path"] is not None,
        "trimmed_video_path": state["trimmed_video_path"],
        "trim_start_offset_sec": state["trim_start_offset_sec"],
        "kill_offsets_in_trimmed": state["kill_offsets_in_trimmed"],
        "has_summary": state["has_summary"],
        "has_kill_compilation": state["kill_compilation_path"] is not None,
        "kill_compilation_path": state["kill_compilation_path"],
        "kill_times_in_match": state["kill_times_in_match"],
        "match_result": state["match_result"],
    }


async def _refresh() -> list[dict[str, Any]]:
    """Scan demos + videos folders and rebuild the match cache."""
    global _matches_cache, _matches_generated_at
    cfg = config_store.load_for_api(_obs_source)
    demos = Path(cfg["demos_dir"])
    videos = Path(cfg["obs_recording_dir"])

    replays = await asyncio.to_thread(scan_replays, demos)
    vids = await asyncio.to_thread(scan_videos, videos, _duration_cache, _ffprobe_path)
    raw = pair(replays, vids)
    _matches_cache = [_merge_state(m) for m in raw]
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


class MatchStatePatch(BaseModel):
    trimmed_video_path: str | None = Field(None, alias="trimmedVideoPath")
    trim_start_offset_sec: float | None = Field(None, alias="trimStartOffsetSec")
    # killOffsetsInOriginal → suite_core が trimmed 内オフセットへ変換して保存
    kill_offsets_in_original: list[float] | None = Field(None, alias="killOffsetsInOriginal")
    has_summary: bool | None = Field(None, alias="hasSummary")
    kill_compilation_path: str | None = Field(None, alias="killCompilationPath")
    model_config = {"populate_by_name": True}


@app.patch("/api/matches/{match_id}/state")
async def patch_match_state(match_id: str, body: MatchStatePatch) -> dict:
    """マッチの処理ステータスを更新する（sidecar JSON に永続化）。

    killOffsetsInOriginal が含まれる場合、sidecar の trim_start_offset_sec を使って
    trimmed video 内オフセットへ変換し kill_offsets_in_trimmed として保存する。
    """
    kwargs: dict[str, Any] = {}

    if body.trimmed_video_path is not None:
        kwargs["trimmed_video_path"] = body.trimmed_video_path
    if body.trim_start_offset_sec is not None:
        kwargs["trim_start_offset_sec"] = body.trim_start_offset_sec
    if body.has_summary is not None:
        kwargs["has_summary"] = body.has_summary
    if body.kill_compilation_path is not None:
        kwargs["kill_compilation_path"] = body.kill_compilation_path

    if body.kill_offsets_in_original is not None:
        current = match_state.load(match_id)
        trim_start = (
            body.trim_start_offset_sec
            if body.trim_start_offset_sec is not None
            else current.get("trim_start_offset_sec")
        )
        if trim_start is None:
            raise HTTPException(
                status_code=400,
                detail="trim_start_offset_sec が未設定です。先にトリミング情報を登録してください。",
            )
        kwargs["kill_offsets_in_trimmed"] = [
            round(off - trim_start, 3)
            for off in body.kill_offsets_in_original
            if off - trim_start >= 0.0
        ]

    updated = match_state.update(match_id, **kwargs)

    # キャッシュを無効化して次回 /api/matches で最新状態を返す
    global _matches_cache
    _matches_cache = []

    return {
        "matchId": match_id,
        "state": {
            "hasTrimmedVideo": updated["trimmed_video_path"] is not None,
            "trimmedVideoPath": updated["trimmed_video_path"],
            "trimStartOffsetSec": updated["trim_start_offset_sec"],
            "killOffsetsInTrimmed": updated["kill_offsets_in_trimmed"],
            "hasSummary": updated["has_summary"],
            "hasKillCompilation": updated["kill_compilation_path"] is not None,
            "killCompilationPath": updated["kill_compilation_path"],
        },
    }


@app.post("/api/matches/{match_id}/compute-kills")
async def compute_kills(match_id: str) -> dict:
    """自プレイヤーのキルオフセットをリプレイから計算し sidecar に保存する。

    candidates API を内部呼び出しし、epic_display_name で設定された
    自プレイヤーのキル（killIndex あり）のみを抽出する。
    user_player_id (epic_display_name) が未設定の場合はエラーを返す。
    trimming が完了していない（trim_start_offset_sec が null）場合もエラー。
    """
    global _matches_cache
    from _common import global_config

    # user_player_id 必須チェック
    cfg = global_config.load()
    user_player_id = ((cfg.get("player") or {}).get("epic_display_name") or "").strip()
    if not user_player_id:
        raise HTTPException(
            status_code=400,
            detail="epic_display_name が未設定です。設定ページで自分のプレイヤー名を登録してください。",
        )

    if not _matches_cache:
        await _refresh()
    target = next((m for m in _matches_cache if m["id"] == match_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"match not found: {match_id}")
    if not target.get("has_replay"):
        raise HTTPException(status_code=400, detail="リプレイファイルがありません。")
    if not target.get("has_video"):
        raise HTTPException(status_code=400, detail="録画動画がありません。")

    state = match_state.load(match_id)
    if state["trim_start_offset_sec"] is None:
        raise HTTPException(
            status_code=400,
            detail="トリミングが未完了です。先にトリミング情報を登録してください。",
        )

    # candidates API を呼び出して自プレイヤーのキルを取得
    if _client is None:
        raise HTTPException(status_code=503, detail="HTTP クライアントが初期化されていません。")
    try:
        r = await _client.post(
            f"{PREPARE_UPLOAD_BASE}/api/candidates",
            json={
                "videoPath": target["video"]["path"],
                "replayPath": target["replay"]["path"],
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"candidates API 呼び出し失敗: {e}")

    if r.status_code != 200:
        raise HTTPException(status_code=422, detail=f"candidates API エラー: {r.text[:400]}")

    candidates = r.json().get("candidates", [])

    # killIndex が付いているもの = 自プレイヤーがキルした event のみ抽出
    kill_offsets_in_original = [
        c["videoOffsetSec"]
        for c in candidates
        if c.get("kind") == "elimination" and c.get("killIndex") is not None
    ]

    trim_start: float = state["trim_start_offset_sec"]
    kill_offsets_in_trimmed = [
        round(off - trim_start, 3)
        for off in kill_offsets_in_original
        if off - trim_start >= 0.0
    ]

    match_state.update(match_id, kill_offsets_in_trimmed=kill_offsets_in_trimmed)
    _matches_cache = []

    return {
        "matchId": match_id,
        "userPlayerId": user_player_id,
        "killCount": len(kill_offsets_in_trimmed),
        "killOffsetsInTrimmed": kill_offsets_in_trimmed,
    }


class SummarizeBody(BaseModel):
    has_won: bool | None = Field(None, alias="hasWon")
    model_config = {"populate_by_name": True}


@app.post("/api/matches/{match_id}/summarize")
async def summarize_match(match_id: str, body: SummarizeBody) -> dict:
    """指定マッチのリプレイを解析し、キルタイム・勝敗を sidecar に保存する（手動トリガー版）。

    has_won が指定されない場合は match_result を変更しない（キルタイムのみ更新）。
    has_summary は常に True に設定する。
    """
    global _matches_cache
    from _common import global_config

    cfg = global_config.load()
    user_player_id = ((cfg.get("player") or {}).get("epic_display_name") or "").strip()
    if not user_player_id:
        raise HTTPException(
            status_code=400,
            detail="epic_display_name が未設定です。設定ページでプレイヤー名を登録してください。",
        )

    if not _matches_cache:
        await _refresh()
    target = next((m for m in _matches_cache if m["id"] == match_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"match not found: {match_id}")
    if not target.get("has_replay"):
        raise HTTPException(status_code=400, detail="リプレイファイルがありません。")

    replay_path = target["replay"]["path"]
    kill_times_in_match: list[float] = []
    if _client is not None:
        try:
            r = await _client.post(
                f"{REPLAY_PARSER_BASE}/api/replay-to-json",
                json={"replayPath": replay_path},
            )
            if r.status_code == 200:
                data = r.json()
                players = data.get("PlayerData") or []
                player = next(
                    (p for p in players
                     if (p.get("PlayerName") or "").lower() == user_player_id.lower()),
                    None,
                )
                if player:
                    player_id = (player.get("PlayerId") or "").upper()
                    for elim in (data.get("Eliminations") or []):
                        if (elim.get("Eliminator") or "").upper() == player_id:
                            t_str = (elim.get("Time") or "")
                            try:
                                parts = t_str.split(":")
                                kill_times_in_match.append(float(int(parts[0]) * 60 + int(parts[1])))
                            except Exception:
                                pass
                else:
                    log.warning(
                        "summarize_match: player '%s' not found in replay %s",
                        user_player_id, match_id,
                    )
        except Exception as e:
            log.warning("summarize_match replay parse failed for %s: %s", match_id, e)

    kwargs: dict[str, Any] = {
        "kill_times_in_match": kill_times_in_match,
        "has_summary": True,
    }
    if body.has_won is not None:
        kwargs["match_result"] = "win" if body.has_won else "loss"

    match_state.update(match_id, **kwargs)
    _matches_cache = []

    log.info("summarize_match: match=%s result=%s kills=%d", match_id, kwargs.get("match_result"), len(kill_times_in_match))
    return {
        "matchId": match_id,
        "matchResult": kwargs.get("match_result"),
        "killCount": len(kill_times_in_match),
        "killTimesInMatch": kill_times_in_match,
    }


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


class PostMatchBody(BaseModel):
    has_won: bool = Field(..., alias="hasWon")
    model_config = {"populate_by_name": True}


@app.post("/api/matches/post-match-automation")
async def post_match_automation(body: PostMatchBody) -> dict:
    """ロビー復帰 + OBS リプレイバッファ保存後に呼ばれる自動集計エンドポイント。

    最新のリプレイを解析し、自プレイヤーのキルタイム・勝敗を sidecar に保存する。
    has_summary を True にしてマッチを「集計済み」とマークする。
    """
    global _matches_cache
    from _common import global_config

    cfg = global_config.load()
    user_player_id = ((cfg.get("player") or {}).get("epic_display_name") or "").strip()
    if not user_player_id:
        raise HTTPException(
            status_code=400,
            detail="epic_display_name が未設定です。設定ページでプレイヤー名を登録してください。",
        )

    suite_cfg = config_store.load_for_api(_obs_source)
    demos = Path(suite_cfg["demos_dir"])
    replays = await asyncio.to_thread(scan_replays, demos)
    if not replays:
        raise HTTPException(status_code=404, detail="リプレイファイルが見つかりません。")

    latest = replays[0]  # scan_replays は match_started_at 降順ソード済み
    match_id = _match_id(latest.match_started_at)

    kill_times_in_match: list[float] = []
    if _client is not None:
        try:
            r = await _client.post(
                f"{REPLAY_PARSER_BASE}/api/replay-to-json",
                json={"replayPath": latest.path},
            )
            if r.status_code == 200:
                data = r.json()
                players = data.get("PlayerData") or []
                player = next(
                    (p for p in players
                     if (p.get("PlayerName") or "").lower() == user_player_id.lower()),
                    None,
                )
                if player:
                    player_id = (player.get("PlayerId") or "").upper()
                    for elim in (data.get("Eliminations") or []):
                        if (elim.get("Eliminator") or "").upper() == player_id:
                            t_str = (elim.get("Time") or "")
                            try:
                                parts = t_str.split(":")
                                kill_times_in_match.append(float(int(parts[0]) * 60 + int(parts[1])))
                            except Exception:
                                pass
                else:
                    log.warning(
                        "post_match_automation: player '%s' not found in replay %s",
                        user_player_id, latest.filename,
                    )
        except Exception as e:
            log.warning("post_match_automation replay parse failed: %s", e)

    match_result = "win" if body.has_won else "loss"
    match_state.update(
        match_id,
        kill_times_in_match=kill_times_in_match,
        match_result=match_result,
        has_summary=True,
    )
    _matches_cache = []

    log.info(
        "post_match_automation: match=%s result=%s kills=%d",
        match_id, match_result, len(kill_times_in_match),
    )
    return {
        "matchId": match_id,
        "matchResult": match_result,
        "killCount": len(kill_times_in_match),
        "killTimesInMatch": kill_times_in_match,
    }
