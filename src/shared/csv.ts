import type { CsvLayoutMode } from './types'

export interface CsvFormatOptions {
  csvFlattenDelimiter?: string
  csvNestedAsJson?: boolean
  csvLayoutMode?: CsvLayoutMode
  csvMultiRow?: boolean
}

/** Pure CSV serializer (main process + renderer preview). */
export function serializeCsv(data: unknown, options: CsvFormatOptions = {}): string {
  const multiRow = options.csvMultiRow !== false
  const mode: CsvLayoutMode = options.csvLayoutMode ?? 'single-header'
  const delim = options.csvFlattenDelimiter ?? '.'
  const nestedAsJson = options.csvNestedAsJson ?? false
  const records = normalizeToRecordList(data, multiRow)

  switch (mode) {
    case 'entity-sections':
      return toCsvEntitySections(records, delim, nestedAsJson)
    case 'per-key-sections':
      return toCsvPerKeySections(records, delim, nestedAsJson)
    case 'single-header':
    default:
      return toCsvSingleHeader(records, delim, nestedAsJson)
  }
}

function normalizeToRecordList(data: unknown, multiRow: boolean): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    const rows = data.map((item) =>
      typeof item === 'object' && item !== null && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item as unknown }
    )
    if (!multiRow && rows.length > 0) return [rows[0]]
    return rows
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return [data as Record<string, unknown>]
  }
  return [{ value: data as unknown }]
}

function toCsvSingleHeader(
  records: Record<string, unknown>[],
  delim: string,
  nestedAsJson: boolean
): string {
  if (records.length === 0) return ''
  const keySet = new Set<string>()
  const flatRows = records.map((row) => flattenObject(row, delim, nestedAsJson, keySet))
  const headers = Array.from(keySet)
  const lines = [headers.map(csvEscape).join(',')]
  for (const flat of flatRows) {
    lines.push(headers.map((h) => csvEscape(flat[h] ?? '')).join(','))
  }
  return lines.join('\n')
}

function toCsvEntitySections(
  records: Record<string, unknown>[],
  delim: string,
  nestedAsJson: boolean
): string {
  const buckets = new Map<string, Record<string, string>[]>()
  for (const rec of records) {
    collectEntities(rec, 'root', buckets, delim, nestedAsJson)
  }
  if (buckets.size === 0) return ''

  const blocks: string[] = []
  for (const [entity, rows] of Array.from(buckets.entries())) {
    if (rows.length === 0) continue
    const keySet = new Set<string>()
    for (const r of rows) {
      for (const k of Object.keys(r)) keySet.add(k)
    }
    const headers = Array.from(keySet)
    const lines = [`# entity: ${entity}`, headers.map(csvEscape).join(',')]
    for (const r of rows) {
      lines.push(headers.map((h) => csvEscape(r[h] ?? '')).join(','))
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function collectEntities(
  obj: Record<string, unknown>,
  entityName: string,
  buckets: Map<string, Record<string, string>[]>,
  delim: string,
  nestedAsJson: boolean
): void {
  const scalarRow: Record<string, string> = {}
  const childObjects: Array<{ name: string; value: Record<string, unknown> }> = []
  const childArrays: Array<{ name: string; items: unknown[] }> = []

  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) childArrays.push({ name: k, items: v })
      else childObjects.push({ name: k, value: v as Record<string, unknown> })
    } else {
      scalarRow[k] = v === null || v === undefined ? '' : String(v)
    }
  }

  if (nestedAsJson) {
    for (const child of childObjects) {
      scalarRow[child.name] = JSON.stringify(child.value)
    }
  }

  if (Object.keys(scalarRow).length > 0) {
    if (!buckets.has(entityName)) buckets.set(entityName, [])
    buckets.get(entityName)!.push(scalarRow)
  }

  if (!nestedAsJson) {
    for (const child of childObjects) {
      const childEntity =
        entityName === 'root' ? child.name : `${entityName}${delim}${child.name}`
      collectEntities(child.value, childEntity, buckets, delim, nestedAsJson)
    }
  }

  for (const arr of childArrays) {
    const childEntity =
      entityName === 'root' ? arr.name : `${entityName}${delim}${arr.name}`
    if (nestedAsJson) {
      if (!buckets.has(entityName)) buckets.set(entityName, [])
      const parentRows = buckets.get(entityName)!
      const target =
        parentRows.length > 0
          ? parentRows[parentRows.length - 1]
          : (() => {
              const empty: Record<string, string> = {}
              parentRows.push(empty)
              return empty
            })()
      target[arr.name] = JSON.stringify(arr.items)
      continue
    }
    for (const item of arr.items) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        collectEntities(
          item as Record<string, unknown>,
          childEntity,
          buckets,
          delim,
          nestedAsJson
        )
      } else {
        if (!buckets.has(childEntity)) buckets.set(childEntity, [])
        buckets.get(childEntity)!.push({
          value: item === null || item === undefined ? '' : String(item)
        })
      }
    }
  }
}

function toCsvPerKeySections(
  records: Record<string, unknown>[],
  delim: string,
  nestedAsJson: boolean
): string {
  if (records.length === 0) return ''
  const keySet = new Set<string>()
  const flatRows = records.map((row) => flattenObject(row, delim, nestedAsJson, keySet))
  const headers = Array.from(keySet)
  const blocks: string[] = []
  for (const key of headers) {
    const lines = [csvEscape(key)]
    for (const row of flatRows) {
      lines.push(csvEscape(row[key] ?? ''))
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** Flatten one record for CSV (used by bulk serialize + stream generate). */
export function flattenRecord(
  obj: Record<string, unknown>,
  delim = '.',
  nestedAsJson = false
): Record<string, string> {
  const keySet = new Set<string>()
  return flattenObject(obj, delim, nestedAsJson, keySet)
}

export function formatCsvHeaderLine(headers: string[]): string {
  return headers.map(csvEscape).join(',')
}

export function formatCsvDataLine(flat: Record<string, string>, headers: string[]): string {
  return headers.map((h) => csvEscape(flat[h] ?? '')).join(',')
}

/**
 * Column headers derived from schema so streaming CSV can write the header once
 * without scanning all rows. Array fields expand to maxArraySlots indexes
 * (matches generator max for one-to-many style nesting).
 */
export function headersFromSchema(
  root: { key: string; kind: string; children: unknown[] }[],
  delim = '.',
  nestedAsJson = false,
  maxArraySlots = 4
): string[] {
  const keys: string[] = []
  const seen = new Set<string>()

  function add(k: string): void {
    if (!k || seen.has(k)) return
    seen.add(k)
    keys.push(k)
  }

  function walk(
    rows: Array<{ key: string; kind: string; children: unknown[] }>,
    prefix: string
  ): void {
    for (const row of rows) {
      const leaf = (row.key || 'field').trim() || 'field'
      const key = prefix ? `${prefix}${delim}${leaf}` : leaf
      const kids = (row.children || []) as Array<{
        key: string
        kind: string
        children: unknown[]
      }>

      if (row.kind === 'array') {
        if (nestedAsJson || kids.length === 0) {
          add(key)
        } else {
          for (let i = 0; i < maxArraySlots; i++) {
            if (kids.length === 1 && kids[0].kind === 'value') {
              add(`${key}${delim}${i}`)
            } else {
              walk(kids, `${key}${delim}${i}`)
            }
          }
        }
      } else if (row.kind === 'object' || kids.length > 0) {
        if (nestedAsJson) {
          add(key)
        } else {
          walk(kids, key)
        }
      } else {
        add(key)
      }
    }
  }

  walk(root as Array<{ key: string; kind: string; children: unknown[] }>, '')
  return keys
}

function flattenObject(
  obj: Record<string, unknown>,
  delim: string,
  nestedAsJson: boolean,
  keySet: Set<string>,
  prefix = ''
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}${delim}${k}` : k
    if (v !== null && typeof v === 'object') {
      if (nestedAsJson) {
        keySet.add(key)
        out[key] = JSON.stringify(v)
      } else if (Array.isArray(v)) {
        if (
          v.length > 0 &&
          typeof v[0] === 'object' &&
          v[0] !== null &&
          !Array.isArray(v[0])
        ) {
          v.forEach((item, i) => {
            Object.assign(
              out,
              flattenObject(
                item as Record<string, unknown>,
                delim,
                nestedAsJson,
                keySet,
                `${key}${delim}${i}`
              )
            )
          })
        } else {
          keySet.add(key)
          out[key] = JSON.stringify(v)
        }
      } else {
        Object.assign(
          out,
          flattenObject(v as Record<string, unknown>, delim, nestedAsJson, keySet, key)
        )
      }
    } else {
      keySet.add(key)
      out[key] = v === null || v === undefined ? '' : String(v)
    }
  }
  return out
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
