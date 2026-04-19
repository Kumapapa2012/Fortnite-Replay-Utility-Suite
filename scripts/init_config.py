"""Create the global suite config at ~/.fortnite-suite/config.json if missing.

Intended to be run once during initial setup.
    python scripts/init_config.py
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from services._common.global_config import ensure_exists, global_config_path  # noqa: E402


def main() -> int:
    path = global_config_path()
    created = not path.exists()
    cfg = ensure_exists()
    if created:
        print(f"[init_config] created {path}")
    else:
        print(f"[init_config] already exists: {path}")
    print("[init_config] current contents:")
    for k, v in cfg.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
