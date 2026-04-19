"""Best-effort OBS recording-dir discovery via obs-websocket.

Called once on startup to resolve the recording folder when the user hasn't set
one explicitly. Read-only — we never write OBS config. Falls back silently on
any failure so the service still starts when OBS isn't running.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("suite_core")


def _candidate_env_paths() -> list[Path]:
    """Locations to probe for OBS credentials, in priority order.

    1. Canonical: ``services/log_monitor_api/.env`` — current integrated layout.
    2. Legacy:    ``__Individual_Apps/fortnite_log_monitor/.env`` — pre-integration
       fallback so existing setups keep working without manual migration.
    """
    here = Path(__file__).resolve()
    return [
        here.parents[2] / "log_monitor_api" / ".env",
        here.parents[3] / "__Individual_Apps" / "fortnite_log_monitor" / ".env",
    ]


def _load_env_obs_creds() -> tuple[str, int, str | None]:
    """Reuse the log monitor's .env so users don't re-enter OBS credentials.

    Falls back to OBS defaults if no .env is present.
    """
    env_path = next((p for p in _candidate_env_paths() if p.exists()), None)
    host, port, pw = "127.0.0.1", 4455, None
    if env_path is not None:
        log.debug("loading OBS creds from %s", env_path)
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k == "OBS_HOST":
                host = v
            elif k == "OBS_PORT":
                try:
                    port = int(v)
                except ValueError:
                    pass
            elif k == "OBS_PASSWORD":
                pw = v or None
    # Allow env vars to override file values.
    host = os.environ.get("OBS_HOST", host)
    try:
        port = int(os.environ.get("OBS_PORT", port))
    except ValueError:
        pass
    pw = os.environ.get("OBS_PASSWORD", pw)
    return host, port, pw


def try_recording_dir(timeout: float = 2.0) -> str | None:
    """Connect to OBS WebSocket and call GetRecordDirectory. Returns path or None."""
    try:
        from obsws_python import ReqClient  # type: ignore
    except Exception as e:
        log.info("obsws_python unavailable: %s", e)
        return None

    host, port, pw = _load_env_obs_creds()
    try:
        cli = ReqClient(host=host, port=port, password=pw or "", timeout=timeout)
    except Exception as e:
        log.info("OBS WebSocket connect failed: %s", e)
        return None

    try:
        resp = cli.get_record_directory()
    except Exception as e:
        log.info("GetRecordDirectory failed: %s", e)
        return None
    finally:
        try:
            cli.disconnect()
        except Exception:
            pass

    for attr in ("record_directory", "recording_directory", "recordDirectory"):
        v = getattr(resp, attr, None)
        if v:
            return str(v)
    return None
