import { randomUUID } from 'crypto'
import type {
  NestedArchiveFormat,
  PackageDoc,
  PackageDocHydrated,
  PackageMember,
  PackageNestedArchiveMeta,
  PackageOuterFormat,
  PackageSourceKind,
  SchemaDoc
} from '../../shared/types'
import { getDb, getSchema, saveSchema } from './database'

function nowIso(): string {
  return new Date().toISOString()
}

export function ensurePackageTables(): void {
  const db = getDb()
  db.exec(`
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
  // Migrate older DBs
  const cols = db.prepare('PRAGMA table_info(package_import)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'multifile_schema_id')) {
    try {
      db.exec('ALTER TABLE package_import ADD COLUMN multifile_schema_id TEXT')
    } catch {
      /* ignore */
    }
  }
}

export function listPackages(): PackageDoc[] {
  ensurePackageTables()
  const rows = getDb()
    .prepare(
      `SELECT id, name, source_kind, outer_format, outer_extension, nested_json,
              skipped_json, multifile_schema_id, created_at, updated_at
       FROM package_import ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string
    name: string
    source_kind: string
    outer_format: string
    outer_extension: string | null
    nested_json: string
    skipped_json: string
    multifile_schema_id: string | null
    created_at: string
    updated_at: string
  }>
  return rows.map((r) => loadPackageFromRow(r))
}

function loadPackageFromRow(r: {
  id: string
  name: string
  source_kind: string
  outer_format: string
  outer_extension: string | null
  nested_json: string
  skipped_json: string
  multifile_schema_id?: string | null
  created_at: string
  updated_at: string
}): PackageDoc {
  const members = getDb()
    .prepare(
      `SELECT id, path, name, kind, format, nested_archive_path, nested_archive_format,
              content, schema_id, verified, sort_order
       FROM package_member WHERE package_id = ? ORDER BY sort_order, path`
    )
    .all(r.id) as Array<{
    id: string
    path: string
    name: string
    kind: string
    format: string | null
    nested_archive_path: string | null
    nested_archive_format: string | null
    content: string | null
    schema_id: string | null
    verified: number
    sort_order: number
  }>

  let nested: PackageNestedArchiveMeta[] = []
  try {
    nested = JSON.parse(r.nested_json) as PackageNestedArchiveMeta[]
  } catch {
    nested = []
  }
  let skipped: string[] = []
  try {
    skipped = JSON.parse(r.skipped_json) as string[]
  } catch {
    skipped = []
  }

  return {
    id: r.id,
    name: r.name,
    sourceKind: r.source_kind as PackageSourceKind,
    outerFormat: r.outer_format as PackageOuterFormat,
    outerExtension: r.outer_extension ?? undefined,
    nestedArchives: nested,
    skipped,
    multifileSchemaId: r.multifile_schema_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    members: members.map(
      (m): PackageMember => ({
        id: m.id,
        path: m.path,
        name: m.name,
        kind: m.kind as PackageMember['kind'],
        format: (m.format as PackageMember['format']) || undefined,
        nestedArchivePath: m.nested_archive_path ?? undefined,
        nestedArchiveFormat: (m.nested_archive_format as NestedArchiveFormat) || undefined,
        content: m.content ?? undefined,
        schemaId: m.schema_id ?? undefined,
        verified: Boolean(m.verified)
      })
    )
  }
}

export function getPackage(id: string): PackageDoc | null {
  ensurePackageTables()
  const r = getDb()
    .prepare(
      `SELECT id, name, source_kind, outer_format, outer_extension, nested_json,
              skipped_json, multifile_schema_id, created_at, updated_at
       FROM package_import WHERE id = ?`
    )
    .get(id) as
    | {
        id: string
        name: string
        source_kind: string
        outer_format: string
        outer_extension: string | null
        nested_json: string
        skipped_json: string
        multifile_schema_id: string | null
        created_at: string
        updated_at: string
      }
    | undefined
  if (!r) return null
  return loadPackageFromRow(r)
}

export function getPackageHydrated(id: string): PackageDocHydrated | null {
  const pkg = getPackage(id)
  if (!pkg) return null
  const schemas: Record<string, SchemaDoc> = {}
  for (const m of pkg.members) {
    if (m.schemaId) {
      const s = getSchema(m.schemaId)
      if (s) schemas[m.path] = s
    }
  }
  return { ...pkg, schemas }
}

export function savePackage(doc: PackageDoc): PackageDoc {
  ensurePackageTables()
  const db = getDb()
  const ts = nowIso()
  const id = doc.id || randomUUID()
  const existing = db.prepare('SELECT created_at FROM package_import WHERE id = ?').get(id) as
    | { created_at: string }
    | undefined
  const created = existing?.created_at || doc.createdAt || ts

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO package_import
        (id, name, source_kind, outer_format, outer_extension, nested_json, skipped_json,
         multifile_schema_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         source_kind = excluded.source_kind,
         outer_format = excluded.outer_format,
         outer_extension = excluded.outer_extension,
         nested_json = excluded.nested_json,
         skipped_json = excluded.skipped_json,
         multifile_schema_id = excluded.multifile_schema_id,
         updated_at = excluded.updated_at`
    ).run(
      id,
      doc.name,
      doc.sourceKind,
      doc.outerFormat,
      doc.outerExtension ?? null,
      JSON.stringify(doc.nestedArchives || []),
      JSON.stringify(doc.skipped || []),
      doc.multifileSchemaId ?? null,
      created,
      ts
    )

    db.prepare('DELETE FROM package_member WHERE package_id = ?').run(id)
    const ins = db.prepare(
      `INSERT INTO package_member
        (id, package_id, path, name, kind, format, nested_archive_path, nested_archive_format,
         content, schema_id, verified, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    doc.members.forEach((m, i) => {
      ins.run(
        m.id || randomUUID(),
        id,
        m.path,
        m.name,
        m.kind,
        m.format ?? null,
        m.nestedArchivePath ?? null,
        m.nestedArchiveFormat ?? null,
        m.content ?? null,
        m.schemaId ?? null,
        m.verified ? 1 : 0,
        i
      )
    })
  })
  tx()
  return getPackage(id)!
}

export function deletePackage(id: string): boolean {
  ensurePackageTables()
  const info = getDb().prepare('DELETE FROM package_import WHERE id = ?').run(id)
  return info.changes > 0
}

export function setMemberVerified(packageId: string, memberPath: string, verified: boolean): void {
  ensurePackageTables()
  getDb()
    .prepare(
      `UPDATE package_member SET verified = ? WHERE package_id = ? AND path = ?`
    )
    .run(verified ? 1 : 0, packageId, memberPath)
}

export function updateMemberSchema(
  packageId: string,
  memberPath: string,
  schema: SchemaDoc
): SchemaDoc {
  ensurePackageTables()
  const saved = saveSchema(schema)
  getDb()
    .prepare(
      `UPDATE package_member SET schema_id = ? WHERE package_id = ? AND path = ?`
    )
    .run(saved.id, packageId, memberPath)
  return saved
}
