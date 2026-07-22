import { randomUUID } from 'crypto'
import type {
  Category,
  ClearHistoryRequest,
  ClearHistoryResult,
  DeleteHistoryResult,
  HistoryRecordInput,
  HistorySuggestQuery,
  SchemaRow,
  UpdateHistoryEntryRequest,
  ValueHistoryEntry
} from '../../shared/types'
import {
  fieldHistoryKey,
  fieldHistoryReadKeys,
  fieldHistoryWriteKey
} from '../../shared/fieldHistory'
import { getDb, writeUserCache } from './database'

export { fieldHistoryKey, fieldHistoryReadKeys, fieldHistoryWriteKey }

function nowIso(): string {
  return new Date().toISOString()
}

export function ensureCategory(name: string, sourceKey?: string): Category {
  const trimmed = name.trim() || 'uncategorized'
  const existing = getDb()
    .prepare('SELECT id, name, source_key, created_at FROM categories WHERE name = ? COLLATE NOCASE')
    .get(trimmed) as
    | { id: string; name: string; source_key: string | null; created_at: string }
    | undefined

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      sourceKey: existing.source_key ?? undefined,
      createdAt: existing.created_at
    }
  }

  const cat: Category = {
    id: randomUUID(),
    name: trimmed,
    sourceKey,
    createdAt: nowIso()
  }
  getDb()
    .prepare(
      'INSERT INTO categories (id, name, source_key, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(cat.id, cat.name, sourceKey ?? null, cat.createdAt)
  return cat
}

export type RecordValueMode = 'use' | 'ensure'

/**
 * @param mode `use` — generation/user use: bump use_count (default).
 *             `ensure` — import/sample upsert: insert if missing, never bump counts.
 */
export function recordValue(
  input: HistoryRecordInput,
  mode: RecordValueMode = 'use'
): ValueHistoryEntry | null {
  const value = input.value?.trim()
  if (!value) return null

  const cat = ensureCategory(input.categoryName, input.sourceKey ?? input.keyName)
  const ts = nowIso()

  const existing = getDb()
    .prepare(
      `SELECT id, category_id, key_name, value, use_count, last_used_at, created_at
       FROM value_history
       WHERE category_id = ? AND key_name = ? AND value = ?`
    )
    .get(cat.id, input.keyName, value) as
    | {
        id: string
        category_id: string
        key_name: string
        value: string
        use_count: number
        last_used_at: string
        created_at: string
      }
    | undefined

  if (existing) {
    if (mode === 'ensure') {
      return {
        id: existing.id,
        categoryId: existing.category_id,
        keyName: existing.key_name,
        value: existing.value,
        useCount: existing.use_count,
        lastUsedAt: existing.last_used_at,
        createdAt: existing.created_at
      }
    }
    getDb()
      .prepare(
        `UPDATE value_history SET use_count = use_count + 1, last_used_at = ? WHERE id = ?`
      )
      .run(ts, existing.id)
    return {
      id: existing.id,
      categoryId: existing.category_id,
      keyName: existing.key_name,
      value: existing.value,
      useCount: existing.use_count + 1,
      lastUsedAt: ts,
      createdAt: existing.created_at
    }
  }

  const entry: ValueHistoryEntry = {
    id: randomUUID(),
    categoryId: cat.id,
    keyName: input.keyName,
    value,
    useCount: 1,
    lastUsedAt: ts,
    createdAt: ts
  }
  getDb()
    .prepare(
      `INSERT INTO value_history
        (id, category_id, key_name, value, use_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
    .run(entry.id, entry.categoryId, entry.keyName, entry.value, ts, ts)
  return entry
}

export function recordMany(
  inputs: HistoryRecordInput[],
  mode: RecordValueMode = 'use'
): number {
  let n = 0
  const tx = getDb().transaction((items: HistoryRecordInput[]) => {
    for (const item of items) {
      if (recordValue(item, mode)) n++
    }
  })
  tx(inputs)
  writeUserCache()
  return n
}

/** Remove categories that no longer have any value_history rows. */
export function pruneOrphanCategories(): number {
  const info = getDb()
    .prepare(
      `DELETE FROM categories
       WHERE id NOT IN (SELECT DISTINCT category_id FROM value_history WHERE category_id IS NOT NULL)`
    )
    .run()
  return info.changes
}

export function suggestValues(query: HistorySuggestQuery): ValueHistoryEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  const prefix = query.prefix?.trim() ?? ''
  const keyName = query.keyName?.trim()
  const categoryName = query.categoryName?.trim()

  let sql = `
    SELECT vh.id, vh.category_id, vh.key_name, vh.value, vh.use_count, vh.last_used_at, vh.created_at
    FROM value_history vh
    LEFT JOIN categories c ON c.id = vh.category_id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (categoryName) {
    sql += ' AND c.name = ? COLLATE NOCASE'
    params.push(categoryName)
  }
  if (keyName) {
    sql += ' AND vh.key_name = ? COLLATE NOCASE'
    params.push(keyName)
  }
  if (prefix) {
    // Escape LIKE wildcards so user typing is literal
    const esc = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    sql += ` AND vh.value LIKE ? ESCAPE '\\'`
    params.push(`${esc}%`)
  }

  sql += ' ORDER BY vh.use_count DESC, vh.last_used_at DESC LIMIT ?'
  params.push(limit)

  const rows = getDb().prepare(sql).all(...params) as Array<{
    id: string
    category_id: string
    key_name: string
    value: string
    use_count: number
    last_used_at: string
    created_at: string
  }>

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    keyName: r.key_name,
    value: r.value,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at
  }))
}

type HistoryRow = {
  id: string
  category_id: string
  key_name: string
  value: string
  use_count: number
  last_used_at: string
  created_at: string
  category_name: string | null
}

function mapHistoryRow(r: HistoryRow): ValueHistoryEntry & { categoryName: string } {
  return {
    id: r.id,
    categoryId: r.category_id,
    keyName: r.key_name,
    value: r.value,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    categoryName: r.category_name ?? 'uncategorized'
  }
}

export function listRecentHistory(limit = 50): Array<ValueHistoryEntry & { categoryName: string }> {
  const rows = getDb()
    .prepare(
      `SELECT vh.id, vh.category_id, vh.key_name, vh.value, vh.use_count, vh.last_used_at, vh.created_at,
              c.name as category_name
       FROM value_history vh
       LEFT JOIN categories c ON c.id = vh.category_id
       ORDER BY vh.last_used_at DESC
       LIMIT ?`
    )
    .all(Math.min(Math.max(limit, 1), 200)) as HistoryRow[]

  return rows.map(mapHistoryRow)
}

/**
 * Export a large history snapshot for JSON backup (not capped at 200).
 * Ordered by last_used_at DESC. Soft cap prevents multi-GB JSON.
 */
export function listHistoryForBackup(
  maxRows = 50_000
): Array<ValueHistoryEntry & { categoryName: string }> {
  const limit = Math.min(Math.max(Math.floor(maxRows) || 1, 1), 200_000)
  const rows = getDb()
    .prepare(
      `SELECT vh.id, vh.category_id, vh.key_name, vh.value, vh.use_count, vh.last_used_at, vh.created_at,
              c.name as category_name
       FROM value_history vh
       LEFT JOIN categories c ON c.id = vh.category_id
       ORDER BY vh.last_used_at DESC
       LIMIT ?`
    )
    .all(limit) as HistoryRow[]

  return rows.map(mapHistoryRow)
}

export interface HistoryPageQuery {
  offset?: number
  limit?: number
  search?: string
}

export interface HistoryPageResult {
  items: Array<ValueHistoryEntry & { categoryName: string }>
  total: number
  offset: number
  limit: number
}

/**
 * Paged history for virtualized UI over large DBs.
 * Uses LIMIT/OFFSET + optional search on key_name / value / category.
 */
/** Escape LIKE wildcards so user search is literal. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function listHistoryPage(query: HistoryPageQuery = {}): HistoryPageResult {
  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 500)
  const search = query.search?.trim() ?? ''

  let where = ''
  const params: unknown[] = []
  if (search) {
    where = `WHERE (
      vh.key_name LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR vh.value LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR c.name LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`
    const like = `%${escapeLike(search)}%`
    params.push(like, like, like)
  }

  const db = getDb()

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM value_history vh
       LEFT JOIN categories c ON c.id = vh.category_id
       ${where}`
    )
    .get(...params) as { c: number }

  const total = typeof totalRow?.c === 'number' ? totalRow.c : 0

  // Past end (or empty table): return empty page, never remap to page 0
  if (total === 0 || offset >= total) {
    return { items: [], total, offset, limit }
  }

  const rows = db
    .prepare(
      `SELECT vh.id, vh.category_id, vh.key_name, vh.value, vh.use_count, vh.last_used_at, vh.created_at,
              c.name as category_name
       FROM value_history vh
       LEFT JOIN categories c ON c.id = vh.category_id
       ${where}
       ORDER BY vh.last_used_at DESC, vh.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as HistoryRow[]

  return {
    items: rows.map(mapHistoryRow),
    total,
    offset,
    limit
  }
}

/** Ensure indexes that keep large history tables fast. */
export function ensureHistoryIndexes(): void {
  const db = getDb()
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_value_history_last_used
      ON value_history(last_used_at DESC);
    CREATE INDEX IF NOT EXISTS idx_value_history_key_name
      ON value_history(key_name);
  `)
}

/**
 * Build WHERE clause for time-based history clear (by last_used_at).
 * age "newer" = on/after cutoff; age "older" = on/before cutoff.
 */
function clearHistoryWhere(
  request: ClearHistoryRequest
): { sql: string; params: unknown[] } {
  if (request.mode === 'all') {
    return { sql: '', params: [] }
  }

  let cutoffIso: string
  let age = request.age

  if (request.mode === 'days' || request.mode === 'lastDays') {
    const days = Math.floor(Number(request.days))
    if (!Number.isFinite(days) || days < 1) {
      throw new Error('Enter how many days (1 or more).')
    }
    if (days > 36500) {
      throw new Error('Days value is too large (max ~100 years).')
    }
    cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString()
    age = age ?? 'newer'
  } else if (request.mode === 'datetime' || request.mode === 'before') {
    const raw = request.beforeIso?.trim()
    if (!raw) {
      throw new Error('Pick a date/time for the cutoff.')
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid date/time cutoff.')
    }
    cutoffIso = d.toISOString()
    age = age ?? 'older'
  } else {
    throw new Error('Unknown clear history mode.')
  }

  if (age === 'newer') {
    // On or after cutoff (recent side) — exclusive of older-only boundary
    return { sql: 'WHERE last_used_at >= ?', params: [cutoffIso] }
  }
  if (age === 'older') {
    // Strictly before cutoff so the same instant is not deleted by both modes
    return { sql: 'WHERE last_used_at < ?', params: [cutoffIso] }
  }
  throw new Error('Choose whether to delete older or newer history.')
}

/** Count how many history rows would be deleted for a clear request. */
export function countHistoryClear(request: ClearHistoryRequest): number {
  if (request.mode === 'all') {
    const row = getDb().prepare('SELECT COUNT(*) as c FROM value_history').get() as {
      c: number
    }
    return row?.c ?? 0
  }
  const { sql, params } = clearHistoryWhere(request)
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM value_history ${sql}`)
    .get(...params) as { c: number }
  return row?.c ?? 0
}

/**
 * Delete value_history rows by time scope.
 * - all: entire history (requires confirmAll)
 * - days: cutoff = now − N days; age newer|older chooses which side to delete
 * - datetime: cutoff = beforeIso; age newer|older chooses which side to delete
 * Legacy mode names lastDays / before are still accepted.
 */
export function clearHistory(request: ClearHistoryRequest): ClearHistoryResult {
  if (request.mode === 'all' && !request.confirmAll) {
    throw new Error('All-time clear requires confirmation.')
  }

  const db = getDb()
  let deleted = 0
  const normalizedMode =
    request.mode === 'lastDays'
      ? 'days'
      : request.mode === 'before'
        ? 'datetime'
        : request.mode

  if (normalizedMode === 'all') {
    const info = db.prepare('DELETE FROM value_history').run()
    deleted = info.changes
  } else {
    const { sql, params } = clearHistoryWhere(request)
    const info = db.prepare(`DELETE FROM value_history ${sql}`).run(...params)
    deleted = info.changes
  }

  const orphans = pruneOrphanCategories()
  writeUserCache()
  logInteraction('history_clear', {
    mode: normalizedMode,
    age: request.age,
    days: request.days,
    beforeIso: request.beforeIso,
    deleted,
    orphanCategoriesRemoved: orphans
  })

  return { deleted, mode: normalizedMode }
}

/** Delete one or more history rows by id. */
export function deleteHistoryEntries(ids: string[]): DeleteHistoryResult {
  const unique = Array.from(
    new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
  )
  if (unique.length === 0) return { deleted: 0 }

  const db = getDb()
  const stmt = db.prepare('DELETE FROM value_history WHERE id = ?')
  const tx = db.transaction((list: string[]) => {
    let n = 0
    for (const id of list) {
      n += stmt.run(id).changes
    }
    return n
  })
  const deleted = tx(unique)
  pruneOrphanCategories()
  writeUserCache()
  logInteraction('history_delete', { deleted, ids: unique.slice(0, 50) })
  return { deleted }
}

/**
 * Correct a history value in place. If the new text already exists for the same
 * category+key, merges use counts into the existing row and removes the old one.
 */
export function updateHistoryEntry(
  request: UpdateHistoryEntryRequest
): ValueHistoryEntry | null {
  const id = request.id?.trim()
  const value = request.value?.trim()
  if (!id) throw new Error('Missing history entry id.')
  if (!value) throw new Error('Value cannot be empty.')

  const db = getDb()
  const existing = db
    .prepare(
      `SELECT id, category_id, key_name, value, use_count, last_used_at, created_at
       FROM value_history WHERE id = ?`
    )
    .get(id) as
    | {
        id: string
        category_id: string
        key_name: string
        value: string
        use_count: number
        last_used_at: string
        created_at: string
      }
    | undefined

  if (!existing) return null

  if (existing.value === value) {
    return {
      id: existing.id,
      categoryId: existing.category_id,
      keyName: existing.key_name,
      value: existing.value,
      useCount: existing.use_count,
      lastUsedAt: existing.last_used_at,
      createdAt: existing.created_at
    }
  }

  const twin = db
    .prepare(
      `SELECT id, category_id, key_name, value, use_count, last_used_at, created_at
       FROM value_history
       WHERE category_id = ? AND key_name = ? AND value = ? AND id != ?`
    )
    .get(existing.category_id, existing.key_name, value, id) as
    | {
        id: string
        category_id: string
        key_name: string
        value: string
        use_count: number
        last_used_at: string
        created_at: string
      }
    | undefined

  const ts = nowIso()

  if (twin) {
    // Merge into existing twin, drop the edited row
    db.prepare(
      `UPDATE value_history
       SET use_count = use_count + ?, last_used_at = ?
       WHERE id = ?`
    ).run(existing.use_count, ts, twin.id)
    db.prepare('DELETE FROM value_history WHERE id = ?').run(id)
    writeUserCache()
    logInteraction('history_update_merge', { fromId: id, toId: twin.id, value })
    return {
      id: twin.id,
      categoryId: twin.category_id,
      keyName: twin.key_name,
      value: twin.value,
      useCount: twin.use_count + existing.use_count,
      lastUsedAt: ts,
      createdAt: twin.created_at
    }
  }

  db.prepare(
    `UPDATE value_history SET value = ?, last_used_at = ? WHERE id = ?`
  ).run(value, ts, id)
  writeUserCache()
  logInteraction('history_update', { id, value })
  return {
    id: existing.id,
    categoryId: existing.category_id,
    keyName: existing.key_name,
    value,
    useCount: existing.use_count,
    lastUsedAt: ts,
    createdAt: existing.created_at
  }
}

/**
 * Delete all history rows matching the same search used by the virtual list
 * (key_name / value / category name substring).
 */
export function deleteHistoryMatching(search: string): DeleteHistoryResult {
  const q = search?.trim()
  if (!q) {
    throw new Error('Enter a search term before deleting matches.')
  }
  const like = `%${escapeLike(q)}%`
  const info = getDb()
    .prepare(
      `DELETE FROM value_history
       WHERE id IN (
         SELECT vh.id
         FROM value_history vh
         LEFT JOIN categories c ON c.id = vh.category_id
         WHERE vh.key_name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR vh.value LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR c.name LIKE ? ESCAPE '\\' COLLATE NOCASE
       )`
    )
    .run(like, like, like)

  pruneOrphanCategories()
  writeUserCache()
  logInteraction('history_delete_matching', { search: q, deleted: info.changes })
  return { deleted: info.changes }
}

export function getValuesForKey(categoryName: string, keyName: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT vh.value
       FROM value_history vh
       JOIN categories c ON c.id = vh.category_id
       WHERE c.name = ? COLLATE NOCASE AND vh.key_name = ? COLLATE NOCASE
       ORDER BY vh.use_count DESC, vh.last_used_at DESC
       LIMIT 500`
    )
    .all(categoryName, keyName) as Array<{ value: string }>
  return rows.map((r) => r.value)
}

/**
 * Values for one field only — scoped by field history key (path or pool).
 * Never merges across different keys unless caller passes multiple keys to getValuesForFields.
 */
export function getValuesForField(fieldKey: string): string[] {
  const key = fieldKey.trim()
  if (!key) return []
  const rows = getDb()
    .prepare(
      `SELECT vh.value
       FROM value_history vh
       JOIN categories c ON c.id = vh.category_id
       WHERE c.name = ? COLLATE NOCASE AND vh.key_name = ? COLLATE NOCASE
       ORDER BY vh.use_count DESC, vh.last_used_at DESC
       LIMIT 500`
    )
    .all(key, key) as Array<{ value: string }>
  return rows.map((r) => r.value)
}

/**
 * Merge values from multiple history keys (own path/pool + user-mapped sources).
 * Dedupes while preserving use-order preference from each key's ranking.
 */
export function getValuesForFields(fieldKeys: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of fieldKeys) {
    for (const v of getValuesForField(k)) {
      if (seen.has(v)) continue
      seen.add(v)
      out.push(v)
      if (out.length >= 500) return out
    }
  }
  return out
}

/** Distinct field keys seen in history (for key autocomplete). */
export function listDistinctKeys(prefix = '', limit = 30): string[] {
  const lim = Math.min(Math.max(limit, 1), 100)
  const p = prefix.trim()
  if (p) {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT vh.key_name as k
         FROM value_history vh
         WHERE vh.key_name LIKE ? COLLATE NOCASE
         ORDER BY vh.key_name
         LIMIT ?`
      )
      .all(`${p}%`, lim) as Array<{ k: string }>
    // Also strip path prefixes for nested keys: building.name → name when typing
    const set = new Set(rows.map((r) => r.k))
    const leafRows = getDb()
      .prepare(
        `SELECT DISTINCT vh.key_name as k FROM value_history vh LIMIT 500`
      )
      .all() as Array<{ k: string }>
    for (const r of leafRows) {
      const leaf = r.k.includes('.') ? r.k.split('.').pop()! : r.k
      if (leaf.toLowerCase().startsWith(p.toLowerCase())) set.add(leaf)
      if (r.k.toLowerCase().startsWith(p.toLowerCase())) set.add(r.k)
    }
    return Array.from(set).slice(0, lim)
  }
  const rows = getDb()
    .prepare(
      `SELECT vh.key_name as k, SUM(vh.use_count) as u
       FROM value_history vh
       GROUP BY vh.key_name
       ORDER BY u DESC
       LIMIT ?`
    )
    .all(lim) as Array<{ k: string }>
  return rows.map((r) => r.k)
}

export function logInteraction(type: string, payload: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO interactions (id, type, payload_json, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(randomUUID(), type, JSON.stringify(payload ?? {}), nowIso())
}

export function historyRecordForField(
  path: string[],
  row: SchemaRow,
  value: string
): HistoryRecordInput {
  const fieldKey = fieldHistoryWriteKey(path, row)
  return {
    // category + key both = fieldKey so lookups never cross fields by default
    categoryName: fieldKey,
    keyName: fieldKey,
    value,
    sourceKey: row.key || fieldKey
  }
}

/** Walk schema tree and collect sample values scoped per field path. */
export function harvestSchemaSamples(root: SchemaRow[]): HistoryRecordInput[] {
  const out: HistoryRecordInput[] = []

  function walk(rows: SchemaRow[], path: string[]): void {
    for (const row of rows) {
      if (row.kind === 'value' && row.sampleValue?.trim()) {
        out.push(historyRecordForField(path, row, row.sampleValue))
      }
      if (row.children.length) {
        const seg = (row.key || 'field').trim() || 'field'
        walk(row.children, [...path, seg])
      }
    }
  }

  walk(root, [])
  return out
}

/** @deprecated prefer fieldHistoryKey — kept for any residual callers */
export function categoryNameForRow(row: SchemaRow): string {
  return fieldHistoryKey([], row)
}
