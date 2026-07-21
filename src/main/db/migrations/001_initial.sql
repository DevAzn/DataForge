PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tree_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS value_history (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key_name TEXT NOT NULL,
  value TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(category_id, key_name, value)
);

CREATE INDEX IF NOT EXISTS idx_value_history_lookup
  ON value_history(category_id, key_name);

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

CREATE INDEX IF NOT EXISTS idx_interactions_type_time
  ON interactions(type, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
