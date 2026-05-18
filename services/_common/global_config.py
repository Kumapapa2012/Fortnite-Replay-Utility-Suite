"""Global suite config stored at ~/.fortnite-suite/config.json.

Centralised player / path settings that previously lived in each app's
own JSON config file. See docs/01_overview.md D-08 and
docs/07_project_structure.md §4 for the migration rationale.
"""
from __future__ import annotations

import json
from typing import Any

from .paths import global_config_path

_DEFAULT_RESULT_TEMPLATE = (
    "========= Match Data ============\n"
    "Started : {{started_at}}\n"
    "Ended : {{ended_at}}\n"
    "Duration : {{duration}}\n"
    "Total Players: {{total_players}}(Humans : {{human_players}} / Bots : {{bot_players}})\n"
    "\n"
    "========= Player Results =========\n"
    "Player : {{player_name}}[{{cosmetics_name}}] ({{human_or_bot}}) eliminated {{elimination_count}} players.\n"
    "{{#eliminations}}\n"
    "{{nth}}: {{time}} - {{player_name}}[{{cosmetics_name}}] ({{human_or_bot}})\n"
    "{{/eliminations}}\n"
    "{{#is_eliminated}}{{player_name}} was eliminated by "
    "{{eliminated_by_player_name}}[{{eliminated_by_cosmetics_name}}]"
    "({{eliminated_by_human_or_bot}}) at {{eliminated_by_time}} (Placement: {{placement_display}})\n"
    "{{/is_eliminated}}"
    "{{^is_eliminated}}{{#is_winner}}{{player_name}} won the game!{{/is_winner}}"
    "{{^is_winner}}The replay ended before the match ends.{{/is_winner}}\n"
    "{{/is_eliminated}}\n"
    "========= Platform ===============\n"
    "OS : {{os}}\n"
    "CPU : {{cpu}}\n"
    "Memory : {{memory}} - {{available_memory}}\n"
    "GPU : {{gpu}}\n"
    "Resolution : {{resolution}}\n"
    "\n"
    "(This data has been produced using: https://github.com/Kumapapa2012/Fortnite_Replay_Parser_GUI/)"
)

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
    "replay_result_template": _DEFAULT_RESULT_TEMPLATE,
    "ui_lang": "en",
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
