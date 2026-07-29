"""Field values pools: opt-in per tag, shared by tag name, max 1000."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.defaults import MAX_FIELD_VALUES_PER_TAG  # noqa: E402
from app.main import app  # noqa: E402
import app.database as db  # noqa: E402


def test_save_without_opt_in_does_not_write_field_pool():
    client = TestClient(app)
    schema = {
        "name": "NoOptIn",
        "root": [
            {
                "key": "TN",
                "kind": "value",
                "sampleValue": "SHOULD_NOT_AUTO",
                "children": [],
            }
        ],
    }
    r = client.post("/api/schemas", json=schema)
    assert r.status_code == 200, r.text
    vals = db.get_custom_values_for_key("TN")
    assert "SHOULD_NOT_AUTO" not in vals


def test_save_with_opt_in_maps_tag_pool():
    client = TestClient(app)
    schema = {
        "name": "TNFiles",
        "root": [
            {
                "key": "TN",
                "kind": "value",
                "sampleValue": "VAL_A",
                "sampleValues": ["VAL_A", "VAL_B"],
                "saveToFieldPool": True,
                "children": [],
            },
            {
                "key": "hero",
                "kind": "value",
                "sampleValue": "Luke",
                "themeCategory": "names",
                "saveToFieldPool": True,
                "children": [],
            },
        ],
    }
    r = client.post("/api/schemas", json=schema)
    assert r.status_code == 200, r.text
    tn = db.get_custom_values_for_key("TN")
    assert "VAL_A" in tn and "VAL_B" in tn
    # Theme field skipped even with saveToFieldPool
    assert "Luke" not in db.get_custom_values_for_key("hero")


def test_tag_pool_shared_across_schemas_and_cap():
    client = TestClient(app)
    # Two schemas both contribute to tag TN
    for i, val in enumerate(["SHARED_1", "SHARED_2"]):
        r = client.post(
            "/api/schemas",
            json={
                "name": f"File{i}",
                "root": [
                    {
                        "key": "TN",
                        "kind": "value",
                        "sampleValue": val,
                        "saveToFieldPool": True,
                        "children": [],
                    }
                ],
            },
        )
        assert r.status_code == 200, r.text
    tn = db.get_custom_values_for_key("TN")
    assert "SHARED_1" in tn and "SHARED_2" in tn

    # Cap at 1000
    batch = [f"bulk_{i}" for i in range(MAX_FIELD_VALUES_PER_TAG + 20)]
    res = db.ensure_custom_field_values("CAPTAG", batch)
    assert res["total"] == MAX_FIELD_VALUES_PER_TAG
    assert res["skippedCap"] >= 1
    assert res.get("warning")


def test_resave_same_samples_does_not_duplicate():
    client = TestClient(app)
    schema = {
        "name": "NoDup",
        "root": [
            {
                "key": "code",
                "kind": "value",
                "sampleValue": "X1",
                "saveToFieldPool": True,
                "children": [],
            }
        ],
    }
    r1 = client.post("/api/schemas", json=schema)
    assert r1.status_code == 200
    sid = r1.json()["id"]
    before = db.get_custom_values_for_key("code")
    n_before = before.count("X1")
    schema["id"] = sid
    r2 = client.post("/api/schemas", json=schema)
    assert r2.status_code == 200
    after = db.get_custom_values_for_key("code")
    assert after.count("X1") == n_before


def test_map_fields_maps_all_non_theme_samples():
    """Toolbar Map fields: all tags with samples → pool (no per-field opt-in)."""
    client = TestClient(app)
    schema = {
        "name": "MapAll",
        "root": [
            {
                "key": "TN",
                "kind": "value",
                "sampleValue": "MAP_TN_1",
                "sampleValues": ["MAP_TN_1", "MAP_TN_2"],
                "children": [],
            },
            {
                "key": "AC",
                "kind": "value",
                "sampleValue": "MAP_AC_1",
                "children": [],
            },
            {
                "key": "hero",
                "kind": "value",
                "sampleValue": "MapLuke",
                "themeCategory": "names",
                "children": [],
            },
        ],
    }
    r = client.post("/api/schemas/map-fields", json=schema)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("schema", {}).get("id")
    sync = body.get("fieldValuesSynced") or {}
    assert int(sync.get("inserted") or 0) >= 3
    tn = db.get_custom_values_for_key("TN")
    ac = db.get_custom_values_for_key("AC")
    assert "MAP_TN_1" in tn and "MAP_TN_2" in tn
    assert "MAP_AC_1" in ac
    # Theme fields excluded from Field values map
    assert "MapLuke" not in db.get_custom_values_for_key("hero")