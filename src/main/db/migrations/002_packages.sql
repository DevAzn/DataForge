-- Package variation: whole multi-file upload = one record unit
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS package_import (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  outer_format TEXT NOT NULL,
  outer_extension TEXT,
  nested_json TEXT NOT NULL,
  skipped_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS package_member (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES package_import(id) ON DELETE CASCADE,
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
  UNIQUE(package_id, path)
);

CREATE INDEX IF NOT EXISTS idx_package_member_pkg ON package_member(package_id);
