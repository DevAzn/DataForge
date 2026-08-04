"""Resolve install / frozen (PyInstaller) paths for DataForge."""
from __future__ import annotations

import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def project_root() -> Path:
    """Writable app root: repo root in dev, folder containing the .exe when frozen."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    # backend/app/runtime_paths.py → parents[2] = repo root
    return Path(__file__).resolve().parents[2]


def bundle_root() -> Path:
    """Read-only assets root (PyInstaller extract dir, or repo root)."""
    if is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass)
        return Path(sys.executable).resolve().parent
    return project_root()


def ui_dist_dir() -> Path | None:
    """Built Vue UI (frontend/dist) if present."""
    root = project_root()
    bundle = bundle_root()
    candidates = [
        bundle / "frontend" / "dist",
        root / "frontend" / "dist",
        root / "_internal" / "frontend" / "dist",
        root / "ui",
        # Some layouts place index.html next to the exe
        root,
    ]
    for c in candidates:
        if (c / "index.html").is_file() and (c / "assets").is_dir():
            return c
    for c in candidates:
        if (c / "index.html").is_file():
            return c
    return None
