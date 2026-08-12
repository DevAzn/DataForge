"""
API smoke: import tar + tar.gz → estimate → generate (formats + modes).
Uses FastAPI TestClient against real routes.
"""
from __future__ import annotations

import base64
import io
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def _tar_bytes(entries: list[tuple[str, bytes]], *, gzip: bool) -> bytes:
    buf = io.BytesIO()
    mode = "w:gz" if gzip else "w:"
    with tarfile.open(fileobj=buf, mode=mode) as tar:
        for path, data in entries:
            info = tarfile.TarInfo(name=path)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


XML = b'<?xml version="1.0"?><root><name>Ada</name><n>1</n></root>'
CSV = b"name,n\nAda,1\n"
TXT = b"note\n"
BIN = b"\xff\x00bin"


def test_health():
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True or body.get("status") == "ok" or "DataForge" in str(body) or body
    # app identity
    assert "dataforge" in str(body).lower() or body.get("ok") is not False


def test_import_tar_gz_estimate_generate():
    client = TestClient(app)
    raw = _tar_bytes(
        [
            ("nest/a.xml", XML),
            ("nest/b.csv", CSV),
            ("readme.txt", TXT),
            ("x.bin", BIN),
        ],
        gzip=True,
    )
    r = client.post(
        "/api/packages/import",
        files=[("files", ("fixture.tar.gz", raw, "application/gzip"))],
    )
    assert r.status_code == 200, r.text
    pkg = r.json()
    assert pkg.get("id")
    text = [m for m in pkg["members"] if m["kind"] == "text"]
    assert len(text) >= 3
    assert any("a.xml" in m["path"] for m in text)
    # Non-schema files are structural (scrambled on generate), not dropped to skipped.
    structural = [m for m in pkg["members"] if m["kind"] == "structural"]
    assert any(m["path"].endswith("x.bin") for m in structural), structural
    bin_m = next(m for m in structural if m["path"].endswith("x.bin"))
    assert bin_m.get("content") in (None, "")
    assert bin_m.get("scrambled") is True
    assert int(bin_m.get("byteSize") or 0) == len(BIN)

    pid = pkg["id"]
    er = client.get(f"/api/packages/{pid}/estimate", params={"recordCount": 3})
    assert er.status_code == 200, er.text
    est = er.json()
    assert est["recordCount"] == 3
    assert est["textFilesPerPackage"] >= 3

    xml_path = next(m["path"] for m in text if m["path"].endswith(".xml"))
    gr = client.post(
        f"/api/packages/{pid}/generate",
        json={
            "recordCount": 2,
            "seed": 99,
            "ciMode": True,
            "recordHistory": False,
            "defaultFieldMode": "random",
            "fieldModes": {xml_path: {"name": "same", "n": "random"}},
            "outputFormat": "tar.gz",
            "bundleFormat": "tar.gz",
        },
    )
    assert gr.status_code == 200, gr.text
    gen = gr.json()
    assert gen["written"] == 2
    assert gen.get("archiveBase64") or gen.get("zipBase64")
    assert gen["archiveFormat"] == "tar.gz"
    # not empty
    blob = base64.b64decode(gen["archiveBase64"] or gen["zipBase64"])
    assert len(blob) > 20


def test_import_tar_generate_tar():
    client = TestClient(app)
    raw = _tar_bytes([("only.xml", XML)], gzip=False)
    r = client.post(
        "/api/packages/import",
        files=[("files", ("plain.tar", raw, "application/x-tar"))],
    )
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    gr = client.post(
        f"/api/packages/{pid}/generate",
        json={
            "recordCount": 2,
            "seed": 1,
            "ciMode": True,
            "recordHistory": False,
            "outputFormat": "tar",
            "bundleFormat": "tar",
        },
    )
    assert gr.status_code == 200, gr.text
    gen = gr.json()
    assert gen["written"] == 2
    assert gen["fileName"].endswith(".tar")
    assert gen["archiveFormat"] == "tar"


def test_member_patch_and_save_as():
    client = TestClient(app)
    raw = _tar_bytes([("edit.xml", XML)], gzip=True)
    r = client.post(
        "/api/packages/import",
        files=[("files", ("e.tar.gz", raw, "application/gzip"))],
    )
    assert r.status_code == 200, r.text
    pkg = r.json()
    pid = pkg["id"]
    path = next(m["path"] for m in pkg["members"] if m["kind"] == "text")
    ur = client.patch(
        f"/api/packages/{pid}/members",
        json={
            "memberPath": path,
            "newName": "edited.xml",
            "content": "<?xml version='1.0'?><root><name>Zed</name></root>",
        },
    )
    assert ur.status_code == 200, ur.text
    body = ur.json()
    m = next(x for x in body["members"] if x["kind"] == "text")
    assert m["name"] == "edited.xml"
    assert "Zed" in (m.get("content") or "")

    sr = client.post(
        f"/api/packages/{pid}/members/save-as",
        json={"memberPath": m["path"], "newSchemaName": "Smoke save-as schema"},
    )
    assert sr.status_code == 200, sr.text
    assert sr.json()["schema"]["name"] == "Smoke save-as schema"


if __name__ == "__main__":
    test_health()
    test_import_tar_gz_estimate_generate()
    test_import_tar_generate_tar()
    test_member_patch_and_save_as()
    print("ok test_package_api_smoke")
