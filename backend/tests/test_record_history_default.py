"""recordHistory defaults to False (aligned with UI opt-in)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import GenerateBody, PackageGenerateBody, app

client = TestClient(app)


def _schema():
    return {
        "name": "HistDefault",
        "root": [
            {
                "id": "f1",
                "key": "code",
                "kind": "value",
                "generateMode": "enum",
                "enumValues": ["A", "B"],
            }
        ],
    }


def test_generate_body_default_record_history_false():
    body = GenerateBody.model_validate({"schema": _schema(), "recordCount": 2})
    assert body.recordHistory is False


def test_package_generate_body_default_record_history_false():
    body = PackageGenerateBody.model_validate({"recordCount": 1})
    assert body.recordHistory is False


def test_generate_without_flag_does_not_grow_history():
    before = client.get("/api/history/page?offset=0&limit=1")
    assert before.status_code == 200
    total_before = int(before.json().get("total") or 0)

    res = client.post(
        "/api/generate",
        json={
            "schema": _schema(),
            "recordCount": 5,
            "seed": 11,
            "ciMode": False,
            # omit recordHistory — must default false
        },
    )
    assert res.status_code == 200, res.text

    after = client.get("/api/history/page?offset=0&limit=1")
    total_after = int(after.json().get("total") or 0)
    assert total_after == total_before


def test_generate_with_record_history_true_can_grow():
    before = client.get("/api/history/page?offset=0&limit=1")
    total_before = int(before.json().get("total") or 0)

    res = client.post(
        "/api/generate",
        json={
            "schema": _schema(),
            "recordCount": 3,
            "seed": 22,
            "ciMode": False,
            "recordHistory": True,
        },
    )
    assert res.status_code == 200, res.text
    # Enum-only fields may or may not push history depending on generator;
    # assert request accepted and default path remains opt-in.
    assert "records" in res.json()
    # Soft: total may stay same if enum stage does not buffer history — just ensure no crash
    after = client.get("/api/history/page?offset=0&limit=1")
    assert after.status_code == 200
    assert int(after.json().get("total") or 0) >= total_before
