"""
Unit tests: package generate field-mode immutability (same), output formats
(tar / tar.gz / itself), multi-variant uniqueness.
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

import app.database as db  # noqa: E402
from app.services import package_svc, archive_svc  # noqa: E402


def _make_tar(entries: list[tuple[str, bytes]], *, gzip: bool) -> bytes:
    buf = io.BytesIO()
    mode = "w:gz" if gzip else "w:"
    with tarfile.open(fileobj=buf, mode=mode) as tar:
        for path, data in entries:
            info = tarfile.TarInfo(name=path.replace("\\", "/"))
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


XML = b'<?xml version="1.0"?><root><code>FIXED</code><seq>1</seq></root>'
CSV = b"code,seq\nFIXED,1\n"


def _import_nested_pkg():
    raw = _make_tar(
        [
            ("layer/a.xml", XML),
            ("layer/b.csv", CSV),
        ],
        gzip=True,
    )
    return package_svc.import_uploaded_archive("multi.tar.gz", raw)


def _decode_bundle(result: dict) -> list[tuple[str, bytes]]:
    raw = base64.b64decode(result["archiveBase64"] or result["zipBase64"])
    fmt = result.get("archiveFormat") or "zip"
    name = result.get("fileName") or "x.zip"
    if fmt == "file":
        return [(name, raw)]
    if fmt == "tar.gz" or name.endswith(".tar.gz"):
        out = []
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile():
                    f = tar.extractfile(m)
                    out.append((m.name, f.read() if f else b""))
        return out
    if fmt == "tar" or name.endswith(".tar"):
        out = []
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
            for m in tar.getmembers():
                if m.isfile():
                    f = tar.extractfile(m)
                    out.append((m.name, f.read() if f else b""))
        return out
    out = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for n in zf.namelist():
            if not n.endswith("/"):
                out.append((n, zf.read(n)))
    return out


def _inner_xml_values(variant_bytes: bytes, variant_name: str) -> list[str]:
    """Extract <code>…</code> texts from a package variant archive/file."""
    texts: list[str] = []
    lower = variant_name.lower()
    members: list[tuple[str, bytes]] = []
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        with tarfile.open(fileobj=io.BytesIO(variant_bytes), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith(".xml"):
                    f = tar.extractfile(m)
                    members.append((m.name, f.read() if f else b""))
    elif lower.endswith(".tar"):
        with tarfile.open(fileobj=io.BytesIO(variant_bytes), mode="r:") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith(".xml"):
                    f = tar.extractfile(m)
                    members.append((m.name, f.read() if f else b""))
    elif lower.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(variant_bytes)) as zf:
            for n in zf.namelist():
                if n.endswith(".xml"):
                    members.append((n, zf.read(n)))
    else:
        members = [(variant_name, variant_bytes)]
    import re

    for _, data in members:
        s = data.decode("utf-8", errors="replace")
        texts.extend(re.findall(r"<code>([^<]*)</code>", s))
    return texts


def _inner_xml_tag_values(variant_bytes: bytes, variant_name: str, tag: str) -> list[str]:
    import re

    texts: list[str] = []
    lower = variant_name.lower()
    members: list[tuple[str, bytes]] = []
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        with tarfile.open(fileobj=io.BytesIO(variant_bytes), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith(".xml"):
                    f = tar.extractfile(m)
                    members.append((m.name, f.read() if f else b""))
    elif lower.endswith(".tar"):
        with tarfile.open(fileobj=io.BytesIO(variant_bytes), mode="r:") as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith(".xml"):
                    f = tar.extractfile(m)
                    members.append((m.name, f.read() if f else b""))
    elif lower.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(variant_bytes)) as zf:
            for n in zf.namelist():
                if n.endswith(".xml"):
                    members.append((n, zf.read(n)))
    else:
        members = [(variant_name, variant_bytes)]
    for _, data in members:
        s = data.decode("utf-8", errors="replace")
        texts.extend(re.findall(rf"<{tag}>([^<]*)</{tag}>", s))
    return texts


def test_same_mode_immutable_across_variants():
    pkg = _import_nested_pkg()
    pid = pkg["id"]
    xml_path = next(
        m["path"] for m in pkg["members"] if m["kind"] == "text" and m["path"].endswith(".xml")
    )
    # Lock code field as same (immutable); leave seq random.
    # Paths may be leaf ("code") or dotted ("root.code") — both accepted.
    field_modes = {xml_path: {"root.code": "same", "code": "same", "seq": "random"}}
    result = package_svc.generate_package_variants(
        pid,
        record_count=3,
        seed=42,
        ci_mode=True,
        record_history=False,
        default_field_mode="random",
        field_modes=field_modes,
        output_format="tar.gz",
        bundle_format="tar.gz",
    )
    assert result["written"] == 3
    variants = _decode_bundle(result)
    assert len(variants) == 3
    codes_per_variant = []
    seqs_per_variant = []
    for vname, vbytes in variants:
        codes = _inner_xml_values(vbytes, vname)
        assert codes, f"no code values in {vname}"
        codes_per_variant.append(codes[0])
        seqs = _inner_xml_tag_values(vbytes, vname, "seq")
        if seqs:
            seqs_per_variant.append(seqs[0])
    # Immutable: all variants share the same code value
    assert len(set(codes_per_variant)) == 1, codes_per_variant
    # Non-immutable (seq) must differ for at least one pair when N>2
    assert len(seqs_per_variant) == 3, seqs_per_variant
    assert len(set(seqs_per_variant)) > 1, (
        f"expected seq to vary across variants, got {seqs_per_variant}"
    )


def test_content_edit_reinfers_schema_and_generate():
    """
    Real path: import → update content → generate.
    Edited design sampleValues must drive generation (not stale FIXED import).
    """
    pkg = _import_nested_pkg()
    pid = pkg["id"]
    xml_path = next(
        m["path"] for m in pkg["members"] if m["kind"] == "text" and m["path"].endswith(".xml")
    )
    new_xml = (
        '<?xml version="1.0"?>'
        "<root><code>USERVALUE</code><seq>1</seq></root>"
    )
    updated = package_svc.update_package_member(pid, xml_path, content=new_xml)
    # Schema sample re-inferred from content
    schema = updated["schemas"][xml_path]
    samples: list[str] = []

    def walk(rows):
        for r in rows or []:
            if r.get("sampleValue") is not None:
                samples.append(str(r.get("sampleValue")))
            walk(r.get("children") or [])

    walk(schema.get("root") or [])
    assert any("USERVALUE" == s for s in samples), samples
    assert "FIXED" not in samples or any(s == "USERVALUE" for s in samples)

    field_modes = {xml_path: {"code": "same", "seq": "random"}}
    result = package_svc.generate_package_variants(
        pid,
        record_count=3,
        seed=99,
        ci_mode=True,
        record_history=False,
        default_field_mode="random",
        field_modes=field_modes,
        output_format="tar.gz",
        bundle_format="tar.gz",
    )
    variants = _decode_bundle(result)
    codes = []
    for vname, vbytes in variants:
        found = _inner_xml_values(vbytes, vname)
        assert found, vname
        codes.append(found[0])
    # same-mode locks first value; re-inferred USERVALUE sample is used for lock
    assert len(set(codes)) == 1, codes
    assert codes[0] == "USERVALUE", codes


def test_output_format_tar():
    pkg = _import_nested_pkg()
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=2,
        seed=7,
        ci_mode=True,
        record_history=False,
        output_format="tar",
        bundle_format="tar",
    )
    assert result["archiveFormat"] == "tar"
    assert result["fileName"].endswith(".tar")
    variants = _decode_bundle(result)
    assert len(variants) == 2
    for vname, _ in variants:
        assert vname.endswith(".tar"), vname


def test_output_format_tar_gz():
    pkg = _import_nested_pkg()
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=2,
        seed=8,
        ci_mode=True,
        record_history=False,
        output_format="tar.gz",
        bundle_format="tar.gz",
    )
    assert result["archiveFormat"] == "tar.gz"
    variants = _decode_bundle(result)
    assert len(variants) == 2
    for vname, _ in variants:
        assert vname.endswith(".tar.gz") or vname.endswith(".tgz"), vname


def test_output_format_itself_single_file():
    raw = _make_tar([("solo.xml", XML)], gzip=False)
    # Import as loose single file → folder outer
    pkg = package_svc.import_package_from_bytes(
        package_name="solo",
        file_entries=[("solo.xml", XML)],
        source_kind="files",
        outer_format="folder",
    )
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=1,
        seed=1,
        ci_mode=True,
        record_history=False,
        output_format="itself",
    )
    assert result["archiveFormat"] == "file"
    assert result["fileName"].endswith(".xml")
    raw_out = base64.b64decode(result["archiveBase64"])
    text = raw_out.decode("utf-8", errors="replace")
    assert "<" in text  # xml-ish


def test_resolve_variant_format():
    assert package_svc.resolve_variant_format("tar.gz", ".tar.gz", "tar")[0] == "tar"
    assert package_svc.resolve_variant_format("tar", ".tar", "tar.gz")[0] == "tar.gz"
    assert package_svc.resolve_variant_format("folder", None, "itself", text_member_count=1)[
        0
    ] == "file"
    assert package_svc.resolve_variant_format("folder", None, "itself", text_member_count=2)[
        0
    ] == "folder"
    assert package_svc.resolve_variant_format("tar.gz", ".tar.gz", "itself")[0] == "tar.gz"


def test_generated_not_written_to_sqlite():
    pkg = _import_nested_pkg()
    before = db.get_package(pkg["id"])
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=2,
        seed=3,
        ci_mode=True,
        record_history=False,
        output_format="tar",
    )
    after = db.get_package(pkg["id"])
    assert before is not None and after is not None
    # member sample content unchanged (design only)
    for bm, am in zip(before["members"], after["members"]):
        if bm.get("kind") == "text":
            assert bm.get("content") == am.get("content")
    assert result["written"] == 2


def test_archive_svc_pack_formats():
    entries = [("a.txt", "hello"), ("b.txt", "world")]
    for fmt in ("tar", "tar.gz", "zip"):
        raw, ext, media = archive_svc.pack_named_entries(entries, format=fmt)
        assert len(raw) > 0
        assert ext.startswith(".")
        assert media


def test_output_format_itself_preserves_outer_tar():
    """Import plain .tar → generate itself → variants are .tar (not forced zip)."""
    raw = _make_tar([("a.xml", XML), ("b.csv", CSV)], gzip=False)
    pkg = package_svc.import_uploaded_archive("plain.tar", raw)
    assert pkg["outerFormat"] == "tar"
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=1,
        seed=11,
        ci_mode=True,
        record_history=False,
        output_format="itself",
    )
    # Single variant of a multi-member package: outer is tar; download may be bare variant or zip wrap
    assert result["variantFormat"] == "tar" or (result.get("fileName") or "").endswith(".tar")
    variants = _decode_bundle(result)
    assert variants
    # The package variant itself should be tar when itself
    if result["archiveFormat"] == "tar" and result["written"] == 1:
        assert result["fileName"].endswith(".tar")
    else:
        for vname, _ in variants:
            assert vname.endswith(".tar"), vname


def test_structural_member_emitted_scrambled():
    secret = b"ORIGINAL_SECRET_BYTES_XX"
    pkg = package_svc.import_package_from_bytes(
        package_name="with-struct",
        file_entries=[
            ("data.xml", XML),
            ("noise.bin", secret),
        ],
        source_kind="files",
        outer_format="folder",
    )
    structural = [m for m in pkg["members"] if m["kind"] == "structural"]
    assert len(structural) == 1
    assert structural[0]["byteSize"] == len(secret)
    assert not structural[0].get("content")
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=1,
        seed=99,
        ci_mode=True,
        record_history=False,
        output_format="zip",
        bundle_format="zip",
    )
    variants = _decode_bundle(result)
    assert variants
    vname, vbytes = variants[0]
    with zipfile.ZipFile(io.BytesIO(vbytes)) as zf:
        names = zf.namelist()
        bin_name = next(n for n in names if n.endswith("noise.bin"))
        payload = zf.read(bin_name)
    assert len(payload) == len(secret)
    assert payload != secret


def test_nested_pack_format_override():
    import zipfile as zfmod

    inner = io.BytesIO()
    with zfmod.ZipFile(inner, "w") as zf:
        zf.writestr("inner.xml", XML)
    nested_zip = inner.getvalue()
    raw = _make_tar(
        [("wrap/inner.zip", nested_zip), ("top.xml", XML)],
        gzip=True,
    )
    pkg = package_svc.import_uploaded_archive(
        "nest.tar.gz", raw, nested_archive_mode="expand"
    )
    assert pkg["nestedArchives"]
    folder = pkg["nestedArchives"][0]["folderPath"]
    # Default pack format is zip (from nested zip)
    assert (pkg["nestedArchives"][0].get("packFormat") or pkg["nestedArchives"][0]["format"]) in (
        "zip",
    )
    # Override to tar
    updated = package_svc.update_nested_pack(pkg["id"], folder, pack_format="tar")
    nest = updated["nestedArchives"][0]
    assert nest["packFormat"] == "tar"
    assert nest["originalArchivePath"].endswith(".tar")
    result = package_svc.generate_package_variants(
        pkg["id"],
        record_count=1,
        seed=5,
        ci_mode=True,
        record_history=False,
        output_format="tar.gz",
        bundle_format="tar.gz",
    )
    variants = _decode_bundle(result)
    assert variants
    # N=1 tar.gz is the variant itself; nested folder re-packs to .tar
    names = [n.replace("\\", "/") for n, _ in variants]
    assert any(n.endswith(".tar") for n in names), names


if __name__ == "__main__":
    test_resolve_variant_format()
    test_archive_svc_pack_formats()
    test_output_format_itself_single_file()
    test_output_format_tar()
    test_output_format_tar_gz()
    test_same_mode_immutable_across_variants()
    test_generated_not_written_to_sqlite()
    test_output_format_itself_preserves_outer_tar()
    test_structural_member_emitted_scrambled()
    test_nested_pack_format_override()
    print("ok test_package_generate")
