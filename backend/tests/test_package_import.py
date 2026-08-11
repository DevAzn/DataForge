"""
Unit tests: package archive import (tar / tar.gz), supported-format filter,
nested path preservation, path tree, member rename.
"""
from __future__ import annotations

import io
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import package_svc  # noqa: E402


def _make_tar(entries: list[tuple[str, bytes]], *, gzip: bool) -> bytes:
    buf = io.BytesIO()
    mode = "w:gz" if gzip else "w:"
    with tarfile.open(fileobj=buf, mode=mode) as tar:
        for path, data in entries:
            info = tarfile.TarInfo(name=path.replace("\\", "/"))
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


SAMPLE_XML = b'<?xml version="1.0"?><root><name>Ada</name><city>London</city></root>'
SAMPLE_CSV = b"name,city\nAda,London\n"
SAMPLE_TXT = b"hello line one\n"
SAMPLE_BIN = b"\x00\x01\x02binary"
SAMPLE_JSON = b'{"name":"skip"}'


def test_build_path_tree_nested():
    tree = package_svc.build_path_tree(
        ["outer/inner/a.xml", "outer/b.csv", "readme.txt"]
    )
    names = {n["name"] for n in tree}
    assert "outer" in names
    assert "readme.txt" in names
    outer = next(n for n in tree if n["name"] == "outer")
    assert outer["kind"] == "dir"
    child_names = {c["name"] for c in outer["children"]}
    assert "inner" in child_names
    assert "b.csv" in child_names
    inner = next(c for c in outer["children"] if c["name"] == "inner")
    assert any(c["name"] == "a.xml" for c in inner["children"])


def test_import_tar_gz_schema_and_structural():
    raw = _make_tar(
        [
            ("pkg/data/person.xml", SAMPLE_XML),
            ("pkg/data/rows.csv", SAMPLE_CSV),
            ("pkg/notes.txt", SAMPLE_TXT),
            ("pkg/blob.bin", SAMPLE_BIN),
            ("pkg/legacy.json", SAMPLE_JSON),
        ],
        gzip=True,
    )
    result = package_svc.import_uploaded_archive("sample-pkg.tar.gz", raw)
    assert result["outerFormat"] == "tar.gz"
    text = [m for m in result["members"] if m["kind"] == "text"]
    structural = [m for m in result["members"] if m["kind"] == "structural"]
    paths = {m["path"] for m in text}
    assert "pkg/data/person.xml" in paths
    assert "pkg/data/rows.csv" in paths
    assert "pkg/notes.txt" in paths
    assert "pkg/legacy.json" in paths  # json is now a schema member
    # binary companions kept as structural (no original content stored)
    struct_paths = {m["path"] for m in structural}
    assert "pkg/blob.bin" in struct_paths
    blob = next(m for m in structural if m["path"] == "pkg/blob.bin")
    assert blob.get("byteSize") == len(SAMPLE_BIN)
    assert not blob.get("content")
    # schemas present for text members
    for m in text:
        assert m.get("schemaId")
        if (m.get("format") or "") != "xlsx":
            assert m.get("content") is not None
    # nested tree from all members
    tree = package_svc.build_path_tree([m["path"] for m in result["members"] if m["kind"] != "nested_archive_folder"])
    assert any(n["name"] == "pkg" for n in tree)


def test_import_plain_tar():
    raw = _make_tar(
        [
            ("nested/deep/file.xml", SAMPLE_XML),
            ("flat.csv", SAMPLE_CSV),
        ],
        gzip=False,
    )
    result = package_svc.import_uploaded_archive("plain.tar", raw)
    assert result["outerFormat"] == "tar"
    text = [m for m in result["members"] if m["kind"] == "text"]
    paths = {m["path"] for m in text}
    assert "nested/deep/file.xml" in paths
    assert "flat.csv" in paths


def test_import_multi_file_preserves_relative_paths():
    files = [
        ("folder/sub/a.xml", SAMPLE_XML),
        ("folder/b.csv", SAMPLE_CSV),
    ]
    result = package_svc.import_uploaded_files(files)
    text = [m for m in result["members"] if m["kind"] == "text"]
    paths = {m["path"] for m in text}
    assert "folder/sub/a.xml" in paths
    assert "folder/b.csv" in paths


def test_member_rename_and_content_update():
    raw = _make_tar([("doc.xml", SAMPLE_XML)], gzip=True)
    pkg = package_svc.import_uploaded_archive("one.tar.gz", raw)
    pid = pkg["id"]
    path = next(m["path"] for m in pkg["members"] if m["kind"] == "text")
    updated = package_svc.update_package_member(
        pid,
        path,
        new_name="renamed.xml",
        content="<?xml version='1.0'?><root><name>Bob</name></root>",
    )
    text = [m for m in updated["members"] if m["kind"] == "text"]
    assert len(text) == 1
    assert text[0]["name"] == "renamed.xml"
    assert "Bob" in (text[0].get("content") or "")
    # path leaf updated
    assert text[0]["path"].endswith("renamed.xml")
    # Content save re-infers schema sampleValues (generate uses schema, not stale content alone)
    schema = updated["schemas"][text[0]["path"]]
    samples = []

    def walk(rows):
        for r in rows or []:
            if r.get("sampleValue") is not None:
                samples.append(str(r["sampleValue"]))
            walk(r.get("children") or [])

    walk(schema.get("root") or [])
    assert "Bob" in samples, samples


def test_save_member_schema_as():
    raw = _make_tar([("doc.xml", SAMPLE_XML)], gzip=False)
    pkg = package_svc.import_uploaded_archive("s.tar", raw)
    pid = pkg["id"]
    path = next(m["path"] for m in pkg["members"] if m["kind"] == "text")
    out = package_svc.save_member_schema_as(
        pid, path, new_schema_name="My copy schema", link_to_package=True
    )
    assert out["ok"]
    assert out["schema"]["name"] == "My copy schema"
    # package member points at new schema
    hyd = out["package"]
    m = next(x for x in hyd["members"] if x["path"] == path)
    assert m["schemaId"] == out["schema"]["id"]


def test_import_json_yaml_schema():
    files = [
        ("data/a.json", b'{"name":"Ada","city":"London"}'),
        ("data/b.yaml", b"name: Bob\ncity: Paris\n"),
        ("data/readme.md", b"# notes\nsecret"),
    ]
    result = package_svc.import_uploaded_files(files)
    text = {m["path"]: m for m in result["members"] if m["kind"] == "text"}
    structural = {m["path"]: m for m in result["members"] if m["kind"] == "structural"}
    assert "data/a.json" in text
    assert text["data/a.json"]["format"] == "json"
    assert "data/b.yaml" in text
    assert text["data/b.yaml"]["format"] == "yaml"
    assert "data/readme.md" in structural
    assert structural["data/readme.md"]["byteSize"] == len(b"# notes\nsecret")
    assert not structural["data/readme.md"].get("content")


def test_nested_opaque_keeps_archive_structural():
    import zipfile

    inner_buf = io.BytesIO()
    with zipfile.ZipFile(inner_buf, "w") as zf:
        zf.writestr("inner.xml", SAMPLE_XML)
    inner_zip = inner_buf.getvalue()
    raw = _make_tar([("outer/nested.zip", inner_zip), ("outer/a.xml", SAMPLE_XML)], gzip=True)
    expanded = package_svc.import_uploaded_archive(
        "pack.tar.gz", raw, nested_archive_mode="expand"
    )
    assert any(m["kind"] == "nested_archive_folder" for m in expanded["members"])
    opaque = package_svc.import_uploaded_archive(
        "pack.tar.gz", raw, nested_archive_mode="opaque"
    )
    struct = [m for m in opaque["members"] if m["kind"] == "structural"]
    assert any(m["path"].endswith("nested.zip") for m in struct)
    assert not any(m["kind"] == "nested_archive_folder" for m in opaque["members"])


def test_scrambled_bytes_no_original():
    secret = b"TOP_SECRET_PAYLOAD"
    out = package_svc.scrambled_bytes("x.bin", len(secret), seed=42)
    assert len(out) == len(secret)
    assert out != secret
    out2 = package_svc.scrambled_bytes("x.bin", len(secret), seed=42)
    assert out == out2  # deterministic with seed


if __name__ == "__main__":
    test_build_path_tree_nested()
    test_import_tar_gz_schema_and_structural()
    test_import_plain_tar()
    test_import_multi_file_preserves_relative_paths()
    test_member_rename_and_content_update()
    test_save_member_schema_as()
    test_import_json_yaml_schema()
    test_nested_opaque_keeps_archive_structural()
    test_scrambled_bytes_no_original()
    print("ok test_package_import")
