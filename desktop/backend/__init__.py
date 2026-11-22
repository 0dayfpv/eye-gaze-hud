"""Native eye gaze inference and cross-platform camera backend package."""

from __future__ import annotations

import sys
from pathlib import Path


def _resolve_repo_root() -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass)
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


REPO_ROOT: Path = _resolve_repo_root()
DEFAULT_MODEL_PATH: Path = REPO_ROOT / "assets" / "face_landmarker.task"

__all__ = ["DEFAULT_MODEL_PATH", "REPO_ROOT"]
