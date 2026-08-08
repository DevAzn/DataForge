"""Custom field-value lists: pool cap (MAX_FIELD_VALUES_PER_TAG)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.defaults import FIELD_VALUES_WARN_AT, MAX_FIELD_VALUES_PER_TAG  # noqa: E402
from app.main import app  # noqa: E402


def test_custom_list_value_cap():
    client = TestClient(app)
    lst = client.post(
        "/api/custom-lists",
        json={"name": "Cap List QA", "keys": ["city"]},
    ).json()
    lid = lst["id"]

    # Fill near warn threshold in chunks
    batch = [f"c{i}" for i in range(FIELD_VALUES_WARN_AT)]
    r = client.post(f"/api/custom-lists/{lid}/values", json={"values": batch})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["inserted"] == FIELD_VALUES_WARN_AT
    assert body["total"] == FIELD_VALUES_WARN_AT
    assert body.get("warning")

    more = [f"x{i}" for i in range(MAX_FIELD_VALUES_PER_TAG - FIELD_VALUES_WARN_AT + 10)]
    r2 = client.post(f"/api/custom-lists/{lid}/values", json={"values": more})
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["total"] == MAX_FIELD_VALUES_PER_TAG
    assert b2["skippedCap"] >= 1
    assert b2["inserted"] == MAX_FIELD_VALUES_PER_TAG - FIELD_VALUES_WARN_AT
    assert b2.get("warning")

    got = client.get(f"/api/custom-lists/{lid}").json()
    assert len(got.get("values") or []) == MAX_FIELD_VALUES_PER_TAG

    client.delete(f"/api/custom-lists/{lid}")
