"""FastAPI entry — PV_DataForge API (Electron feature parity)."""
from __future__ import annotations

import base64
import io
import json
import uuid
import zipfile
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app import database as db
from app.defaults import MAX_IMPORT_BYTES
from app.services import archive_svc, export_fmt, generator, infer
from app.services import file_naming

app = FastAPI(title="PV_DataForge", version="0.2.0")
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


# ── models ──────────────────────────────────────────────────────────


class SchemaBody(BaseModel):
    id: str | None = None
    name: str = "Untitled"
    description: str | None = None
    root: list[dict[str, Any]] = Field(default_factory=list)
    csvTiedFieldPaths: list[str] | None = None
    sourceFileName: str | None = None
    sourceFormat: str | None = None
    createdAt: str | None = None
    updatedAt: str | None = None
    lastOpenedAt: str | None = None


class GenerateBody(BaseModel):
    schema_: dict[str, Any] = Field(alias="schema")
    recordCount: int = 10
    seed: int | None = None
    ciMode: bool = False
    recordHistory: bool = True

    model_config = {"populate_by_name": True}


class ExportBody(BaseModel):
    data: Any
    format: str = "json"
    multiRow: bool = True
    layoutMode: str = "single-header"
    delim: str = "."
    nestedAsJson: bool = False
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    xmlSelfClosing: bool | None = None


class StreamBody(GenerateBody):
    format: str = "csv"
    multiRow: bool = True
    layoutMode: str = "single-header"
    delim: str = "."
    nestedAsJson: bool = False
    xmlRootTag: str | None = None
    xmlRecordTag: str | None = None
    xmlSelfClosing: bool | None = None


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
    extension: str = ".zip"
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


def _lookup(key: str) -> list[str]:
    return db.get_values_for_key(key)


def _run_generate(body: GenerateBody) -> dict:
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")
    try:
        result = generator.generate_records(
            schema,
            record_count=body.recordCount,
            seed=body.seed,
            ci_mode=body.ciMode,
            history_lookup=_lookup,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if body.recordHistory and not body.ciMode:
        buf = result.pop("historyBuffer", [])
        if buf:
            db.record_values(buf, mode="use")
    else:
        result.pop("historyBuffer", None)
    db.log_interaction("generate", {"count": result["recordCount"], "seed": result["seed"]})
    return result


# ── core routes ─────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    return {"ok": True, "app": "PV_DataForge", "version": "0.2.0"}


@app.get("/api/status")
def status():
    schemas = db.list_schemas()
    templates = db.list_templates()
    return {
        "ok": True,
        "version": "0.2.0",
        "schemaCount": len(schemas),
        "templateCount": len(templates),
        "valueHistoryCount": db.history_count(),
        "dbPath": str(db.DB_PATH),
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
    if not db.delete_schema(schema_id):
        raise HTTPException(404, "Schema not found")
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
    """Large-count generate with allow_large; returns full serialized payload as a stream."""
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")
    settings = db.get_settings()
    fmt = (body.format or "csv").lower()
    delim = body.delim or settings.get("csvFlattenDelimiter") or "."
    nested = (
        body.nestedAsJson
        if body.nestedAsJson is not None
        else settings.get("csvNestedAsJson")
    )
    layout = body.layoutMode or settings.get("csvLayoutMode") or "single-header"
    multi = body.multiRow if body.multiRow is not None else settings.get("csvMultiRow", True)

    def line_iter():
        try:
            if fmt in ("jsonl", "ndjson"):
                last_gen = None
                for _i, rec, gen in generator.iter_records(
                    schema,
                    record_count=body.recordCount,
                    seed=body.seed,
                    ci_mode=body.ciMode,
                    history_lookup=_lookup,
                ):
                    last_gen = gen
                    yield json.dumps(rec, ensure_ascii=False) + "\n"
                if body.recordHistory and not body.ciMode and last_gen:
                    db.record_values(last_gen.history_buffer, mode="use")
                return

            result = generator.generate_records(
                schema,
                record_count=body.recordCount,
                seed=body.seed,
                ci_mode=body.ciMode,
                history_lookup=_lookup,
                allow_large=True,
            )
            if body.recordHistory and not body.ciMode:
                buf = result.pop("historyBuffer", [])
                if buf:
                    db.record_values(buf, mode="use")
            text = export_fmt.serialize(
                result["records"],
                "json" if fmt == "json" else fmt,
                multi_row=multi,
                layout_mode=layout,
                delim=delim,
                nested_as_json=bool(nested),
                **_xml_opts(body, settings),
            )
            # chunk for progressive download
            step = 64 * 1024
            for i in range(0, len(text), step):
                yield text[i : i + step]
        except Exception as e:
            yield f"ERROR: {e}"

    media = (
        "text/csv"
        if fmt == "csv"
        else "application/x-ndjson"
        if fmt in ("jsonl", "ndjson")
        else "application/xml"
        if fmt == "xml"
        else "application/json"
    )
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

    buf = io.BytesIO()
    used: set[str] = set()
    used_fields: dict[str, set[str]] = {}
    sample: list[dict] = []
    sample_n = min(max(body.previewSampleSize or 5, 0), 25)
    det = bool(naming.get("deterministicRandom") or body.ciMode)
    seed_holder = [body.seed]
    count = body.recordCount
    written = 0
    skipped = 0

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, rec, gen in generator.iter_records(
            schema,
            record_count=count,
            seed=body.seed,
            ci_mode=body.ciMode,
            history_lookup=_lookup,
        ):
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
                rec if multi else rec,
                fmt,
                multi_row=False,
                layout_mode=layout,
                delim=delim,
                nested_as_json=bool(nested),
                **_xml_opts(body, settings),
            )
            zf.writestr(claimed, text)
            written += 1
            if len(sample) < sample_n:
                sample.append({"path": claimed, "preview": text[:400]})
        if body.recordHistory and not body.ciMode:
            # last gen's buffer — re-generate history from samples is incomplete;
            # collect via a bulk pass if needed; for per-file we re-run harvest lightly
            pass

    # record history via bulk generate side-effect for moderate counts
    if body.recordHistory and not body.ciMode and count <= 5000:
        try:
            r = generator.generate_records(
                schema,
                record_count=count,
                seed=body.seed,
                ci_mode=body.ciMode,
                history_lookup=_lookup,
            )
            buf_hist = r.pop("historyBuffer", [])
            if buf_hist:
                db.record_values(buf_hist, mode="use")
        except Exception:
            pass

    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "ok": True,
        "written": written,
        "skipped": skipped,
        "seed": seed_holder[0],
        "format": fmt,
        "sample": sample,
        "zipBase64": b64,
        "fileName": f"{schema_name}-per-file.zip",
        "perFile": True,
    }


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
    return {
        "xml_root_tag": root or settings.get("xmlRootTag") or "root",
        "xml_record_tag": rec or settings.get("xmlRecordTag") or "record",
        "xml_self_closing": (
            bool(sc)
            if sc is not None
            else bool(settings.get("xmlSelfClosing", True))
        ),
    }


@app.post("/api/export")
def export_data(body: ExportBody):
    settings = db.get_settings()
    text = export_fmt.serialize(
        body.data,
        body.format,
        multi_row=body.multiRow,
        layout_mode=body.layoutMode or settings.get("csvLayoutMode") or "single-header",
        delim=body.delim or settings.get("csvFlattenDelimiter") or ".",
        nested_as_json=body.nestedAsJson
        if body.nestedAsJson is not None
        else bool(settings.get("csvNestedAsJson")),
        **_xml_opts(body, settings),
    )
    return {"content": text, "format": body.format}


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
    raw, _ctype = archive_svc.build_archive(
        files, extension=body.extension, top_folder=body.topFolderName
    )
    ext = body.extension if body.extension.startswith(".") else f".{body.extension}"
    return Response(
        content=raw,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="dataforge{ext}"'},
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
        "note": "PV_DataForge JSON backup (settings, schemas, templates, history).",
    }
    raw = json.dumps(payload, indent=2).encode("utf-8")
    return Response(
        content=raw,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="PV_DataForge-backup-{db.now_iso()[:10]}.json"'
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
