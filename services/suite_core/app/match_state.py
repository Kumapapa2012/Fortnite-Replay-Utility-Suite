"""Per-match sidecar state (~/.fortnite-suite/matches/{match_id}.json).

Tracks processing steps not derivable from the filesystem:
  trimmed_video_path, trim_start_offset_sec, kill_offsets_in_trimmed,
  has_summary, kill_compilation_path.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_MATCHES_DIR = Path.home() / ".fortnite-suite" / "matches"

DEFAULT_STATE: dict[str, Any] = {
    "video_path": None,            # manually or auto linked raw recording
    "trimmed_video_path": None,
    "trim_start_offset_sec": None,
    "kill_offsets_in_trimmed": [],
    "has_summary": False,
    "kill_compilation_path": None,
    "kill_times_in_match": [],    # seconds from match start (replay-based, no video)
    "match_result": None,         # "win" | "loss" | None
}


def _path(match_id: str) -> Path:
    return _MATCHES_DIR / f"{match_id}.json"


def load(match_id: str) -> dict[str, Any]:
    p = _path(match_id)
    if not p.exists():
        return dict(DEFAULT_STATE)
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return dict(DEFAULT_STATE)
    merged = dict(DEFAULT_STATE)
    merged.update(data)
    return merged


def save(match_id: str, state: dict[str, Any]) -> None:
    p = _path(match_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def update(match_id: str, **kwargs: Any) -> dict[str, Any]:
    """Load current state, apply kwargs, save, return updated state."""
    state = load(match_id)
    state.update({k: v for k, v in kwargs.items() if k in DEFAULT_STATE})
    save(match_id, state)
    return state
