"""Build ZIP / TAR / TAR.GZ archives of generated exports."""
from __future__ import annotations

import io
import tarfile
import zipfile
from typing import Any

from app.services import export_fmt


def default_bundle_format(entry_count: int) -> str:
    """
    Prefer tar.gz when bundling more than one file (better compression / space).
    Single-file bundles stay ZIP for wider Windows tooling defaults.
    """
    return "tar.gz" if int(entry_count or 0) > 1 else "zip"


def extension_for_format(fmt: str) -> str:
    f = (fmt or "zip").lower().strip()
    if f in ("tar.gz", "tgz", ".tar.gz", ".tgz"):
        return ".tar.gz"
    if f in ("tar", ".tar"):
        return ".tar"
    return ".zip"


def media_type_for_format(fmt: str) -> str:
    f = (fmt or "zip").lower().strip()
    if f in ("tar.gz", "tgz", ".tar.gz", ".tgz"):
        return "application/gzip"
    if f in ("tar", ".tar"):
        return "application/x-tar"
    return "application/zip"


def pack_named_entries(
    entries: list[tuple[str, bytes | str]],
    *,
    format: str | None = None,
) -> tuple[bytes, str, str]:
    """
    Pack path→content entries into an archive.

    When ``format`` is omitted, uses tar.gz if more than one entry, else zip.
    Returns (raw_bytes, extension_with_dot, media_type).
    """
    fmt = (format or default_bundle_format(len(entries))).lower().strip()
    if fmt.startswith("."):
        fmt = fmt[1:]
    if fmt == "tgz":
        fmt = "tar.gz"

    buf = io.BytesIO()
    if fmt == "tar.gz":
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for path, content in entries:
                data = content if isinstance(content, bytes) else content.encode("utf-8")
                info = tarfile.TarInfo(name=str(path).replace("\\", "/"))
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue(), ".tar.gz", "application/gzip"
    if fmt == "tar":
        with tarfile.open(fileobj=buf, mode="w") as tar:
            for path, content in entries:
                data = content if isinstance(content, bytes) else content.encode("utf-8")
                info = tarfile.TarInfo(name=str(path).replace("\\", "/"))
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue(), ".tar", "application/x-tar"

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries:
            data = content if isinstance(content, bytes) else content.encode("utf-8")
            zf.writestr(str(path).replace("\\", "/"), data)
    return buf.getvalue(), ".zip", "application/zip"


def build_archive(
    files: list[dict[str, Any]],
    *,
    extension: str | None = None,
    top_folder: str | None = None,
) -> tuple[bytes, str]:
    """
    files: [{ fileName, format, data, multiRow?, layoutMode?, delim?, nestedAsJson? }]
    Returns (bytes, media_type).

    Default extension: .tar.gz when packing more than one file, else .zip.
    Pass an explicit extension to override.
    """
    entries: list[tuple[str, bytes | str]] = []
    for f in files:
        fmt = f.get("format") or "xml"
        name = f.get("fileName") or "data"
        data = f.get("data")
        content: bytes | str
        # Pre-serialized binary (base64) or text body
        if f.get("contentBase64"):
            import base64

            content = base64.b64decode(str(f.get("contentBase64")))
        elif f.get("content") is not None and str(f.get("content")) != "":
            content = str(f.get("content"))
        else:
            # Schema-shaped XML document (single-key tree) — do not list-wrap
            doc_shaped = bool(f.get("documentShaped")) or (
                (fmt or "").lower() == "xml"
                and isinstance(data, dict)
                and len(data) == 1
            )
            content = export_fmt.serialize(
                data,
                fmt,
                multi_row=f.get("multiRow", True),
                layout_mode=f.get("layoutMode") or "single-header",
                delim=f.get("delim") or ".",
                nested_as_json=bool(f.get("nestedAsJson")),
                xml_root_tag=f.get("xmlRootTag") or "root",
                xml_record_tag=f.get("xmlRecordTag") or "record",
                xml_self_closing=bool(f["xmlSelfClosing"])
                if "xmlSelfClosing" in f and f["xmlSelfClosing"] is not None
                else True,
                document_shaped=doc_shaped,
            )
        e = export_fmt.extension_for_format(fmt)
        lower = name.lower()
        if not any(
            lower.endswith(x)
            for x in (
                f".{e}",
                ".json",
                ".xml",
                ".csv",
                ".txt",
                ".yml",
                ".yaml",
                ".xlsx",
                ".xls",
            )
        ):
            name = f"{name}.{e}"
        if top_folder:
            name = f"{top_folder.strip().strip('/')}/{name}"
        entries.append((name.replace("\\", "/"), content))

    if extension is None or str(extension).strip() == "":
        pack_fmt = default_bundle_format(len(entries))
    else:
        ext = str(extension).lower()
        if not ext.startswith("."):
            ext = "." + ext
        pack_fmt = "tar.gz" if ext in (".tar.gz", ".tgz") else "tar" if ext == ".tar" else "zip"

    raw, _ext, media = pack_named_entries(entries, format=pack_fmt)
    return raw, media


def read_archive_listing(raw: bytes, file_name: str) -> list[dict[str, Any]]:
    lower = file_name.lower()
    out: list[dict[str, Any]] = []
    if lower.endswith((".tar.gz", ".tgz")):
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
            for m in tar.getmembers():
                if m.isfile():
                    out.append({"path": m.name, "size": m.size})
    elif lower.endswith(".tar"):
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
            for m in tar.getmembers():
                if m.isfile():
                    out.append({"path": m.name, "size": m.size})
    else:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for info in zf.infolist():
                if not info.is_dir():
                    out.append({"path": info.filename, "size": info.file_size})
    return out


def read_archive_entry(raw: bytes, file_name: str, entry_path: str) -> str:
    lower = file_name.lower()
    if lower.endswith((".tar.gz", ".tgz")):
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
            f = tar.extractfile(entry_path)
            if not f:
                raise FileNotFoundError(entry_path)
            return f.read().decode("utf-8", errors="replace")
    if lower.endswith(".tar"):
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
            f = tar.extractfile(entry_path)
            if not f:
                raise FileNotFoundError(entry_path)
            return f.read().decode("utf-8", errors="replace")
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        return zf.read(entry_path).decode("utf-8", errors="replace")
