"""Compute video-offset candidates from a replay + a video file's mtime/duration.

Pure logic, no I/O except the video/replay file stat (callers pass the already-parsed
replay dict from replay_parser's /api/replay-to-json).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

JST = timezone(timedelta(hours=9))

# OBS default recording filename patterns, e.g.
#   Replay_2026-04-19_15-52-15.mp4
#   2026-04-19 15-52-15.mp4
#   2026-04-19_15-52-15.mp4
# Captures YYYY, MM, DD, hh, mm, ss. Anchored loosely so a prefix like
# "Replay_" is allowed.
_FILENAME_TS_RE = re.compile(
    r"(?P<y>\d{4})-(?P<mo>\d{2})-(?P<d>\d{2})[_\s\-](?P<h>\d{2})-(?P<mi>\d{2})-(?P<s>\d{2})"
)


def parse_filename_timestamp(name: str) -> datetime | None:
    """Best-effort JST datetime parsed from an OBS-style filename. None if not found."""
    m = _FILENAME_TS_RE.search(name)
    if not m:
        return None
    try:
        return datetime(
            int(m["y"]), int(m["mo"]), int(m["d"]),
            int(m["h"]), int(m["mi"]), int(m["s"]),
            tzinfo=JST,
        )
    except ValueError:
        return None


@dataclass
class VideoMeta:
    path: str
    duration_sec: float
    mtime: datetime               # aware, JST
    recording_started_at: datetime  # aware, JST


@dataclass
class ReplayMeta:
    path: str
    match_started_at: datetime    # aware, JST
    match_length_sec: float


def video_meta(video_path: str, duration_sec: float) -> VideoMeta:
    """Build video metadata. Duration is provided by the caller (ffprobe)."""
    st = os.stat(video_path)
    mtime = datetime.fromtimestamp(st.st_mtime, tz=JST)
    # OBS embeds the last-frame timestamp in the filename (e.g. "Replay_2026-05-12_22-23-39.mp4").
    # Use it as the content-end anchor instead of mtime: mtime is the file-write-completion
    # time (~4-5 s after the last frame) and would shift recording_started_at too late.
    filename_ts = parse_filename_timestamp(os.path.basename(video_path))
    content_end = filename_ts if filename_ts is not None else mtime
    started = content_end - timedelta(seconds=duration_sec)
    return VideoMeta(
        path=video_path, duration_sec=duration_sec, mtime=mtime, recording_started_at=started
    )


def _parse_mm_ss(s: str) -> float:
    """'mm:ss' (or 'HH:MM:SS') → seconds. Tolerant of extra whitespace."""
    parts = s.strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    raise ValueError(f"時刻フォーマットが不正: {s!r}")


def replay_meta(replay_path: str, replay: dict[str, Any]) -> ReplayMeta:
    # On Windows st_ctime is the file-creation time = when Fortnite began writing the
    # replay = the actual demo-recording start.  Eliminations[].Time is seconds elapsed
    # since that moment, so this is the correct reference for kill-offset calculation.
    # UtcTimeStartedMatch (stored inside the replay) is ~8 s earlier and reflects a
    # server-side match-assignment timestamp, not the local demo clock start.
    st = os.stat(replay_path)
    ctime = datetime.fromtimestamp(st.st_ctime, tz=JST)
    length_ms = (replay.get("Info") or {}).get("LengthInMs") or 0
    return ReplayMeta(
        path=replay_path,
        match_started_at=ctime,
        match_length_sec=length_ms / 1000.0,
    )


def _player_label_map(replay: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in replay.get("PlayerData") or []:
        pid = (p.get("PlayerId") or "").upper()
        if pid:
            out[pid] = p.get("PlayerName") or "Unknown"
    return out


def build_candidates(
    video: VideoMeta,
    replay: dict[str, Any],
    rmeta: ReplayMeta,
    user_player_id: str | None = None,
) -> list[dict[str, Any]]:
    """Return candidate offsets (in video seconds) for match_start / eliminations / match_end.

    When ``user_player_id`` is provided, the elimination list is filtered to
    events where the user was either the killer or the victim, and the label is
    adjusted so deaths read ``Death <killer>`` instead of ``Kill #N <myself>``.
    """
    result: list[dict[str, Any]] = []
    rec_start = video.recording_started_at
    duration = video.duration_sec
    user_id = (user_player_id or "").strip().upper() or None

    def _offset(at: datetime) -> float:
        return (at - rec_start).total_seconds()

    def _push(kind: str, at: datetime, label: str, **extra: Any) -> None:
        off = _offset(at)
        if 0.0 <= off <= duration:
            row = {
                "kind": kind,
                "absoluteTime": at.isoformat(),
                "videoOffsetSec": round(off, 3),
                "label": label,
            }
            row.update(extra)
            result.append(row)

    _push("match_start", rmeta.match_started_at, "試合開始")

    names = _player_label_map(replay)
    kill_idx = 0
    for elim in replay.get("Eliminations") or []:
        time_str = elim.get("Time")
        if not time_str:
            continue
        try:
            match_time_sec = _parse_mm_ss(time_str)
        except ValueError:
            continue
        abs_time = rmeta.match_started_at + timedelta(seconds=match_time_sec)
        victim_id = ((elim.get("EliminatedInfo") or {}).get("Id") or "").upper()
        killer_id = ((elim.get("EliminatorInfo") or {}).get("Id") or "").upper()
        victim_name = names.get(victim_id, "Unknown")
        killer_name = names.get(killer_id, "Unknown")

        user_is_killer = user_id is not None and killer_id == user_id
        user_is_victim = user_id is not None and victim_id == user_id
        # If a user_player_id is configured, show only events they were involved in.
        if user_id is not None and not (user_is_killer or user_is_victim):
            continue

        if user_id is not None and user_is_victim and not user_is_killer:
            # User died. Label with the opponent's name; keep kind="elimination".
            _push(
                "elimination",
                abs_time,
                f"Death ← {killer_name}",
                matchTime=time_str,
            )
        else:
            kill_idx += 1
            _push(
                "elimination",
                abs_time,
                f"Kill #{kill_idx} {victim_name}",
                killIndex=kill_idx,
                matchTime=time_str,
            )

    match_end = rmeta.match_started_at + timedelta(seconds=rmeta.match_length_sec)
    _push("match_end", match_end, "試合終了")

    result.sort(key=lambda r: r["videoOffsetSec"])
    return result
