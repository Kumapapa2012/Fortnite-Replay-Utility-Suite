"""Smoke test: hit /health on every service via the Gateway.

Exits non-zero if any upstream is down. Meant for post-start verification and
CI-lite sanity checks. Does not require the frontend to be running.

Usage:
    python scripts/smoke.py
    python scripts/smoke.py --direct      # bypass Gateway, hit each port
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "services"))

from _common.ports import SERVICE_PORTS  # noqa: E402

GATEWAY_ROUTES = {
    "gateway": "/health",
    "replay_parser": "/api/replay-parser/health",
    "log_monitor_api": "/api/log-monitor/health",
    "map_api": "/api/map/health",
    "prepare_upload_api": "/api/prepare-upload/health",
    "suite_core": "/api/suite/health",
}


def _get(url: str, timeout: float = 3.0) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")[:200]
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode("utf-8", "replace")[:200] if e.fp else "")
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Ping every service's /health.")
    ap.add_argument("--direct", action="store_true", help="hit each service directly, bypassing the gateway")
    args = ap.parse_args()

    failures = 0
    start = time.time()

    if args.direct:
        targets = [
            (name, f"http://127.0.0.1:{port}/health") for name, port in SERVICE_PORTS.items()
        ]
    else:
        gw_port = SERVICE_PORTS["gateway"]
        targets = [
            (name, f"http://127.0.0.1:{gw_port}{path}") for name, path in GATEWAY_ROUTES.items()
        ]

    print(f"[smoke] mode={'direct' if args.direct else 'gateway'}  targets={len(targets)}")
    for name, url in targets:
        status, body = _get(url)
        ok = 200 <= status < 300
        mark = "OK " if ok else "FAIL"
        print(f"  [{mark}] {name:22s} {status:>3}  {url}")
        if not ok:
            failures += 1
            if body:
                print(f"         └─ {body}")

    elapsed = time.time() - start
    print(f"[smoke] done in {elapsed:.2f}s — {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
