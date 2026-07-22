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

/** All value-leaf paths in a schema tree (dot notation). */
export function listLeafFieldPaths(rows: SchemaRow[], parentPath: string[] = []): string[] {
  const out: string[] = []
  for (const row of rows) {
    const leaf = (row.key || 'field').trim() || 'field'
    if (row.kind === 'value') {
      out.push([...parentPath, leaf].join('.'))
    } else if (row.children.length) {
      out.push(...listLeafFieldPaths(row.children, [...parentPath, leaf]))
    }
  }
  return out
}

export function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) return undefined
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined
    }
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** Deep-set path on a plain object tree (creates intermediate objects). */
export function setValueAtPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split('.').filter(Boolean)
  if (parts.length === 0) return
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    const next = cur[p]
    if (next === null || next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      cur[p] = {}
    }
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

/**
 * Copy selected leaf paths from `source` onto `target` (mutates and returns target).
 * Used so multi-row CSV can keep parent keys constant while other fields vary.
 * Skips paths missing on the source (undefined) so a partial first row cannot
 * blank columns on later rows. Explicit `null` is still copied.
 */
export function applyTiedFieldPaths(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  paths: string[]
): Record<string, unknown> {
  for (const path of paths) {
    const p = path.trim()
    if (!p) continue
    if (!pathExistsOnObject(source, p)) continue
    setValueAtPath(target, p, getValueAtPath(source, p))
  }
  return target
}

/** Coerce schema sample text the same way the builder/preview treats samples. */
export function coerceSampleValue(sampleValue: string): unknown {
  const s = sampleValue.trim()
  if (s === '') return ''
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  // Prefer plain numbers when the whole sample is numeric
  if (/^-?\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isSafeInteger(n)) return n
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return sampleValue
}

/**
 * Build a partial record of constant values for CSV “tie keys” from schema
 * sampleValue fields. Paths not present (empty sample) are omitted so the
 * generator can fill them once from the first generated row.
 */
export function buildTiedTemplateFromSchema(
  root: SchemaRow[],
  tiedPaths: string[]
): Record<string, unknown> {
  const want = new Set(
    tiedPaths.map((p) => p.trim().toLowerCase()).filter(Boolean)
  )
  if (want.size === 0) return {}

  const template: Record<string, unknown> = {}

  function walk(rows: SchemaRow[], parentPath: string[]): void {
    for (const row of rows) {
      const leaf = (row.key || 'field').trim() || 'field'
      const fullPath = [...parentPath, leaf]
      const pathKey = fullPath.join('.')
      if (row.kind === 'value') {
        if (want.has(pathKey.toLowerCase())) {
          const raw = row.sampleValue
          if (raw !== undefined && String(raw).length > 0) {
            setValueAtPath(template, pathKey, coerceSampleValue(String(raw)))
          }
        }
      } else if (row.children.length) {
        walk(row.children, fullPath)
      }
    }
  }

  walk(root, [])
  return template
}

/**
 * For tied paths missing on the template, copy values from `record` into template.
 * Used so the first generated row can fill blanks when schema samples are empty.
 */
export function mergeMissingTiedPaths(
  template: Record<string, unknown>,
  record: Record<string, unknown>,
  paths: string[]
): void {
  for (const path of paths) {
    const p = path.trim()
    if (!p) continue
    if (pathExistsOnObject(template, p)) continue
    if (!pathExistsOnObject(record, p)) continue
    setValueAtPath(template, p, getValueAtPath(record, p))
  }
}

/** True if every segment of `path` exists on `obj` (value may be null). */
export function pathExistsOnObject(obj: unknown, path: string): boolean {
  if (!path || obj === null || obj === undefined) return false
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) {
      return false
    }
    const rec = cur as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(rec, p)) return false
    cur = rec[p]
  }
  return true
}
