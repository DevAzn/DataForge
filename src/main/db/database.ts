import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import type {
  AppPaths,
  AppSettings,
  SchemaDoc,
  SchemaRow,
  SchemaTreePayload,
  Template
} from '../../shared/types'
import {
  DEFAULT_ENCRYPTION,
  DEFAULT_FILE_NAMING,
  DEFAULT_SETTINGS
} from '../../shared/types'

function parseTreeJson(
  raw: string
): Pick<
  SchemaDoc,
  'root' | 'sourceFileName' | 'sourceFilePath' | 'sourceFormat' | 'csvTiedFieldPaths'
> {
  try {
    const parsed = JSON.parse(raw) as SchemaRow[] | SchemaTreePayload
    if (Array.isArray(parsed)) {
      return { root: parsed }
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.root)) {
      return {
        root: parsed.root,
        sourceFileName: parsed.sourceFileName,
        sourceFilePath: parsed.sourceFilePath,
        sourceFormat: parsed.sourceFormat,
        csvTiedFieldPaths: parsed.csvTiedFieldPaths
      }
    }
  } catch {
    /* fall through */
  }
  return { root: [] }
}

function encodeTreeJson(doc: SchemaDoc): string {
  const payload: SchemaTreePayload = {
    root: doc.root,
    sourceFileName: doc.sourceFileName,
    sourceFilePath: doc.sourceFilePath,
    sourceFormat: doc.sourceFormat,
    csvTiedFieldPaths: doc.csvTiedFieldPaths
  }
  return JSON.stringify(payload)
}

const DB_FILE = 'dataforge.sqlite'
const CACHE_FILE = 'DataForge_user_cache'

let db: Database.Database | null = null
let paths: AppPaths | null = null

export function getPaths(): AppPaths {
  if (paths) return paths
  const userData = app.getPath('userData')
  if (!existsSync(userData)) {
    mkdirSync(userData, { recursive: true })
  }
  paths = {
    userData,
    dbPath: join(userData, DB_FILE),
    cachePath: join(userData, CACHE_FILE)
  }
  return paths
}

function loadMigrationSql(): string {
  // In dev, read from source; in prod, embed via import.meta or read relative to __dirname
  const candidates = [
    join(__dirname, 'migrations', '001_initial.sql'),
    join(app.getAppPath(), 'src', 'main', 'db', 'migrations', '001_initial.sql'),
    join(process.cwd(), 'src', 'main', 'db', 'migrations', '001_initial.sql')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      return readFileSync(p, 'utf-8')
    }
  }
  // Fallback: inline migration if file not found (packaged builds)
  return INLINE_MIGRATION_V1
}

const INLINE_MIGRATION_V1 = `
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
CREATE INDEX IF NOT EXISTS idx_value_history_lookup ON value_history(category_id, key_name);
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
CREATE INDEX IF NOT EXISTS idx_interactions_type_time ON interactions(type, created_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`

export function initDatabase(): Database.Database {
  if (db) return db
  const { dbPath } = getPaths()
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = db
    .prepare('SELECT version FROM schema_migrations WHERE version = ?')
    .get(1) as { version: number } | undefined

  if (!applied) {
    db.exec(loadMigrationSql())
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      1,
      new Date().toISOString()
    )
  }

  // Ensure default settings row
  const settingsRow = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app') as
    | { value_json: string }
    | undefined
  if (!settingsRow) {
    db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run(
      'app',
      JSON.stringify(DEFAULT_SETTINGS)
    )
  }

  // Performance indexes for large history tables
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_value_history_last_used
        ON value_history(last_used_at DESC);
      CREATE INDEX IF NOT EXISTS idx_value_history_key_name
        ON value_history(key_name);
    `)
  } catch {
    /* ignore */
  }

  // Package variation tables (v2) — inline to avoid circular import with packages.ts
  try {
    db.exec(`
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
    `)
    db.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(2, new Date().toISOString())
  } catch {
    /* ignore */
  }

  writeUserCache()
  return db
}

export function getDb(): Database.Database {
  if (!db) return initDatabase()
  return db
}

export function getSettings(): AppSettings {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get('app') as
    | { value_json: string }
    | undefined
  if (!row) {
    return {
      ...DEFAULT_SETTINGS,
      encryption: { ...DEFAULT_ENCRYPTION }
    }
  }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<AppSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      csvLayoutMode: parsed.csvLayoutMode ?? DEFAULT_SETTINGS.csvLayoutMode,
      csvMultiRow:
        typeof parsed.csvMultiRow === 'boolean'
          ? parsed.csvMultiRow
          : DEFAULT_SETTINGS.csvMultiRow,
      xmlRootTag:
        typeof parsed.xmlRootTag === 'string' && parsed.xmlRootTag.trim()
          ? parsed.xmlRootTag.trim()
          : DEFAULT_SETTINGS.xmlRootTag,
      xmlRecordTag:
        typeof parsed.xmlRecordTag === 'string' && parsed.xmlRecordTag.trim()
          ? parsed.xmlRecordTag.trim()
          : DEFAULT_SETTINGS.xmlRecordTag,
      xmlSelfClosing:
        typeof parsed.xmlSelfClosing === 'boolean'
          ? parsed.xmlSelfClosing
          : DEFAULT_SETTINGS.xmlSelfClosing,
      encryption: {
        ...DEFAULT_ENCRYPTION,
        ...(parsed.encryption ?? {})
      },
      fileNaming: {
        ...DEFAULT_FILE_NAMING,
        ...(parsed.fileNaming ?? {})
      }
    }
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      encryption: { ...DEFAULT_ENCRYPTION }
    }
  }
}

export function setSettings(settings: AppSettings): AppSettings {
  const current = getSettings()
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...current,
    ...settings,
    encryption: {
      ...DEFAULT_ENCRYPTION,
      ...current.encryption,
      ...(settings.encryption ?? {})
    },
    fileNaming: {
      ...DEFAULT_FILE_NAMING,
      ...current.fileNaming,
      ...(settings.fileNaming ?? {})
    }
  }
  // Only clear custom colors when explicitly removed (undefined on the patch object)
  if ('customColors' in settings && !settings.customColors) {
    delete merged.customColors
  } else if (settings.customColors) {
    merged.customColors = settings.customColors
  } else if (current.customColors) {
    merged.customColors = current.customColors
  }
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
    )
    .run('app', JSON.stringify(merged))
  writeUserCache()
  return getSettings()
}

export function listSchemas(): SchemaDoc[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, description, tree_json, created_at, updated_at, last_opened_at
       FROM schema_meta ORDER BY COALESCE(last_opened_at, updated_at) DESC`
    )
    .all() as Array<{
    id: string
    name: string
    description: string | null
    tree_json: string
    created_at: string
    updated_at: string
    last_opened_at: string | null
  }>

  return rows.map((r) => {
    const tree = parseTreeJson(r.tree_json)
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      root: tree.root,
      sourceFileName: tree.sourceFileName,
      sourceFilePath: tree.sourceFilePath,
      sourceFormat: tree.sourceFormat,
      csvTiedFieldPaths: tree.csvTiedFieldPaths,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastOpenedAt: r.last_opened_at ?? undefined
    }
  })
}

export function getSchema(id: string): SchemaDoc | null {
  const r = getDb()
    .prepare(
      `SELECT id, name, description, tree_json, created_at, updated_at, last_opened_at
       FROM schema_meta WHERE id = ?`
    )
    .get(id) as
    | {
        id: string
        name: string
        description: string | null
        tree_json: string
        created_at: string
        updated_at: string
        last_opened_at: string | null
      }
    | undefined

  if (!r) return null
  const tree = parseTreeJson(r.tree_json)
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    root: tree.root,
    sourceFileName: tree.sourceFileName,
    sourceFilePath: tree.sourceFilePath,
    sourceFormat: tree.sourceFormat,
    csvTiedFieldPaths: tree.csvTiedFieldPaths,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastOpenedAt: r.last_opened_at ?? undefined
  }
}

export function saveSchema(doc: SchemaDoc): SchemaDoc {
  const now = new Date().toISOString()
  const updated: SchemaDoc = {
    ...doc,
    updatedAt: now,
    createdAt: doc.createdAt || now
  }
  getDb()
    .prepare(
      `INSERT INTO schema_meta (id, name, description, tree_json, created_at, updated_at, last_opened_at)
       VALUES (@id, @name, @description, @tree_json, @created_at, @updated_at, @last_opened_at)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         tree_json = excluded.tree_json,
         updated_at = excluded.updated_at,
         last_opened_at = excluded.last_opened_at`
    )
    .run({
      id: updated.id,
      name: updated.name,
      description: updated.description ?? null,
      tree_json: encodeTreeJson(updated),
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
      last_opened_at: updated.lastOpenedAt ?? null
    })
  writeUserCache()
  return updated
}

export function deleteSchema(id: string): boolean {
  const result = getDb().prepare('DELETE FROM schema_meta WHERE id = ?').run(id)
  writeUserCache()
  return result.changes > 0
}

/** Update last_opened_at without rewriting the full tree (sidebar recents). */
export function touchSchemaOpened(id: string): SchemaDoc | null {
  const existing = getSchema(id)
  if (!existing) return null
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE schema_meta SET last_opened_at = ? WHERE id = ?')
    .run(now, id)
  writeUserCache()
  return { ...existing, lastOpenedAt: now }
}

export function listTemplates(): Template[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, description, schema_json, sample_data_json, created_at, updated_at
       FROM templates ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string
    name: string
    description: string | null
    schema_json: string
    sample_data_json: string | null
    created_at: string
    updated_at: string
  }>

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    schemaJson: r.schema_json,
    sampleDataJson: r.sample_data_json ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

export function saveTemplate(t: Template): Template {
  const now = new Date().toISOString()
  const updated: Template = {
    ...t,
    updatedAt: now,
    createdAt: t.createdAt || now
  }
  getDb()
    .prepare(
      `INSERT INTO templates (id, name, description, schema_json, sample_data_json, created_at, updated_at)
       VALUES (@id, @name, @description, @schema_json, @sample_data_json, @created_at, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         schema_json = excluded.schema_json,
         sample_data_json = excluded.sample_data_json,
         updated_at = excluded.updated_at`
    )
    .run({
      id: updated.id,
      name: updated.name,
      description: updated.description ?? null,
      schema_json: updated.schemaJson,
      sample_data_json: updated.sampleDataJson ?? null,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt
    })
  writeUserCache()
  return updated
}

export function deleteTemplate(id: string): boolean {
  const result = getDb().prepare('DELETE FROM templates WHERE id = ?').run(id)
  writeUserCache()
  return result.changes > 0
}

export function countTable(table: string): number {
  const allowed = new Set([
    'schema_meta',
    'templates',
    'value_history',
    'categories',
    'interactions'
  ])
  if (!allowed.has(table)) return 0
  const row = getDb().prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }
  return row.c
}

let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null

function writeUserCacheNow(): void {
  const { cachePath } = getPaths()
  const snapshot = {
    version: 1,
    writtenAt: new Date().toISOString(),
    settings: getSettings(),
    schemas: listSchemas(),
    templates: listTemplates(),
    valueHistoryCount: countTable('value_history'),
    categoriesCount: countTable('categories')
  }
  writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), 'utf-8')
}

/**
 * Overwrite DataForge_user_cache with a portable JSON snapshot.
 * Debounced (~750ms) so rapid history/schema ops don't thrash disk.
 * Use flushUserCache() on quit or backup.
 */
export function writeUserCache(): void {
  if (cacheWriteTimer) return
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null
    try {
      writeUserCacheNow()
    } catch {
      /* ignore disk errors */
    }
  }, 750)
}

/** Immediate cache write (quit, backup, explicit refresh). */
export function flushUserCache(): void {
  if (cacheWriteTimer) {
    clearTimeout(cacheWriteTimer)
    cacheWriteTimer = null
  }
  writeUserCacheNow()
}
