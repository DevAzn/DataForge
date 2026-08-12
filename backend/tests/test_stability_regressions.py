"""
Regression anchors for stability fixes:
- package generate document shape (isRecordTag) + absolute same-mode paths
- stream XML uses assemble document
- default multi-file bundle tar.gz
- save_schema preserves csvTiedFieldPaths when omitted
- package record_history defaults to False
- health identity
"""
from __future__ import annotations

import base64
import inspect
import io
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import app.database as db  # noqa: E402
from app.main import APP_NAME, APP_VERSION, app  # noqa: E402
from app.services import archive_svc, package_svc  # noqa: E402
from app.services.package_svc import generate_package_variants  # noqa: E402

CATALOG_XML = (
    b'<?xml version="1.0"?>'
    b"<catalog><book>"
    b"<title>The Pragmatic Programmer</title>"
    b"<author>Andrew Hunt</author>"
    b"<year>1999</year>"
    b"</book></catalog>"
)

CATALOG_SCHEMA = {
    "name": "Catalog",
    "xmlRootTag": "catalog",
    "xmlRecordTag": "book",
    "csvTiedFieldPaths": ["catalog.book.author"],
    "root": [
        {
            "key": "catalog",
            "kind": "object",
            "children": [
                {
                    "key": "book",
                    "kind": "array",
                    "isRecordTag": True,
                    "children": [
                        {
                            "key": "title",
                            "kind": "value",
                            "sampleValue": "TitleA",
                            "children": [],
                        },
                        {
                            "key": "author",
                            "kind": "value",
                            "sampleValue": "AuthorLocked",
                            "children": [],
                        },
                        {
                            "key": "year",
                            "kind": "value",
                            "sampleValue": "1999",
                            "children": [],
                        },
                    ],
                }
            ],
        }
    ],
}


def test_health_identity_strict():
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("app") == APP_NAME
    assert body.get("version") == APP_VERSION
    assert "DataForge" in str(body.get("app"))


def test_default_bundle_format_product_rule():
    assert archive_svc.default_bundle_format(1) == "zip"
    assert archive_svc.default_bundle_format(2) == "tar.gz"
    assert archive_svc.default_bundle_format(10) == "tar.gz"


def test_per_file_default_bundle_is_tar_gz_when_n_gt_1():
    """Omit archiveFormat — multi-record per-file must default to tar.gz."""
    client = TestClient(app)
    r = client.post(
        "/api/generate/per-file",
        json={
            "schema": {
                "name": "bundle-default",
                "root": [
                    {
                        "key": "name",
                        "kind": "value",
                        "sampleValue": "Ada",
                        "children": [],
                    }
                ],
            },
            "recordCount": 3,
            "seed": 1,
            "ciMode": True,
            "recordHistory": False,
            "format": "xml",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["archiveFormat"] == "tar.gz"
    assert (body.get("fileName") or "").endswith(".tar.gz")
    raw = base64.b64decode(body["archiveBase64"] or body["zipBase64"])
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        files = [m for m in tar.getmembers() if m.isfile()]
    assert len(files) == 3


def test_per_file_default_bundle_is_zip_when_n_eq_1():
    client = TestClient(app)
    r = client.post(
        "/api/generate/per-file",
        json={
            "schema": {
                "name": "bundle-one",
                "root": [
                    {
                        "key": "name",
                        "kind": "value",
                        "sampleValue": "Ada",
                        "children": [],
                    }
                ],
            },
            "recordCount": 1,
            "seed": 1,
            "ciMode": True,
            "recordHistory": False,
            "format": "xml",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["archiveFormat"] == "zip"
    raw = base64.b64decode(body["archiveBase64"] or body["zipBase64"])
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        assert len([n for n in zf.namelist() if not n.endswith("/")]) == 1


def test_stream_xml_is_record_tag_document_shape():
    client = TestClient(app)
    r = client.post(
        "/api/generate/stream",
        json={
            "schema": CATALOG_SCHEMA,
            "recordCount": 3,
            "seed": 5,
            "ciMode": True,
            "recordHistory": False,
            "format": "xml",
            "xmlRootTag": "catalog",
            "xmlRecordTag": "book",
        },
    )
    assert r.status_code == 200, r.text[:400]
    text = r.text
    assert not text.lstrip().startswith("ERROR:")
    assert text.strip().startswith("<catalog>")
    assert text.count("<book>") == 3
    assert "<title>" in text and "<author>" in text


def test_package_generate_is_record_tag_shape_and_absolute_same_mode():
    """
    Package XML must assemble schema tree (catalog/book), not flat <root><title>…
    Absolute field mode path catalog.book.author must lock author across variants.
    """
    pkg = package_svc.import_package_from_bytes(
        package_name="catalog-pkg",
        file_entries=[("catalog.xml", CATALOG_XML)],
        source_kind="files",
        outer_format="folder",
    )
    pid = pkg["id"]
    # Force isRecordTag tree (import may not set isRecordTag from simple sample)
    hydrated = db.get_package_hydrated(pid)
    assert hydrated
    xml_path = next(m["path"] for m in hydrated["members"] if m["kind"] == "text")
    schema = hydrated["schemas"][xml_path]
    # Overlay known record-tag schema so generate path is exercised
    schema = {
        **schema,
        **CATALOG_SCHEMA,
        "id": schema["id"],
        "name": schema.get("name") or "Catalog",
        "isPackageMember": True,
        "packageId": pid,
    }
    db.save_schema(schema)

    result = package_svc.generate_package_variants(
        pid,
        record_count=3,
        seed=42,
        ci_mode=True,
        record_history=False,
        default_field_mode="random",
        field_modes={
            xml_path: {
                "catalog.book.author": "same",
                "author": "same",
                "title": "random",
                "year": "random",
            }
        },
        output_format="itself",
        bundle_format="tar.gz",
    )
    assert result["written"] == 3
    raw = base64.b64decode(result["archiveBase64"] or result["zipBase64"])
    # Collect xml bodies from variants
    bodies: list[str] = []
    fmt = result.get("archiveFormat")
    if fmt == "file":
        bodies.append(raw.decode("utf-8", errors="replace"))
    elif fmt == "tar.gz":
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith((".xml", ".tar.gz", ".zip", ".tar")):
                    f = tar.extractfile(m)
                    data = f.read() if f else b""
                    if m.name.endswith(".xml"):
                        bodies.append(data.decode("utf-8", errors="replace"))
                    elif m.name.endswith(".tar.gz"):
                        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as inner:
                            for im in inner.getmembers():
                                if im.isfile() and im.name.endswith(".xml"):
                                    ff = inner.extractfile(im)
                                    bodies.append(
                                        (ff.read() if ff else b"").decode(
                                            "utf-8", errors="replace"
                                        )
                                    )
                    elif m.name.endswith(".zip"):
                        with zipfile.ZipFile(io.BytesIO(data)) as zf:
                            for n in zf.namelist():
                                if n.endswith(".xml"):
                                    bodies.append(
                                        zf.read(n).decode("utf-8", errors="replace")
                                    )
    else:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for n in zf.namelist():
                if n.endswith(".xml"):
                    bodies.append(zf.read(n).decode("utf-8", errors="replace"))

    assert bodies, "no xml bodies extracted from package variants"
    for b in bodies:
        assert "<catalog>" in b, b[:200]
        assert "<book>" in b, b[:200]
        # Not the list-envelope mistake under synthetic root for this schema
        assert not b.strip().startswith("<root>"), b[:200]
    authors = []
    import re

    for b in bodies:
        authors.extend(re.findall(r"<author>([^<]*)</author>", b))
    assert authors
    assert len(set(authors)) == 1, authors


def test_package_record_history_default_is_false():
    sig = inspect.signature(generate_package_variants)
    assert sig.parameters["record_history"].default is False


def test_save_schema_preserves_tied_paths_when_omitted():
    saved = db.save_schema(
        {
            "name": "tied-preserve",
            "root": [
                {"key": "region", "kind": "value", "sampleValue": "EU", "children": []}
            ],
            "csvTiedFieldPaths": ["region"],
        }
    )
    sid = saved["id"]
    assert saved.get("csvTiedFieldPaths") == ["region"]
    # Partial save without csvTiedFieldPaths key
    again = db.save_schema(
        {
            "id": sid,
            "name": "tied-preserve",
            "root": [
                {"key": "region", "kind": "value", "sampleValue": "EU", "children": []}
            ],
        }
    )
    assert again.get("csvTiedFieldPaths") == ["region"]
    # Explicit clear
    cleared = db.save_schema(
        {
            "id": sid,
            "name": "tied-preserve",
            "root": [
                {"key": "region", "kind": "value", "sampleValue": "EU", "children": []}
            ],
            "csvTiedFieldPaths": [],
        }
    )
    assert cleared.get("csvTiedFieldPaths") in ([], None)
