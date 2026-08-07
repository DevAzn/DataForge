"""Slice 2: POST /api/schemas/{id}/clone."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_clone_schema_new_id_and_name():
    body = {
        "id": "sch-clone-src",
        "name": "Orders",
        "root": [
            {
                "id": "f1",
                "key": "orderId",
                "kind": "value",
                "generateMode": "synth",
            }
        ],
    }
    save = client.post("/api/schemas", json=body)
    assert save.status_code == 200, save.text
    payload = save.json()
    src_id = payload["id"]
    assert payload["name"] == "Orders"

    res = client.post(f"/api/schemas/{src_id}/clone")
    assert res.status_code == 200, res.text
    cloned = res.json()
    assert cloned["id"] != src_id
    assert cloned["name"] == "Orders (copy)"
    assert isinstance(cloned.get("root"), list)
    assert len(cloned["root"]) == 1
    assert cloned["root"][0]["key"] == "orderId"

    # Original still present
    orig = client.get(f"/api/schemas/{src_id}")
    assert orig.status_code == 200
    assert orig.json()["name"] == "Orders"


def test_clone_missing_404():
    res = client.post("/api/schemas/does-not-exist/clone")
    assert res.status_code == 404
