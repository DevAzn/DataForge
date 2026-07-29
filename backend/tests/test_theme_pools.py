"""Theme category pools: 100-cap, per-field theme pack + category fill."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.defaults import MAX_THEME_CATEGORY_VALUES, THEME_CATEGORY_WARN_AT  # noqa: E402
from app.main import app  # noqa: E402
from app.services.generator import Generator  # noqa: E402


def test_theme_category_cap_and_warning():
    client = TestClient(app)
    t = client.post("/api/themes", json={"name": "CapTest Theme"}).json()
    tid = t["id"]
    # Fill to warn threshold
    batch = [f"v{i}" for i in range(THEME_CATEGORY_WARN_AT)]
    r = client.post(
        f"/api/themes/{tid}/values",
        json={"category": "names", "values": batch},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == THEME_CATEGORY_WARN_AT
    assert body["total"] == THEME_CATEGORY_WARN_AT
    assert body.get("warning")

    # Fill remainder to 100
    more = [f"x{i}" for i in range(MAX_THEME_CATEGORY_VALUES - THEME_CATEGORY_WARN_AT + 5)]
    r2 = client.post(
        f"/api/themes/{tid}/values",
        json={"category": "names", "values": more},
    )
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["total"] == MAX_THEME_CATEGORY_VALUES
    assert b2["skippedCap"] >= 1
    assert b2["inserted"] == MAX_THEME_CATEGORY_VALUES - THEME_CATEGORY_WARN_AT

    # List values + category stats
    gv = client.get(f"/api/themes/{tid}/values", params={"category": "names"}).json()
    assert gv["count"] == MAX_THEME_CATEGORY_VALUES
    assert any(c["category"] == "names" and c["full"] for c in gv["categories"])

    # Delete one, edit another
    vid = gv["values"][0]["id"]
    client.delete(f"/api/themes/{tid}/values/{vid}")
    vid2 = gv["values"][1]["id"]
    u = client.put(
        f"/api/themes/{tid}/values/{vid2}",
        json={"value": "Edited Name"},
    )
    assert u.status_code == 200
    assert u.json()["value"] == "Edited Name"

    client.delete(f"/api/themes/{tid}")


def test_field_theme_id_scopes_pool():
    """Field themeId + themeCategory only draws from that pack's category."""
    client = TestClient(app)
    sw = client.post("/api/themes", json={"name": "SW Test"}).json()
    other = client.post("/api/themes", json={"name": "Other Test"}).json()
    client.post(
        f"/api/themes/{sw['id']}/values",
        json={"category": "names", "values": ["Luke", "Leia", "Han"]},
    )
    client.post(
        f"/api/themes/{other['id']}/values",
        json={"category": "names", "values": ["Alice", "Bob", "Carol"]},
    )

    def lookup(cat, theme_id=None):
        if theme_id:
            rows = client.get(
                f"/api/themes/{theme_id}/values", params={"category": cat}
            ).json()["values"]
            return [r["value"] for r in rows]
        # blend both
        a = lookup(cat, sw["id"])
        b = lookup(cat, other["id"])
        return a + b

    root = [
        {
            "key": "hero",
            "kind": "value",
            "themeCategory": "names",
            "themeId": sw["id"],
            "sampleValue": "X",
            "children": [],
        }
    ]
    g = Generator(
        root,
        seed=1,
        ci_mode=False,
        custom_lookup=lambda _k: [],
        history_lookup=lambda _k: [],
        theme_lookup=lookup,
        theme_prefer=True,
    )
    vals = [g.one_record()["hero"] for _ in range(20)]
    assert all(v in ("Luke", "Leia", "Han") for v in vals), vals
    assert g.stats["themeHits"] == 20

    client.delete(f"/api/themes/{sw['id']}")
    client.delete(f"/api/themes/{other['id']}")


def test_delete_theme_category():
    client = TestClient(app)
    t = client.post("/api/themes", json={"name": "DelCat Theme"}).json()
    tid = t["id"]
    client.post(
        f"/api/themes/{tid}/values",
        json={"category": "ships", "values": ["X-Wing", "TIE Fighter"]},
    )
    client.post(
        f"/api/themes/{tid}/values",
        json={"category": "names", "values": ["Luke"]},
    )
    cats = client.get(f"/api/themes/{tid}/categories").json()["categories"]
    assert {c["category"] for c in cats} >= {"ships", "names"}

    r = client.delete(f"/api/themes/{tid}/categories/ships")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] == 2
    remaining = {c["category"] for c in body["categories"]}
    assert "ships" not in remaining
    assert "names" in remaining

    # Deleting again is ok (0 deleted)
    r2 = client.delete(f"/api/themes/{tid}/categories/ships")
    assert r2.status_code == 200
    assert r2.json()["deleted"] == 0

    client.delete(f"/api/themes/{tid}")
