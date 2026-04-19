"""Thin wrappers around ffmpeg / ffprobe.

All subprocesses run synchronously — trimming can take tens of seconds on large
files but we call these from async handlers via `asyncio.to_thread`. The wrappers
return plain dicts / dataclasses so FastAPI can JSON-serialize results directly.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ToolStatus:
    available: bool
    version: str | None
    path: str | None


def _probe_tool(binary: str) -> ToolStatus:
    path = shutil.which(binary)
    if not path:
        return ToolStatus(available=False, version=None, path=None)
    try:
        out = subprocess.run(
            [path, "-version"], capture_output=True, text=True, timeout=5
        )
        first = (out.stdout.splitlines() or [""])[0]
        m = re.search(r"version\s+(\S+)", first)
        ver = m.group(1) if m else first.strip() or None
    except Exception:
        ver = None
    return ToolStatus(available=True, version=ver, path=path)


def detect_tools() -> dict[str, ToolStatus]:
    return {"ffmpeg": _probe_tool("ffmpeg"), "ffprobe": _probe_tool("ffprobe")}


def probe_duration(ffprobe: str, video_path: str) -> float:
    """Return duration in seconds via `ffprobe -show_format`."""
    cmd = [
        ffprobe,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        video_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip() or r.stdout.strip()}")
    data = json.loads(r.stdout or "{}")
    try:
        return float(data["format"]["duration"])
    except (KeyError, TypeError, ValueError) as e:
        raise RuntimeError(f"ffprobe returned no duration: {e}")


def find_keyframes(
    ffprobe: str, video_path: str, start_sec: float, range_sec: float
) -> list[float]:
    """Return list of I-frame timestamps in [start_sec, start_sec+range_sec]."""
    end_sec = start_sec + range_sec
    cmd = [
        ffprobe,
        "-v", "quiet",
        "-select_streams", "v:0",
        "-show_entries", "frame=best_effort_timestamp_time,pict_type",
        "-of", "csv=p=0",
        "-read_intervals", f"{start_sec}%{end_sec}",
        video_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip() or r.stdout.strip()}")
    out: list[float] = []
    for line in r.stdout.splitlines():
        parts = line.strip().split(",")
        if len(parts) < 2:
            continue
        ts, kind = parts[0], parts[1].strip()
        if kind != "I":
            continue
        try:
            out.append(float(ts))
        except ValueError:
            continue
    return out


def extract_thumbnail(ffmpeg: str, video_path: str, offset_sec: float) -> bytes:
    """Extract a JPEG frame at the given offset (seeking before -i is fast)."""
    cmd = [
        ffmpeg,
        "-loglevel", "error",
        "-ss", f"{max(0.0, offset_sec):.3f}",
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", "4",
        "-f", "image2",
        "pipe:1",
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=15)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(
            f"ffmpeg thumbnail failed: {r.stderr.decode('utf-8', 'replace').strip()}"
        )
    return r.stdout


def trim_copy(
    ffmpeg: str,
    video_path: str,
    start_sec: float,
    output_path: str,
) -> subprocess.CompletedProcess[str]:
    """Cut from start_sec to EOF using stream copy (fast, keyframe-aligned)."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-loglevel", "error",
        "-ss", f"{start_sec:.3f}",
        "-i", video_path,
        "-codec", "copy",
        "-y",
        output_path,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=600)


def seconds_to_hms(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
