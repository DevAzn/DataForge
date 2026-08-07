"""Slice 1: POST /api/generate/preview — cap, no history write, sampleRows."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import PREVIEW_MAX_RECORDS, app


client = TestClient(app)


def _schema(name: str = "Preview schema"):
    return {
        "id": "sch-preview-1",
        "name": name,
        "root": [
            {
                "id": "f1",
                "key": "code",
                "kind": "value",
                "generateMode": "enum",
                "enumValues": ["A", "B", "C"],
            },
            {
                "id": "f2",
                "key": "label",
                "kind": "value",
                "generateMode": "synth",
            },
        ],
    }


def test_preview_returns_sample_rows_and_report():
    body = {
        "schema": _schema(),
        "recordCount": 5,
        "seed": 42,
        "ciMode": True,
        "recordHistory": True,  # must be ignored
    }
    res = client.post("/api/generate/preview", json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data.get("preview") is True
    assert data["recordCount"] == 5
    assert len(data["records"]) == 5
    assert isinstance(data.get("sampleRows"), list)
    assert len(data["sampleRows"]) == 5
    assert "report" in data and isinstance(data["report"], dict)
    # enum field should produce enum hits
    assert (data["report"].get("enumHits") or 0) >= 1
    # never echo history buffer
    assert "historyBuffer" not in data


def test_preview_clamps_record_count():
    body = {
        "schema": _schema(),
        "recordCount": 500,
        "seed": 1,
        "ciMode": True,
    }
    res = client.post("/api/generate/preview", json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["recordCount"] == PREVIEW_MAX_RECORDS
    assert len(data["records"]) == PREVIEW_MAX_RECORDS


def test_preview_empty_schema_400():
    res = client.post(
        "/api/generate/preview",
        json={"schema": {"name": "empty", "root": []}, "recordCount": 3},
    )
    assert res.status_code == 400


def test_preview_does_not_grow_history_bank():
    page = client.get("/api/history/page?offset=0&limit=1")
    assert page.status_code == 200
    before_total = int(page.json().get("total") or 0)

    res = client.post(
        "/api/generate/preview",
        json={
            "schema": _schema(),
            "recordCount": 8,
            "seed": 7,
            "ciMode": False,
            "recordHistory": True,
        },
    )
    assert res.status_code == 200, res.text

    page2 = client.get("/api/history/page?offset=0&limit=1")
    after_total = int(page2.json().get("total") or 0)
    assert after_total == before_total
