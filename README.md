# Fortnite Replay Suite

A personal Windows-local tool that consolidates Fortnite replay analysis, map visualization, log monitoring, and OBS recording trimming into a **single Web UI**.

> 📖 **See the [User Guide](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/) for full instructions.** It covers initial setup, daily start/stop, all screen operations, and troubleshooting across 7 chapters with screenshots (source in [`docs/user_guide/`](./docs/user_guide/)).

Six processes work together internally (Gateway + 5 backend services + Vite frontend).

```
┌───────────────┐     ┌──────────────────────────────────────────┐
│ Browser       │────▶│ Gateway :8080 ── reverse proxy           │
│ (Vite :5173   │     │   /api/replay-parser/* → Parser :12345   │
│  or dist/)    │     │   /api/log-monitor/*   → LogMon  :8000   │
└───────────────┘     │   /api/map/*           → Map     :8001   │
                      │   /api/prepare-upload/* → Upload :8002   │
                      │   /api/suite/*         → Core    :8003   │
                      └──────────────────────────────────────────┘
```

## Requirements

| Requirement | Version / Notes |
|---|---|
| OS | Windows 11 |
| Python | 3.14 (or 3.11+) |
| .NET SDK | 10.0 (for Replay Parser) |
| ffmpeg / ffprobe | Must be on PATH. [Official builds](https://ffmpeg.org/download.html#build-windows) |
| Node.js | 20+ (frontend development only) |
| Fortnite | Must be configured to generate `.replay` files |

## Setup and Operation

All procedures are consolidated in the [User Guide](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/). End users should start there.

| Chapter | Contents |
|---|---|
| [01. Setup](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/01_setup.html) | Python venv / npm install / `config.json` / OBS `.env` |
| [02. Start & Stop](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/02_startup.html) | `manage.ps1` / `start.ps1` / `stop.ps1` / `smoke.py` |
| [03. Dashboard & Settings](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/03_dashboard_settings.html) | 4 config fields / OBS auto-detect badge |
| [04. Matches & Replays](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/04_matches_replays.html) | Match list/detail, replay map |
| [05. Video Trimming](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/05_videos.html) | Candidate extraction / keyframe selection |
| [06. Log Monitor](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/06_logs.html) | Real-time event reception via SSE |
| [07. Troubleshooting](https://kumapapa2012.github.io/Fortnite-Replay-Utility-Suite/user_guide/07_troubleshoot.html) | Diagnostic flow / log locations |

For developer design specs, see `01_overview.md` through `08_e2e_manual.md` under [`docs/`](./docs/). Production serving of `frontend/dist` via Gateway is planned but not yet implemented (Phase 6).

## Screens

`:lang` is `ja` (Japanese) or `en` (English). Accessing `/` automatically redirects to `/ja/`.

| Route | Purpose |
|---|---|
| `/` | Redirects to `/ja/` |
| `/:lang/` | Dashboard (service overview + log monitor banner) |
| `/:lang/matches` | Match list (replay + recording pairs) |
| `/:lang/matches/:id` | Match detail (replay / video / logs in one view) |
| `/:lang/replays` | Replay file list |
| `/:lang/replays/:id` | Replay result report (HTML) |
| `/:lang/replays/:id/map` | Replay map (movement trajectory PNG) |
| `/:lang/videos` | Recording list + trimming UI |
| `/:lang/logs` | Log monitor event stream (SSE) |
| `/:lang/settings` | Folder paths + Epic display name |

## Troubleshooting (Quick Reference)

See [docs/06_deployment.md §12](./docs/06_deployment.md#12-トラブルシュート) for full details.

| Symptom | Fix |
|---|---|
| `/ja/matches` is empty | Check `demos_dir` / `obs_recording_dir` in `/ja/settings` → click "Rescan" |
| `/ja/videos` shows `ffmpeg: not found` | Add `ffmpeg.exe` / `ffprobe.exe` to PATH, then restart all services |
| `/ja/logs` shows `Log File: (not found)` | Set `log_path` explicitly in `/ja/settings` → `scripts/stop.ps1` → `start.ps1` |
| Frequent 503 errors from the UI | Run `python scripts/smoke.py` to identify which service is down |

## Directory Structure (Overview)

```
Integrated_App/
├── README.md              (this file — English)
├── README_ja.md           (Japanese version)
├── docs/                  Design documents
├── gateway/               FastAPI Gateway
├── services/
│   ├── _common/           ports, paths, logging, global config
│   ├── replay_parser/     .NET 10 ASP.NET Core Minimal API
│   ├── log_monitor_api/   Fortnite log monitor + SSE
│   ├── map_api/           Movement trajectory PNG renderer
│   ├── prepare_upload_api/ ffmpeg/ffprobe-based video processing
│   └── suite_core/        Match pairing + global config
├── frontend/              React + Vite + Tailwind
├── scripts/               PowerShell + process_manager
├── logs/                  Runtime logs (with rotation)
└── .run/                  PID files (cleaned up by stop)
```

## About `../__Individual_Apps/` (not included in the GitHub release)

The four standalone CLIs that this suite was built from are stored locally at `../__Individual_Apps/`. They are **read-only references** (migration sources) and are not referenced by any code in `Integrated_App/` — all logic has been ported into `services/*/app/`.

> **Note**: Only `Integrated_App/` is published to GitHub. `__Individual_Apps/` is not part of this repository. References to `__Individual_Apps/` found in design documents such as `docs/01_overview.md`, `docs/02_existing_apps_analysis.md`, and `docs/07_project_structure.md` are **archival notes from the migration process**. Similarly, the legacy fallback path in `services/suite_core/app/obs_discovery.py` exists only for local development compatibility and does not affect operation of this repository standalone (the canonical path `services/log_monitor_api/.env` takes precedence).

## License / Copyright

This repository is distributed under the [MIT License](./LICENSE) (Copyright (c) 2026 kumapapa2012). It is provided on an AS IS basis — **the author bears no obligation to fix bugs or provide support**. Commercial use, modification, and partial reuse are all permitted, provided the copyright notice is retained as required by the MIT License.

If you cite this software in an academic paper, article, or derivative product, please use the **"Cite this repository"** button in the right sidebar of the repository page ([`CITATION.cff`](./CITATION.cff)).

Third-party dependency licenses can be found in `services/replay_parser/LICENSE.txt` (and `__Individual_Apps/*/LICENSE.txt` for migration sources — local reference only).
