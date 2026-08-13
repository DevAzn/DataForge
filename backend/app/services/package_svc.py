"""
Package / multifile import + variant generate.

Whole package = one record unit. Nested zip/tar/tar.gz expand into a folder
named after the archive (extensions stripped) unless opaque mode. Generated
variants are returned as archive bytes (not stored in SQLite — only layout,
schemas, design samples, and structural size metadata).
"""
from __future__ import annotations

import hashlib
import io
import re
import tarfile
import uuid
import zipfile
from pathlib import PurePosixPath
from typing import Any

from app import database as db
from app.services import export_fmt, generator, infer

MAX_TEXT = 25 * 1024 * 1024
MAX_NEST = 6
# Max scrambled structural size per file on generate (presence for ETL, not multi-GB blobs).
MAX_STRUCTURAL_BYTES = 1 * 1024 * 1024

# Schema members: infer + regenerate. Structural: path/name only, scrambled content on emit.
SCHEMA_EXTS = {
    ".xml",
    ".csv",
    ".txt",
    ".json",
    ".jsonl",
    ".ndjson",
    ".yml",
    ".yaml",
    ".xlsx",
}
SUPPORTED_TEXT_EXTS = SCHEMA_EXTS  # editable package members
LEGACY_TEXT_EXTS: set[str] = set()  # kept for callers; package import no longer skips these
TEXT_EXTS = SCHEMA_EXTS


def now_iso() -> str:
    return db.now_iso()


def normalize_path(p: str) -> str:
    parts = [x for x in p.replace("\\", "/").split("/") if x and x not in (".", "..")]
    return "/".join(parts)


def basename(p: str) -> str:
    return PurePosixPath(normalize_path(p)).name or p


def dirname_posix(p: str) -> str:
    p = normalize_path(p)
    if "/" not in p:
        return ""
    return p.rsplit("/", 1)[0]


def join_path(a: str, b: str) -> str:
    if not a:
        return normalize_path(b)
    if not b:
        return normalize_path(a)
    return normalize_path(f"{a}/{b}")


def strip_archive_extensions(file_name: str) -> str:
    base = basename(file_name)
    lower = base.lower()
    if lower.endswith(".tar.gz"):
        base = base[:-7]
    elif lower.endswith(".tgz"):
        base = base[:-4]
    elif lower.endswith(".zip"):
        base = base[:-4]
    elif lower.endswith(".tar"):
        base = base[:-4]
    else:
        base = re.sub(r"\.[^.]+$", "", base)
    return base or "archive"


def detect_nested_format(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        return "tar.gz"
    if lower.endswith(".tar"):
        return "tar"
    if lower.endswith(".zip"):
        return "zip"
    return None


def is_schema_file(name: str) -> bool:
    """True if extension is a regenerable schema member (json/xml/txt/yaml/csv/xlsx)."""
    lower = name.lower()
    return any(lower.endswith(e) for e in SCHEMA_EXTS)


def is_supported_text(name: str) -> bool:
    """Editable package members — all schema formats (binary xlsx content not text-edited)."""
    return is_schema_file(name)


def is_likely_text(name: str) -> bool:
    """Backward-compat alias."""
    return is_schema_file(name)


def schema_format_from_name(name: str) -> str | None:
    lower = (name or "").lower()
    if lower.endswith(".xlsx"):
        return "xlsx"
    if lower.endswith((".jsonl", ".ndjson")):
        return "json"
    if lower.endswith(".json"):
        return "json"
    if lower.endswith((".yml", ".yaml")):
        return "yaml"
    if lower.endswith(".xml"):
        return "xml"
    if lower.endswith(".csv"):
        return "csv"
    if lower.endswith(".txt"):
        return "txt"
    return None


def structural_format_label(name: str) -> str:
    lower = (name or "").lower()
    nest = detect_nested_format(name)
    if nest:
        return nest
    if "." in lower:
        return lower.rsplit(".", 1)[-1] or "binary"
    return "binary"


def clamp_structural_size(n: int) -> tuple[int, bool]:
    size = max(0, int(n or 0))
    if size > MAX_STRUCTURAL_BYTES:
        return MAX_STRUCTURAL_BYTES, True
    return size, False


def scrambled_bytes(path: str, size: int, *, seed: int | None = None) -> bytes:
    """
    Random-looking bytes of exact `size` with no original content.
    Deterministic when seed is provided (path + seed).
    """
    n = max(0, int(size or 0))
    if n == 0:
        return b""
    if seed is None:
        import os

        return os.urandom(n)
    # Expand a deterministic stream from seed+path
    out = bytearray()
    counter = 0
    key = f"{seed}:{path}".encode("utf-8", errors="replace")
    while len(out) < n:
        block = hashlib.sha256(key + counter.to_bytes(4, "big")).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:n])


def skip_reason_for_name(name: str, *, too_large: bool = False) -> str:
    if too_large:
        return "too large"
    if detect_nested_format(name):
        return "archive expand failed"
    return "unsupported or unreadable"


def archive_ext_for_format(fmt: str) -> str:
    f = (fmt or "zip").lower()
    if f in ("tar.gz", "tgz"):
        return ".tar.gz"
    if f == "tar":
        return ".tar"
    return ".zip"


def with_archive_extension(path: str, fmt: str) -> str:
    """Rewrite leaf extension to match pack format (tar / zip / tar.gz)."""
    p = normalize_path(path)
    parent = dirname_posix(p)
    stem = strip_archive_extensions(basename(p)) or "archive"
    leaf = stem + archive_ext_for_format(fmt)
    return join_path(parent, leaf) if parent else leaf

def build_path_tree(paths: list[str]) -> list[dict[str, Any]]:
    """
    Nested explorer tree from flat POSIX paths (VS Code-like).
    Each node: { name, path, kind: 'dir'|'file', children? }
    """
    root: dict[str, Any] = {"name": "", "path": "", "kind": "dir", "children": {}}

    def ensure_dir(node: dict, name: str, full: str) -> dict:
        kids = node.setdefault("children", {})
        if name not in kids:
            kids[name] = {"name": name, "path": full, "kind": "dir", "children": {}}
        return kids[name]

    for raw in paths:
        p = normalize_path(raw)
        if not p:
            continue
        parts = p.split("/")
        node = root
        acc: list[str] = []
        for i, part in enumerate(parts):
            acc.append(part)
            full = "/".join(acc)
            if i == len(parts) - 1:
                kids = node.setdefault("children", {})
                kids[part] = {"name": part, "path": full, "kind": "file", "children": {}}
            else:
                node = ensure_dir(node, part, full)

    def freeze(node: dict) -> dict[str, Any]:
        kids_map = node.get("children") or {}
        children = [freeze(kids_map[k]) for k in sorted(kids_map.keys())]
        out: dict[str, Any] = {
            "name": node["name"],
            "path": node["path"],
            "kind": node["kind"],
        }
        if node["kind"] == "dir" or children:
            out["children"] = children
        return out

    top = freeze(root).get("children") or []
    return top


def outer_from_name(name: str) -> tuple[str, str]:
    """Return (outer_format, outer_extension)."""
    n = name or "package.zip"
    if re.search(r"\.tar\.gz$", n, re.I):
        m = re.search(r"(\.tar\.gz)$", n, re.I)
        return "tar.gz", m.group(1) if m else ".tar.gz"
    if re.search(r"\.tgz$", n, re.I):
        m = re.search(r"(\.tgz)$", n, re.I)
        return "tar.gz", m.group(1) if m else ".tgz"
    if re.search(r"\.tar$", n, re.I):
        m = re.search(r"(\.tar)$", n, re.I)
        return "tar", m.group(1) if m else ".tar"
    if re.search(r"\.zip$", n, re.I):
        m = re.search(r"(\.zip)$", n, re.I)
        return "zip", m.group(1) if m else ".zip"
    return "folder", ""


def read_zip_bytes(raw: bytes) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            path = normalize_path(info.filename)
            if not path:
                continue
            out.append((path, zf.read(info)))
    return out


def read_tar_bytes(raw: bytes, gzip: bool) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    mode = "r:gz" if gzip else "r:"
    with tarfile.open(fileobj=io.BytesIO(raw), mode=mode) as tar:
        for m in tar.getmembers():
            if not m.isfile():
                continue
            path = normalize_path(m.name)
            if not path:
                continue
            f = tar.extractfile(m)
            if not f:
                continue
            out.append((path, f.read()))
    return out


def read_archive_bytes(raw: bytes, fmt: str) -> list[tuple[str, bytes]]:
    if fmt == "zip":
        return read_zip_bytes(raw)
    return read_tar_bytes(raw, gzip=(fmt == "tar.gz"))


def _add_structural(
    structural: list[dict[str, Any]],
    warnings: list[str],
    full: str,
    content_len: int,
    fmt_label: str,
) -> None:
    size, clamped = clamp_structural_size(content_len)
    if clamped:
        warnings.append(f"{full} (structural size clamped to {MAX_STRUCTURAL_BYTES})")
    structural.append(
        {
            "path": full,
            "byteSize": size,
            "format": fmt_label or structural_format_label(full),
        }
    )


def expand_files(
    files: list[tuple[str, bytes]],
    path_prefix: str,
    depth: int,
    nested: list[dict[str, Any]],
    warnings: list[str],
    structural: list[dict[str, Any]],
    *,
    nested_archive_mode: str = "expand",
) -> list[tuple[str, bytes]]:
    """
    Classify tree into schema candidates (returned with bytes) and structural
    placeholders (size only). Nested archives expand or stay opaque per mode.
    """
    mode = (nested_archive_mode or "expand").lower().strip()
    if mode not in ("expand", "opaque"):
        mode = "expand"
    if depth > MAX_NEST:
        for p, content in files:
            full = join_path(path_prefix, p)
            warnings.append(f"{full} (nest depth exceeded)")
            _add_structural(
                structural, warnings, full, len(content), structural_format_label(p)
            )
        return []
    result: list[tuple[str, bytes]] = []
    for rel, content in files:
        full = join_path(path_prefix, rel)
        name = basename(rel)
        nest_fmt = detect_nested_format(name)
        if nest_fmt:
            if mode == "opaque":
                _add_structural(structural, warnings, full, len(content), nest_fmt)
                continue
            folder_name = strip_archive_extensions(name)
            folder_path = join_path(
                path_prefix, join_path(dirname_posix(rel), folder_name)
            )
            nested.append(
                {
                    "folderPath": folder_path,
                    "originalArchivePath": full,
                    "format": nest_fmt,
                    "packFormat": nest_fmt,
                    "packEnabled": True,
                }
            )
            try:
                inner = read_archive_bytes(content, nest_fmt)
                result.extend(
                    expand_files(
                        inner,
                        folder_path,
                        depth + 1,
                        nested,
                        warnings,
                        structural,
                        nested_archive_mode=mode,
                    )
                )
            except Exception:
                warnings.append(f"{full} (archive expand failed)")
                _add_structural(structural, warnings, full, len(content), nest_fmt)
            continue
        if not is_schema_file(name):
            _add_structural(
                structural, warnings, full, len(content), structural_format_label(name)
            )
            continue
        if len(content) > MAX_TEXT:
            warnings.append(f"{full} (schema file too large; kept structural)")
            _add_structural(
                structural, warnings, full, len(content), structural_format_label(name)
            )
            continue
        result.append((full, content))
    return result

def _clone_rows(rows: list[dict]) -> list[dict]:
    out = []
    for i, r in enumerate(rows):
        nr = dict(r)
        nr["id"] = str(uuid.uuid4())
        nr["sortOrder"] = r.get("sortOrder", i)
        kids = r.get("children") or []
        nr["children"] = _clone_rows(kids) if kids else []
        out.append(nr)
    return out


def _unique_multifile_name(base: str) -> str:
    preferred = (base or "Multifile schema").strip() or "Multifile schema"
    existing = {s["name"].lower() for s in db.list_schemas()}
    if preferred.lower() not in existing:
        return preferred
    n = 2
    while f"{preferred} ({n})".lower() in existing:
        n += 1
    return f"{preferred} ({n})"


def _try_infer_schema_member(
    path: str, raw: bytes
) -> dict[str, Any] | None:
    """Return pending schema item or None (caller may keep as structural)."""
    file_name = basename(path)
    lower = file_name.lower()
    if lower.endswith(".xlsx"):
        try:
            inferred = infer.infer_schema_from_xlsx(file_name, raw)
            return {
                "path": path,
                "fileName": file_name,
                "text": "",  # binary workbook — sample lives in schema fields
                "format": "xlsx",
                "root": inferred["schema"]["root"],
                "historySamples": inferred.get("historySamples") or [],
            }
        except Exception:
            return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    try:
        inferred = infer.infer_schema_from_file(file_name, text)
        return {
            "path": path,
            "fileName": file_name,
            "text": text,
            "format": inferred["format"],
            "root": inferred["schema"]["root"],
            "historySamples": inferred.get("historySamples") or [],
        }
    except Exception:
        return None


def import_package_from_bytes(
    *,
    package_name: str,
    file_entries: list[tuple[str, bytes]],
    source_kind: str = "files",
    outer_format: str = "folder",
    outer_extension: str | None = None,
    nested_archive_mode: str = "expand",
) -> dict[str, Any]:
    """
    file_entries: list of (relative_path, bytes) — archive members or multi-upload.
    Schema formats → text members + schemas. Other files → structural (size only).
    """
    nested: list[dict[str, Any]] = []
    warnings: list[str] = []
    structural_meta: list[dict[str, Any]] = []
    expanded = expand_files(
        file_entries,
        "",
        0,
        nested,
        warnings,
        structural_meta,
        nested_archive_mode=nested_archive_mode,
    )

    package_id = str(uuid.uuid4())
    members: list[dict[str, Any]] = []
    schemas: dict[str, Any] = {}
    pending: list[dict[str, Any]] = []

    for n in nested:
        pack_fmt = n.get("packFormat") or n.get("format") or "zip"
        members.append(
            {
                "id": str(uuid.uuid4()),
                "path": n["folderPath"],
                "name": basename(n["folderPath"]),
                "kind": "nested_archive_folder",
                "nestedArchivePath": n["originalArchivePath"],
                "nestedArchiveFormat": n.get("format") or pack_fmt,
                "verified": True,
            }
        )
        n.setdefault("packFormat", pack_fmt)
        n.setdefault("packEnabled", True)

    for path, raw in expanded:
        item = _try_infer_schema_member(path, raw)
        if item:
            pending.append(item)
        else:
            _add_structural(
                structural_meta,
                warnings,
                path,
                len(raw),
                structural_format_label(path),
            )

    for s in structural_meta:
        members.append(
            {
                "id": str(uuid.uuid4()),
                "path": s["path"],
                "name": basename(s["path"]),
                "kind": "structural",
                "format": s.get("format") or "binary",
                "byteSize": int(s.get("byteSize") or 0),
                "content": None,
                "schemaId": None,
                "verified": True,
                "scrambled": True,
            }
        )

    if not pending and not structural_meta and not nested:
        reasons = ", ".join(warnings[:12]) if warnings else "no files found"
        more = f" (+{len(warnings) - 12} more)" if len(warnings) > 12 else ""
        raise ValueError(
            f"Package import produced no members ({reasons}{more}). "
            "Import a folder, archive, or files (xml/csv/txt/json/yaml/xlsx and companions)."
        )

    is_multifile = len(pending) > 1
    display = (
        _unique_multifile_name(
            f"Multifile schema — {package_name}" if package_name else "Multifile schema"
        )
        if is_multifile
        else (package_name or "Package")
    )

    for item in pending:
        member_name = (
            f"{display} › {item['path']}"
            if is_multifile
            else re.sub(r"\.[^.]+$", "", item["fileName"]) or item["fileName"]
        )
        schema_doc = {
            "id": str(uuid.uuid4()),
            "name": member_name,
            "root": item["root"],
            "sourceFileName": item["fileName"],
            "sourceFormat": item["format"],
            "isPackageMember": True if is_multifile else None,
            "packageId": package_id if is_multifile else None,
        }
        saved = db.save_schema(schema_doc)
        if item["historySamples"]:
            db.record_values(item["historySamples"], mode="ensure")
        members.append(
            {
                "id": str(uuid.uuid4()),
                "path": item["path"],
                "name": item["fileName"],
                "kind": "text",
                "format": item["format"],
                "content": item["text"] if item["format"] != "xlsx" else None,
                "schemaId": saved["id"],
                "verified": False,
            }
        )
        schemas[item["path"]] = saved

    members.sort(
        key=lambda m: (
            0
            if m["kind"] == "nested_archive_folder"
            else 1
            if m["kind"] == "text"
            else 2,
            m["path"],
        )
    )

    multifile_schema_id = None
    if is_multifile:
        multifile_root = []
        for i, item in enumerate(pending):
            member_schema = schemas.get(item["path"])
            children = (
                _clone_rows(member_schema.get("root") or [])
                if member_schema
                else _clone_rows(item["root"])
            )
            multifile_root.append(
                {
                    "id": str(uuid.uuid4()),
                    "key": item["path"].replace("\\", "/").lstrip("/") or "file",
                    "kind": "object",
                    "isPrimary": False,
                    "isUnique": False,
                    "children": children,
                    "sortOrder": i,
                }
            )
        multi = db.save_schema(
            {
                "id": str(uuid.uuid4()),
                "name": display,
                "description": (
                    f"Multifile package ({len(pending)} schema files): "
                    + ", ".join(p["path"] for p in pending)
                ),
                "root": multifile_root,
                "sourceFileName": package_name,
                "isMultifile": True,
                "packageId": package_id,
            }
        )
        multifile_schema_id = multi["id"]
        schemas["__multifile__"] = multi

    # Structural-only: still a valid package for presence testing
    if not pending and not is_multifile:
        display = package_name or "Package"

    doc = {
        "id": package_id,
        "name": display if pending else (package_name or "Package"),
        "sourceKind": source_kind,
        "outerFormat": outer_format,
        "outerExtension": outer_extension,
        "members": members,
        "nestedArchives": nested,
        "skipped": warnings,  # warnings / clamp notes (compat field name)
        "multifileSchemaId": multifile_schema_id,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    saved_pkg = db.save_package(doc)
    return {**saved_pkg, "schemas": schemas}

def import_uploaded_archive(
    file_name: str,
    raw: bytes,
    *,
    nested_archive_mode: str = "expand",
) -> dict[str, Any]:
    outer_fmt, outer_ext = outer_from_name(file_name)
    name = strip_archive_extensions(file_name)
    if outer_fmt == "folder":
        # single loose file (schema or structural)
        return import_package_from_bytes(
            package_name=name,
            file_entries=[(basename(file_name), raw)],
            source_kind="files",
            outer_format="folder",
            nested_archive_mode=nested_archive_mode,
        )
    nest = "zip" if outer_fmt == "zip" else "tar" if outer_fmt == "tar" else "tar.gz"
    entries = read_archive_bytes(raw, nest)
    return import_package_from_bytes(
        package_name=name,
        file_entries=entries,
        source_kind="archive",
        outer_format=outer_fmt,
        outer_extension=outer_ext,
        nested_archive_mode=nested_archive_mode,
    )

def estimate_output(package: dict[str, Any], record_count: int) -> dict[str, Any]:
    """
    Observability: how many files/archives a generate of `record_count` package
    variants will produce. Whole package = 1 record.
    """
    n = max(1, min(int(record_count or 1), 1_000_000))
    members = package.get("members") or []
    nested = package.get("nestedArchives") or []
    nested_folders = [x.get("folderPath") or "" for x in nested if x.get("folderPath")]

    def under_nested(path: str) -> bool:
        for f in nested_folders:
            if path == f or path.startswith(f + "/"):
                return True
        return False

    text_members = [m for m in members if m.get("kind") == "text"]
    structural_members = [m for m in members if m.get("kind") == "structural"]
    text_count = len(text_members)
    structural_count = len(structural_members)
    top_level_text = sum(1 for m in text_members if not under_nested(m.get("path") or ""))
    top_level_structural = sum(
        1 for m in structural_members if not under_nested(m.get("path") or "")
    )
    nested_archive_count = len(nested)
    packed_nested = sum(
        1 for x in nested if x.get("packEnabled", True) is not False
    )
    # After re-pack: top-level files + one file per nested archive that packs
    top_level_entries = top_level_text + top_level_structural + packed_nested
    outer_format = package.get("outerFormat") or "zip"

    return {
        "recordCount": n,
        "recordMeans": "one full package variant",
        "textFilesPerPackage": text_count,
        "structuralFilesPerPackage": structural_count,
        "topLevelTextFilesPerPackage": top_level_text,
        "nestedArchivesPerPackage": nested_archive_count,
        "topLevelEntriesPerPackage": top_level_entries,
        "outerFormat": outer_format,
        "estimatedOuterPackages": n,
        "estimatedLogicalContentFiles": n * text_count,
        "estimatedTopLevelEntriesTotal": n * top_level_entries,
        "downloadBundles": 1,
        "downloadContainsPackages": n,
        "downloadBundleFormat": "tar.gz" if n > 1 else "zip",
        "summary": (
            f"{n} package variant(s) × {top_level_entries} top-level entr"
            f"{'y' if top_level_entries == 1 else 'ies'} "
            f"({text_count} schema file(s) + {structural_count} structural; "
            f"{packed_nested} nested pack(s)); "
            f"download: 1 {'tar.gz' if n > 1 else 'ZIP'} with {n} package(s)"
        ),
    }

def relative_upload_path(name: str) -> str:
    """Keep folder-picker relative path (webkitdirectory); never drop parent dirs."""
    return normalize_path(name) or basename(name)


def directory_layout_member_paths(members: list[dict[str, Any]]) -> bool:
    """True when generate must emit a 1:1 tree (nested path or more than one leaf)."""
    leaves = [m for m in members if m.get("kind") in ("text", "structural")]
    if len(leaves) != 1:
        return len(leaves) > 1
    return "/" in (leaves[0].get("path") or "")


def import_uploaded_files(
    files: list[tuple[str, bytes]],
    *,
    nested_archive_mode: str = "expand",
) -> dict[str, Any]:
    """
    Multi-file upload (flat names or relative paths from folder picker)
    or single archive. One nested file from a folder picker stays a directory layout.
    """
    if len(files) == 1:
        name, raw = files[0]
        outer_fmt, _ = outer_from_name(name)
        if outer_fmt != "folder":
            return import_uploaded_archive(
                name, raw, nested_archive_mode=nested_archive_mode
            )
    entries = [(relative_upload_path(n), b) for n, b in files]
    tops = {e.split("/")[0] for e, _ in entries if e}
    if len(files) == 1 and "/" not in entries[0][0]:
        pkg_name = strip_archive_extensions(files[0][0])
    elif len(tops) == 1:
        pkg_name = next(iter(tops))
    else:
        pkg_name = f"package-{now_iso()[:10]}"
    return import_package_from_bytes(
        package_name=pkg_name,
        file_entries=entries,
        source_kind="files",
        outer_format="folder",
        nested_archive_mode=nested_archive_mode,
    )

def _write_archive_bytes(
    fmt: str, entries: list[tuple[str, bytes | str]]
) -> bytes:
    buf = io.BytesIO()
    if fmt in ("tar.gz", "tgz"):
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for path, content in entries:
                data = content if isinstance(content, bytes) else content.encode("utf-8")
                info = tarfile.TarInfo(name=path.replace("\\", "/"))
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue()
    if fmt == "tar":
        with tarfile.open(fileobj=buf, mode="w") as tar:
            for path, content in entries:
                data = content if isinstance(content, bytes) else content.encode("utf-8")
                info = tarfile.TarInfo(name=path.replace("\\", "/"))
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries:
            data = content if isinstance(content, bytes) else content.encode("utf-8")
            zf.writestr(path.replace("\\", "/"), data)
    return buf.getvalue()


def _is_under(file_path: str, folder: str) -> bool:
    if not folder:
        return True
    return file_path == folder or file_path.startswith(folder + "/")


def _rel_to(file_path: str, folder: str) -> str:
    if not folder:
        return file_path
    if file_path.startswith(folder + "/"):
        return file_path[len(folder) + 1 :]
    return file_path


def resolve_variant_format(
    package_outer: str,
    package_ext: str | None,
    output_format: str | None,
    *,
    text_member_count: int = 1,
) -> tuple[str, str | None]:
    """
    Map user outputFormat → (outer_format, outer_extension) for each package variant.

    - tar / tar.gz / zip: force that form
    - itself / None: keep package original outer form
    - single supported file imported as folder → emit bare file (outer_format="file")
    """
    of = (output_format or "itself").lower().strip()
    if of in ("tar.gz", "tgz"):
        return "tar.gz", ".tar.gz"
    if of == "tar":
        return "tar", ".tar"
    if of == "zip":
        return "zip", ".zip"
    # itself
    outer = package_outer or "folder"
    if outer == "folder" and text_member_count == 1:
        return "file", None
    return outer, package_ext


def repack_nested_archives(
    text_entries: list[tuple[str, str | bytes]],
    nested: list[dict[str, Any]],
) -> list[tuple[str, bytes | str]]:
    """Re-pack expanded nested archive folders; leave other paths 1:1."""
    files: dict[str, bytes | str] = {p: c for p, c in text_entries}
    nested_sorted = sorted(
        nested, key=lambda n: -len((n.get("folderPath") or "").split("/"))
    )
    for nest in nested_sorted:
        folder = nest.get("folderPath") or ""
        pack_enabled = nest.get("packEnabled", True) is not False
        if not pack_enabled:
            continue
        children: list[tuple[str, bytes | str]] = []
        for p, content in list(files.items()):
            if _is_under(p, folder) and p != folder:
                children.append((_rel_to(p, folder), content))
        for p in list(files.keys()):
            if _is_under(p, folder) and p != folder:
                del files[p]
        files.pop(folder, None)
        nest_fmt = (
            nest.get("packFormat") or nest.get("format") or "zip"
        ).lower().strip()
        if nest_fmt in ("tgz",):
            nest_fmt = "tar.gz"
        if nest_fmt not in ("tar", "tar.gz", "zip"):
            nest_fmt = "zip"
        nested_bytes = _write_archive_bytes(nest_fmt, children)
        orig = nest.get("originalArchivePath") or f"{folder}{archive_ext_for_format(nest_fmt)}"
        orig = with_archive_extension(orig, nest_fmt)
        files[orig] = nested_bytes
    return list(files.items())


def pack_directory_tree(
    entries: list[tuple[str, bytes | str]],
    *,
    package_name: str,
    index: int,
    variant_root: str | None = None,
) -> tuple[str, bytes]:
    """
    Pack one directory replica for download at 1:1 relative paths.
    variant_root is a single prefix used only when N>1 variants would collide.
    Multi-file trees use tar.gz; a single file uses zip.
    """
    named: list[tuple[str, bytes | str]] = []
    for path, content in entries:
        named.append((f"{variant_root}/{path}" if variant_root else path, content))
    pack_fmt = "tar.gz" if len(named) > 1 else "zip"
    ext = ".tar.gz" if pack_fmt == "tar.gz" else ".zip"
    safe = re.sub(r'[<>:"/\\|?*]', "_", package_name) or "package"
    return f"{safe}_{index:04d}{ext}", _write_archive_bytes(pack_fmt, named)


def emit_variant_bytes(
    *,
    outer_format: str,
    outer_extension: str | None,
    text_entries: list[tuple[str, str | bytes]],
    nested: list[dict[str, Any]],
    package_name: str,
    index: int,
    variant_root: str | None = None,
) -> tuple[str, bytes]:
    """Return (file_name, archive_or_file_bytes). Preserves nested pack formats."""
    flat = repack_nested_archives(text_entries, nested)
    safe = re.sub(r'[<>:"/\\|?*]', "_", package_name) or "package"
    pad = f"{index:04d}"

    # Bare single file (itself on single-member folder import)
    if outer_format == "file":
        if len(flat) == 1:
            path, content = flat[0]
            data = content if isinstance(content, bytes) else content.encode("utf-8")
            base = basename(path) or f"{safe}_{pad}.txt"
            stem, dot, ext = base.rpartition(".")
            if dot:
                out_name = f"{stem}_{pad}.{ext}"
            else:
                out_name = f"{base}_{pad}"
            return out_name, data
        outer_format = "folder"

    if outer_format == "folder":
        return pack_directory_tree(
            flat,
            package_name=package_name,
            index=index,
            variant_root=variant_root,
        )

    ext = outer_extension or (
        ".tar.gz" if outer_format == "tar.gz" else ".tar" if outer_format == "tar" else ".zip"
    )
    pack_fmt = (
        "tar.gz"
        if outer_format == "tar.gz"
        else outer_format
        if outer_format in ("tar", "zip")
        else "zip"
    )
    name = f"{safe}_{pad}{ext}"
    return name, _write_archive_bytes(pack_fmt, flat)

def generate_package_variants(
    package_id: str,
    *,
    record_count: int = 10,
    seed: int | None = None,
    ci_mode: bool = False,
    record_history: bool = False,
    default_field_mode: str = "random",
    field_modes: dict[str, dict[str, str]] | None = None,
    history_lookup=None,
    custom_lookup=None,
    theme_lookup=None,
    theme_prefer: bool = True,
    settings: dict | None = None,
    output_format: str | None = "itself",
    bundle_format: str | None = None,
) -> dict[str, Any]:
    """
    Generate N full package variants. Returns archive (ZIP / tar / tar.gz) of variants
    or a single bare file when N=1 and output is itself on a single-member package.
    Does not store generated content in SQLite.
    """
    from app.services.generator import (
        Generator,
        apply_tied,
        assemble_schema_document,
        build_tied_template,
        merge_missing_tied,
        normalize_tied_paths,
    )

    hydrated = db.get_package_hydrated(package_id)
    if not hydrated:
        raise ValueError("Package not found")
    text_members = [
        m for m in hydrated["members"] if m.get("kind") == "text" and m.get("schemaId")
    ]
    structural_members = [
        m for m in hydrated["members"] if m.get("kind") == "structural"
    ]
    if not text_members and not structural_members:
        raise ValueError("Package has no members to generate")

    count = max(1, min(int(record_count or 1), 10_000))
    settings = settings or db.get_settings()
    field_modes = field_modes or {}
    default_mode = default_field_mode or "random"
    hist_lookup = history_lookup or (lambda _k: [])
    cust_lookup = custom_lookup or (lambda _k: [])

    # Bare single-file only for one flat loose file — nested folder paths stay a tree
    leaf_count = len(text_members) + len(structural_members)
    v_outer, v_ext = resolve_variant_format(
        hydrated.get("outerFormat") or "folder",
        hydrated.get("outerExtension"),
        output_format,
        text_member_count=leaf_count,
    )
    if v_outer == "file" and (
        leaf_count != 1
        or directory_layout_member_paths(text_members + structural_members)
    ):
        v_outer, v_ext = "folder", None

    # Prepare schemas with modes
    prepared = []
    for m in text_members:
        schema = hydrated["schemas"].get(m["path"])
        if not schema:
            continue
        modes = field_modes.get(m["path"]) or {}
        adjusted, tied = _apply_field_modes(schema, modes, default_mode)
        root = adjusted.get("root") or []
        # Absolute UI paths (catalog.book.author) → record-relative after isRecordTag unwrap
        tied = normalize_tied_paths(root, tied)
        adjusted = {**adjusted, "csvTiedFieldPaths": tied if tied else None}
        prepared.append(
            {
                "member": m,
                "schema": adjusted,
                "tied": tied,
                "format": m.get("format") or schema.get("sourceFormat") or "xml",
            }
        )
    if not prepared and not structural_members:
        raise ValueError("No valid member schemas available for this package")

    # Generate all variants into memory as named files
    variant_files: list[tuple[str, bytes]] = []
    directory_trees: list[list[tuple[str, str | bytes]]] = []
    seed_used = seed if seed is not None else 0

    # Shared unique sets across variants via one generator context per member
    contexts = []
    for p in prepared:
        root = p["schema"].get("root") or []
        gen = Generator(
            root,
            seed=seed,
            ci_mode=ci_mode,
            history_lookup=hist_lookup,
            custom_lookup=cust_lookup,
            theme_lookup=theme_lookup,
            theme_prefer=theme_prefer,
        )
        seed_used = gen.seed
        template = build_tied_template(root, p["tied"]) if p["tied"] else None
        if p["tied"]:
            gen.suppress_paths = {t.lower() for t in p["tied"]}
        contexts.append({**p, "gen": gen, "template": template})

    for i in range(count):
        file_entries: list[tuple[str, str | bytes]] = []
        for ctx in contexts:
            rec = ctx["gen"].one_record()
            if ctx["template"] is not None:
                if i == 0:
                    merge_missing_tied(ctx["template"], rec, ctx["tied"])
                apply_tied(ctx["template"], rec, ctx["tied"])
            schema = ctx["schema"]
            xml_root = (
                schema.get("xmlRootTag")
                or settings.get("xmlRootTag")
                or "root"
            )
            xml_rec = (
                schema.get("xmlRecordTag")
                or settings.get("xmlRecordTag")
                or "record"
            )
            # Match one-file / per-file generate: schema tree shape for isRecordTag
            doc = assemble_schema_document(schema, [rec], xml_root_tag=xml_root)
            content = export_fmt.serialize(
                doc if isinstance(doc, dict) else rec,
                ctx["format"],
                multi_row=False,
                layout_mode=settings.get("csvLayoutMode") or "single-header",
                delim=settings.get("csvFlattenDelimiter") or ".",
                nested_as_json=bool(settings.get("csvNestedAsJson")),
                document_shaped=isinstance(doc, dict),
                xml_root_tag=xml_root,
                xml_record_tag=xml_rec,
                xml_self_closing=settings.get("xmlSelfClosing", True) is not False,
            )
            file_entries.append((ctx["member"]["path"], content))

        # Structural companions: same size, no original content
        for sm in structural_members:
            path = sm.get("path") or sm.get("name") or "file.bin"
            size = int(sm.get("byteSize") or 0)
            file_entries.append(
                (
                    path,
                    scrambled_bytes(path, size, seed=(seed_used or 0) + i),
                )
            )

        if v_outer == "folder":
            directory_trees.append(
                repack_nested_archives(
                    file_entries, hydrated.get("nestedArchives") or []
                )
            )
            continue
        vname, vbytes = emit_variant_bytes(
            outer_format=v_outer,
            outer_extension=v_ext,
            text_entries=file_entries,
            nested=hydrated.get("nestedArchives") or [],
            package_name=hydrated.get("name") or "package",
            index=i + 1,
        )
        variant_files.append((vname, vbytes))

    # Final cumulative stats once per member (not per-variant re-sum)
    theme_hits_total = sum(int(ctx["gen"].stats.get("themeHits", 0) or 0) for ctx in contexts)

    if record_history and not ci_mode and contexts:
        for ctx in contexts:
            buf = ctx["gen"].history_buffer
            if buf:
                db.record_values(buf, mode="use")

    from app.services import archive_svc
    import base64

    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", hydrated.get("name") or "package")

    if v_outer == "folder":
        # One download archive of the uploaded tree. Prefix only when N>1.
        pkg_label = hydrated.get("name") or "package"
        root_safe = re.sub(r'[<>:"/\\|?*]', "_", pkg_label) or "package"
        combined: list[tuple[str, bytes | str]] = []
        for i, entries in enumerate(directory_trees):
            prefix = f"{root_safe}_{i + 1:04d}" if count > 1 else None
            for path, content in entries:
                combined.append((f"{prefix}/{path}" if prefix else path, content))
        pack_fmt = "tar.gz" if len(combined) > 1 else "zip"
        raw = _write_archive_bytes(pack_fmt, combined)
        ext = ".tar.gz" if pack_fmt == "tar.gz" else ".zip"
        dl_name = f"{safe}{ext}" if count == 1 else f"{safe}-variants{ext}"
        b64 = base64.b64encode(raw).decode("ascii")
        return {
            "ok": True,
            "written": count,
            "seed": seed_used,
            "sampleNames": [p for p, _ in combined[:8]],
            "zipBase64": b64,
            "archiveBase64": b64,
            "archiveFormat": pack_fmt,
            "fileName": dl_name,
            "themeHits": theme_hits_total,
            "variantFormat": v_outer,
            "outputFormat": output_format or "itself",
        }

    # Single bare file: return as-is (no wrapper archive)
    if len(variant_files) == 1 and v_outer == "file":
        vname, vbytes = variant_files[0]
        b64 = base64.b64encode(vbytes).decode("ascii")
        return {
            "ok": True,
            "written": 1,
            "seed": seed_used,
            "sampleNames": [vname],
            "zipBase64": b64,
            "archiveBase64": b64,
            "archiveFormat": "file",
            "fileName": vname,
            "themeHits": theme_hits_total,
            "variantFormat": v_outer,
            "outputFormat": output_format or "itself",
        }

    # Bundle variants: explicit bundle_format, else tar.gz when N>1, zip when N=1
    if bundle_format:
        bf = bundle_format.lower().strip()
        if bf in ("tgz", ".tar.gz"):
            bf = "tar.gz"
        if bf.startswith("."):
            bf = bf[1:]
        bundle_fmt = bf if bf in ("tar", "tar.gz", "zip") else archive_svc.default_bundle_format(
            len(variant_files)
        )
    else:
        bundle_fmt = archive_svc.default_bundle_format(len(variant_files))
    bundle, arch_ext, _media = archive_svc.pack_named_entries(
        variant_files, format=bundle_fmt
    )

    b64 = base64.b64encode(bundle).decode("ascii")
    return {
        "ok": True,
        "written": len(variant_files),
        "seed": seed_used,
        "sampleNames": [n for n, _ in variant_files[:5]],
        "zipBase64": b64,  # base64 of archive (zip or tar / tar.gz)
        "archiveBase64": b64,
        "archiveFormat": bundle_fmt,
        "fileName": f"{safe}-variants{arch_ext}",
        "themeHits": theme_hits_total,
        "variantFormat": v_outer,
        "outputFormat": output_format or "itself",
    }


def reinfer_schema_from_content(
    *,
    schema_id: str | None,
    file_name: str,
    content: str,
    existing: dict[str, Any] | None = None,
    package_id: str | None = None,
    member_path: str | None = None,
) -> dict[str, Any]:
    """
    Re-infer design schema root + sampleValues from edited member text.
    Preserves schema id / package linkage / display name when updating in place.
    Harvests history samples (ensure) — never stores generated bulk bodies.
    """
    inferred = infer.infer_schema_from_file(file_name, content)
    new_root = inferred["schema"]["root"]
    fmt = inferred["format"]
    samples = inferred.get("historySamples") or []

    prev = existing or (db.get_schema(schema_id) if schema_id else None) or {}
    sid = schema_id or prev.get("id") or str(uuid.uuid4())
    display = prev.get("name")
    if not display:
        if member_path and package_id:
            display = f"member › {member_path}"
        else:
            display = re.sub(r"\.[^.]+$", "", basename(file_name)) or file_name

    # Merge field flags (isUnique / isPrimary / enumValues / modes-related) by path
    merged_root = _merge_field_meta(prev.get("root") or [], new_root)

    doc = {
        "id": sid,
        "name": display,
        "root": merged_root,
        "sourceFileName": file_name,
        "sourceFormat": fmt,
        "isPackageMember": prev.get("isPackageMember"),
        "packageId": prev.get("packageId") or package_id,
        "xmlRootTag": prev.get("xmlRootTag"),
        "xmlRecordTag": prev.get("xmlRecordTag"),
        "csvTiedFieldPaths": prev.get("csvTiedFieldPaths"),
    }
    saved = db.save_schema(doc)
    if samples:
        # Design samples → Field values by column/tag (not history dump)
        db.ensure_custom_field_values_bulk(
            [
                {
                    "keyName": (h.get("keyName") or h.get("categoryName") or "field"),
                    "value": h.get("value") or "",
                }
                for h in samples
                if (h.get("value") or "").strip()
            ]
        )
    return saved


def _field_meta_map(rows: list[dict], parent: list[str] | None = None) -> dict[str, dict]:
    """Map dotted path → selected design flags from an existing schema tree."""
    parent = parent or []
    out: dict[str, dict] = {}
    for row in rows or []:
        leaf = (row.get("key") or "field").strip() or "field"
        path = ".".join(parent + [leaf])
        out[path.lower()] = {
            "isUnique": row.get("isUnique"),
            "isPrimary": row.get("isPrimary"),
            "enumValues": row.get("enumValues"),
            "nullRate": row.get("nullRate"),
            "themeCategory": row.get("themeCategory"),
            "historyPool": row.get("historyPool"),
            "categoryOverride": row.get("categoryOverride"),
            "historySourceKeys": row.get("historySourceKeys"),
            "pattern": row.get("pattern"),
            "min": row.get("min"),
            "max": row.get("max"),
            "minLength": row.get("minLength"),
            "maxLength": row.get("maxLength"),
            "selfClosing": row.get("selfClosing"),
        }
        kids = row.get("children") or []
        if kids:
            out.update(_field_meta_map(kids, parent + [leaf]))
    return out


def _merge_field_meta(old_root: list, new_root: list) -> list:
    """Apply prior field flags onto re-inferred tree; sampleValues come from new_root."""
    meta = _field_meta_map(old_root)

    def walk(rows: list, parent: list[str]) -> list:
        out = []
        for row in rows or []:
            leaf = (row.get("key") or "field").strip() or "field"
            path = ".".join(parent + [leaf])
            flags = meta.get(path.lower()) or meta.get(leaf.lower()) or {}
            kids = row.get("children") or []
            nr = {**row}
            for k, v in flags.items():
                if v is not None and k != "sampleValue":
                    nr[k] = v
            if kids:
                nr["children"] = walk(kids, parent + [leaf])
            out.append(nr)
        return out

    return walk(new_root, [])


def update_package_member(
    package_id: str,
    member_path: str,
    *,
    new_path: str | None = None,
    new_name: str | None = None,
    content: str | None = None,
    reinfer: bool = True,
) -> dict[str, Any]:
    """
    Design-only member edits: rename path/file name and/or sample content.
    When content changes, re-infers linked schema root/sampleValues so generate
    uses the edited design (not stale import samples).
    Never stores generated bulk bodies — only import sample / user-edited design text.
    """
    pkg = db.get_package(package_id)
    if not pkg:
        raise ValueError("Package not found")
    members = list(pkg.get("members") or [])
    idx = next((i for i, m in enumerate(members) if m.get("path") == member_path), None)
    if idx is None:
        raise ValueError(f"Member not found: {member_path}")
    m = dict(members[idx])
    if m.get("kind") != "text":
        raise ValueError("Only schema (text) members can be renamed or edited")

    target_path = normalize_path(new_path) if new_path is not None else m["path"]
    if not target_path:
        raise ValueError("Invalid path")
    if new_name is not None:
        # Rename leaf while keeping parent dirs when new_path not fully supplied
        parent = dirname_posix(target_path)
        leaf = basename(new_name) or new_name
        if not is_schema_file(leaf):
            raise ValueError(
                "File name must end with .xml, .csv, .txt, .json, .yaml, or .xlsx"
            )
        target_path = join_path(parent, leaf) if parent else leaf
        m["name"] = leaf
    elif new_path is not None:
        leaf = basename(target_path)
        if not is_schema_file(leaf):
            raise ValueError(
                "File name must end with .xml, .csv, .txt, .json, .yaml, or .xlsx"
            )
        m["name"] = leaf

    if target_path != member_path:
        if any(
            x.get("path") == target_path for i2, x in enumerate(members) if i2 != idx
        ):
            raise ValueError(f"Path already exists: {target_path}")
        m["path"] = target_path

    content_changed = content is not None
    if content is not None:
        if (m.get("format") or "").lower() == "xlsx":
            raise ValueError("XLSX members are not text-editable; re-import to change design")
        if len(content.encode("utf-8")) > MAX_TEXT:
            raise ValueError("Content too large")
        m["content"] = content
        # Keep format in sync with extension when renamed
        fmt = schema_format_from_name(m.get("name") or "")
        if fmt:
            m["format"] = fmt
    members[idx] = m
    pkg["members"] = members

    # Re-infer schema from edited content so generate uses new sampleValues
    if m.get("schemaId") and content_changed and reinfer:
        try:
            saved_schema = reinfer_schema_from_content(
                schema_id=m["schemaId"],
                file_name=m.get("name") or basename(m["path"]),
                content=m.get("content") or "",
                package_id=package_id,
                member_path=m["path"],
            )
            m["format"] = saved_schema.get("sourceFormat") or m.get("format")
            members[idx] = m
            pkg["members"] = members
        except Exception as e:
            raise ValueError(f"Could not re-infer schema from content: {e}") from e
    elif m.get("schemaId") and (new_path is not None or new_name is not None):
        schema = db.get_schema(m["schemaId"])
        if schema:
            schema = {
                **schema,
                "sourceFileName": m["name"],
                "sourceFormat": m.get("format") or schema.get("sourceFormat"),
            }
            if schema.get("isPackageMember"):
                name = schema.get("name") or ""
                if " › " in name:
                    prefix = name.split(" › ", 1)[0]
                    schema["name"] = f"{prefix} › {m['path']}"
                else:
                    schema["name"] = re.sub(r"\.[^.]+$", "", m["name"]) or m["name"]
            db.save_schema(schema)

    saved = db.save_package(pkg)
    return db.get_package_hydrated(saved["id"])  # type: ignore[return-value]


def update_nested_pack(
    package_id: str,
    folder_path: str,
    *,
    pack_format: str | None = None,
    pack_enabled: bool | None = None,
    original_archive_path: str | None = None,
) -> dict[str, Any]:
    """
    Edit how an expanded nested archive directory is re-packed on generate.
    pack_format: tar | zip | tar.gz | original (alias for stored format)
    pack_enabled: False leaves children as loose files under the folder.
    """
    pkg = db.get_package(package_id)
    if not pkg:
        raise ValueError("Package not found")
    folder = normalize_path(folder_path)
    nested = list(pkg.get("nestedArchives") or [])
    idx = next(
        (i for i, n in enumerate(nested) if normalize_path(n.get("folderPath") or "") == folder),
        None,
    )
    if idx is None:
        raise ValueError(f"Nested archive folder not found: {folder_path}")
    n = dict(nested[idx])
    original_fmt = (n.get("format") or "zip").lower()
    if pack_format is not None:
        pf = pack_format.lower().strip()
        if pf in ("original", "itself", ""):
            pf = original_fmt
        if pf in ("tgz",):
            pf = "tar.gz"
        if pf not in ("tar", "tar.gz", "zip"):
            raise ValueError("packFormat must be tar, zip, tar.gz, or original")
        n["packFormat"] = pf
        # Align emit path extension with pack format
        orig = n.get("originalArchivePath") or f"{folder}{archive_ext_for_format(pf)}"
        n["originalArchivePath"] = with_archive_extension(orig, pf)
    if pack_enabled is not None:
        n["packEnabled"] = bool(pack_enabled)
    if original_archive_path is not None:
        ap = normalize_path(original_archive_path)
        if not ap:
            raise ValueError("Invalid archive path")
        pf = n.get("packFormat") or n.get("format") or "zip"
        n["originalArchivePath"] = with_archive_extension(ap, pf)
    nested[idx] = n
    pkg["nestedArchives"] = nested

    # Keep nested_archive_folder member path pointer in sync
    members = list(pkg.get("members") or [])
    for i, m in enumerate(members):
        if m.get("kind") == "nested_archive_folder" and normalize_path(
            m.get("path") or ""
        ) == folder:
            mm = dict(m)
            mm["nestedArchivePath"] = n.get("originalArchivePath")
            mm["nestedArchiveFormat"] = n.get("packFormat") or n.get("format")
            members[i] = mm
            break
    pkg["members"] = members
    saved = db.save_package(pkg)
    return db.get_package_hydrated(saved["id"])  # type: ignore[return-value]


def save_member_schema_as(
    package_id: str,
    member_path: str,
    *,
    new_schema_name: str | None = None,
    root: list | None = None,
    content: str | None = None,
    link_to_package: bool = True,
    reinfer_from_content: bool = True,
) -> dict[str, Any]:
    """
    Save-as: new schema from member — re-infers from edited content by default
    so the copy is based on the current design text, not a stale import tree.
    When link_to_package=True, package member points at the new schema id.
    """
    hydrated = db.get_package_hydrated(package_id)
    if not hydrated:
        raise ValueError("Package not found")
    member = next(
        (m for m in hydrated["members"] if m.get("path") == member_path and m.get("kind") == "text"),
        None,
    )
    if not member or not member.get("schemaId"):
        raise ValueError("Member schema not found")
    src = hydrated["schemas"].get(member_path) or db.get_schema(member["schemaId"])
    if not src:
        raise ValueError("Source schema missing")

    text = content if content is not None else (member.get("content") or "")
    file_name = member.get("name") or basename(member_path)

    # Optionally persist content edit first (design sample)
    if content is not None and content != member.get("content"):
        hydrated = update_package_member(
            package_id, member_path, content=content, reinfer=True
        )
        member = next(
            (m for m in hydrated["members"] if m.get("path") == member_path),
            member,
        )
        src = (hydrated.get("schemas") or {}).get(member_path) or src
        text = member.get("content") or text

    display = (new_schema_name or "").strip() or f"{src.get('name') or member['name']} (copy)"
    existing = {s["name"].lower() for s in db.list_schemas(include_package_members=True)}
    base = display
    n = 2
    while display.lower() in existing:
        display = f"{base} ({n})"
        n += 1

    if root is not None:
        use_root = root
        use_fmt = src.get("sourceFormat") or member.get("format")
    elif reinfer_from_content and text.strip():
        try:
            inferred = infer.infer_schema_from_file(file_name, text)
            use_root = _merge_field_meta(src.get("root") or [], inferred["schema"]["root"])
            use_fmt = inferred["format"]
            samples = inferred.get("historySamples") or []
            if samples:
                db.ensure_custom_field_values_bulk(
                    [
                        {
                            "keyName": (
                                h.get("keyName") or h.get("categoryName") or "field"
                            ),
                            "value": h.get("value") or "",
                        }
                        for h in samples
                        if (h.get("value") or "").strip()
                    ]
                )
        except Exception as e:
            raise ValueError(f"Could not re-infer schema from content: {e}") from e
    else:
        use_root = _clone_rows(src.get("root") or [])
        use_fmt = src.get("sourceFormat") or member.get("format")

    doc = {
        "id": str(uuid.uuid4()),
        "name": display,
        "root": use_root,
        "sourceFileName": src.get("sourceFileName") or member.get("name"),
        "sourceFormat": use_fmt,
        "isPackageMember": True if link_to_package else None,
        "packageId": package_id if link_to_package else None,
        "xmlRootTag": src.get("xmlRootTag"),
        "xmlRecordTag": src.get("xmlRecordTag"),
        "csvTiedFieldPaths": src.get("csvTiedFieldPaths"),
    }
    saved = db.save_schema(doc)
    if link_to_package:
        pkg = db.get_package(package_id)
        if not pkg:
            raise ValueError("Package not found")
        members = []
        for m in pkg.get("members") or []:
            if m.get("path") == member_path:
                members.append({**m, "schemaId": saved["id"]})
            else:
                members.append(m)
        pkg["members"] = members
        db.save_package(pkg)
    return {
        "ok": True,
        "schema": saved,
        "package": db.get_package_hydrated(package_id),
    }


def _apply_field_modes(
    schema: dict, modes: dict[str, str], default_mode: str
) -> tuple[dict, list[str]]:
    tied: list[str] = []

    def mode_of(path: str) -> str:
        # Full dotted path, case-insensitive, or leaf key fallback
        if path in modes:
            return modes[path]
        low = path.lower()
        if low in modes:
            return modes[low]
        leaf = path.rsplit(".", 1)[-1]
        if leaf in modes:
            return modes[leaf]
        if leaf.lower() in modes:
            return modes[leaf.lower()]
        return default_mode

    def walk(rows: list[dict], parent: list[str]) -> list[dict]:
        out = []
        for row in rows:
            leaf = (row.get("key") or "field").strip() or "field"
            full = parent + [leaf]
            path_key = ".".join(full)
            kids = row.get("children") or []
            new_kids = walk(kids, full) if kids else []
            kind = row.get("kind") or "value"
            nr = {**row, "children": new_kids}
            if kind == "value" or (not kids and kind not in ("object", "array")):
                mode = mode_of(path_key)
                if mode == "same":
                    tied.append(path_key)
                    nr["isUnique"] = False
                    nr["isPrimary"] = False
                elif mode == "unique":
                    nr["isUnique"] = True
                else:
                    nr["isUnique"] = False
                    nr["isPrimary"] = False
            out.append(nr)
        return out

    root = walk(schema.get("root") or [], [])
    adjusted = {
        **schema,
        "root": root,
        "csvTiedFieldPaths": tied if tied else None,
    }
    return adjusted, tied
