"""Stream generate: true row stream for csv/txt; structured caps for xml/json."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.defaults import STREAM_STRUCTURED_MAX_RECORDS  # noqa: E402
from app.main import app  # noqa: E402

SCHEMA = {
    "name": "stream-test",
    "root": [
        {"key": "name", "kind": "value", "sampleValue": "Ada", "children": []},
        {"key": "city", "kind": "value", "sampleValue": "London", "children": []},
    ],
}


def test_stream_txt_above_structured_cap_is_true_stream():
    """TXT is a true row stream (not structured-capped) — large N must return 200."""
    client = TestClient(app)
    n = STREAM_STRUCTURED_MAX_RECORDS + 5
    r = client.post(
        "/api/generate/stream",
        json={
            "schema": SCHEMA,
            "recordCount": n,
            "seed": 1,
            "ciMode": True,
            "recordHistory": False,
            "format": "txt",
        },
    )
    assert r.status_code == 200, r.text[:300]
    assert not r.text.lstrip().startswith("ERROR:")
    lines = [ln for ln in r.text.splitlines() if ln.strip()]
    assert len(lines) == n + 1  # header + n data
    assert "\t" in lines[0]
    assert "name" in lines[0] and "city" in lines[0]


def test_stream_csv_above_structured_cap():
    client = TestClient(app)
    n = STREAM_STRUCTURED_MAX_RECORDS + 3
    r = client.post(
        "/api/generate/stream",
        json={
            "schema": SCHEMA,
            "recordCount": n,
            "seed": 2,
            "ciMode": True,
            "recordHistory": False,
            "format": "csv",
            "layoutMode": "single-header",
        },
    )
    assert r.status_code == 200, r.text[:300]
    assert not r.text.lstrip().startswith("ERROR:")
    lines = [ln for ln in r.text.splitlines() if ln.strip()]
    assert len(lines) == n + 1


def test_stream_xml_above_cap_returns_400():
    client = TestClient(app)
    r = client.post(
        "/api/generate/stream",
        json={
            "schema": SCHEMA,
            "recordCount": STREAM_STRUCTURED_MAX_RECORDS + 1,
            "seed": 3,
            "ciMode": True,
            "recordHistory": False,
            "format": "xml",
        },
    )
    assert r.status_code == 400
    assert "limited" in r.text.lower() or "Stream format" in r.text


def test_stream_no_error_prefix_on_small_csv():
    client = TestClient(app)
    r = client.post(
        "/api/generate/stream",
        json={
            "schema": SCHEMA,
            "recordCount": 5,
            "seed": 4,
            "ciMode": True,
            "recordHistory": False,
            "format": "csv",
        },
    )
    assert r.status_code == 200
    assert not r.text.lstrip().startswith("ERROR:")
    assert "name" in r.text
