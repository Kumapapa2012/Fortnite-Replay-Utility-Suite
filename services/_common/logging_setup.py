"""Per-service logging setup.

Writes to logs/<service>.log with rotation and also echoes to stdout so that
process_manager can surface messages.
"""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from .paths import logs_dir


def setup_logging(service_name: str, level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(service_name)
    if logger.handlers:
        return logger

    logger.setLevel(level)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    fh = RotatingFileHandler(
        logs_dir() / f"{service_name}.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    logger.propagate = False
    return logger
