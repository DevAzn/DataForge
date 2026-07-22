"""FastAPI entry — PV_DataForge API."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import database as db
from app.services import export_fmt, generator, infer

app = FastAPI(title="PV_DataForge", version="0.1.0")
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


@app.get("/api/health")
def health():
    return {"ok": True, "app": "PV_DataForge"}


@app.get("/api/status")
def status():
    schemas = db.list_schemas()
    return {
        "ok": True,
        "schemaCount": len(schemas),
        "valueHistoryCount": db.history_count(),
        "dbPath": str(db.DB_PATH),
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
    # harvest samples into history (ensure)
    samples = _harvest_schema_samples(saved.get("root") or [])
    if samples:
        db.record_values(samples, mode="ensure")
    return saved


@app.delete("/api/schemas/{schema_id}")
def schemas_delete(schema_id: str):
    ok = db.delete_schema(schema_id)
    if not ok:
        raise HTTPException(404, "Schema not found")
    return {"ok": True}


@app.post("/api/schemas/import")
async def schemas_import(file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 25 * 1024 * 1024:
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
    schema = body.schema_
    if not schema.get("root"):
        raise HTTPException(400, "Schema has no fields")

    def lookup(key: str) -> list[str]:
        return db.get_values_for_key(key)

    result = generator.generate_records(
        schema,
        record_count=body.recordCount,
        seed=body.seed,
        ci_mode=body.ciMode,
        history_lookup=lookup,
    )
    if body.recordHistory and not body.ciMode:
        buf = result.pop("historyBuffer", [])
        if buf:
            db.record_values(buf, mode="use")
    else:
        result.pop("historyBuffer", None)
    return result


@app.post("/api/export")
def export_data(body: ExportBody):
    text = export_fmt.serialize(body.data, body.format, multi_row=body.multiRow)
    return {"content": text, "format": body.format}


@app.get("/api/history")
def history(limit: int = 100):
    return db.list_history(limit)


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
