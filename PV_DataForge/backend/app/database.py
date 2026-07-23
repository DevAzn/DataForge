"""SQLite persistence — full Electron-parity tables."""
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
ENCRYPTION_DIR = DATA_DIR / "encryption"


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
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "lastOpenedAt": r["last_opened_at"] if "last_opened_at" in r.keys() else None,
    }


def list_schemas() -> list[dict[str, Any]]:
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
        return [_schema_row(r) for r in rows]
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
        tree = {
            "root": doc.get("root") or [],
            "csvTiedFieldPaths": doc.get("csvTiedFieldPaths"),
            "sourceFileName": doc.get("sourceFileName"),
            "sourceFormat": doc.get("sourceFormat"),
        }
        existing = conn.execute(
            "SELECT created_at, last_opened_at FROM schema_meta WHERE id = ?", (sid,)
        ).fetchone()
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
    # dry-run count by cloning logic without delete — simple path
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
        conn.commit()
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
