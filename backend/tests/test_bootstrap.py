"""Smoke: GET /api/bootstrap returns the boot payload the UI needs."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_bootstrap_shape_and_keys():
    client = TestClient(app)
    res = client.get("/api/bootstrap")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data.get("ok") is True
    for key in (
        "status",
        "settings",
        "schemas",
        "packages",
        "themes",
        "customLists",
        "templates",
        "deliveryJobs",
        "themeCategories",
    ):
        assert key in data, f"missing key {key}"

    assert isinstance(data["status"], dict)
    assert data["status"].get("ok") is True
    assert "schemaCount" in data["status"]
    assert isinstance(data["settings"], dict)
    assert isinstance(data["schemas"], list)
    assert isinstance(data["packages"], list)
    assert isinstance(data["themes"], list)
    assert isinstance(data["customLists"], list)
    assert isinstance(data["templates"], list)
    assert isinstance(data["deliveryJobs"], list)
    assert isinstance(data["themeCategories"], list)


def test_bootstrap_survives_empty_db():
    client = TestClient(app)
    data = client.get("/api/bootstrap").json()
    assert data["status"]["schemaCount"] == len(data["schemas"])
    assert data["status"]["templateCount"] == len(data["templates"])


def test_individual_list_endpoints_still_exist():
    client = TestClient(app)
    for path in (
        "/api/status",
        "/api/settings",
        "/api/schemas",
        "/api/packages",
        "/api/themes",
        "/api/custom-lists",
        "/api/templates",
    ):
        r = client.get(path)
        assert r.status_code == 200, path
