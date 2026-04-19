"""Thin wrapper around _common.global_config with validation + OBS discovery.

Extends the stored schema with a runtime-only `obs_recording_dir_source` field
so the frontend can show where the recordings path came from.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from _common import global_config

log = logging.getLogger("suite_core")

_ALLOWED_KEYS = {"user_player_id", "demos_dir", "obs_recording_dir", "log_path"}


def _default_demos_dir() -> str:
    lad = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return str(Path(lad) / "FortniteGame" / "Saved" / "Demos")


def _default_log_path() -> str:
    lad = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return str(Path(lad) / "FortniteGame" / "Saved" / "Logs" / "FortniteGame.log")


def _default_videos_dir() -> str:
    home = os.environ.get("USERPROFILE") or str(Path.home())
    return str(Path(home) / "Videos")


def load_for_api(obs_source: str | None = None) -> dict[str, Any]:
    """Load config, fill in defaults, attach transient source marker."""
    raw = global_config.load()
    player = raw.get("player") or {}
    replays = raw.get("replays") or {}
    obs = raw.get("obs") or {}

    demos = replays.get("dir") or _default_demos_dir()
    rec = obs.get("recordings_dir") or _default_videos_dir()

    source = obs_source
    if source is None:
        source = "config_file" if obs.get("recordings_dir") else "default"

    return {
        "user_player_id": player.get("epic_display_name", ""),
        "demos_dir": demos,
        "obs_recording_dir": rec,
        "obs_recording_dir_source": source,
        "log_path": raw.get("log_path") or _default_log_path(),
    }


def save_partial(updates: dict[str, Any]) -> dict[str, Any]:
    """Validate + merge updates into the global config. Returns post-save view."""
    bad = set(updates) - _ALLOWED_KEYS
    if bad:
        raise ValueError(f"未知のキー: {sorted(bad)}")

    _validate(updates)

    raw = global_config.load()
    player = dict(raw.get("player") or {})
    replays = dict(raw.get("replays") or {})
    obs = dict(raw.get("obs") or {})

    if "user_player_id" in updates:
        player["epic_display_name"] = updates["user_player_id"]
    if "demos_dir" in updates:
        replays["dir"] = updates["demos_dir"]
    if "obs_recording_dir" in updates:
        obs["recordings_dir"] = updates["obs_recording_dir"]
    if "log_path" in updates:
        raw["log_path"] = updates["log_path"]

    raw["player"] = player
    raw["replays"] = replays
    raw["obs"] = obs
    global_config.save(raw)
    return load_for_api()


def _validate(updates: dict[str, Any]) -> None:
    if "user_player_id" in updates:
        v = updates["user_player_id"]
        if not isinstance(v, str) or len(v) > 128:
            raise ValueError("user_player_id は 128 文字以内の文字列で指定してください。")
    for key in ("demos_dir", "obs_recording_dir"):
        if key in updates:
            v = updates[key]
            if not isinstance(v, str) or not v:
                raise ValueError(f"{key} は空にできません。")
            if not Path(v).expanduser().is_dir():
                raise ValueError(f"{key}: ディレクトリが存在しません ({v})")
    if "log_path" in updates:
        v = updates["log_path"]
        if not isinstance(v, str) or not v:
            raise ValueError("log_path は空にできません。")
        p = Path(v).expanduser()
        if not (p.exists() or p.parent.is_dir()):
            raise ValueError(f"log_path: ファイルまたは親ディレクトリが見つかりません ({v})")
