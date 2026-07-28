"""FastAPI entry — DataForge API."""
from __future__ import annotations

import base64
import io
import json
import uuid
from typing import Any, Callable

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app import database as db
from app.defaults import (
    MAX_IMPORT_BYTES,
    MAX_IN_MEMORY_GENERATE_RECORDS,
    STREAM_STRUCTURED_MAX_RECORDS,
)
from app.services import (
    archive_svc,
    delivery_svc,
    export_fmt,
    generator,
    infer,
    package_svc,
)
from app.services import file_naming

APP_VERSION = "0.5.0"
APP_NAME = "DataForge"

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description=(
        "Local ETL test-data generator. SQLite stores schemas, history, custom values, "
        "and themes only — never auto-generated file bodies."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()
    # Repair schemas left behind by older package deletes
    try:
        db.cleanup_orphan_package_schemas()
    except Exception:
        pass


# ── models ──────────────────────────────────────────────────────────


class SchemaBody(BaseModel):
    id: str | None = None
    name: str = "Untitled"
    description: str | None = None
    root: list[dict[str, Any]] = Field(default_factory=list)
    csvTiedFieldPaths: list[str] | None = None
    sourceFileName: str | None = None
    sourceFormat: str | None = None
    # Per-schema XML tags (override app defaults when set)
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    isMultifile: bool | None = None
    packageId: str | None = None
    isPackageMember: bool | None = None
    createdAt: str | None = None
    updatedAt: str | None = None
    lastOpenedAt: str | None = None


class ThemeBlendEntry(BaseModel):
    themeId: str
    weight: float = 1.0


class GenerateBody(BaseModel):
    schema_: dict[str, Any] = Field(alias="schema")
    recordCount: int = 10
    seed: int | None = None
    ciMode: bool = False
    recordHistory: bool = True
    # Optional override of settings.dataThemes for this run
    useDataThemes: bool | None = None
    themeBlend: list[ThemeBlendEntry] | None = None
    themePreferOverHistory: bool | None = None

    model_config = {"populate_by_name": True}


class ExportBody(BaseModel):
    data: Any
    format: str = "json"
    multiRow: bool = True
    layoutMode: str = "single-header"
    delim: str = "."
    nestedAsJson: bool = False
    # When False (default), a single object is wrapped as a one-element list for stable ETL shapes.
    singleObject: bool = False
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    xmlSelfClosing: bool | None = None
    # Optional path/tag overrides: { "field": true, "meta.child": false }
    xmlSelfClosingMap: dict[str, bool] | None = None


class StreamBody(GenerateBody):
    format: str = "csv"
    multiRow: bool = True
    layoutMode: str = "single-header"
    delim: str = "."
    nestedAsJson: bool = False
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    xmlSelfClosing: bool | None = None
    xmlSelfClosingMap: dict[str, bool] | None = None


class PerFileBody(GenerateBody):
    format: str = "json"
    multiRow: bool = True
    layoutMode: str = "single-header"
    delim: str = "."
    nestedAsJson: bool = False
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    xmlSelfClosing: bool | None = None
    fileName: str | None = None
    previewSampleSize: int = 5


class ArchiveBuildBody(BaseModel):
    # None = auto: .tar.gz when packing more than one file, else .zip
    extension: str | None = None
    topFolderName: str | None = None
    mode: str = "multi-format"  # multi-format | split-records
    files: list[dict[str, Any]] = Field(default_factory=list)
    # optional generate-then-pack
    generate: GenerateBody | None = None
    formats: list[str] | None = None


class TemplateBody(BaseModel):
    id: str | None = None
    name: str = "Template"
    description: str | None = None
    schemaJson: str | None = None
    schemaDoc: dict[str, Any] | None = Field(default=None, alias="schema")
    sampleDataJson: str | None = None

    model_config = {"populate_by_name": True}


class HistoryUpdateBody(BaseModel):
    id: str
    value: str


class ClearHistoryBody(BaseModel):
    mode: str = "all"
    days: int | None = None
    beforeIso: str | None = None
    age: str | None = None
    confirmAll: bool = False


# ── helpers ─────────────────────────────────────────────────────────


def _harvest_schema_samples(root: list[dict], path: list[str] | None = None) -> list[dict]:
    path = path or []
    out: list[dict] = []
    for row in root:
        leaf = (row.get("key") or "field").strip() or "field"
        if (row.get("kind") or "value") == "value":
            sample = (row.get("sampleValue") or "").strip()
            if sample:
                key = generator.field_write_key(path, row)
                out.append({"categoryName": key, "keyName": key, "value": sample})
        kids = row.get("children") or []
        if kids:
            out.extend(_harvest_schema_samples(kids, path + [leaf]))
    return out


def _history_lookup(key: str) -> list[str]:
    """Learned value history only. Never loads generated file bodies."""
    return db.get_values_for_key(key)


def _custom_lookup(key: str) -> list[str]:
    """User custom list values only."""
    return db.get_custom_values_for_key(key)


def _lookup(key: str) -> list[str]:
    """
    Backward-compatible combined lookup (custom then history).
    Prefer passing _custom_lookup and _history_lookup separately so the generator
    can enforce strict fill order: enums → theme → custom → history → synth.
    """
    custom = _custom_lookup(key)
    hist = _history_lookup(key)
    if not custom:
        return hist
    seen = set(custom)
    return custom + [h for h in hist if h not in seen]


def _resolve_theme_context(body: GenerateBody | None = None) -> tuple[
    Callable[[str], list[str]] | None,
    bool,
    list[dict[str, Any]],
]:
    """Build theme_lookup(category) from settings + optional request override."""
    settings = db.get_settings()
    dt = settings.get("dataThemes") or {}
    enabled = dt.get("enabled", True) if body is None or body.useDataThemes is None else body.useDataThemes
    prefer = (
        dt.get("preferOverHistory", True)
        if body is None or body.themePreferOverHistory is None
        else body.themePreferOverHistory
    )
    blend: list[dict[str, Any]]
    if body is not None and body.themeBlend is not None:
        blend = [b.model_dump() for b in body.themeBlend]
    else:
        blend = list(dt.get("blend") or [])

    if not enabled or not blend:
        return None, prefer, blend

    def theme_lookup(category: str) -> list[str]:
        return db.get_blended_theme_values(category, blend)

    return theme_lookup, prefer, blend


def _run_generate(body: GenerateBody) -> dict:
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")
    theme_lookup, theme_prefer, blend = _resolve_theme_context(body)
    try:
        result = generator.generate_records(
            schema,
            record_count=body.recordCount,
            seed=body.seed,
            ci_mode=body.ciMode,
            history_lookup=_history_lookup,
            custom_lookup=_custom_lookup,
            theme_lookup=theme_lookup,
            theme_prefer=theme_prefer,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if body.recordHistory and not body.ciMode:
        buf = result.pop("historyBuffer", [])
        if buf:
            db.record_values(buf, mode="use")
    else:
        result.pop("historyBuffer", None)
    db.log_interaction(
        "generate",
        {
            "count": result["recordCount"],
            "seed": result["seed"],
            "schemaId": schema.get("id"),
            "schemaName": schema.get("name"),
            "themeBlend": blend,
            "themeHits": (result.get("report") or {}).get("themeHits"),
            "customHits": (result.get("report") or {}).get("customHits"),
        },
    )
    return result


# ── core routes ─────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    return {"ok": True, "app": APP_NAME, "version": APP_VERSION}


@app.get("/api/status")
def status():
    schemas = db.list_schemas()
    templates = db.list_templates()
    return {
        "ok": True,
        "version": APP_VERSION,
        "schemaCount": len(schemas),
        "templateCount": len(templates),
        "valueHistoryCount": db.history_count(),
        "customListCount": db.custom_list_count(),
        "themeCount": len(db.list_themes()),
        "packageCount": db.package_count(),
        "deliveryJobCount": db.delivery_job_count(),
        "dbPath": str(db.DB_PATH),
        "persistence": {
            "stores": [
                "schemas",
                "history",
                "customValues",
                "themes",
                "settings",
                "templates",
                "packageLayouts",
                "deliveryJobPlans",
            ],
            "neverStores": [
                "generatedRecords",
                "exportFileBodies",
                "packageVariants",
                "deliveryArtifacts",
            ],
        },
        "paths": {
            "userData": str(db.DATA_DIR),
            "dbPath": str(db.DB_PATH),
            "encryptionDir": str(db.ENCRYPTION_DIR),
        },
    }


@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.put("/api/settings")
def put_settings(body: dict[str, Any]):
    return db.set_settings(body)


@app.get("/api/schemas")
def schemas_list():
    return db.list_schemas()


@app.get("/api/schemas/{schema_id}")
def schemas_get(schema_id: str):
    s = db.get_schema(schema_id)
    if not s:
        raise HTTPException(404, "Schema not found")
    return s


@app.post("/api/schemas")
def schemas_save(body: SchemaBody):
    data = body.model_dump(by_alias=False)
    if not data.get("id"):
        data["id"] = str(uuid.uuid4())
    saved = db.save_schema(data)
    samples = _harvest_schema_samples(saved.get("root") or [])
    if samples:
        db.record_values(samples, mode="ensure")
    return saved


@app.post("/api/schemas/{schema_id}/touch")
def schemas_touch(schema_id: str):
    if not db.get_schema(schema_id):
        raise HTTPException(404, "Schema not found")
    db.touch_schema_opened(schema_id)
    return {"ok": True}


@app.delete("/api/schemas/{schema_id}")
def schemas_delete(schema_id: str):
    try:
        if not db.delete_schema(schema_id):
            raise HTTPException(404, "Schema not found")
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


@app.post("/api/schemas/import")
async def schemas_import(file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(400, "File too large (max 25 MB)")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    try:
        result = infer.infer_schema_from_file(file.filename or "upload.bin", text)
    except Exception as e:
        raise HTTPException(400, f"Import failed: {e}") from e
    schema = result["schema"]
    saved = db.save_schema(schema)
    if result.get("historySamples"):
        db.record_values(result["historySamples"], mode="ensure")
    samples = _harvest_schema_samples(saved.get("root") or [])
    if samples:
        db.record_values(samples, mode="ensure")
    return {
        "schema": saved,
        "format": result["format"],
        "recordHint": result["recordHint"],
        "scannedRecords": result["scannedRecords"],
        "historyValues": len(result.get("historySamples") or []),
    }


@app.post("/api/generate")
def generate(body: GenerateBody):
    return _run_generate(body)


@app.post("/api/generate/stream")
def generate_stream(body: StreamBody):
    """
    Stream generate for large counts.
    - csv / jsonl: true per-record iteration (no full materialization)
    - json / xml / yaml / txt: capped at STREAM_STRUCTURED_MAX_RECORDS; use csv/jsonl for larger N
    Failures raise HTTP errors before the stream starts when possible (never 200 + ERROR: body).
    """
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")
    settings = db.get_settings()
    try:
        fmt = export_fmt.validate_format(body.format or "csv")
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    count = int(body.recordCount or 1)
    structured = fmt in ("json", "xml", "yaml", "txt")
    if structured and count > STREAM_STRUCTURED_MAX_RECORDS:
        raise HTTPException(
            400,
            f"Stream format {fmt!r} is limited to {STREAM_STRUCTURED_MAX_RECORDS:,} records "
            f"(requested {count:,}). Use format csv or jsonl for large counts.",
        )

    delim = body.delim or settings.get("csvFlattenDelimiter") or "."
    nested = (
        body.nestedAsJson
        if body.nestedAsJson is not None
        else settings.get("csvNestedAsJson")
    )
    layout = body.layoutMode or settings.get("csvLayoutMode") or "single-header"
    multi = body.multiRow if body.multiRow is not None else settings.get("csvMultiRow", True)
    # Non-single-header CSV still buffers full output — enforce memory cap up front.
    if fmt == "csv" and layout != "single-header" and count > MAX_IN_MEMORY_GENERATE_RECORDS:
        raise HTTPException(
            400,
            f"CSV layout {layout!r} is limited to {MAX_IN_MEMORY_GENERATE_RECORDS:,} records "
            f"(requested {count:,}). Use layoutMode single-header or lower the count.",
        )
    theme_lookup, theme_prefer, _blend = _resolve_theme_context(body)
    xml_opts = _xml_opts(body, settings)

    def _iter_kwargs():
        return dict(
            record_count=count,
            seed=body.seed,
            ci_mode=body.ciMode,
            history_lookup=_history_lookup,
            custom_lookup=_custom_lookup,
            theme_lookup=theme_lookup,
            theme_prefer=theme_prefer,
        )

    def line_iter():
        last_gen = None
        if fmt == "jsonl":
            for _i, rec, gen in generator.iter_records(schema, **_iter_kwargs()):
                last_gen = gen
                yield json.dumps(rec, ensure_ascii=False) + "\n"
        elif fmt == "csv":
            # True row stream: headers from first record (single-header layout only for stream).
            # Other layout modes fall back to buffered serialize within the cap.
            if layout != "single-header":
                result = generator.generate_records(
                    schema,
                    allow_large=count <= MAX_IN_MEMORY_GENERATE_RECORDS,
                    **_iter_kwargs(),
                )
                last_gen = None
                if body.recordHistory and not body.ciMode:
                    buf = result.pop("historyBuffer", [])
                    if buf:
                        db.record_values(buf, mode="use")
                text = export_fmt.serialize(
                    result["records"],
                    "csv",
                    multi_row=multi,
                    layout_mode=layout,
                    delim=delim,
                    nested_as_json=bool(nested),
                    **xml_opts,
                )
                step = 64 * 1024
                for i in range(0, len(text), step):
                    yield text[i : i + step]
                return

            headers: list[str] | None = None
            for _i, rec, gen in generator.iter_records(schema, **_iter_kwargs()):
                last_gen = gen
                flat = export_fmt.flatten_record_for_csv(
                    rec, delim=delim, nested_as_json=bool(nested)
                )
                if headers is None:
                    headers = list(flat.keys())
                    yield export_fmt.csv_header_line(headers) + "\n"
                assert headers is not None
                yield export_fmt.csv_data_line(headers, flat) + "\n"
        else:
            # Structured formats: generate within cap, then chunk the payload.
            result = generator.generate_records(
                schema,
                allow_large=False,
                **_iter_kwargs(),
            )
            if body.recordHistory and not body.ciMode:
                buf = result.pop("historyBuffer", [])
                if buf:
                    db.record_values(buf, mode="use")
            text = export_fmt.serialize(
                result["records"],
                fmt,
                multi_row=multi,
                layout_mode=layout,
                delim=delim,
                nested_as_json=bool(nested),
                **xml_opts,
            )
            step = 64 * 1024
            for i in range(0, len(text), step):
                yield text[i : i + step]
            return

        if body.recordHistory and not body.ciMode and last_gen:
            try:
                if last_gen.history_buffer:
                    db.record_values(last_gen.history_buffer, mode="use")
            except Exception:
                # Do not corrupt the download stream with an error prefix.
                pass

    media = {
        "csv": "text/csv; charset=utf-8",
        "jsonl": "application/x-ndjson; charset=utf-8",
        "xml": "application/xml; charset=utf-8",
        "yaml": "application/yaml; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "json": "application/json; charset=utf-8",
    }.get(fmt, "application/octet-stream")
    return StreamingResponse(line_iter(), media_type=media)


@app.post("/api/generate/per-file")
def generate_per_file(body: PerFileBody):
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")
    settings = db.get_settings()
    naming = {**settings.get("fileNaming", {})}
    fmt = body.format or "json"
    ext = export_fmt.extension_for_format(fmt)
    schema_name = export_fmt.sanitize_export_file_name(
        body.fileName or schema.get("name") or "dataforge-record"
    )
    delim = body.delim or settings.get("csvFlattenDelimiter") or "."
    nested = body.nestedAsJson if body.nestedAsJson is not None else settings.get("csvNestedAsJson")
    layout = body.layoutMode or settings.get("csvLayoutMode") or "single-header"
    multi = body.multiRow
    theme_lookup, theme_prefer, _blend = _resolve_theme_context(body)

    used: set[str] = set()
    used_fields: dict[str, set[str]] = {}
    sample: list[dict] = []
    sample_n = min(max(body.previewSampleSize or 5, 0), 25)
    det = bool(naming.get("deterministicRandom") or body.ciMode)
    seed_holder = [body.seed]
    count = body.recordCount
    written = 0
    skipped = 0
    entries: list[tuple[str, str]] = []

    last_gen = None
    history_warning: str | None = None
    try:
        fmt = export_fmt.validate_format(fmt)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    ext = export_fmt.extension_for_format(fmt)

    for i, rec, gen in generator.iter_records(
        schema,
        record_count=count,
        seed=body.seed,
        ci_mode=body.ciMode,
        history_lookup=_history_lookup,
        custom_lookup=_custom_lookup,
        theme_lookup=theme_lookup,
        theme_prefer=theme_prefer,
    ):
        last_gen = gen
        seed_holder[0] = gen.seed
        rel = file_naming.render_file_name(
            naming.get("pattern") or "{schema}_{index:04}.{ext}",
            schema=schema_name,
            index=i,
            count=count,
            format=fmt,
            ext=ext,
            prefix=naming.get("prefix") or "",
            suffix=naming.get("suffix") or "",
            seed=gen.seed,
            record=rec,
            default_index_pad=int(naming.get("defaultIndexPad") or 4),
            sanitize_mode=naming.get("sanitizeMode") or "windows",
            deterministic_random=det,
            used_field_values=used_fields if naming.get("ensureUniqueNames", True) else None,
        )
        claimed = file_naming.claim_unique_name(
            rel, used, collision=naming.get("collision") or "suffix"
        )
        if claimed is None:
            skipped += 1
            continue
        text = export_fmt.serialize(
            rec,
            fmt,
            multi_row=False,
            layout_mode=layout,
            delim=delim,
            nested_as_json=bool(nested),
            **_xml_opts(body, settings),
        )
        entries.append((claimed, text))
        written += 1
        if len(sample) < sample_n:
            sample.append({"path": claimed, "preview": text[:400]})

    # Multi-file default: tar.gz (space); single file: zip
    raw, arch_ext, _media = archive_svc.pack_named_entries(entries)
    arch_fmt = "tar.gz" if arch_ext == ".tar.gz" else "zip"

    # One-pass history from the same generator used for files
    if body.recordHistory and not body.ciMode and last_gen is not None:
        try:
            buf_hist = last_gen.history_buffer
            if buf_hist:
                db.record_values(buf_hist, mode="use")
        except Exception as e:
            history_warning = f"History write failed: {e}"

    b64 = base64.b64encode(raw).decode("ascii")
    out: dict[str, Any] = {
        "ok": True,
        "written": written,
        "skipped": skipped,
        "seed": seed_holder[0],
        "format": fmt,
        "sample": sample,
        "zipBase64": b64,  # base64 of archive (zip or tar.gz)
        "archiveBase64": b64,
        "archiveFormat": arch_fmt,
        "fileName": f"{schema_name}-per-file{arch_ext}",
        "perFile": True,
    }
    if history_warning:
        out["historyWarning"] = history_warning
    if last_gen is not None:
        out["report"] = last_gen.report(written, 0)
    return out


@app.get("/api/activity")
def activity_list(limit: int = 40):
    """Recent generate / package activity for the Recent workspace."""
    return db.list_interactions(
        types=["generate", "package_generate", "export", "event"],
        limit=limit,
    )


def _xml_opts(body: Any, settings: dict[str, Any]) -> dict[str, Any]:
    root = getattr(body, "xmlRootTag", None)
    if root is None and isinstance(body, dict):
        root = body.get("xmlRootTag")
    rec = getattr(body, "xmlRecordTag", None)
    if rec is None and isinstance(body, dict):
        rec = body.get("xmlRecordTag")
    sc = getattr(body, "xmlSelfClosing", None)
    if sc is None and isinstance(body, dict):
        sc = body.get("xmlSelfClosing")
    sc_map = getattr(body, "xmlSelfClosingMap", None)
    if sc_map is None and isinstance(body, dict):
        sc_map = body.get("xmlSelfClosingMap")
    opts: dict[str, Any] = {
        "xml_root_tag": root or settings.get("xmlRootTag") or "root",
        "xml_record_tag": rec or settings.get("xmlRecordTag") or "record",
        "xml_self_closing": (
            bool(sc)
            if sc is not None
            else bool(settings.get("xmlSelfClosing", True))
        ),
    }
    if isinstance(sc_map, dict) and sc_map:
        opts["xml_self_closing_map"] = {
            str(k): bool(v) for k, v in sc_map.items()
        }
    return opts


@app.post("/api/export")
def export_data(body: ExportBody):
    settings = db.get_settings()
    data = body.data
    if not body.singleObject and isinstance(data, dict):
        data = [data]
    try:
        fmt = export_fmt.validate_format(body.format)
        text = export_fmt.serialize(
            data,
            fmt,
            multi_row=body.multiRow,
            layout_mode=body.layoutMode or settings.get("csvLayoutMode") or "single-header",
            delim=body.delim or settings.get("csvFlattenDelimiter") or ".",
            nested_as_json=body.nestedAsJson
            if body.nestedAsJson is not None
            else bool(settings.get("csvNestedAsJson")),
            **_xml_opts(body, settings),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"content": text, "format": fmt}


@app.post("/api/export/archive")
def export_archive(body: ArchiveBuildBody):
    files = list(body.files or [])
    if body.generate and body.formats:
        gen = _run_generate(body.generate)
        settings = db.get_settings()
        for fmt in body.formats:
            files.append(
                {
                    "fileName": f"data.{export_fmt.extension_for_format(fmt)}",
                    "format": fmt,
                    "data": gen["records"],
                    "multiRow": settings.get("csvMultiRow", True),
                    "layoutMode": settings.get("csvLayoutMode"),
                    "delim": settings.get("csvFlattenDelimiter"),
                    "nestedAsJson": settings.get("csvNestedAsJson"),
                    "xmlRootTag": settings.get("xmlRootTag"),
                    "xmlRecordTag": settings.get("xmlRecordTag"),
                    "xmlSelfClosing": settings.get("xmlSelfClosing"),
                }
            )
    if not files:
        raise HTTPException(400, "No files to archive")
    raw, media = archive_svc.build_archive(
        files, extension=body.extension, top_folder=body.topFolderName
    )
    if body.extension:
        ext = body.extension if body.extension.startswith(".") else f".{body.extension}"
        if ext == ".tgz":
            ext = ".tar.gz"
    else:
        ext = archive_svc.extension_for_format(
            archive_svc.default_bundle_format(len(files))
        )
    return Response(
        content=raw,
        media_type=media or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="DataForge{ext}"'},
    )


@app.post("/api/archive/list")
async def archive_list(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        entries = archive_svc.read_archive_listing(raw, file.filename or "a.zip")
    except Exception as e:
        raise HTTPException(400, f"Cannot read archive: {e}") from e
    return {"entries": entries, "fileName": file.filename}


@app.post("/api/archive/read")
async def archive_read(file: UploadFile = File(...), entryPath: str = ""):
    raw = await file.read()
    if not entryPath:
        raise HTTPException(400, "entryPath required")
    try:
        text = archive_svc.read_archive_entry(raw, file.filename or "a.zip", entryPath)
    except Exception as e:
        raise HTTPException(400, str(e)) from e
    return {"path": entryPath, "content": text}


# ── history ─────────────────────────────────────────────────────────


@app.get("/api/history")
def history(limit: int = 100):
    return db.list_history(limit)


@app.get("/api/history/page")
def history_page(offset: int = 0, limit: int = 50, search: str | None = None):
    return db.list_history_page(offset=offset, limit=limit, search=search)


@app.get("/api/history/suggest")
def history_suggest(
    categoryName: str | None = None,
    keyName: str | None = None,
    prefix: str = "",
    limit: int = 20,
):
    return db.suggest_values(
        category_name=categoryName, key_name=keyName, prefix=prefix, limit=limit
    )


@app.get("/api/history/keys")
def history_keys(prefix: str = "", limit: int = 50):
    return db.history_keys(prefix, limit)


@app.post("/api/history/record")
def history_record(body: dict[str, Any]):
    n = db.record_values([body], mode=body.get("mode") or "use")
    return {"recorded": n}


@app.post("/api/history/record-many")
def history_record_many(body: list[dict[str, Any]]):
    return {"recorded": db.record_values(body, mode="use")}


@app.post("/api/history/clear-count")
def history_clear_count(body: ClearHistoryBody):
    return {"count": db.clear_history_count(body.model_dump())}


@app.post("/api/history/clear")
def history_clear(body: ClearHistoryBody):
    try:
        return db.clear_history(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/history/delete")
def history_delete(ids: list[str]):
    return {"deleted": db.delete_history_ids(ids)}


@app.post("/api/history/update")
def history_update(body: HistoryUpdateBody):
    ok = db.update_history_entry(body.id, body.value)
    if not ok:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@app.post("/api/history/delete-matching")
def history_delete_matching(body: dict[str, Any]):
    return {"deleted": db.delete_history_matching(body.get("search") or "")}


# ── templates ───────────────────────────────────────────────────────


@app.get("/api/templates")
def templates_list():
    return db.list_templates()


@app.post("/api/templates")
def templates_save(body: TemplateBody):
    data = body.model_dump(by_alias=False)
    schema_doc = data.pop("schemaDoc", None) or None
    if schema_doc and not data.get("schemaJson"):
        data["schemaJson"] = json.dumps(schema_doc)
    return db.save_template(data)


@app.delete("/api/templates/{tid}")
def templates_delete(tid: str):
    if not db.delete_template(tid):
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ── backup ──────────────────────────────────────────────────────────


@app.get("/api/backup/export")
def backup_export():
    payload = {
        "version": 2,
        "exportedAt": db.now_iso(),
        "settings": db.get_settings(),
        "schemas": db.list_schemas(),
        "templates": db.list_templates(),
        "history": db.list_history_for_backup(50_000),
        "note": "DataForge JSON backup (settings, schemas, templates, history).",
    }
    raw = json.dumps(payload, indent=2).encode("utf-8")
    return Response(
        content=raw,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="DataForge-backup-{db.now_iso()[:10]}.json"'
        },
    )


@app.post("/api/backup/import")
async def backup_import(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise HTTPException(400, f"Invalid backup JSON: {e}") from e
    n = 0
    if payload.get("settings"):
        db.set_settings(payload["settings"])
        n += 1
    for s in payload.get("schemas") or []:
        db.save_schema(s)
        n += 1
    for t in payload.get("templates") or []:
        db.save_template(t)
        n += 1
    hist = payload.get("history") or []
    if hist:
        items = [
            {
                "categoryName": h.get("categoryName") or h.get("keyName") or "field",
                "keyName": h.get("keyName") or "field",
                "value": h.get("value") or "",
            }
            for h in hist
            if h.get("value")
        ]
        db.record_values(items, mode="ensure")
        n += len(items)
    return {"ok": True, "imported": n}


@app.post("/api/interaction")
def interaction(body: dict[str, Any]):
    db.log_interaction(body.get("type") or "event", body.get("payload"))
    return {"ok": True}


# ── Custom value lists (user-curated) ───────────────────────────────


class CustomListBody(BaseModel):
    id: str | None = None
    name: str = "Custom list"
    description: str | None = None
    keys: list[str] | None = None


class CustomValuesBody(BaseModel):
    values: list[str] = Field(default_factory=list)


class CustomValueUpdateBody(BaseModel):
    value: str


@app.get("/api/custom-lists")
def custom_lists():
    return db.list_custom_lists()


@app.get("/api/custom-lists/{list_id}")
def custom_list_get(list_id: str):
    item = db.get_custom_list(list_id)
    if not item:
        raise HTTPException(404, "List not found")
    return item


@app.post("/api/custom-lists")
def custom_list_save(body: CustomListBody):
    return db.save_custom_list(body.model_dump())


@app.delete("/api/custom-lists/{list_id}")
def custom_list_delete(list_id: str):
    if not db.delete_custom_list(list_id):
        raise HTTPException(404, "List not found")
    return {"ok": True}


@app.post("/api/custom-lists/{list_id}/values")
def custom_list_add_values(list_id: str, body: CustomValuesBody):
    n = db.add_custom_values(list_id, body.values)
    if n < 0:
        raise HTTPException(404, "List not found")
    return {"inserted": n, "list": db.get_custom_list(list_id)}


@app.put("/api/custom-values/{value_id}")
def custom_value_update(value_id: str, body: CustomValueUpdateBody):
    if not db.update_custom_value(value_id, body.value):
        raise HTTPException(404, "Value not found")
    return {"ok": True}


@app.delete("/api/custom-values/{value_id}")
def custom_value_delete(value_id: str):
    if not db.delete_custom_value(value_id):
        raise HTTPException(404, "Value not found")
    return {"ok": True}


# ── Themes (data packs) ─────────────────────────────────────────────


class ThemeBody(BaseModel):
    id: str | None = None
    name: str = "Theme"
    slug: str | None = None
    description: str | None = None


class ThemeValuesBody(BaseModel):
    category: str = "general"
    values: list[str] = Field(default_factory=list)
    weight: float = 1.0


@app.get("/api/themes")
def themes_list():
    return db.list_themes()


@app.get("/api/themes/categories")
def themes_categories(themeId: str | None = None):
    """Distinct theme value categories (for field mapping UI)."""
    return {"categories": db.list_theme_categories(themeId)}


@app.post("/api/themes")
def themes_save(body: ThemeBody):
    return db.save_theme(body.model_dump())


@app.delete("/api/themes/{theme_id}")
def themes_delete(theme_id: str):
    if not db.delete_theme(theme_id):
        raise HTTPException(404, "Theme not found")
    return {"ok": True}


@app.get("/api/themes/{theme_id}/values")
def themes_values(theme_id: str, category: str | None = None):
    return db.get_theme_values(theme_id, category)


@app.post("/api/themes/{theme_id}/values")
def themes_add_values(theme_id: str, body: ThemeValuesBody):
    n = db.add_theme_values(theme_id, body.category, body.values, body.weight)
    if n < 0:
        raise HTTPException(404, "Theme not found")
    return {"inserted": n, "values": db.get_theme_values(theme_id, body.category)}


# ── Packages / multifile (layout in SQLite; variants only on download) ─


class PackageGenerateBody(BaseModel):
    recordCount: int = 10
    seed: int | None = None
    ciMode: bool = False
    recordHistory: bool = True
    defaultFieldMode: str = "random"  # same | random | unique
    fieldModes: dict[str, dict[str, str]] | None = None
    useDataThemes: bool | None = None
    themeBlend: list[ThemeBlendEntry] | None = None
    themePreferOverHistory: bool | None = None


class PackageVerifyBody(BaseModel):
    memberPath: str
    verified: bool = True


@app.get("/api/packages")
def packages_list():
    return db.list_packages()


@app.get("/api/packages/{package_id}")
def packages_get(package_id: str):
    pkg = db.get_package_hydrated(package_id)
    if not pkg:
        raise HTTPException(404, "Package not found")
    return pkg


@app.get("/api/packages/{package_id}/estimate")
def packages_estimate(package_id: str, recordCount: int = 1):
    """Observability: estimated files created for N package variants (records)."""
    pkg = db.get_package(package_id)
    if not pkg:
        raise HTTPException(404, "Package not found")
    return package_svc.estimate_output(pkg, recordCount)


@app.post("/api/packages/import")
async def packages_import(files: list[UploadFile] = File(...)):
    """
    Upload one archive (zip/tar/tar.gz) or multiple text files.
    Nested archives expand into named folders. 2+ text files → Multifile schema.
    """
    if not files:
        raise HTTPException(400, "No files uploaded")
    loaded: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        raw = await f.read()
        total += len(raw)
        if total > MAX_IMPORT_BYTES * 4:
            raise HTTPException(400, "Upload too large")
        loaded.append((f.filename or "upload.bin", raw))
    try:
        if len(loaded) == 1:
            result = package_svc.import_uploaded_archive(loaded[0][0], loaded[0][1])
        else:
            result = package_svc.import_uploaded_files(loaded)
    except Exception as e:
        raise HTTPException(400, f"Package import failed: {e}") from e
    return result


@app.delete("/api/packages/{package_id}")
def packages_delete(package_id: str):
    if not db.delete_package(package_id):
        raise HTTPException(404, "Package not found")
    return {"ok": True}


@app.post("/api/packages/{package_id}/verify")
def packages_verify(package_id: str, body: PackageVerifyBody):
    if not db.get_package(package_id):
        raise HTTPException(404, "Package not found")
    db.set_package_member_verified(package_id, body.memberPath, body.verified)
    return {"ok": True}


@app.post("/api/packages/{package_id}/generate")
def packages_generate(package_id: str, body: PackageGenerateBody):
    """
    Generate N full package variants. Returns a downloadable archive
    (ZIP when one variant, tar.gz when multiple). Generated content is NOT stored in SQLite.
    """
    # Build a temporary GenerateBody for theme context
    gen_body = GenerateBody(
        schema={"root": [{"key": "x", "kind": "value", "children": []}]},
        recordCount=body.recordCount,
        seed=body.seed,
        ciMode=body.ciMode,
        useDataThemes=body.useDataThemes,
        themeBlend=body.themeBlend,
        themePreferOverHistory=body.themePreferOverHistory,
    )
    theme_lookup, theme_prefer, _blend = _resolve_theme_context(gen_body)
    try:
        result = package_svc.generate_package_variants(
            package_id,
            record_count=body.recordCount,
            seed=body.seed,
            ci_mode=body.ciMode,
            record_history=body.recordHistory and not body.ciMode,
            default_field_mode=body.defaultFieldMode,
            field_modes=body.fieldModes,
            history_lookup=_history_lookup,
            custom_lookup=_custom_lookup,
            theme_lookup=theme_lookup,
            theme_prefer=theme_prefer,
            settings=db.get_settings(),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Package generate failed: {e}") from e
    db.log_interaction(
        "package_generate",
        {"packageId": package_id, "written": result.get("written"), "seed": result.get("seed")},
    )
    return result


# ── Delivery jobs (incremental chunks; plan in SQLite, files on disk) ─


class DeliveryJobBody(BaseModel):
    name: str | None = None
    packageId: str
    targetTotal: int = 100
    windowHours: int = 24
    chunkMin: int = 5
    chunkMax: int = 20
    destinationType: str = "local_dir"
    destinationPath: str | None = None
    seed: int | None = None


@app.get("/api/delivery-jobs")
def delivery_jobs_list():
    return [delivery_svc.job_summary(j) for j in db.list_delivery_jobs()]


@app.get("/api/delivery-jobs/{job_id}")
def delivery_jobs_get(job_id: str):
    job = db.get_delivery_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return delivery_svc.job_summary(job)


@app.post("/api/delivery-jobs")
def delivery_jobs_create(body: DeliveryJobBody):
    try:
        job = delivery_svc.create_job(body.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return delivery_svc.job_summary(job)


@app.post("/api/delivery-jobs/{job_id}/run-chunk")
def delivery_jobs_run_chunk(job_id: str):
    theme_lookup, theme_prefer, _ = _resolve_theme_context(None)
    try:
        result = delivery_svc.run_next_chunk(
            job_id,
            history_lookup=_history_lookup,
            custom_lookup=_custom_lookup,
            theme_lookup=theme_lookup,
            theme_prefer=theme_prefer,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Chunk failed: {e}") from e
    return result


@app.delete("/api/delivery-jobs/{job_id}")
def delivery_jobs_delete(job_id: str):
    if not db.delete_delivery_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": True}
