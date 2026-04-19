"""Common path helpers.

Resolves repository root, logs dir, run dir, and global config location.
"""
from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    """Return Integrated_App/ directory (repo root for the suite)."""
    return Path(__file__).resolve().parents[2]


def logs_dir() -> Path:
    d = repo_root() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_dir() -> Path:
    d = repo_root() / ".run"
    d.mkdir(parents=True, exist_ok=True)
    return d


def dist_dir() -> Path:
    d = repo_root() / "dist"
    d.mkdir(parents=True, exist_ok=True)
    return d


def global_config_path() -> Path:
    """Global suite config: ~/.fortnite-suite/config.json."""
    return Path.home() / ".fortnite-suite" / "config.json"
