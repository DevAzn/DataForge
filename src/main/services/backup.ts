import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { dialog } from 'electron'
import type { ExportFormat, SchemaRow, SchemaTreePayload } from '../../shared/types'
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
import { listHistoryForBackup, recordMany } from '../db/history'

const BACKUP_VERSION = 2

function encodeSchemaTree(s: {
  root: unknown
  sourceFileName?: string
  sourceFilePath?: string
  sourceFormat?: ExportFormat
  csvTiedFieldPaths?: string[]
}): string {
  const root = Array.isArray(s.root) ? (s.root as SchemaRow[]) : []
  const payload: SchemaTreePayload = {
    root,
    sourceFileName: s.sourceFileName,
    sourceFilePath: s.sourceFilePath,
    sourceFormat: s.sourceFormat,
    csvTiedFieldPaths: s.csvTiedFieldPaths
  }
  return JSON.stringify(payload)
}

export async function exportBackup(): Promise<{ canceled: boolean; filePath?: string }> {
  const { dbPath, cachePath } = getPaths()
  flushUserCache()

  const result = await dialog.showSaveDialog({
    title: 'Export DataForge backup',
    defaultPath: `DataForge-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'DataForge Backup', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const history = listHistoryForBackup(50_000)
  const payload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    schemas: listSchemas(),
    templates: listTemplates(),
    history,
    historyCount: history.length,
    note:
      'JSON backup includes settings, schemas (with csvTiedFieldPaths + source meta), templates, ' +
      'and up to 50k recent history rows. A side .sqlite.bak is a full binary DB copy when present.',
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
    version?: number
    settings?: unknown
    schemas?: Array<{
      id: string
      name: string
      description?: string
      root: unknown
      sourceFileName?: string
      sourceFilePath?: string
      sourceFormat?: ExportFormat
      csvTiedFieldPaths?: string[]
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
    history?: Array<{
      categoryName?: string
      keyName?: string
      value?: string
      categoryId?: string
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
      // Prefer full SchemaTreePayload so ties + source meta survive (v2 + fixed v1 imports)
      const treeJson = encodeSchemaTree({
        root: s.root,
        sourceFileName: s.sourceFileName,
        sourceFilePath: s.sourceFilePath,
        sourceFormat: s.sourceFormat,
        csvTiedFieldPaths: s.csvTiedFieldPaths
      })
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
        tree_json: treeJson,
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

  // History restore outside nested transaction concerns — ensure mode, no use_count spam
  const historyInputs = (payload.history ?? [])
    .map((h) => {
      const categoryName = (h.categoryName || h.keyName || '').trim()
      const keyName = (h.keyName || h.categoryName || '').trim()
      const value = (h.value || '').trim()
      if (!categoryName || !keyName || !value) return null
      return { categoryName, keyName, value }
    })
    .filter((x): x is { categoryName: string; keyName: string; value: string } => x != null)

  if (historyInputs.length > 0) {
    const n = recordMany(historyInputs, 'ensure')
    imported += n
  }

  writeUserCache()
  return { canceled: false, imported }
}

export function cacheExists(): boolean {
  return existsSync(getPaths().cachePath)
}
