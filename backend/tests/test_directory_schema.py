"""
1:1 directory schema: folder import keeps relative paths; generate emits that tree.

Drives shipped import_uploaded_files / generate_package_variants and the FastAPI
import + generate routes. No mocks of those units, no re-implementation, no
hardcoded generated file bodies.
"""
from __future__ import annotations

import base64
import io
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import package_svc  # noqa: E402

XML = b'<?xml version="1.0"?><root><name>ORIG_XML_MARKER</name><seq>1</seq></root>'
CSV = b"name,city\nORIG_CSV_MARKER,Here\n"
BIN = b"ORIG_BIN_BYTES_XX"

NESTED = [
    ("sample-dir/data/person.xml", XML),
    ("sample-dir/notes/readme.csv", CSV),
    ("sample-dir/assets/logo.bin", BIN),
]
UPLOADED_PATHS = {p for p, _ in NESTED}
UPLOADED = {p: b for p, b in NESTED}


def _archive_files(raw: bytes) -> list[tuple[str, bytes]]:
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            return [(n, zf.read(n)) for n in zf.namelist() if not n.endswith("/")]
    for mode in ("r:gz", "r:"):
        try:
            with tarfile.open(fileobj=io.BytesIO(raw), mode=mode) as tar:
                out: list[tuple[str, bytes]] = []
                for m in tar.getmembers():
                    if not m.isfile():
                        continue
                    fh = tar.extractfile(m)
                    out.append((m.name.replace("\\", "/"), fh.read() if fh else b""))
                return out
        except tarfile.TarError:
            continue
    return []


def _trees_from_download(raw: bytes) -> list[dict[str, bytes]]:
    """
    Decode a generate download into one or more relative trees.
    N=1: members are the uploaded relative paths.
    N>1: a single extra variant-root prefix is allowed.
    """
    members = {n.replace("\\", "/"): data for n, data in _archive_files(raw)}
    assert members, "download archive had no files"
    if set(members) == UPLOADED_PATHS:
        return [members]
    groups: dict[str, dict[str, bytes]] = {}
    for path, data in members.items():
        assert "/" in path, f"N>1 member missing variant root: {path}"
        root, rest = path.split("/", 1)
        groups.setdefault(root, {})[rest] = data
    assert groups, members
    return list(groups.values())


def _assert_one_to_one_tree(tree: dict[str, bytes]) -> None:
    assert set(tree) == UPLOADED_PATHS, (set(tree), UPLOADED_PATHS)
    assert tree["sample-dir/data/person.xml"] != XML
    assert tree["sample-dir/notes/readme.csv"] != CSV
    assert "sample-dir/assets/logo.bin" in tree
    assert tree["sample-dir/assets/logo.bin"] != BIN
    assert len(tree["sample-dir/assets/logo.bin"]) == len(BIN)


def test_import_uploaded_files_keeps_relative_paths():
    pkg = package_svc.import_uploaded_files(list(NESTED))
    persisted = {
        m["path"]
        for m in pkg["members"]
        if m["kind"] in ("text", "structural")
    }
    assert persisted == UPLOADED_PATHS
    by_path = {m["path"]: m for m in pkg["members"]}
    assert by_path["sample-dir/data/person.xml"]["kind"] == "text"
    assert by_path["sample-dir/notes/readme.csv"]["kind"] == "text"
    struct = by_path["sample-dir/assets/logo.bin"]
    assert struct["kind"] == "structural"
    assert struct.get("byteSize") == len(BIN)
    assert not struct.get("content")


def test_import_single_nested_file_keeps_directory_path():
    pkg = package_svc.import_uploaded_files([NESTED[0]])
    paths = [m["path"] for m in pkg["members"] if m["kind"] in ("text", "structural")]
    assert paths == ["sample-dir/data/person.xml"]


def test_generate_directory_n1_is_one_to_one():
    pkg = package_svc.import_uploaded_files(list(NESTED))
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=1,
        seed=17,
        ci_mode=True,
        record_history=False,
        output_format="itself",
    )
    assert result["written"] == 1
    raw = base64.b64decode(result["archiveBase64"] or result["zipBase64"])
    trees = _trees_from_download(raw)
    assert len(trees) == 1
    _assert_one_to_one_tree(trees[0])


def test_generate_directory_n2_variant_root_only():
    pkg = package_svc.import_uploaded_files(list(NESTED))
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=2,
        seed=17,
        ci_mode=True,
        record_history=False,
        output_format="itself",
    )
    assert result["written"] == 2
    raw = base64.b64decode(result["archiveBase64"] or result["zipBase64"])
    trees = _trees_from_download(raw)
    assert len(trees) == 2
    for tree in trees:
        _assert_one_to_one_tree(tree)


def test_api_import_then_generate_n1_and_n2():
    client = TestClient(app)
    files = [
        ("files", (path, data, "application/octet-stream")) for path, data in NESTED
    ]
    imported = client.post("/api/packages/import", files=files)
    assert imported.status_code == 200, imported.text
    pkg = imported.json()
    persisted = {
        m["path"] for m in pkg["members"] if m["kind"] in ("text", "structural")
    }
    assert persisted == UPLOADED_PATHS
    pid = pkg["id"]

    for n in (1, 2):
        gen = client.post(
            f"/api/packages/{pid}/generate",
            json={
                "recordCount": n,
                "seed": 21,
                "ciMode": True,
                "recordHistory": False,
                "outputFormat": "itself",
            },
        )
        assert gen.status_code == 200, gen.text
        body = gen.json()
        assert body["written"] == n
        raw = base64.b64decode(body["archiveBase64"] or body["zipBase64"])
        trees = _trees_from_download(raw)
        assert len(trees) == n
        for tree in trees:
            _assert_one_to_one_tree(tree)


def test_api_single_nested_file_keeps_relative_path():
    client = TestClient(app)
    r = client.post(
        "/api/packages/import",
        files=[("files", ("sample-dir/data/person.xml", XML, "application/xml"))],
    )
    assert r.status_code == 200, r.text
    paths = [m["path"] for m in r.json()["members"] if m["kind"] in ("text", "structural")]
    assert paths == ["sample-dir/data/person.xml"]


def test_ui_empty_create_has_folder_import_and_directory_generate():
    text = (ROOT / "frontend" / "src" / "App.vue").read_text(encoding="utf-8")
    schema_empty = text.split("No schema open", 1)[1].split("center-head schema-head", 1)[0]
    assert "webkitdirectory" in schema_empty
    assert "Import folder" in schema_empty
    pkg_empty = text.split("No package selected", 1)[1].split("pkg-layout", 1)[0]
    assert "webkitdirectory" in pkg_empty
    assert "Import folder" in pkg_empty
    lib = text.split("Import package", 1)[1].split("schema-list", 1)[0]
    assert "webkitdirectory" in lib
    assert "Entire uploaded directory" in text
    assert "runPackageGenerate" in text
    assert 'value="one-file"' in text
    assert 'value="per-file"' in text
