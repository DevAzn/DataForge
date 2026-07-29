"""Per-file archive format + directory name for generate bundles."""
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
from app.services import archive_svc  # noqa: E402

SCHEMA = {
    "name": "TestGen",
    "root": [
        {"key": "title", "kind": "value", "sampleValue": "A", "children": []},
        {"key": "author", "kind": "value", "sampleValue": "B", "children": []},
    ],
}


def test_pack_named_entries_tar_and_tar_gz():
    entries = [("TestGen/a.xml", "<a/>"), ("TestGen/b.xml", "<b/>")]
    raw, ext, _ = archive_svc.pack_named_entries(entries, format="tar")
    assert ext == ".tar"
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        names = [m.name for m in tar.getmembers() if m.isfile()]
    assert names == ["TestGen/a.xml", "TestGen/b.xml"] or set(names) == set(
        ["TestGen/a.xml", "TestGen/b.xml"]
    )

    raw2, ext2, _ = archive_svc.pack_named_entries(entries, format="tar.gz")
    assert ext2 == ".tar.gz"
    with tarfile.open(fileobj=io.BytesIO(raw2), mode="r:gz") as tar:
        names2 = [m.name for m in tar.getmembers() if m.isfile()]
    assert "TestGen/a.xml" in names2


def test_per_file_archive_dir_and_tar_gz():
    client = TestClient(app)
    r = client.post(
        "/api/generate/per-file",
        json={
            "schema": SCHEMA,
            "recordCount": 3,
            "seed": 1,
            "ciMode": True,
            "recordHistory": False,
            "format": "xml",
            "archiveFormat": "tar.gz",
            "archiveDir": "TestGen",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["archiveFormat"] == "tar.gz"
    assert body["archiveDir"] == "TestGen"
    assert body["fileName"] == "TestGen.tar.gz"
    raw = base64.b64decode(body["archiveBase64"] or body["zipBase64"])
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        names = [m.name for m in tar.getmembers() if m.isfile()]
    assert len(names) == 3
    assert all(n.startswith("TestGen/") for n in names)


def test_build_archive_with_content_and_top_folder():
    raw, media = archive_svc.build_archive(
        [{"fileName": "TestGen.xml", "format": "xml", "content": "<root/>"}],
        extension=".tar",
        top_folder="TestGen",
    )
    assert media
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        names = [m.name for m in tar.getmembers() if m.isfile()]
    assert names == ["TestGen/TestGen.xml"] or "TestGen/TestGen.xml" in names
