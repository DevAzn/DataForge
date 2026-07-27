"""
Package / multifile import + variant generate.

Whole package = one record unit. Nested zip/tar/tar.gz expand into a folder
named after the archive (extensions stripped). Generated variants are returned
as archive bytes (not stored in SQLite — only layout + schemas + sample text).
"""
from __future__ import annotations

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

TEXT_EXTS = {
    ".json",
    ".jsonl",
    ".ndjson",
    ".xml",
    ".csv",
    ".yml",
    ".yaml",
    ".txt",
}


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


def is_likely_text(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(e) for e in TEXT_EXTS)


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


def expand_files(
    files: list[tuple[str, bytes]],
    path_prefix: str,
    depth: int,
    nested: list[dict[str, str]],
    skipped: list[str],
) -> list[tuple[str, bytes]]:
    if depth > MAX_NEST:
        for p, _ in files:
            skipped.append(join_path(path_prefix, p))
        return []
    result: list[tuple[str, bytes]] = []
    for rel, content in files:
        full = join_path(path_prefix, rel)
        name = basename(rel)
        nest_fmt = detect_nested_format(name)
        if nest_fmt:
            folder_name = strip_archive_extensions(name)
            folder_path = join_path(path_prefix, join_path(dirname_posix(rel), folder_name))
            nested.append(
                {
                    "folderPath": folder_path,
                    "originalArchivePath": full,
                    "format": nest_fmt,
                }
            )
            try:
                inner = read_archive_bytes(content, nest_fmt)
                result.extend(
                    expand_files(inner, folder_path, depth + 1, nested, skipped)
                )
            except Exception:
                skipped.append(full)
            continue
        if not is_likely_text(name):
            skipped.append(full)
            continue
        if len(content) > MAX_TEXT:
            skipped.append(f"{full} (too large)")
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


def import_package_from_bytes(
    *,
    package_name: str,
    file_entries: list[tuple[str, bytes]],
    source_kind: str = "files",
    outer_format: str = "folder",
    outer_extension: str | None = None,
) -> dict[str, Any]:
    """
    file_entries: list of (relative_path, bytes) — either archive members or multi-upload.
    """
    nested: list[dict[str, str]] = []
    skipped: list[str] = []
    expanded = expand_files(file_entries, "", 0, nested, skipped)

    package_id = str(uuid.uuid4())
    members: list[dict[str, Any]] = []
    schemas: dict[str, Any] = {}
    pending: list[dict[str, Any]] = []

    for n in nested:
        members.append(
            {
                "id": str(uuid.uuid4()),
                "path": n["folderPath"],
                "name": basename(n["folderPath"]),
                "kind": "nested_archive_folder",
                "nestedArchivePath": n["originalArchivePath"],
                "nestedArchiveFormat": n["format"],
                "verified": True,
            }
        )

    for path, raw in expanded:
        file_name = basename(path)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", errors="replace")
        try:
            inferred = infer.infer_schema_from_file(file_name, text)
            pending.append(
                {
                    "path": path,
                    "fileName": file_name,
                    "text": text,
                    "format": inferred["format"],
                    "root": inferred["schema"]["root"],
                    "historySamples": inferred.get("historySamples") or [],
                }
            )
        except Exception:
            skipped.append(path)

    if not pending:
        reasons = ", ".join(skipped[:12]) if skipped else "no text files found"
        more = f" (+{len(skipped) - 12} more)" if len(skipped) > 12 else ""
        raise ValueError(
            f"Package import produced no text members ({reasons}{more}). "
            "Import text JSON/XML/CSV/YAML files or an archive that contains them."
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
        # harvest samples into history (ensure) — not generated files
        if item["historySamples"]:
            db.record_values(item["historySamples"], mode="ensure")
        members.append(
            {
                "id": str(uuid.uuid4()),
                "path": item["path"],
                "name": item["fileName"],
                "kind": "text",
                "format": item["format"],
                "content": item["text"],
                "schemaId": saved["id"],
                "verified": False,
            }
        )
        schemas[item["path"]] = saved

    members.sort(
        key=lambda m: (0 if m["kind"] == "nested_archive_folder" else 1, m["path"])
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
                    f"Multifile package ({len(pending)} files): "
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

    doc = {
        "id": package_id,
        "name": display,
        "sourceKind": source_kind,
        "outerFormat": outer_format,
        "outerExtension": outer_extension,
        "members": members,
        "nestedArchives": nested,
        "skipped": skipped,
        "multifileSchemaId": multifile_schema_id,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    saved_pkg = db.save_package(doc)
    return {**saved_pkg, "schemas": schemas}


def import_uploaded_archive(file_name: str, raw: bytes) -> dict[str, Any]:
    outer_fmt, outer_ext = outer_from_name(file_name)
    name = strip_archive_extensions(file_name)
    if outer_fmt == "folder":
        # single loose file
        if not is_likely_text(file_name):
            raise ValueError("Unsupported file type")
        return import_package_from_bytes(
            package_name=name,
            file_entries=[(basename(file_name), raw)],
            source_kind="files",
            outer_format="folder",
        )
    nest = "zip" if outer_fmt == "zip" else "tar" if outer_fmt == "tar" else "tar.gz"
    entries = read_archive_bytes(raw, nest)
    return import_package_from_bytes(
        package_name=name,
        file_entries=entries,
        source_kind="archive",
        outer_format=outer_fmt,
        outer_extension=outer_ext,
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
    text_count = len(text_members)
    top_level_text = sum(1 for m in text_members if not under_nested(m.get("path") or ""))
    nested_archive_count = len(nested)
    # After re-pack: top-level text files + one file per nested archive
    top_level_entries = top_level_text + nested_archive_count
    outer_format = package.get("outerFormat") or "zip"

    return {
        "recordCount": n,
        "recordMeans": "one full package variant",
        "textFilesPerPackage": text_count,
        "topLevelTextFilesPerPackage": top_level_text,
        "nestedArchivesPerPackage": nested_archive_count,
        "topLevelEntriesPerPackage": top_level_entries,
        "outerFormat": outer_format,
        "estimatedOuterPackages": n,
        # Content files regenerated across all variants (text members × N)
        "estimatedLogicalContentFiles": n * text_count,
        # Top-level entries inside all outer packages (text + re-packed nested archives)
        "estimatedTopLevelEntriesTotal": n * top_level_entries,
        # UI download: one bundle (tar.gz when N>1 for space, else zip)
        "downloadBundles": 1,
        "downloadContainsPackages": n,
        "downloadBundleFormat": "tar.gz" if n > 1 else "zip",
        "summary": (
            f"{n} package variant(s) × {top_level_entries} top-level entr"
            f"{'y' if top_level_entries == 1 else 'ies'} "
            f"({text_count} text file(s) regenerated per package) "
            f"≈ {n * text_count} content file(s) + {n * nested_archive_count} nested archive(s); "
            f"download: 1 {'tar.gz' if n > 1 else 'ZIP'} with {n} package(s)"
        ),
    }


def import_uploaded_files(files: list[tuple[str, bytes]]) -> dict[str, Any]:
    """Multi-file upload (flat names) or single archive."""
    if len(files) == 1:
        name, raw = files[0]
        outer_fmt, _ = outer_from_name(name)
        if outer_fmt != "folder":
            return import_uploaded_archive(name, raw)
    entries = [(basename(n), b) for n, b in files]
    pkg_name = (
        strip_archive_extensions(files[0][0])
        if len(files) == 1
        else f"package-{now_iso()[:10]}"
    )
    return import_package_from_bytes(
        package_name=pkg_name,
        file_entries=entries,
        source_kind="files",
        outer_format="folder",
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


def emit_variant_bytes(
    *,
    outer_format: str,
    outer_extension: str | None,
    text_entries: list[tuple[str, str]],
    nested: list[dict[str, str]],
    package_name: str,
    index: int,
) -> tuple[str, bytes]:
    """Return (file_name, archive_or_folder_zip_bytes)."""
    files: dict[str, bytes | str] = {p: c for p, c in text_entries}
    nested_sorted = sorted(
        nested, key=lambda n: -len(n.get("folderPath", "").split("/"))
    )

    for nest in nested_sorted:
        folder = nest.get("folderPath") or ""
        children: list[tuple[str, bytes | str]] = []
        for p, content in list(files.items()):
            if _is_under(p, folder) and p != folder:
                children.append((_rel_to(p, folder), content))
        for p in list(files.keys()):
            if _is_under(p, folder) and p != folder:
                del files[p]
        files.pop(folder, None)
        nest_fmt = nest.get("format") or "zip"
        nested_bytes = _write_archive_bytes(nest_fmt, children)
        orig = nest.get("originalArchivePath") or f"{folder}.zip"
        files[orig] = nested_bytes

    flat = list(files.items())
    safe = re.sub(r'[<>:"/\\|?*]', "_", package_name) or "package"
    pad = f"{index:04d}"

    if outer_format == "folder":
        # Zip of folder tree as package_NNNN/
        entries = [(f"{safe}_{pad}/{p}", c) for p, c in flat]
        return f"{safe}_{pad}.zip", _write_archive_bytes("zip", entries)

    ext = outer_extension or (
        ".tar.gz" if outer_format == "tar.gz" else ".tar" if outer_format == "tar" else ".zip"
    )
    pack_fmt = "tar.gz" if outer_format == "tar.gz" else outer_format if outer_format in ("tar", "zip") else "zip"
    name = f"{safe}_{pad}{ext}"
    return name, _write_archive_bytes(pack_fmt, flat)


def generate_package_variants(
    package_id: str,
    *,
    record_count: int = 10,
    seed: int | None = None,
    ci_mode: bool = False,
    record_history: bool = True,
    default_field_mode: str = "random",
    field_modes: dict[str, dict[str, str]] | None = None,
    history_lookup=None,
    custom_lookup=None,
    theme_lookup=None,
    theme_prefer: bool = True,
    settings: dict | None = None,
) -> dict[str, Any]:
    """
    Generate N full package variants. Returns archive (ZIP or tar.gz) of variants.
    Does not store generated content in SQLite.
    """
    hydrated = db.get_package_hydrated(package_id)
    if not hydrated:
        raise ValueError("Package not found")
    text_members = [m for m in hydrated["members"] if m.get("kind") == "text" and m.get("schemaId")]
    if not text_members:
        raise ValueError("Package has no text members with schemas")

    count = max(1, min(int(record_count or 1), 10_000))
    settings = settings or db.get_settings()
    field_modes = field_modes or {}
    default_mode = default_field_mode or "random"
    hist_lookup = history_lookup or (lambda _k: [])
    cust_lookup = custom_lookup or (lambda _k: [])

    # Prepare schemas with modes
    prepared = []
    for m in text_members:
        schema = hydrated["schemas"].get(m["path"])
        if not schema:
            continue
        modes = field_modes.get(m["path"]) or {}
        adjusted, tied = _apply_field_modes(schema, modes, default_mode)
        prepared.append(
            {
                "member": m,
                "schema": adjusted,
                "tied": tied,
                "format": m.get("format") or schema.get("sourceFormat") or "xml",
            }
        )
    if not prepared:
        raise ValueError("No valid member schemas available for this package")

    # Generate all variants into memory as named files
    variant_files: list[tuple[str, bytes]] = []
    seed_used = seed
    theme_hits_total = 0

    # Shared unique sets across variants via one generator context per member
    contexts = []
    for p in prepared:
        from app.services.generator import Generator, build_tied_template, merge_missing_tied, apply_tied

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
        text_entries: list[tuple[str, str]] = []
        for ctx in contexts:
            rec = ctx["gen"].one_record()
            if ctx["template"] is not None:
                if i == 0:
                    merge_missing_tied(ctx["template"], rec, ctx["tied"])
                apply_tied(ctx["template"], rec, ctx["tied"])
            content = export_fmt.serialize(
                rec,
                ctx["format"],
                multi_row=False,
                layout_mode=settings.get("csvLayoutMode") or "single-header",
                delim=settings.get("csvFlattenDelimiter") or ".",
                nested_as_json=bool(settings.get("csvNestedAsJson")),
                xml_root_tag=settings.get("xmlRootTag") or "root",
                xml_record_tag=settings.get("xmlRecordTag") or "record",
                xml_self_closing=settings.get("xmlSelfClosing", True) is not False,
            )
            text_entries.append((ctx["member"]["path"], content))
            theme_hits_total += ctx["gen"].stats.get("themeHits", 0)

        vname, vbytes = emit_variant_bytes(
            outer_format=hydrated.get("outerFormat") or "zip",
            outer_extension=hydrated.get("outerExtension"),
            text_entries=text_entries,
            nested=hydrated.get("nestedArchives") or [],
            package_name=hydrated.get("name") or "package",
            index=i + 1,
        )
        variant_files.append((vname, vbytes))

    if record_history and not ci_mode:
        for ctx in contexts:
            buf = ctx["gen"].history_buffer
            if buf:
                db.record_values(buf, mode="use")

    # Bundle variants: tar.gz when more than one (space), else zip
    from app.services import archive_svc

    bundle_fmt = archive_svc.default_bundle_format(len(variant_files))
    bundle, arch_ext, _media = archive_svc.pack_named_entries(
        variant_files, format=bundle_fmt
    )
    import base64

    b64 = base64.b64encode(bundle).decode("ascii")
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", hydrated.get("name") or "package")
    return {
        "ok": True,
        "written": len(variant_files),
        "seed": seed_used,
        "sampleNames": [n for n, _ in variant_files[:5]],
        "zipBase64": b64,  # base64 of archive (zip or tar.gz)
        "archiveBase64": b64,
        "archiveFormat": bundle_fmt,
        "fileName": f"{safe}-variants{arch_ext}",
        "themeHits": theme_hits_total,
    }


def _apply_field_modes(
    schema: dict, modes: dict[str, str], default_mode: str
) -> tuple[dict, list[str]]:
    tied: list[str] = []

    def mode_of(path: str) -> str:
        return modes.get(path) or modes.get(path.lower()) or default_mode

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
