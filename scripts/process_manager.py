"""Process manager for Fortnite Replay Suite.

Spawns / stops / reports status of all backend services declared in SERVICES.
Invoked by scripts/start.ps1, stop.ps1, dev.ps1.

Usage:
    python scripts/process_manager.py start [--service NAME ...]
    python scripts/process_manager.py stop  [--service NAME ...]
    python scripts/process_manager.py status

See docs/06_deployment.md.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_DIR = REPO_ROOT / ".run"
LOGS_DIR = REPO_ROOT / "logs"

# venv lookup order (Windows layout):
#   1) Integrated_App/.venv/Scripts/python.exe
#   2) ../venv/Scripts/python.exe  (sibling to Integrated_App)
_VENV_CANDIDATES = [
    REPO_ROOT / ".venv" / "Scripts" / "python.exe",
    REPO_ROOT.parent / "venv" / "Scripts" / "python.exe",
]
VENV_PYTHON = next((p for p in _VENV_CANDIDATES if p.exists()), _VENV_CANDIDATES[0])


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    kind: str  # "python" | "dotnet"
    cwd: Path
    command: list[str]
    port: int


def _py(module_args: list[str]) -> list[str]:
    """Build a python command using the suite venv if available."""
    py = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable
    return [py, *module_args]


def _services() -> list[ServiceSpec]:
    svc = REPO_ROOT / "services"
    return [
        ServiceSpec(
            name="replay_parser",
            kind="dotnet",
            cwd=svc / "replay_parser",
            command=["dotnet", "run", "--no-launch-profile", "--", "--urls", "http://127.0.0.1:12345"],
            port=12345,
        ),
        ServiceSpec(
            name="log_monitor_api",
            kind="python",
            cwd=svc / "log_monitor_api",
            command=_py(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]),
            port=8000,
        ),
        ServiceSpec(
            name="map_api",
            kind="python",
            cwd=svc / "map_api",
            command=_py(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"]),
            port=8001,
        ),
        ServiceSpec(
            name="prepare_upload_api",
            kind="python",
            cwd=svc / "prepare_upload_api",
            command=_py(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8002"]),
            port=8002,
        ),
        ServiceSpec(
            name="suite_core",
            kind="python",
            cwd=svc / "suite_core",
            command=_py(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8003"]),
            port=8003,
        ),
        ServiceSpec(
            name="gateway",
            kind="python",
            cwd=REPO_ROOT / "gateway",
            command=_py(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8080"]),
            port=8080,
        ),
    ]


def _pid_file(name: str) -> Path:
    return RUN_DIR / f"{name}.pid"


def _write_pid(name: str, pid: int, port: int) -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    _pid_file(name).write_text(
        json.dumps({"pid": pid, "port": port, "started_at": time.time()}),
        encoding="utf-8",
    )


def _read_pid(name: str) -> dict | None:
    p = _pid_file(name)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _is_alive(pid: int) -> bool:
    try:
        import psutil  # type: ignore

        return psutil.pid_exists(pid)
    except ImportError:
        # Fallback - may misreport on Windows but good enough for dev.
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def start(services: list[ServiceSpec]) -> int:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0

    for s in services:
        existing = _read_pid(s.name)
        if existing and _is_alive(existing["pid"]):
            print(f"[skip] {s.name} already running (pid={existing['pid']})")
            continue

        log_path = LOGS_DIR / f"{s.name}.stdout.log"
        log_file = log_path.open("a", encoding="utf-8", buffering=1)
        log_file.write(f"\n=== spawn at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")

        if not s.cwd.exists():
            print(f"[warn] {s.name}: cwd missing ({s.cwd}); skipping")
            failures += 1
            continue

        try:
            proc = subprocess.Popen(
                s.command,
                cwd=str(s.cwd),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
        except FileNotFoundError as e:
            print(f"[error] {s.name}: {e}")
            failures += 1
            continue

        _write_pid(s.name, proc.pid, s.port)
        print(f"[start] {s.name} pid={proc.pid} port={s.port} log={log_path.name}")

    return failures


def stop(services: list[ServiceSpec]) -> int:
    failures = 0
    for s in services:
        info = _read_pid(s.name)
        if not info:
            print(f"[skip] {s.name}: no pid file")
            continue
        pid = int(info["pid"])
        if not _is_alive(pid):
            print(f"[clean] {s.name}: stale pid file (pid={pid})")
            _pid_file(s.name).unlink(missing_ok=True)
            continue
        try:
            try:
                import psutil  # type: ignore

                parent = psutil.Process(pid)
                for child in parent.children(recursive=True):
                    child.terminate()
                parent.terminate()
                gone, alive = psutil.wait_procs([parent], timeout=5)
                for a in alive:
                    a.kill()
            except ImportError:
                os.kill(pid, signal.SIGTERM)
                time.sleep(1)
            print(f"[stop]  {s.name} pid={pid}")
        except Exception as e:
            print(f"[error] {s.name}: failed to stop pid={pid}: {e}")
            failures += 1
        finally:
            _pid_file(s.name).unlink(missing_ok=True)
    return failures


def status(services: list[ServiceSpec]) -> int:
    for s in services:
        info = _read_pid(s.name)
        if info and _is_alive(info["pid"]):
            print(f"[ up ] {s.name:22s} pid={info['pid']:<6} port={s.port}")
        else:
            print(f"[down] {s.name:22s} port={s.port}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Fortnite Replay Suite process manager")
    parser.add_argument("action", choices=["start", "stop", "status"])
    parser.add_argument("--service", action="append", default=[], help="limit to named service(s)")
    args = parser.parse_args()

    all_services = _services()
    if args.service:
        selected = [s for s in all_services if s.name in args.service]
        missing = set(args.service) - {s.name for s in selected}
        if missing:
            print(f"[error] unknown service(s): {', '.join(sorted(missing))}")
            return 2
    else:
        selected = all_services

    if args.action == "start":
        return 1 if start(selected) else 0
    if args.action == "stop":
        return 1 if stop(selected) else 0
    if args.action == "status":
        return status(selected)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
