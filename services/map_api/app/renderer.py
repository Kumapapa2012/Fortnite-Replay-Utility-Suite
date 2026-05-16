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


_Z_MAX_CAP = 20_000.0


def _z_to_color(z: float, z_max_capped: float) -> tuple[int, int, int]:
    """Blue (z=0) → green → red (z=z_max_capped) gradient. Values above the cap clamp to red."""
    t = max(0.0, min(1.0, z / z_max_capped)) if z_max_capped > 0 else 0.0
    if t <= 0.5:
        tt = t * 2
        return (0, int(255 * tt), int(255 * (1 - tt)))
    else:
        tt = (t - 0.5) * 2
        return (int(255 * tt), int(255 * (1 - tt)), 0)


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
        raise ValueError("Movement log for the specified player is empty.")

    map_cfg = base_params["map_image"]
    map_path = assets_dir / map_cfg["path"]
    if not map_path.exists():
        raise FileNotFoundError(f"Map background image not found: {map_path}")

    expected_w = map_cfg["width"]
    expected_h = map_cfg["height"]

    img = Image.open(map_path).copy()
    if img.size != (expected_w, expected_h):
        raise ValueError(
            f"Map image size mismatch: got {img.size}, expected ({expected_w},{expected_h})"
        )

    z_values = [e["world"]["Z"] for e in entries]
    z_min = min(z_values)
    z_max = max(z_values)
    z_mean = sum(z_values) / len(z_values)
    z_max_capped = min(z_max, _Z_MAX_CAP)

    draw = ImageDraw.Draw(img)
    dot_r = 2
    dot_r_end = 6
    line_width = 3

    points = [(e["map"]["X"], e["map"]["Y"]) for e in entries]
    colors = [_z_to_color(e["world"]["Z"], z_max_capped) for e in entries]

    for i in range(1, len(points)):
        draw.line([points[i - 1], points[i]], fill=(255, 255, 255), width=line_width+2)  # 白い縁取り
        draw.line([points[i - 1], points[i]], fill=colors[i], width=line_width)

    # 中間点を先に描画
    #for i, (px, py) in enumerate(points):
    #    if i == 0 or i == len(points) - 1:
    #        continue
    #    draw.ellipse([(px - dot_r, py - dot_r), (px + dot_r, py + dot_r)], fill=colors[i])

    # 始点・終点を最後に描画（他の点で上書きされないよう）
    for i in (0, len(points) - 1):
        px, py = points[i]
        draw.ellipse([(px - dot_r_end - 2, py - dot_r_end - 2), (px + dot_r_end + 2, py + dot_r_end + 2)], fill=(255, 255, 255))
        draw.ellipse([(px - dot_r_end, py - dot_r_end), (px + dot_r_end, py + dot_r_end)], fill=colors[i])

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
