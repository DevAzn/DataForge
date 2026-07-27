"""SQLite persistence for PV_DataForge.

Persistence policy (product rule):
  STORE: schemas, value history, custom value lists, themes, settings, templates,
         package *layout* metadata (structure only).
  DO NOT STORE: auto-generated records or export file bodies â€” those go to disk
  only when the user explicitly generates/exports.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.defaults import DEFAULT_SETTINGS

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "pv_dataforge.sqlite"
# Prefer canonical name; fall back if only short-lived rebrand file exists
_LEGACY_DB = DATA_DIR / "dataforge.sqlite"
if not DB_PATH.exists() and _LEGACY_DB.exists():
    try:
        _LEGACY_DB.rename(DB_PATH)
    except OSError:
        DB_PATH = _LEGACY_DB
ENCRYPTION_DIR = DATA_DIR / "encryption"
# Staging for user-triggered exports only (not a permanent store of generated data)
EXPORT_STAGING_DIR = DATA_DIR / "exports"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    ENCRYPTION_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_meta (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              tree_json TEXT NOT NULL,
              source_file_name TEXT,
              source_format TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_opened_at TEXT
            );
            CREATE TABLE IF NOT EXISTS categories (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE COLLATE NOCASE,
              source_key TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS value_history (
              id TEXT PRIMARY KEY,
              category_id TEXT NOT NULL,
              key_name TEXT NOT NULL,
              value TEXT NOT NULL,
              use_count INTEGER NOT NULL DEFAULT 1,
              last_used_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
              UNIQUE(category_id, key_name, value)
            );
            CREATE INDEX IF NOT EXISTS idx_vh_key ON value_history(key_name);
            CREATE INDEX IF NOT EXISTS idx_vh_cat ON value_history(category_id);
            CREATE TABLE IF NOT EXISTS templates (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              schema_json TEXT NOT NULL,
              sample_data_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS interactions (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_interactions_type
              ON interactions(type, created_at);

            -- User-curated value banks (not auto-generated output)
            CREATE TABLE IF NOT EXISTS custom_lists (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE COLLATE NOCASE,
              description TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS custom_values (
              id TEXT PRIMARY KEY,
              list_id TEXT NOT NULL,
              value TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              FOREIGN KEY (list_id) REFERENCES custom_lists(id) ON DELETE CASCADE,
              UNIQUE(list_id, value)
            );
            CREATE INDEX IF NOT EXISTS idx_cv_list ON custom_values(list_id);
            -- Map list â†’ field path / history key used during generation
            CREATE TABLE IF NOT EXISTS custom_list_keys (
              list_id TEXT NOT NULL,
              key_name TEXT NOT NULL COLLATE NOCASE,
              PRIMARY KEY (list_id, key_name),
              FOREIGN KEY (list_id) REFERENCES custom_lists(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_clk_key ON custom_list_keys(key_name);

            -- Data themes (Star Wars, GoT, â€¦) â€” user/builtin value packs
            CREATE TABLE IF NOT EXISTS themes (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE COLLATE NOCASE,
              slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
              description TEXT,
              is_builtin INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS theme_values (
              id TEXT PRIMARY KEY,
              theme_id TEXT NOT NULL,
              category TEXT NOT NULL COLLATE NOCASE,
              value TEXT NOT NULL,
              weight REAL NOT NULL DEFAULT 1.0,
              created_at TEXT NOT NULL,
              FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE,
              UNIQUE(theme_id, category, value)
            );
            CREATE INDEX IF NOT EXISTS idx_tv_theme_cat ON theme_values(theme_id, category);

            -- Package / multifile layout (no generated file bodies)
            CREATE TABLE IF NOT EXISTS package_import (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              source_kind TEXT NOT NULL,
              outer_format TEXT NOT NULL,
              outer_extension TEXT,
              nested_json TEXT NOT NULL,
              skipped_json TEXT NOT NULL DEFAULT '[]',
              multifile_schema_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS package_member (
              id TEXT PRIMARY KEY,
              package_id TEXT NOT NULL,
              path TEXT NOT NULL,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              format TEXT,
              nested_archive_path TEXT,
              nested_archive_format TEXT,
              content TEXT,
              schema_id TEXT,
              verified INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (package_id) REFERENCES package_import(id) ON DELETE CASCADE,
              UNIQUE(package_id, path)
            );
            CREATE INDEX IF NOT EXISTS idx_pkg_member ON package_member(package_id);

            -- Delivery jobs (plan + progress only; artifacts on disk)
            CREATE TABLE IF NOT EXISTS delivery_job (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              package_id TEXT NOT NULL,
              target_total INTEGER NOT NULL,
              window_hours INTEGER NOT NULL DEFAULT 24,
              chunk_min INTEGER NOT NULL,
              chunk_max INTEGER NOT NULL,
              destination_type TEXT NOT NULL DEFAULT 'local_dir',
              destination_path TEXT,
              status TEXT NOT NULL DEFAULT 'planned',
              sent_total INTEGER NOT NULL DEFAULT 0,
              next_chunk_index INTEGER NOT NULL DEFAULT 0,
              plan_json TEXT NOT NULL,
              seed INTEGER,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS delivery_chunk (
              id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              size INTEGER NOT NULL,
              status TEXT NOT NULL,
              artifact_name TEXT,
              artifact_path TEXT,
              sent_at TEXT,
              error TEXT,
              FOREIGN KEY (job_id) REFERENCES delivery_job(id) ON DELETE CASCADE,
              UNIQUE(job_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_dchunk_job ON delivery_chunk(job_id);
            """
        )
        # migrate columns on older DBs
        schema_cols = {
            r[1] for r in conn.execute("PRAGMA table_info(schema_meta)").fetchall()
        }
        if "last_opened_at" not in schema_cols:
            try:
                conn.execute("ALTER TABLE schema_meta ADD COLUMN last_opened_at TEXT")
            except sqlite3.OperationalError:
                pass
        cat_cols = {
            r[1] for r in conn.execute("PRAGMA table_info(categories)").fetchall()
        }
        if "source_key" not in cat_cols:
            try:
                conn.execute("ALTER TABLE categories ADD COLUMN source_key TEXT")
            except sqlite3.OperationalError:
                pass
        row = conn.execute("SELECT 1 FROM settings WHERE key = 'app'").fetchone()
        if not row:
            conn.execute(
                "INSERT INTO settings (key, value_json) VALUES ('app', ?)",
                (json.dumps(DEFAULT_SETTINGS),),
            )
        conn.commit()
    finally:
        conn.close()


def deep_merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def get_settings() -> dict[str, Any]:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT value_json FROM settings WHERE key = 'app'"
        ).fetchone()
        if not row:
            return dict(DEFAULT_SETTINGS)
        stored = json.loads(row["value_json"])
        return deep_merge(DEFAULT_SETTINGS, stored)
    finally:
        conn.close()


def set_settings(data: dict[str, Any]) -> dict[str, Any]:
    merged = deep_merge(get_settings(), data)
    conn = connect()
    try:
        conn.execute(
            """
            INSERT INTO settings (key, value_json) VALUES ('app', ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
            """,
            (json.dumps(merged),),
        )
        conn.commit()
        return merged
    finally:
        conn.close()


def _schema_row(r: sqlite3.Row) -> dict[str, Any]:
    tree = json.loads(r["tree_json"])
    if isinstance(tree, list):
        root, meta = tree, {}
    else:
        root = tree.get("root", [])
        meta = tree
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "root": root,
        "csvTiedFieldPaths": meta.get("csvTiedFieldPaths"),
        "sourceFileName": r["source_file_name"] or meta.get("sourceFileName"),
        "sourceFormat": r["source_format"] or meta.get("sourceFormat"),
        "isMultifile": meta.get("isMultifile"),
        "packageId": meta.get("packageId"),
        "isPackageMember": meta.get("isPackageMember"),
        "xmlRootTag": meta.get("xmlRootTag"),
        "xmlRecordTag": meta.get("xmlRecordTag"),
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "lastOpenedAt": r["last_opened_at"] if "last_opened_at" in r.keys() else None,
    }


def list_schemas(*, include_package_members: bool = False) -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT id, name, description, tree_json, source_file_name, source_format,
                   created_at, updated_at, last_opened_at
            FROM schema_meta
            ORDER BY COALESCE(last_opened_at, updated_at) DESC
            """
        ).fetchall()
        out = []
        for r in rows:
            s = _schema_row(r)
            if not include_package_members and s.get("isPackageMember"):
                continue
            out.append(s)
        return out
    finally:
        conn.close()


def get_schema(schema_id: str) -> dict[str, Any] | None:
    conn = connect()
    try:
        r = conn.execute(
            """
            SELECT id, name, description, tree_json, source_file_name, source_format,
                   created_at, updated_at, last_opened_at
            FROM schema_meta WHERE id = ?
            """,
            (schema_id,),
        ).fetchone()
        return _schema_row(r) if r else None
    finally:
        conn.close()


def save_schema(doc: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        sid = doc.get("id") or str(uuid.uuid4())
        # Preserve package linkage when UI save omits flags (member edit path)
        prev_meta: dict[str, Any] = {}
        existing = conn.execute(
            "SELECT created_at, last_opened_at, tree_json FROM schema_meta WHERE id = ?",
            (sid,),
        ).fetchone()
        if existing:
            try:
                prev_tree = json.loads(existing["tree_json"] or "{}")
                if isinstance(prev_tree, dict):
                    prev_meta = prev_tree
            except json.JSONDecodeError:
                prev_meta = {}

        def _flag(key: str):
            if key in doc and doc.get(key) is not None:
                return doc.get(key)
            return prev_meta.get(key)

        tree = {
            "root": doc.get("root") or [],
            "csvTiedFieldPaths": doc.get("csvTiedFieldPaths"),
            "sourceFileName": doc.get("sourceFileName"),
            "sourceFormat": doc.get("sourceFormat"),
            "isMultifile": _flag("isMultifile"),
            "packageId": _flag("packageId"),
            "isPackageMember": _flag("isPackageMember"),
            "xmlRootTag": doc.get("xmlRootTag")
            if doc.get("xmlRootTag") is not None
            else prev_meta.get("xmlRootTag"),
            "xmlRecordTag": doc.get("xmlRecordTag")
            if doc.get("xmlRecordTag") is not None
            else prev_meta.get("xmlRecordTag"),
        }
        created = existing["created_at"] if existing else doc.get("createdAt") or ts
        last_opened = doc.get("lastOpenedAt") or (
            existing["last_opened_at"] if existing else None
        )
        conn.execute(
            """
            INSERT INTO schema_meta
              (id, name, description, tree_json, source_file_name, source_format,
               created_at, updated_at, last_opened_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              tree_json = excluded.tree_json,
              source_file_name = excluded.source_file_name,
              source_format = excluded.source_format,
              updated_at = excluded.updated_at,
              last_opened_at = excluded.last_opened_at
            """,
            (
                sid,
                doc.get("name") or "Untitled",
                doc.get("description"),
                json.dumps(tree),
                doc.get("sourceFileName"),
                doc.get("sourceFormat"),
                created,
                ts,
                last_opened,
            ),
        )
        conn.commit()
        return get_schema(sid)  # type: ignore[return-value]
    finally:
        conn.close()


def touch_schema_opened(schema_id: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "UPDATE schema_meta SET last_opened_at = ? WHERE id = ?",
            (now_iso(), schema_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_schema(schema_id: str) -> bool:
    """
    Delete a standalone schema. Package member / multifile umbrella schemas must be
    removed via delete_package so package layouts stay consistent.
    """
    existing = get_schema(schema_id)
    if not existing:
        return False
    if existing.get("isPackageMember") or existing.get("isMultifile"):
        raise ValueError(
            "This schema belongs to a package. Delete the package instead of the schema."
        )
    # Single-file package schemas may only have packageId without member flag
    if existing.get("packageId") and not existing.get("isMultifile"):
        # Allow only if no package still references this schema id
        pkg = get_package(existing["packageId"])
        if pkg:
            raise ValueError(
                "This schema is linked to a package. Delete the package instead."
            )
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM schema_meta WHERE id = ?", (schema_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _ensure_category(conn: sqlite3.Connection, name: str, source_key: str | None = None) -> str:
    row = conn.execute(
        "SELECT id FROM categories WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if row:
        return row["id"]
    cid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO categories (id, name, source_key, created_at) VALUES (?, ?, ?, ?)",
        (cid, name, source_key, now_iso()),
    )
    return cid


def ensure_category(name: str, source_key: str | None = None) -> str:
    conn = connect()
    try:
        cid = _ensure_category(conn, name, source_key)
        conn.commit()
        return cid
    finally:
        conn.close()


def record_values(items: list[dict[str, str]], mode: str = "use") -> int:
    n = 0
    conn = connect()
    try:
        for it in items:
            val = (it.get("value") or "").strip()
            if not val:
                continue
            key = (it.get("keyName") or it.get("categoryName") or "field").strip()
            cat_name = (it.get("categoryName") or key).strip()
            cid = _ensure_category(conn, cat_name, it.get("sourceKey") or key)
            ts = now_iso()
            existing = conn.execute(
                """
                SELECT id, use_count FROM value_history
                WHERE category_id = ? AND key_name = ? AND value = ?
                """,
                (cid, key, val),
            ).fetchone()
            if existing:
                if mode != "ensure":
                    conn.execute(
                        """
                        UPDATE value_history
                        SET use_count = use_count + 1, last_used_at = ?
                        WHERE id = ?
                        """,
                        (ts, existing["id"]),
                    )
                n += 1
            else:
                try:
                    conn.execute(
                        """
                        INSERT INTO value_history
                          (id, category_id, key_name, value, use_count, last_used_at, created_at)
                        VALUES (?, ?, ?, ?, 1, ?, ?)
                        """,
                        (str(uuid.uuid4()), cid, key, val, ts, ts),
                    )
                    n += 1
                except sqlite3.IntegrityError:
                    n += 1
        conn.commit()
        return n
    finally:
        conn.close()


def get_values_for_key(key: str, limit: int = 80) -> list[str]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT value FROM value_history
            WHERE key_name = ? COLLATE NOCASE OR category_id IN (
              SELECT id FROM categories WHERE name = ? COLLATE NOCASE
            )
            ORDER BY use_count DESC, last_used_at DESC
            LIMIT ?
            """,
            (key, key, limit),
        ).fetchall()
        return [r["value"] for r in rows]
    finally:
        conn.close()


def list_history(limit: int = 100) -> list[dict[str, Any]]:
    return list_history_page(offset=0, limit=limit)["items"]


def list_history_page(
    *, offset: int = 0, limit: int = 50, search: str | None = None
) -> dict[str, Any]:
    limit = min(max(limit, 1), 500)
    offset = max(offset, 0)
    conn = connect()
    try:
        where = "1=1"
        params: list[Any] = []
        if search and search.strip():
            where += " AND (vh.key_name LIKE ? OR vh.value LIKE ? OR c.name LIKE ?)"
            q = f"%{search.strip()}%"
            params.extend([q, q, q])
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS n FROM value_history vh
            LEFT JOIN categories c ON c.id = vh.category_id
            WHERE {where}
            """,
            params,
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT vh.id, vh.key_name, vh.value, vh.use_count, vh.last_used_at,
                   vh.created_at, vh.category_id, c.name AS category_name
            FROM value_history vh
            LEFT JOIN categories c ON c.id = vh.category_id
            WHERE {where}
            ORDER BY vh.last_used_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()
        items = [
            {
                "id": r["id"],
                "keyName": r["key_name"],
                "value": r["value"],
                "useCount": r["use_count"],
                "lastUsedAt": r["last_used_at"],
                "createdAt": r["created_at"],
                "categoryId": r["category_id"],
                "categoryName": r["category_name"],
            }
            for r in rows
        ]
        return {"items": items, "total": int(total), "offset": offset, "limit": limit}
    finally:
        conn.close()


def suggest_values(
    *, category_name: str | None = None, key_name: str | None = None, prefix: str = "", limit: int = 20
) -> list[dict]:
    limit = min(max(limit, 1), 100)
    conn = connect()
    try:
        sql = """
            SELECT vh.id, vh.category_id, vh.key_name, vh.value, vh.use_count,
                   vh.last_used_at, vh.created_at
            FROM value_history vh
            LEFT JOIN categories c ON c.id = vh.category_id
            WHERE 1=1
        """
        params: list[Any] = []
        if category_name:
            sql += " AND c.name = ? COLLATE NOCASE"
            params.append(category_name)
        if key_name:
            sql += " AND vh.key_name = ? COLLATE NOCASE"
            params.append(key_name)
        if prefix:
            esc = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            sql += " AND vh.value LIKE ? ESCAPE '\\'"
            params.append(f"{esc}%")
        sql += " ORDER BY vh.use_count DESC, vh.last_used_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        return [
            {
                "id": r["id"],
                "categoryId": r["category_id"],
                "keyName": r["key_name"],
                "value": r["value"],
                "useCount": r["use_count"],
                "lastUsedAt": r["last_used_at"],
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def history_keys(prefix: str = "", limit: int = 50) -> list[str]:
    limit = min(max(limit, 1), 200)
    conn = connect()
    try:
        if prefix:
            rows = conn.execute(
                """
                SELECT DISTINCT key_name FROM value_history
                WHERE key_name LIKE ? COLLATE NOCASE
                ORDER BY key_name LIMIT ?
                """,
                (f"{prefix}%", limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT key_name FROM value_history ORDER BY key_name LIMIT ?",
                (limit,),
            ).fetchall()
        return [r["key_name"] for r in rows]
    finally:
        conn.close()


def delete_history_ids(ids: list[str]) -> int:
    if not ids:
        return 0
    conn = connect()
    try:
        placeholders = ",".join("?" * len(ids))
        cur = conn.execute(
            f"DELETE FROM value_history WHERE id IN ({placeholders})", ids
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def update_history_entry(entry_id: str, value: str) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    conn = connect()
    try:
        cur = conn.execute(
            "UPDATE value_history SET value = ?, last_used_at = ? WHERE id = ?",
            (value, now_iso(), entry_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_history_matching(search: str) -> int:
    if not (search or "").strip():
        return 0
    q = f"%{search.strip()}%"
    conn = connect()
    try:
        cur = conn.execute(
            """
            DELETE FROM value_history WHERE id IN (
              SELECT vh.id FROM value_history vh
              LEFT JOIN categories c ON c.id = vh.category_id
              WHERE vh.key_name LIKE ? OR vh.value LIKE ? OR c.name LIKE ?
            )
            """,
            (q, q, q),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def clear_history(request: dict[str, Any]) -> dict[str, Any]:
    mode = request.get("mode") or "all"
    if mode in ("lastDays",):
        mode = "days"
    if mode in ("before",):
        mode = "datetime"
    conn = connect()
    try:
        if mode == "all":
            if not request.get("confirmAll"):
                raise ValueError("confirmAll required for clear all")
            cur = conn.execute("DELETE FROM value_history")
            deleted = cur.rowcount
        elif mode == "days":
            days = int(request.get("days") or 7)
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            age = request.get("age") or "newer"
            if age == "older":
                cur = conn.execute(
                    "DELETE FROM value_history WHERE last_used_at <= ?", (cutoff,)
                )
            else:
                cur = conn.execute(
                    "DELETE FROM value_history WHERE last_used_at >= ?", (cutoff,)
                )
            deleted = cur.rowcount
        elif mode == "datetime":
            before = request.get("beforeIso") or now_iso()
            age = request.get("age") or "older"
            if age == "newer":
                cur = conn.execute(
                    "DELETE FROM value_history WHERE last_used_at >= ?", (before,)
                )
            else:
                cur = conn.execute(
                    "DELETE FROM value_history WHERE last_used_at <= ?", (before,)
                )
            deleted = cur.rowcount
        else:
            raise ValueError(f"Unknown clear mode: {mode}")
        conn.execute(
            """
            DELETE FROM categories
            WHERE id NOT IN (SELECT DISTINCT category_id FROM value_history)
            """
        )
        conn.commit()
        return {"deleted": deleted, "mode": mode}
    finally:
        conn.close()


def clear_history_count(request: dict[str, Any]) -> int:
    # dry-run count by cloning logic without delete â€” simple path
    mode = request.get("mode") or "all"
    if mode in ("lastDays",):
        mode = "days"
    if mode in ("before",):
        mode = "datetime"
    conn = connect()
    try:
        if mode == "all":
            return int(conn.execute("SELECT COUNT(*) AS n FROM value_history").fetchone()["n"])
        if mode == "days":
            days = int(request.get("days") or 7)
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            age = request.get("age") or "newer"
            op = ">=" if age != "older" else "<="
            return int(
                conn.execute(
                    f"SELECT COUNT(*) AS n FROM value_history WHERE last_used_at {op} ?",
                    (cutoff,),
                ).fetchone()["n"]
            )
        before = request.get("beforeIso") or now_iso()
        age = request.get("age") or "older"
        op = ">=" if age == "newer" else "<="
        return int(
            conn.execute(
                f"SELECT COUNT(*) AS n FROM value_history WHERE last_used_at {op} ?",
                (before,),
            ).fetchone()["n"]
        )
    finally:
        conn.close()


def history_count() -> int:
    conn = connect()
    try:
        return int(conn.execute("SELECT COUNT(*) AS n FROM value_history").fetchone()["n"])
    finally:
        conn.close()


def list_templates() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT id, name, description, schema_json, sample_data_json, created_at, updated_at
            FROM templates ORDER BY updated_at DESC
            """
        ).fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "description": r["description"],
                "schemaJson": r["schema_json"],
                "sampleDataJson": r["sample_data_json"],
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def save_template(t: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        tid = t.get("id") or str(uuid.uuid4())
        existing = conn.execute(
            "SELECT created_at FROM templates WHERE id = ?", (tid,)
        ).fetchone()
        created = existing["created_at"] if existing else t.get("createdAt") or ts
        conn.execute(
            """
            INSERT INTO templates
              (id, name, description, schema_json, sample_data_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              schema_json = excluded.schema_json,
              sample_data_json = excluded.sample_data_json,
              updated_at = excluded.updated_at
            """,
            (
                tid,
                t.get("name") or "Template",
                t.get("description"),
                t.get("schemaJson") or json.dumps(t.get("schema") or {}),
                t.get("sampleDataJson"),
                created,
                ts,
            ),
        )
        conn.commit()
        for x in list_templates():
            if x["id"] == tid:
                return x
        return t
    finally:
        conn.close()


def delete_template(tid: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM templates WHERE id = ?", (tid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def log_interaction(itype: str, payload: Any) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO interactions (id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), itype, json.dumps(payload), now_iso()),
        )
        # Keep interactions bounded (recent activity only)
        conn.execute(
            """
            DELETE FROM interactions WHERE id IN (
              SELECT id FROM interactions
              ORDER BY created_at DESC
              LIMIT -1 OFFSET 2000
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def list_interactions(
    *, types: list[str] | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    """Recent activity (generate, package_generate, …) for UI Recent view."""
    lim = max(1, min(int(limit or 50), 200))
    conn = connect()
    try:
        if types:
            placeholders = ",".join("?" for _ in types)
            rows = conn.execute(
                f"""
                SELECT id, type, payload_json, created_at
                FROM interactions
                WHERE type IN ({placeholders})
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (*types, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, type, payload_json, created_at
                FROM interactions
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (lim,),
            ).fetchall()
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload_json"] or "{}")
            except json.JSONDecodeError:
                payload = {}
            out.append(
                {
                    "id": r["id"],
                    "type": r["type"],
                    "payload": payload,
                    "createdAt": r["created_at"],
                }
            )
        return out
    finally:
        conn.close()


def list_history_for_backup(limit: int = 50_000) -> list[dict]:
    page = list_history_page(offset=0, limit=min(limit, 500))
    # fetch more if needed via simple loop
    items = page["items"]
    offset = page["limit"]
    while len(items) < limit and offset < page["total"]:
        more = list_history_page(offset=offset, limit=500)
        if not more["items"]:
            break
        items.extend(more["items"])
        offset += len(more["items"])
    return items[:limit]


# â”€â”€ Packages (multifile layout only â€” no generated variants in DB) â”€â”€


def save_package(doc: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        pid = doc.get("id") or str(uuid.uuid4())
        existing = conn.execute(
            "SELECT created_at FROM package_import WHERE id = ?", (pid,)
        ).fetchone()
        created = existing["created_at"] if existing else doc.get("createdAt") or ts
        conn.execute(
            """
            INSERT INTO package_import
              (id, name, source_kind, outer_format, outer_extension, nested_json,
               skipped_json, multifile_schema_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              source_kind = excluded.source_kind,
              outer_format = excluded.outer_format,
              outer_extension = excluded.outer_extension,
              nested_json = excluded.nested_json,
              skipped_json = excluded.skipped_json,
              multifile_schema_id = excluded.multifile_schema_id,
              updated_at = excluded.updated_at
            """,
            (
                pid,
                doc.get("name") or "Package",
                doc.get("sourceKind") or "files",
                doc.get("outerFormat") or "folder",
                doc.get("outerExtension"),
                json.dumps(doc.get("nestedArchives") or []),
                json.dumps(doc.get("skipped") or []),
                doc.get("multifileSchemaId"),
                created,
                ts,
            ),
        )
        conn.execute("DELETE FROM package_member WHERE package_id = ?", (pid,))
        for i, m in enumerate(doc.get("members") or []):
            conn.execute(
                """
                INSERT INTO package_member
                  (id, package_id, path, name, kind, format, nested_archive_path,
                   nested_archive_format, content, schema_id, verified, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    m.get("id") or str(uuid.uuid4()),
                    pid,
                    m.get("path") or f"file_{i}",
                    m.get("name") or "file",
                    m.get("kind") or "text",
                    m.get("format"),
                    m.get("nestedArchivePath"),
                    m.get("nestedArchiveFormat"),
                    m.get("content"),
                    m.get("schemaId"),
                    1 if m.get("verified") else 0,
                    i,
                ),
            )
        conn.commit()
        return get_package(pid)  # type: ignore[return-value]
    finally:
        conn.close()


def _package_from_id(conn: sqlite3.Connection, pid: str) -> dict[str, Any] | None:
    r = conn.execute(
        """
        SELECT id, name, source_kind, outer_format, outer_extension, nested_json,
               skipped_json, multifile_schema_id, created_at, updated_at
        FROM package_import WHERE id = ?
        """,
        (pid,),
    ).fetchone()
    if not r:
        return None
    try:
        nested = json.loads(r["nested_json"] or "[]")
    except json.JSONDecodeError:
        nested = []
    try:
        skipped = json.loads(r["skipped_json"] or "[]")
    except json.JSONDecodeError:
        skipped = []
    members = conn.execute(
        """
        SELECT id, path, name, kind, format, nested_archive_path, nested_archive_format,
               content, schema_id, verified, sort_order
        FROM package_member WHERE package_id = ? ORDER BY sort_order, path
        """,
        (pid,),
    ).fetchall()
    return {
        "id": r["id"],
        "name": r["name"],
        "sourceKind": r["source_kind"],
        "outerFormat": r["outer_format"],
        "outerExtension": r["outer_extension"],
        "nestedArchives": nested,
        "skipped": skipped,
        "multifileSchemaId": r["multifile_schema_id"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "members": [
            {
                "id": m["id"],
                "path": m["path"],
                "name": m["name"],
                "kind": m["kind"],
                "format": m["format"],
                "nestedArchivePath": m["nested_archive_path"],
                "nestedArchiveFormat": m["nested_archive_format"],
                "content": m["content"],
                "schemaId": m["schema_id"],
                "verified": bool(m["verified"]),
            }
            for m in members
        ],
    }


def get_package(package_id: str) -> dict[str, Any] | None:
    conn = connect()
    try:
        return _package_from_id(conn, package_id)
    finally:
        conn.close()


def get_package_hydrated(package_id: str) -> dict[str, Any] | None:
    pkg = get_package(package_id)
    if not pkg:
        return None
    schemas: dict[str, Any] = {}
    for m in pkg["members"]:
        if m.get("schemaId"):
            s = get_schema(m["schemaId"])
            if s:
                schemas[m["path"]] = s
    if pkg.get("multifileSchemaId"):
        multi = get_schema(pkg["multifileSchemaId"])
        if multi:
            schemas["__multifile__"] = multi
    return {**pkg, "schemas": schemas}


def list_packages() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT id FROM package_import ORDER BY updated_at DESC
            """
        ).fetchall()
        return [_package_from_id(conn, r["id"]) for r in rows if r]  # type: ignore
    finally:
        conn.close()


def _schema_package_id(tree_json: str | None) -> str | None:
    try:
        meta = json.loads(tree_json or "{}")
    except json.JSONDecodeError:
        return None
    if isinstance(meta, dict):
        pid = meta.get("packageId")
        return str(pid) if pid else None
    return None


def cleanup_orphan_package_schemas() -> int:
    """Remove schemas whose packageId no longer exists in package_import."""
    conn = connect()
    try:
        live = {
            r["id"]
            for r in conn.execute("SELECT id FROM package_import").fetchall()
        }
        removed = 0
        for r in conn.execute("SELECT id, tree_json FROM schema_meta").fetchall():
            pid = _schema_package_id(r["tree_json"])
            if pid and pid not in live:
                conn.execute("DELETE FROM schema_meta WHERE id = ?", (r["id"],))
                removed += 1
        if removed:
            conn.commit()
        return removed
    finally:
        conn.close()


def delete_package(package_id: str) -> bool:
    """
    Delete package layout, members (FK cascade), linked member/multifile schemas,
    and delivery jobs that target this package. Does not delete custom destination
    artifact paths outside the default export dir.
    """
    conn = connect()
    try:
        exists = conn.execute(
            "SELECT 1 FROM package_import WHERE id = ?", (package_id,)
        ).fetchone()
        if not exists:
            return False

        # Collect schema ids from members before cascade removes package_member rows
        member_schema_ids = [
            r["schema_id"]
            for r in conn.execute(
                "SELECT schema_id FROM package_member WHERE package_id = ? AND schema_id IS NOT NULL",
                (package_id,),
            ).fetchall()
            if r["schema_id"]
        ]

        # Delivery jobs referencing this package (no FK)
        job_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM delivery_job WHERE package_id = ?", (package_id,)
            ).fetchall()
        ]
        for jid in job_ids:
            conn.execute("DELETE FROM delivery_chunk WHERE job_id = ?", (jid,))
            conn.execute("DELETE FROM delivery_job WHERE id = ?", (jid,))

        cur = conn.execute("DELETE FROM package_import WHERE id = ?", (package_id,))

        # Remove linked schemas (members + multifile umbrella + single-file package schema)
        schema_ids = set(member_schema_ids)
        for r in conn.execute("SELECT id, tree_json FROM schema_meta").fetchall():
            if _schema_package_id(r["tree_json"]) == package_id:
                schema_ids.add(r["id"])
        for sid in schema_ids:
            conn.execute("DELETE FROM schema_meta WHERE id = ?", (sid,))

        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def set_package_member_verified(
    package_id: str, member_path: str, verified: bool
) -> None:
    conn = connect()
    try:
        conn.execute(
            """
            UPDATE package_member SET verified = ?
            WHERE package_id = ? AND path = ?
            """,
            (1 if verified else 0, package_id, member_path),
        )
        conn.commit()
    finally:
        conn.close()


def package_count() -> int:
    conn = connect()
    try:
        return int(conn.execute("SELECT COUNT(*) AS n FROM package_import").fetchone()["n"])
    finally:
        conn.close()


# â”€â”€ Delivery jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def save_delivery_job(doc: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        jid = doc.get("id") or str(uuid.uuid4())
        existing = conn.execute(
            "SELECT created_at FROM delivery_job WHERE id = ?", (jid,)
        ).fetchone()
        created = existing["created_at"] if existing else doc.get("createdAt") or ts
        conn.execute(
            """
            INSERT INTO delivery_job
              (id, name, package_id, target_total, window_hours, chunk_min, chunk_max,
               destination_type, destination_path, status, sent_total, next_chunk_index,
               plan_json, seed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              package_id = excluded.package_id,
              target_total = excluded.target_total,
              window_hours = excluded.window_hours,
              chunk_min = excluded.chunk_min,
              chunk_max = excluded.chunk_max,
              destination_type = excluded.destination_type,
              destination_path = excluded.destination_path,
              status = excluded.status,
              sent_total = excluded.sent_total,
              next_chunk_index = excluded.next_chunk_index,
              plan_json = excluded.plan_json,
              seed = excluded.seed,
              updated_at = excluded.updated_at
            """,
            (
                jid,
                doc.get("name") or "delivery",
                doc.get("packageId"),
                int(doc.get("targetTotal") or 0),
                int(doc.get("windowHours") or 24),
                int(doc.get("chunkMin") or 1),
                int(doc.get("chunkMax") or 1),
                doc.get("destinationType") or "local_dir",
                doc.get("destinationPath"),
                doc.get("status") or "planned",
                int(doc.get("sentTotal") or 0),
                int(doc.get("nextChunkIndex") or 0),
                json.dumps(doc.get("plan") or []),
                doc.get("seed"),
                created,
                ts,
            ),
        )
        conn.commit()
        return get_delivery_job(jid)  # type: ignore[return-value]
    finally:
        conn.close()


def get_delivery_job(job_id: str) -> dict[str, Any] | None:
    conn = connect()
    try:
        r = conn.execute(
            "SELECT * FROM delivery_job WHERE id = ?", (job_id,)
        ).fetchone()
        if not r:
            return None
        try:
            plan = json.loads(r["plan_json"] or "[]")
        except json.JSONDecodeError:
            plan = []
        return {
            "id": r["id"],
            "name": r["name"],
            "packageId": r["package_id"],
            "targetTotal": r["target_total"],
            "windowHours": r["window_hours"],
            "chunkMin": r["chunk_min"],
            "chunkMax": r["chunk_max"],
            "destinationType": r["destination_type"],
            "destinationPath": r["destination_path"],
            "status": r["status"],
            "sentTotal": r["sent_total"],
            "nextChunkIndex": r["next_chunk_index"],
            "plan": plan,
            "seed": r["seed"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
    finally:
        conn.close()


def list_delivery_jobs() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT id FROM delivery_job ORDER BY updated_at DESC"
        ).fetchall()
        out = []
        for r in rows:
            j = get_delivery_job(r["id"])
            if j:
                out.append(j)
        return out
    finally:
        conn.close()


def delete_delivery_job(job_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM delivery_job WHERE id = ?", (job_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def add_delivery_chunk(chunk: dict[str, Any]) -> None:
    conn = connect()
    try:
        conn.execute(
            """
            INSERT INTO delivery_chunk
              (id, job_id, seq, size, status, artifact_name, artifact_path, sent_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id, seq) DO UPDATE SET
              size = excluded.size,
              status = excluded.status,
              artifact_name = excluded.artifact_name,
              artifact_path = excluded.artifact_path,
              sent_at = excluded.sent_at,
              error = excluded.error
            """,
            (
                chunk.get("id") or str(uuid.uuid4()),
                chunk["jobId"],
                int(chunk["seq"]),
                int(chunk["size"]),
                chunk.get("status") or "done",
                chunk.get("artifactName"),
                chunk.get("artifactPath"),
                chunk.get("sentAt"),
                chunk.get("error"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def delivery_job_count() -> int:
    conn = connect()
    try:
        return int(conn.execute("SELECT COUNT(*) AS n FROM delivery_job").fetchone()["n"])
    finally:
        conn.close()


# â”€â”€ Custom value lists (user-curated; never auto-generated rows) â”€â”€â”€â”€â”€


def list_custom_lists() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT cl.id, cl.name, cl.description, cl.created_at, cl.updated_at,
                   (SELECT COUNT(*) FROM custom_values cv WHERE cv.list_id = cl.id) AS value_count
            FROM custom_lists cl
            ORDER BY cl.name COLLATE NOCASE
            """
        ).fetchall()
        out = []
        for r in rows:
            keys = [
                x["key_name"]
                for x in conn.execute(
                    "SELECT key_name FROM custom_list_keys WHERE list_id = ? ORDER BY key_name",
                    (r["id"],),
                ).fetchall()
            ]
            out.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "description": r["description"],
                    "keys": keys,
                    "valueCount": int(r["value_count"] or 0),
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                }
            )
        return out
    finally:
        conn.close()


def get_custom_list(list_id: str) -> dict[str, Any] | None:
    conn = connect()
    try:
        r = conn.execute(
            "SELECT id, name, description, created_at, updated_at FROM custom_lists WHERE id = ?",
            (list_id,),
        ).fetchone()
        if not r:
            return None
        keys = [
            x["key_name"]
            for x in conn.execute(
                "SELECT key_name FROM custom_list_keys WHERE list_id = ? ORDER BY key_name",
                (list_id,),
            ).fetchall()
        ]
        vals = conn.execute(
            """
            SELECT id, value, sort_order, created_at FROM custom_values
            WHERE list_id = ? ORDER BY sort_order, value
            """,
            (list_id,),
        ).fetchall()
        return {
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "keys": keys,
            "values": [
                {
                    "id": v["id"],
                    "value": v["value"],
                    "sortOrder": v["sort_order"],
                    "createdAt": v["created_at"],
                }
                for v in vals
            ],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
    finally:
        conn.close()


def save_custom_list(data: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        lid = data.get("id") or str(uuid.uuid4())
        existing = conn.execute(
            "SELECT created_at FROM custom_lists WHERE id = ?", (lid,)
        ).fetchone()
        created = existing["created_at"] if existing else data.get("createdAt") or ts
        conn.execute(
            """
            INSERT INTO custom_lists (id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              updated_at = excluded.updated_at
            """,
            (
                lid,
                (data.get("name") or "Custom list").strip(),
                data.get("description"),
                created,
                ts,
            ),
        )
        keys = data.get("keys")
        if keys is not None:
            conn.execute("DELETE FROM custom_list_keys WHERE list_id = ?", (lid,))
            for k in keys:
                k = (k or "").strip()
                if not k:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO custom_list_keys (list_id, key_name) VALUES (?, ?)",
                    (lid, k),
                )
        conn.commit()
        return get_custom_list(lid)  # type: ignore[return-value]
    finally:
        conn.close()


def delete_custom_list(list_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM custom_lists WHERE id = ?", (list_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def add_custom_values(list_id: str, values: list[str]) -> int:
    """Add unique values to a list. Returns number inserted."""
    conn = connect()
    try:
        if not conn.execute(
            "SELECT 1 FROM custom_lists WHERE id = ?", (list_id,)
        ).fetchone():
            return -1
        n = 0
        ts = now_iso()
        max_ord = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM custom_values WHERE list_id = ?",
            (list_id,),
        ).fetchone()["m"]
        for raw in values:
            val = (raw or "").strip()
            if not val:
                continue
            max_ord += 1
            try:
                conn.execute(
                    """
                    INSERT INTO custom_values (id, list_id, value, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), list_id, val, max_ord, ts),
                )
                n += 1
            except sqlite3.IntegrityError:
                pass
        conn.execute(
            "UPDATE custom_lists SET updated_at = ? WHERE id = ?", (ts, list_id)
        )
        conn.commit()
        return n
    finally:
        conn.close()


def update_custom_value(value_id: str, value: str) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    conn = connect()
    try:
        cur = conn.execute(
            "UPDATE custom_values SET value = ? WHERE id = ?", (value, value_id)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_custom_value(value_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM custom_values WHERE id = ?", (value_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_custom_values_for_key(key: str, limit: int = 200) -> list[str]:
    """Values from any custom list mapped to this field key (or list name)."""
    key = (key or "").strip()
    if not key:
        return []
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT cv.value
            FROM custom_values cv
            JOIN custom_lists cl ON cl.id = cv.list_id
            LEFT JOIN custom_list_keys clk ON clk.list_id = cl.id
            WHERE clk.key_name = ? COLLATE NOCASE
               OR cl.name = ? COLLATE NOCASE
            ORDER BY cv.sort_order, cv.value
            LIMIT ?
            """,
            (key, key, limit),
        ).fetchall()
        return [r["value"] for r in rows]
    finally:
        conn.close()


def custom_list_count() -> int:
    conn = connect()
    try:
        return int(conn.execute("SELECT COUNT(*) AS n FROM custom_lists").fetchone()["n"])
    finally:
        conn.close()


# â”€â”€ Themes (data packs; not UI chrome) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def list_themes() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.slug, t.description, t.is_builtin, t.created_at, t.updated_at,
                   (SELECT COUNT(*) FROM theme_values tv WHERE tv.theme_id = t.id) AS value_count
            FROM themes t ORDER BY t.name COLLATE NOCASE
            """
        ).fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "slug": r["slug"],
                "description": r["description"],
                "isBuiltin": bool(r["is_builtin"]),
                "valueCount": int(r["value_count"] or 0),
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def save_theme(data: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        tid = data.get("id") or str(uuid.uuid4())
        name = (data.get("name") or "Theme").strip()
        slug = (data.get("slug") or name).strip().lower().replace(" ", "-")
        existing = conn.execute(
            "SELECT created_at FROM themes WHERE id = ?", (tid,)
        ).fetchone()
        created = existing["created_at"] if existing else ts
        conn.execute(
            """
            INSERT INTO themes (id, name, slug, description, is_builtin, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              slug = excluded.slug,
              description = excluded.description,
              updated_at = excluded.updated_at
            """,
            (
                tid,
                name,
                slug,
                data.get("description"),
                1 if data.get("isBuiltin") else 0,
                created,
                ts,
            ),
        )
        conn.commit()
        for t in list_themes():
            if t["id"] == tid:
                return t
        return data
    finally:
        conn.close()


def add_theme_values(
    theme_id: str, category: str, values: list[str], weight: float = 1.0
) -> int:
    conn = connect()
    try:
        if not conn.execute(
            "SELECT 1 FROM themes WHERE id = ?", (theme_id,)
        ).fetchone():
            return -1
        cat = (category or "general").strip() or "general"
        n = 0
        ts = now_iso()
        for raw in values:
            val = (raw or "").strip()
            if not val:
                continue
            try:
                conn.execute(
                    """
                    INSERT INTO theme_values (id, theme_id, category, value, weight, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), theme_id, cat, val, weight, ts),
                )
                n += 1
            except sqlite3.IntegrityError:
                pass
        conn.execute(
            "UPDATE themes SET updated_at = ? WHERE id = ?", (ts, theme_id)
        )
        conn.commit()
        return n
    finally:
        conn.close()


def get_theme_values(
    theme_id: str, category: str | None = None, limit: int = 500
) -> list[dict[str, Any]]:
    conn = connect()
    try:
        if category:
            rows = conn.execute(
                """
                SELECT id, category, value, weight FROM theme_values
                WHERE theme_id = ? AND category = ? COLLATE NOCASE
                ORDER BY category, value LIMIT ?
                """,
                (theme_id, category, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, category, value, weight FROM theme_values
                WHERE theme_id = ? ORDER BY category, value LIMIT ?
                """,
                (theme_id, limit),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "category": r["category"],
                "value": r["value"],
                "weight": r["weight"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def delete_theme(theme_id: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM themes WHERE id = ?", (theme_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def list_theme_categories(theme_id: str | None = None) -> list[str]:
    """Distinct categories across one theme or all themes."""
    conn = connect()
    try:
        if theme_id:
            rows = conn.execute(
                """
                SELECT DISTINCT category FROM theme_values
                WHERE theme_id = ? ORDER BY category COLLATE NOCASE
                """,
                (theme_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT category FROM theme_values
                ORDER BY category COLLATE NOCASE
                """
            ).fetchall()
        return [r["category"] for r in rows]
    finally:
        conn.close()


def get_blended_theme_values(
    category: str,
    blend: list[dict[str, Any]] | None,
    *,
    limit: int = 500,
) -> list[str]:
    """
    Values for a theme category from active blend packs.
    weight scales how often a theme's values appear in the pool (cross-theme mix).
    """
    category = (category or "").strip()
    if not category or not blend:
        return []
    conn = connect()
    try:
        pool: list[str] = []
        for entry in blend:
            tid = (entry.get("themeId") or entry.get("id") or "").strip()
            if not tid:
                continue
            try:
                w = float(entry.get("weight", 1.0))
            except (TypeError, ValueError):
                w = 1.0
            if w <= 0:
                continue
            # Scale copies in pool: weight 1 â†’ 10 slots, 0.5 â†’ 5, etc.
            copies = max(1, int(round(w * 10)))
            rows = conn.execute(
                """
                SELECT value FROM theme_values
                WHERE theme_id = ? AND category = ? COLLATE NOCASE
                ORDER BY value LIMIT ?
                """,
                (tid, category, limit),
            ).fetchall()
            for r in rows:
                val = r["value"]
                if not val:
                    continue
                pool.extend([val] * copies)
        # de-dupe while keeping multi-weight presence: return unique for list, weighted sampling uses copies
        return pool[: max(limit * 5, limit)]
    finally:
        conn.close()
