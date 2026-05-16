"""Global suite config stored at ~/.fortnite-suite/config.json.

Centralised player / path settings that previously lived in each app's
own JSON config file. See docs/01_overview.md D-08 and
docs/07_project_structure.md §4 for the migration rationale.
"""
from __future__ import annotations

import json
from typing import Any

from .paths import global_config_path

DEFAULT_CONFIG: dict[str, Any] = {
    "player": {
        "epic_display_id": "",
    },
    "obs": {
        "recordings_dir": "",
        # Replay Buffer length (seconds) configured in OBS. Used to short-circuit
        # the "video duration ≥ match length" filter when the match itself is
        # longer than what any single replay-buffer recording could cover.
        "replay_buffer_sec": 1500,
    },
    "replays": {
        # Default Fortnite replay dir (Windows): %LOCALAPPDATA%/FortniteGame/Saved/Demos
        "dir": "",
    },
}


def load() -> dict[str, Any]:
    path = global_config_path()
    if not path.exists():
        return dict(DEFAULT_CONFIG)
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    # Shallow-merge defaults to fill missing keys on upgrade.
    merged = dict(DEFAULT_CONFIG)
    for k, v in data.items():
        merged[k] = v
    return merged


def save(config: dict[str, Any]) -> None:
    path = global_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def ensure_exists() -> dict[str, Any]:
    """Create default config file if missing and return current contents."""
    path = global_config_path()
    if not path.exists():
        save(DEFAULT_CONFIG)
        return dict(DEFAULT_CONFIG)
    return load()
