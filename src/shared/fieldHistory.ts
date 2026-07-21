import type { SchemaRow } from './types'

/**
 * Dot-path identity for a field (parent keys + leaf).
 * Root `name` → "name"; nested under building → "building.name"
 */
export function fieldPathKey(path: string[], row: SchemaRow): string {
  const leaf = (row.key || 'field').trim() || 'field'
  const parts = [...path.map((p) => p.trim()).filter(Boolean), leaf]
  return parts.join('.')
}

/**
 * Where values are WRITTEN for this field (generation, sample harvest).
 * - historyPool set → "pool:{name}" so multiple fields intentionally share one bank
 * - else path key, optionally namespaced by categoryOverride
 */
export function fieldHistoryWriteKey(path: string[], row: SchemaRow): string {
  const pool = row.historyPool?.trim()
  if (pool) return `pool:${pool}`

  const pathKey = fieldPathKey(path, row)
  const leaf = (row.key || 'field').trim() || 'field'
  const override = row.categoryOverride?.trim()
  // Override namespaces the field; it does NOT pool unrelated keys together
  if (override && override.toLowerCase() !== leaf.toLowerCase()) {
    return `${override}/${pathKey}`
  }
  return pathKey
}

/**
 * History keys to READ for generation / autocomplete.
 * Always includes the write key and the natural path (so import values still apply).
 * Plus any explicit historySourceKeys the user mapped in Properties.
 */
export function fieldHistoryReadKeys(path: string[], row: SchemaRow): string[] {
  const writeKey = fieldHistoryWriteKey(path, row)
  const pathKey = fieldPathKey(path, row)
  const mapped = (row.historySourceKeys ?? [])
    .map((k) => k.trim())
    .filter(Boolean)

  const ordered: string[] = []
  const seen = new Set<string>()
  for (const k of [writeKey, pathKey, ...mapped]) {
    const key = k.trim()
    if (!key) continue
    const norm = key.toLowerCase()
    if (seen.has(norm)) continue
    seen.add(norm)
    ordered.push(key)
  }
  return ordered
}

/** @deprecated use fieldHistoryWriteKey — alias for call sites */
export function fieldHistoryKey(path: string[], row: SchemaRow): string {
  return fieldHistoryWriteKey(path, row)
}
