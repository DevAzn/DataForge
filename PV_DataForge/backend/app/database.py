"""SQLite persistence for PV_DataForge."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "pv_dataforge.sqlite"


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
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
              FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            CREATE INDEX IF NOT EXISTS idx_vh_key ON value_history(key_name);
            CREATE INDEX IF NOT EXISTS idx_vh_cat ON value_history(category_id);
            """
        )
        # default settings
        row = conn.execute("SELECT 1 FROM settings WHERE key = 'app'").fetchone()
        if not row:
            defaults = {
                "themeMode": "dark",
                "defaultExportFormat": "xml",
                "defaultRecordCount": 10,
                "csvMultiRow": True,
            }
            conn.execute(
                "INSERT INTO settings (key, value_json) VALUES ('app', ?)",
                (json.dumps(defaults),),
            )
        conn.commit()
    finally:
        conn.close()


def get_settings() -> dict[str, Any]:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT value_json FROM settings WHERE key = 'app'"
        ).fetchone()
        if not row:
            return {}
        return json.loads(row["value_json"])
    finally:
        conn.close()


def set_settings(data: dict[str, Any]) -> dict[str, Any]:
    current = get_settings()
    merged = {**current, **data}
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


def list_schemas() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT id, name, description, tree_json, source_file_name, source_format,
                   created_at, updated_at
            FROM schema_meta
            ORDER BY updated_at DESC
            """
        ).fetchall()
        out = []
        for r in rows:
            tree = json.loads(r["tree_json"])
            out.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "description": r["description"],
                    "root": tree.get("root", tree if isinstance(tree, list) else []),
                    "csvTiedFieldPaths": tree.get("csvTiedFieldPaths"),
                    "sourceFileName": r["source_file_name"],
                    "sourceFormat": r["source_format"],
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                }
            )
        return out
    finally:
        conn.close()


def get_schema(schema_id: str) -> dict[str, Any] | None:
    for s in list_schemas():
        if s["id"] == schema_id:
            return s
    return None


def save_schema(doc: dict[str, Any]) -> dict[str, Any]:
    conn = connect()
    try:
        ts = now_iso()
        sid = doc.get("id") or str(uuid.uuid4())
        tree = {
            "root": doc.get("root") or [],
            "csvTiedFieldPaths": doc.get("csvTiedFieldPaths"),
        }
        existing = conn.execute(
            "SELECT created_at FROM schema_meta WHERE id = ?", (sid,)
        ).fetchone()
        created = existing["created_at"] if existing else doc.get("createdAt") or ts
        conn.execute(
            """
            INSERT INTO schema_meta
              (id, name, description, tree_json, source_file_name, source_format, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              tree_json = excluded.tree_json,
              source_file_name = excluded.source_file_name,
              source_format = excluded.source_format,
              updated_at = excluded.updated_at
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
            ),
        )
        conn.commit()
        return get_schema(sid)  # type: ignore[return-value]
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


def _ensure_category(conn: sqlite3.Connection, name: str) -> str:
    """Resolve or create a category using an existing connection (no nested lock)."""
    row = conn.execute(
        "SELECT id FROM categories WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if row:
        return row["id"]
    cid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)",
        (cid, name, now_iso()),
    )
    return cid


def ensure_category(name: str) -> str:
    conn = connect()
    try:
        cid = _ensure_category(conn, name)
        conn.commit()
        return cid
    finally:
        conn.close()


def record_values(items: list[dict[str, str]], mode: str = "use") -> int:
    """items: {categoryName, keyName, value}"""
    n = 0
    conn = connect()
    try:
        for it in items:
            val = (it.get("value") or "").strip()
            if not val:
                continue
            key = (it.get("keyName") or it.get("categoryName") or "field").strip()
            cat_name = (it.get("categoryName") or key).strip()
            cid = _ensure_category(conn, cat_name)
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
                conn.execute(
                    """
                    INSERT INTO value_history
                      (id, category_id, key_name, value, use_count, last_used_at, created_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?)
                    """,
                    (str(uuid.uuid4()), cid, key, val, ts, ts),
                )
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
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT vh.id, vh.key_name, vh.value, vh.use_count, vh.last_used_at,
                   c.name AS category_name
            FROM value_history vh
            LEFT JOIN categories c ON c.id = vh.category_id
            ORDER BY vh.last_used_at DESC
            LIMIT ?
            """,
            (min(max(limit, 1), 500),),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "keyName": r["key_name"],
                "value": r["value"],
                "useCount": r["use_count"],
                "lastUsedAt": r["last_used_at"],
                "categoryName": r["category_name"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def history_count() -> int:
    conn = connect()
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM value_history").fetchone()
        return int(row["n"] if row else 0)
    finally:
        conn.close()
