"""Port assignment table. Single source of truth.

See docs/01_overview.md §5.5.
"""
from __future__ import annotations

GATEWAY_PORT = 8080
REPLAY_PARSER_PORT = 12345
LOG_MONITOR_API_PORT = 8000
MAP_API_PORT = 8001
PREPARE_UPLOAD_API_PORT = 8002
SUITE_CORE_PORT = 8003

SERVICE_PORTS: dict[str, int] = {
    "gateway": GATEWAY_PORT,
    "replay_parser": REPLAY_PARSER_PORT,
    "log_monitor_api": LOG_MONITOR_API_PORT,
    "map_api": MAP_API_PORT,
    "prepare_upload_api": PREPARE_UPLOAD_API_PORT,
    "suite_core": SUITE_CORE_PORT,
}
