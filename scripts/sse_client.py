#!/usr/bin/env python3
"""Command-line SSE client for log_monitor_api /events endpoint.

Usage:
    python scripts/sse_client.py                  # Gateway 経由 (port 8080)
    python scripts/sse_client.py --direct         # log_monitor_api 直接 (port 8000)
    python scripts/sse_client.py --url http://... # URL 指定
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# venv から httpx を使えるようにする
_HERE = Path(__file__).resolve().parent
_VENV_SITE = _HERE.parent / ".venv" / "Lib" / "site-packages"
if _VENV_SITE.exists() and str(_VENV_SITE) not in sys.path:
    sys.path.insert(0, str(_VENV_SITE))

import httpx  # noqa: E402

# ANSI カラーコード
_RESET  = "\033[0m"
_BOLD   = "\033[1m"
_DIM    = "\033[2m"
_CYAN   = "\033[36m"
_GREEN  = "\033[32m"
_YELLOW = "\033[33m"
_RED    = "\033[31m"
_BLUE   = "\033[34m"

DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080/api/log-monitor/events"
DEFAULT_DIRECT_URL  = "http://127.0.0.1:8000/events"


def _fmt_snapshot(msg: dict) -> str:
    status = msg.get("status") or {}
    running = status.get("running", False)
    phase   = status.get("phase", "?")
    obs     = "接続済み" if status.get("obs_connected") else "未接続"
    count   = status.get("match_count", 0)
    state   = f"{_GREEN}稼働中{_RESET}" if running else f"{_DIM}停止中{_RESET}"
    return (
        f"{_BOLD}[snapshot]{_RESET} {state}  "
        f"phase={_CYAN}{phase}{_RESET}  OBS={obs}  matches={count}"
    )


def _fmt_event(msg: dict) -> str:
    icon  = msg.get("icon", "")
    label = msg.get("label", "")
    phase = msg.get("phase", "")
    det   = msg.get("detected_at", "")
    extra = msg.get("extra")
    extra_str = f"  ({extra})" if extra else ""
    return (
        f"{_DIM}[{det}]{_RESET} {icon} {_BOLD}{label}{_RESET}"
        f"  {_DIM}phase={phase}{extra_str}{_RESET}"
    )


def _fmt_system(msg: dict) -> str:
    kind    = msg.get("kind", "")
    message = msg.get("message", "")
    det     = msg.get("detected_at", "")

    if "error" in kind:
        color = _RED
    elif kind == "post_match_automation":
        color = _GREEN
    elif kind == "post_match_step":
        color = _YELLOW
    else:
        color = _BLUE

    return (
        f"{_DIM}[{det}]{_RESET} ⚙  "
        f"{color}[{kind}]{_RESET} {message}"
    )


def stream(url: str, no_color: bool = False) -> None:
    global _RESET, _BOLD, _DIM, _CYAN, _GREEN, _YELLOW, _RED, _BLUE
    if no_color:
        _RESET = _BOLD = _DIM = _CYAN = _GREEN = _YELLOW = _RED = _BLUE = ""

    print(f"Connecting: {url}", flush=True)
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=5.0, read=None, write=5.0, pool=None)) as client:
            with client.stream("GET", url, headers={"Accept": "text/event-stream"}) as r:
                if r.status_code != 200:
                    print(f"Error: HTTP {r.status_code}", file=sys.stderr)
                    sys.exit(1)
                print("Connected. Ctrl+C to stop.\n", flush=True)

                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw:
                        continue

                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        print(f"[raw] {raw}", flush=True)
                        continue

                    t = msg.get("type", "")
                    if t == "snapshot":
                        out = _fmt_snapshot(msg)
                    elif t == "event":
                        out = _fmt_event(msg)
                    elif t == "system":
                        out = _fmt_system(msg)
                    else:
                        out = f"[{t}] {raw}"

                    print(out, flush=True)

    except KeyboardInterrupt:
        print("\nDisconnected.", flush=True)
    except httpx.ConnectError:
        print(f"Connection refused: {url}", file=sys.stderr)
        print("サービスが起動しているか確認してください。", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="log_monitor_api SSE クライアント")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--direct", action="store_true",
                   help=f"log_monitor_api 直接接続 ({DEFAULT_DIRECT_URL})")
    g.add_argument("--url", default=None, metavar="URL",
                   help="接続先 URL を明示指定")
    p.add_argument("--no-color", action="store_true", help="カラー出力を無効化")
    args = p.parse_args()

    if args.url:
        url = args.url
    elif args.direct:
        url = DEFAULT_DIRECT_URL
    else:
        url = DEFAULT_GATEWAY_URL

    stream(url, no_color=args.no_color)


if __name__ == "__main__":
    main()
