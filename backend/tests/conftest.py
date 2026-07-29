"""Isolate SQLite DB for the test package so the developer DB is never touched."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture(scope="session", autouse=True)
def _isolated_db(tmp_path_factory):
    """Point app.database at a session temp SQLite file and re-init schema."""
    base = tmp_path_factory.mktemp("dataforge-db")
    db_path = base / "test.sqlite"

    import app.database as db

    db.DB_PATH = db_path
    db.DATA_DIR = base
    db.EXPORT_STAGING_DIR = base / "exports"
    db.ENCRYPTION_DIR = base / "encryption"
    db.init_db()
    yield db_path
