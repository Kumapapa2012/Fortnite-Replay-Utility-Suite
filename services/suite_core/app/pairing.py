"""Match pairing: Fortnite replay files ↔ OBS recording videos.

Pairing strategy (docs/03 §8.1.3):
1. Replay filename encodes start time: `UnsavedReplay-YYYY.MM.DD-HH.MM.SS.replay`.
2. Each video has a recording window [mtime - duration, mtime]; get duration
   from ffprobe.
3. A replay pairs with the video whose window contains `T_replay`. If multiple
   qualify, keep the one with the closest mtime.
4. Unpaired replays show up with `has_video: false`. Orphan videos are excluded.

Duration lookup is relatively expensive — we cache by (path, size, mtime) so
refresh scans stay snappy.
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("suite_core")

JST = timezone(timedelta(hours=9))
REPLAY_RE = re.compile(
    r"^UnsavedReplay-(?P<y>\d{4})\.(?P<mo>\d{2})\.(?P<d>\d{2})-(?P<h>\d{2})\.(?P<mi>\d{2})\.(?P<s>\d{2})",
    re.IGNORECASE,
)
VIDEO_EXTS = {".mp4", ".mkv", ".mov"}
_PAIR_TOLERANCE = timedelta(seconds=2)


@dataclass
class ReplayInfo:
    path: str
    filename: str
    size_bytes: int
    mtime: datetime  # aware JST
    match_started_at: datetime  # aware JST, parsed from filename


@dataclass
class VideoInfo:
    path: str
    filename: str
    size_bytes: int
    mtime: datetime  # aware JST
    duration_sec: float

    @property
    def recording_started_at(self) -> datetime:
        return self.mtime - timedelta(seconds=self.duration_sec)


@dataclass
class DurationCache:
    # (path, size, mtime_ns) → duration seconds
    store: dict[tuple[str, int, int], float] = field(default_factory=dict)

    def get_or_probe(self, ffprobe_path: str | None, video_path: Path) -> float | None:
        st = video_path.stat()
        key = (str(video_path), st.st_size, st.st_mtime_ns)
        if key in self.store:
            return self.store[key]
        if not ffprobe_path:
            return None
        try:
            r = subprocess.run(
                [ffprobe_path, "-v", "quiet", "-print_format", "json", "-show_format", str(video_path)],
                capture_output=True, text=True, timeout=30,
            )
            if r.returncode != 0:
                log.warning("ffprobe failed for %s: %s", video_path.name, r.stderr.strip()[-200:])
                return None
            dur = float(json.loads(r.stdout)["format"]["duration"])
        except Exception as e:
            log.warning("ffprobe error for %s: %s", video_path.name, e)
            return None
        self.store[key] = dur
        return dur


def _to_jst(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=JST)


def _video_json(v: "VideoInfo") -> dict[str, Any]:
    return {
        "path": v.path, "filename": v.filename,
        "size_bytes": v.size_bytes, "mtime": v.mtime.isoformat(),
        "duration_sec": round(v.duration_sec, 3),
    }


def best_video_for_replay(
    replay: "ReplayInfo", videos: list["VideoInfo"], exclude: set[str] | None = None
) -> "VideoInfo | None":
    candidates = [
        v for v in videos
        if (not exclude or v.path not in exclude)
        and v.recording_started_at <= replay.match_started_at + _PAIR_TOLERANCE
        and replay.match_started_at <= v.mtime
    ]
    after_start = [
        v for v in candidates
        if (v.mtime - replay.match_started_at).total_seconds() > 10.0
    ]
    if after_start:
        return min(after_start, key=lambda v: (v.mtime - replay.match_started_at).total_seconds())
    return min(candidates, key=lambda v: abs((v.mtime - replay.match_started_at).total_seconds()), default=None)


def scan_replays(demos_dir: Path) -> list[ReplayInfo]:
    if not demos_dir.is_dir():
        return []
    out: list[ReplayInfo] = []
    for f in demos_dir.iterdir():
        if not f.is_file() or f.suffix.lower() != ".replay":
            continue
        m = REPLAY_RE.match(f.name)
        if not m:
            continue
        started = datetime(
            int(m["y"]), int(m["mo"]), int(m["d"]),
            int(m["h"]), int(m["mi"]), int(m["s"]),
            tzinfo=JST,
        )
        st = f.stat()
        out.append(ReplayInfo(
            path=str(f), filename=f.name,
            size_bytes=st.st_size, mtime=_to_jst(st.st_mtime),
            match_started_at=started,
        ))
    out.sort(key=lambda r: r.match_started_at, reverse=True)
    return out


def scan_videos(
    recordings_dir: Path, cache: DurationCache, ffprobe: str | None
) -> list[VideoInfo]:
    if not recordings_dir.is_dir():
        return []
    out: list[VideoInfo] = []
    for f in recordings_dir.iterdir():
        if not f.is_file() or f.suffix.lower() not in VIDEO_EXTS:
            continue
        dur = cache.get_or_probe(ffprobe, f)
        if dur is None:
            continue
        st = f.stat()
        out.append(VideoInfo(
            path=str(f), filename=f.name,
            size_bytes=st.st_size, mtime=_to_jst(st.st_mtime),
            duration_sec=dur,
        ))
    return out


def _match_id(started: datetime) -> str:
    return started.strftime("%Y-%m-%dT%H-%M-%S")


def pair(replays: list[ReplayInfo], videos: list[VideoInfo]) -> list[dict[str, Any]]:
    """Return list of match dicts newest-first."""
    used_videos: set[str] = set()
    matches: list[dict[str, Any]] = []

    def _replay_json(r: ReplayInfo) -> dict[str, Any]:
        return {
            "path": r.path, "filename": r.filename,
            "size_bytes": r.size_bytes, "mtime": r.mtime.isoformat(),
        }

    for r in replays:
        best = best_video_for_replay(r, videos, exclude=used_videos)
        if best:
            used_videos.add(best.path)
        matches.append({
            "id": _match_id(r.match_started_at),
            "match_started_at": r.match_started_at.isoformat(),
            "replay": _replay_json(r),
            "video": _video_json(best) if best else None,
            "has_replay": True,
            "has_video": best is not None,
        })

    matches.sort(key=lambda m: m["match_started_at"], reverse=True)
    return matches
