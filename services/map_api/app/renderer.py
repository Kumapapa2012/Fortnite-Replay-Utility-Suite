"""Route rendering logic.

Pure computation — given an already-parsed replay dict, a player id, and the
bundled base_params, build map-coordinate points and paint them onto the map
image. I/O is done by the caller (main.py).

Originally adapted from a standalone CLI (``replay_to_map.py``) that has
since been removed; see docs/02_existing_apps_analysis.md for the migration
history.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


@dataclass
class RenderResult:
    png: bytes
    point_count: int
    z_min: float
    z_mean: float
    z_max: float


def build_location_entries(
    replay: dict[str, Any], player_id: str, base_params: dict[str, Any]
) -> list[dict[str, Any]]:
    """Extract a player's movement trace and convert world → map coordinates."""
    world = base_params["world_to_pixel"]
    scale_x = world["scale_x"]
    scale_y = world["scale_y"]
    origin_x = world["world_origin_on_map"]["x"]
    origin_y = world["world_origin_on_map"]["y"]

    player = next(
        (p for p in replay.get("PlayerData", []) if p.get("PlayerId") == player_id),
        None,
    )
    if player is None:
        raise LookupError(f"Player '{player_id}' not found in replay.")

    entries: list[dict[str, Any]] = []
    for loc in player.get("Locations", []):
        rm = loc.get("ReplicatedMovement")
        if not rm or not rm.get("Location"):
            continue
        wx = rm["Location"]["X"]
        wy = rm["Location"]["Y"]
        wz = rm["Location"]["Z"]
        entries.append(
            {
                "time": loc.get("ReplicatedWorldTimeSecondsDouble"),
                "world": {"X": wx, "Y": wy, "Z": wz},
                "map": {
                    "X": scale_x * wx + origin_x,
                    "Y": scale_y * wy + origin_y,
                },
            }
        )
    return entries


def _z_to_color(z: float, z_min: float, z_mean: float, z_max: float) -> tuple[int, int, int]:
    """Blue (min) → green (mean) → red (max) gradient."""
    if z <= z_mean:
        t = (z - z_min) / (z_mean - z_min) if z_mean != z_min else 0.0
        t = max(0.0, min(1.0, t))
        r = 0
        g = int(255 * t)
        b = int(255 * (1 - t))
    else:
        t = (z - z_mean) / (z_max - z_mean) if z_max != z_mean else 0.0
        t = max(0.0, min(1.0, t))
        r = int(255 * t)
        g = int(255 * (1 - t))
        b = 0
    return (r, g, b)


def render_route(
    replay: dict[str, Any],
    player_id: str,
    base_params: dict[str, Any],
    *,
    assets_dir: Path,
) -> RenderResult:
    """Paint the player's route on the map and return a PNG byte blob."""
    entries = build_location_entries(replay, player_id, base_params)
    if not entries:
        raise ValueError("指定プレイヤーの移動ログが空です。")

    map_cfg = base_params["map_image"]
    map_path = assets_dir / map_cfg["path"]
    if not map_path.exists():
        raise FileNotFoundError(f"マップ背景画像が見つかりません: {map_path}")

    expected_w = map_cfg["width"]
    expected_h = map_cfg["height"]

    img = Image.open(map_path).copy()
    if img.size != (expected_w, expected_h):
        raise ValueError(
            f"マップ画像サイズが期待値と異なります: got {img.size}, expected ({expected_w},{expected_h})"
        )

    z_values = [e["world"]["Z"] for e in entries]
    z_min = min(z_values)
    z_max = max(z_values)
    z_mean = sum(z_values) / len(z_values)

    draw = ImageDraw.Draw(img)
    dot_r = 1
    dot_r_end = 5
    line_width = 1

    points = [(e["map"]["X"], e["map"]["Y"]) for e in entries]
    colors = [_z_to_color(e["world"]["Z"], z_min, z_mean, z_max) for e in entries]

    for i in range(1, len(points)):
        draw.line([points[i - 1], points[i]], fill=colors[i], width=line_width)

    for i, (px, py) in enumerate(points):
        r = dot_r_end if i == 0 or i == len(points) - 1 else dot_r
        draw.ellipse([(px - r, py - r), (px + r, py + r)], fill=colors[i])

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return RenderResult(
        png=buf.getvalue(),
        point_count=len(points),
        z_min=float(z_min),
        z_mean=float(z_mean),
        z_max=float(z_max),
    )


def extract_player_list(replay: dict[str, Any]) -> list[dict[str, Any]]:
    """Minimal dropdown data from a parsed replay."""
    out: list[dict[str, Any]] = []
    for p in replay.get("PlayerData", []):
        out.append(
            {
                "player_id": p.get("PlayerId") or "",
                "player_name": p.get("PlayerName") or "",
                "is_bot": bool(p.get("IsBot", False)),
                "team_index": p.get("TeamIndex"),
            }
        )
    return out
