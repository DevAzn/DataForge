"""Build ZIP / TAR / TAR.GZ archives of generated exports."""
from __future__ import annotations

import io
import tarfile
import zipfile
from typing import Any

from app.services import export_fmt


def build_archive(
    files: list[dict[str, Any]],
    *,
    extension: str = ".zip",
    top_folder: str | None = None,
) -> tuple[bytes, str]:
    """
    files: [{ fileName, format, data, multiRow?, layoutMode?, delim?, nestedAsJson? }]
    Returns (bytes, content_type-ish name).
    """
    ext = (extension or ".zip").lower()
    if not ext.startswith("."):
        ext = "." + ext

    entries: list[tuple[str, str]] = []
    for f in files:
        fmt = f.get("format") or "json"
        name = f.get("fileName") or "data"
        content = export_fmt.serialize(
            f.get("data"),
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
        )
        e = export_fmt.extension_for_format(fmt)
        lower = name.lower()
        if not any(
            lower.endswith(x)
            for x in (f".{e}", ".json", ".xml", ".csv", ".txt", ".yml", ".yaml")
        ):
            name = f"{name}.{e}"
        if top_folder:
            name = f"{top_folder.strip().strip('/')}/{name}"
        entries.append((name.replace("\\", "/"), content))

    buf = io.BytesIO()
    if ext in (".tar.gz", ".tgz"):
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for path, text in entries:
                data = text.encode("utf-8")
                info = tarfile.TarInfo(name=path)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue(), "application/gzip"
    if ext in (".tar",):
        with tarfile.open(fileobj=buf, mode="w") as tar:
            for path, text in entries:
                data = text.encode("utf-8")
                info = tarfile.TarInfo(name=path)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        return buf.getvalue(), "application/x-tar"

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, text in entries:
            zf.writestr(path, text)
    return buf.getvalue(), "application/zip"


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
