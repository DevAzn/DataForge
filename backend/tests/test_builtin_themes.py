"""Starter theme library seeds on init and stays user-extensible."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app import database as db  # noqa: E402
from app.builtin_themes import (  # noqa: E402
    BUILTIN_THEME_PACKS,
    BUILTIN_THEMES_SEED_VERSION,
    all_seed_value_count,
)
from app.main import app  # noqa: E402


def test_builtin_packs_defined():
    assert BUILTIN_THEMES_SEED_VERSION >= 1
    assert len(BUILTIN_THEME_PACKS) >= 2
    assert all_seed_value_count() > 50
    ids = {p["id"] for p in BUILTIN_THEME_PACKS}
    assert "theme-builtin-general" in ids
    assert "theme-builtin-star-wars" in ids


def test_seed_on_fresh_db_and_user_can_extend():
    """init_db/seed installs packs; user can still add categories + values."""
    client = TestClient(app)
    # Force seed (session DB already inited by conftest + app lifespan)
    result = db.seed_builtin_themes(force=True)
    assert result["ok"] is True

    themes = client.get("/api/themes").json()
    by_id = {t["id"]: t for t in themes}
    assert "theme-builtin-general" in by_id
    assert by_id["theme-builtin-general"]["isBuiltin"] is True
    assert by_id["theme-builtin-general"]["valueCount"] > 0

    # Values present under names
    gv = client.get(
        "/api/themes/theme-builtin-general/values",
        params={"category": "names"},
    ).json()
    assert gv["count"] >= 10
    assert any(
        (v.get("value") or "").startswith("Alex") or "Alex" in (v.get("value") or "")
        for v in gv["values"]
    )

    # User extends builtin pack with a custom category
    add = client.post(
        "/api/themes/theme-builtin-general/values",
        json={"category": "custom_codes", "values": ["ALPHA-1", "BETA-2"]},
    )
    assert add.status_code == 200, add.text
    body = add.json()
    assert body["inserted"] == 2

    # Re-seed must not wipe or zero out user values
    again = db.seed_builtin_themes(force=True)
    assert again["ok"] is True
    gv2 = client.get(
        "/api/themes/theme-builtin-general/values",
        params={"category": "custom_codes"},
    ).json()
    vals = {v["value"] for v in gv2["values"]}
    assert "ALPHA-1" in vals and "BETA-2" in vals

    # User can create an entirely custom theme pack
    custom = client.post("/api/themes", json={"name": "My Local Pack"}).json()
    cid = custom["id"]
    r = client.post(
        f"/api/themes/{cid}/values",
        json={"category": "widgets", "values": ["w1", "w2", "w3"]},
    )
    assert r.status_code == 200
    assert r.json()["inserted"] == 3
    listed = {t["id"] for t in client.get("/api/themes").json()}
    assert cid in listed
    assert "theme-builtin-general" in listed


def test_seed_idempotent_no_duplicate_values():
    db.seed_builtin_themes(force=True)
    first = client_count_general_names()
    db.seed_builtin_themes(force=True)
    second = client_count_general_names()
    assert first == second
    assert first > 0


def client_count_general_names() -> int:
    client = TestClient(app)
    gv = client.get(
        "/api/themes/theme-builtin-general/values",
        params={"category": "names"},
    ).json()
    return int(gv.get("count") or 0)
