import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { dialog } from 'electron'
import {
  getDb,
  getPaths,
  listSchemas,
  listTemplates,
  getSettings,
  flushUserCache,
  writeUserCache,
  initDatabase
} from '../db/database'
import { listRecentHistory } from '../db/history'

export async function exportBackup(): Promise<{ canceled: boolean; filePath?: string }> {
  const { dbPath, cachePath } = getPaths()
  flushUserCache()

  const result = await dialog.showSaveDialog({
    title: 'Export DataForge backup',
    defaultPath: `DataForge-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'DataForge Backup', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    schemas: listSchemas(),
    templates: listTemplates(),
    history: listRecentHistory(5000),
    // Paths only — user may also copy sqlite manually
    note: 'SQLite file can be copied separately for a full binary backup.',
    dbFileName: basename(dbPath),
    cacheFileName: basename(cachePath)
  }
  writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')

  // Also copy sqlite next to backup if possible
  try {
    const sideDb = join(dirname(result.filePath), basename(dbPath) + '.bak')
    copyFileSync(dbPath, sideDb)
  } catch {
    /* optional */
  }

  return { canceled: false, filePath: result.filePath }
}

export async function importBackup(): Promise<{ canceled: boolean; imported?: number }> {
  const result = await dialog.showOpenDialog({
    title: 'Import DataForge backup',
    filters: [{ name: 'DataForge Backup', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  const raw = readFileSync(result.filePaths[0], 'utf-8')
  const payload = JSON.parse(raw) as {
    settings?: unknown
    schemas?: Array<{
      id: string
      name: string
      description?: string
      root: unknown
      createdAt: string
      updatedAt: string
      lastOpenedAt?: string
    }>
    templates?: Array<{
      id: string
      name: string
      description?: string
      schemaJson: string
      sampleDataJson?: string
      createdAt: string
      updatedAt: string
    }>
  }

  initDatabase()
  const db = getDb()
  let imported = 0

  const tx = db.transaction(() => {
    if (payload.settings) {
      db.prepare(
        `INSERT INTO settings (key, value_json) VALUES ('app', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      ).run(JSON.stringify(payload.settings))
    }

    for (const s of payload.schemas ?? []) {
      db.prepare(
        `INSERT INTO schema_meta (id, name, description, tree_json, created_at, updated_at, last_opened_at)
         VALUES (@id, @name, @description, @tree_json, @created_at, @updated_at, @last_opened_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           tree_json = excluded.tree_json,
           updated_at = excluded.updated_at,
           last_opened_at = excluded.last_opened_at`
      ).run({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        tree_json: JSON.stringify(s.root),
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        last_opened_at: s.lastOpenedAt ?? null
      })
      imported++
    }

    for (const t of payload.templates ?? []) {
      db.prepare(
        `INSERT INTO templates (id, name, description, schema_json, sample_data_json, created_at, updated_at)
         VALUES (@id, @name, @description, @schema_json, @sample_data_json, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           schema_json = excluded.schema_json,
           sample_data_json = excluded.sample_data_json,
           updated_at = excluded.updated_at`
      ).run({
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        schema_json: t.schemaJson,
        sample_data_json: t.sampleDataJson ?? null,
        created_at: t.createdAt,
        updated_at: t.updatedAt
      })
      imported++
    }
  })
  tx()
  writeUserCache()
  return { canceled: false, imported }
}

export function cacheExists(): boolean {
  return existsSync(getPaths().cachePath)
}
