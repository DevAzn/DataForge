import { randomUUID } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import YAML from 'yaml'
import type {
  ExportFormat,
  HistoryRecordInput,
  RowKind,
  SchemaDoc,
  SchemaRow
} from '../../shared/types'

export interface InferSchemaResult {
  schema: SchemaDoc
  format: ExportFormat
  recordHint: number
  /** Leaf values harvested from many records for SQLite value_history */
  historySamples: HistoryRecordInput[]
  /** How many source records were scanned for structure/values */
  scannedRecords: number
}

export interface InferSchemaOptions {
  /** Full filesystem path when known (Browse dialog) */
  sourceFilePath?: string
  /** Max records to scan for keys + history (default 500) */
  maxScanRecords?: number
  /** Max unique values stored per field path (default 200) */
  maxValuesPerField?: number
}

function newId(): string {
  return randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

function baseName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() || fileName
  return base.replace(/\.[^.]+$/, '') || 'Imported schema'
}

function detectFormat(fileName: string, text: string): ExportFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.txt') || lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    const t = text.trim()
    if (t.startsWith('{') || t.startsWith('[')) return 'json'
    if (t.includes(',') && t.includes('\n')) return 'csv'
    return 'txt'
  }
  // Sniff content
  const t = text.trim()
  if (t.startsWith('<')) return 'xml'
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  if (/^[\w.-]+:\s/m.test(t) && !t.includes(',')) return 'yaml'
  if (t.includes(',') && t.split('\n').length > 1) return 'csv'
  return 'txt'
}

function sampleToString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'object') return undefined
  return String(v)
}

function kindFromValue(v: unknown): RowKind {
  if (Array.isArray(v)) return 'array'
  if (v !== null && typeof v === 'object') return 'object'
  return 'value'
}

/**
 * Infer a SchemaRow tree from a JS value (typically first object of a dataset).
 */
export function inferRowsFromValue(value: unknown, key = 'root', sortOrder = 0): SchemaRow {
  if (Array.isArray(value)) {
    const first =
      value.find((x) => x !== null && typeof x === 'object') ?? value[0]
    if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
      const children = inferObjectChildren(first as Record<string, unknown>)
      return {
        id: newId(),
        key,
        kind: 'array',
        isPrimary: false,
        isUnique: false,
        relationship: 'one-to-many',
        children,
        sortOrder
      }
    }
    // Array of scalars
    return {
      id: newId(),
      key,
      kind: 'array',
      isPrimary: false,
      isUnique: false,
      relationship: 'one-to-many',
      children: [
        {
          id: newId(),
          key: 'item',
          kind: 'value',
          sampleValue: sampleToString(first),
          isPrimary: false,
          isUnique: false,
          children: [],
          sortOrder: 0
        }
      ],
      sortOrder
    }
  }

  if (value !== null && typeof value === 'object') {
    return {
      id: newId(),
      key,
      kind: 'object',
      isPrimary: false,
      isUnique: false,
      children: inferObjectChildren(value as Record<string, unknown>),
      sortOrder
    }
  }

  return {
    id: newId(),
    key,
    kind: 'value',
    sampleValue: sampleToString(value),
    isPrimary: false,
    isUnique: false,
    children: [],
    sortOrder
  }
}

function inferObjectChildren(obj: Record<string, unknown>): SchemaRow[] {
  return Object.entries(obj).map(([k, v], i) => {
    const kind = kindFromValue(v)
    if (kind === 'value') {
      return {
        id: newId(),
        key: k,
        kind: 'value' as const,
        sampleValue: sampleToString(v),
        isPrimary: /^(id|_id|.*_id|uuid|guid)$/i.test(k),
        isUnique: /^(id|_id|uuid|guid)$/i.test(k),
        children: [],
        sortOrder: i
      }
    }
    if (kind === 'array') {
      return inferRowsFromValue(v, k, i)
    }
    // object
    return {
      id: newId(),
      key: k,
      kind: 'object' as const,
      isPrimary: false,
      isUnique: false,
      children: inferObjectChildren(v as Record<string, unknown>),
      sortOrder: i
    }
  })
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
  if (lines.length === 0) return []

  const parseLine = (line: string): string[] => {
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else inQ = false
        } else cur += ch
      } else if (ch === '"') {
        inQ = true
      } else if (ch === ',') {
        cells.push(cur)
        cur = ''
      } else cur += ch
    }
    cells.push(cur)
    return cells
  }

  const headers = parseLine(lines[0]).map((h) => h.trim() || 'field')
  const rows: Record<string, unknown>[] = []
  for (let r = 1; r < lines.length; r++) {
    const cells = parseLine(lines[r])
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? ''
    })
    rows.push(obj)
  }
  // Header-only file: still invent empty samples
  if (rows.length === 0) {
    const obj: Record<string, unknown> = {}
    headers.forEach((h) => {
      obj[h] = ''
    })
    rows.push(obj)
  }
  return rows
}

function parseXml(text: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true
  })
  return parser.parse(text)
}

function unwrapRoot(data: unknown): { sample: unknown; recordHint: number } {
  if (Array.isArray(data)) {
    return {
      sample: data[0] ?? {},
      recordHint: data.length
    }
  }
  // NDJSON
  return { sample: data ?? {}, recordHint: 1 }
}

function parseNdjson(text: string): unknown[] {
  const rows: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t))
    } catch {
      /* skip bad lines */
    }
  }
  return rows
}

/**
 * Deep-merge object keys from multiple records so optional/nested fields are not missed.
 * Sample values prefer the first non-empty scalar seen.
 */
function mergeObjectShapes(
  targets: Record<string, unknown>[],
  max = 100
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const slice = targets.slice(0, max)

  function mergeInto(dest: Record<string, unknown>, src: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined) continue
      if (Array.isArray(v)) {
        if (!dest[k] || !Array.isArray(dest[k]) || (dest[k] as unknown[]).length === 0) {
          dest[k] = v
        } else {
          // Prefer array element with richest object shape
          const existing = dest[k] as unknown[]
          const bestSrc = v.find((x) => x && typeof x === 'object' && !Array.isArray(x))
          const bestDest = existing.find((x) => x && typeof x === 'object' && !Array.isArray(x))
          if (bestSrc && bestDest) {
            const m = { ...(bestDest as Record<string, unknown>) }
            mergeInto(m, bestSrc as Record<string, unknown>)
            dest[k] = [m]
          } else if (bestSrc && !bestDest) {
            dest[k] = v
          }
        }
      } else if (typeof v === 'object') {
        const cur = dest[k]
        if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
          mergeInto(cur as Record<string, unknown>, v as Record<string, unknown>)
        } else if (cur === undefined || cur === null || cur === '') {
          dest[k] = { ...(v as Record<string, unknown>) }
        }
      } else {
        if (dest[k] === undefined || dest[k] === null || dest[k] === '') {
          dest[k] = v
        }
      }
    }
  }

  for (const t of slice) {
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      mergeInto(merged, t)
    }
  }
  return merged
}

/**
 * Walk records and collect leaf values keyed by field path (same contract as generator history).
 */
export function harvestValuesFromRecords(
  records: unknown[],
  maxRecords = 500,
  maxValuesPerField = 200
): HistoryRecordInput[] {
  const perField = new Map<string, Set<string>>()

  function walk(value: unknown, path: string[]): void {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      // Align with generator: scalar array elements live under parent.item
      // (schema infer uses key "item" for array-of-scalars children).
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          walk(item, path)
        } else if (Array.isArray(item)) {
          walk(item, path)
        } else {
          walk(item, [...path, 'item'])
        }
      }
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, [...path, k])
      }
      return
    }
    const fieldKey = path.join('.') || 'value'
    const str = String(value).trim()
    if (!str) return
    if (!perField.has(fieldKey)) perField.set(fieldKey, new Set())
    const set = perField.get(fieldKey)!
    if (set.size < maxValuesPerField) set.add(str)
  }

  for (const rec of records.slice(0, maxRecords)) {
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
      walk(rec, [])
    } else {
      walk(rec, ['value'])
    }
  }

  const out: HistoryRecordInput[] = []
  for (const [fieldKey, values] of Array.from(perField.entries())) {
    for (const value of Array.from(values)) {
      out.push({
        categoryName: fieldKey,
        keyName: fieldKey,
        value,
        sourceKey: fieldKey.includes('.') ? fieldKey.split('.').pop() : fieldKey
      })
    }
  }
  return out
}

/**
 * Infer SchemaDoc from file contents and harvest values for SQLite history.
 * - Schema name = file base name
 * - sourceFileName = original file name
 * - sourceFilePath = full path when provided (Browse)
 * Structure is merged across many records so optional nested keys are captured.
 */
export function inferSchemaFromFile(
  fileName: string,
  content: string | Buffer,
  options: InferSchemaOptions = {}
): InferSchemaResult {
  const maxScan = options.maxScanRecords ?? 500
  const maxVals = options.maxValuesPerField ?? 200
  const text = typeof content === 'string' ? content : content.toString('utf8')
  const format = detectFormat(fileName, text)
  let data: unknown
  let recordHint = 1

  switch (format) {
    case 'json': {
      const t = text.trim()
      if (t.includes('\n') && !t.startsWith('[') && !t.startsWith('{')) {
        data = parseNdjson(t)
        recordHint = (data as unknown[]).length
      } else {
        data = JSON.parse(t)
        if (Array.isArray(data)) recordHint = data.length
      }
      break
    }
    case 'yaml':
      data = YAML.parse(text)
      if (Array.isArray(data)) recordHint = data.length
      break
    case 'xml':
      data = parseXml(text)
      break
    case 'csv': {
      const rows = parseCsv(text)
      data = rows
      recordHint = rows.length
      break
    }
    case 'txt':
    default: {
      const t = text.trim()
      if (t.startsWith('{') || t.startsWith('[')) {
        data = JSON.parse(t)
        if (Array.isArray(data)) recordHint = data.length
      } else if (t.includes(',') && t.includes('\n')) {
        const rows = parseCsv(t)
        data = rows
        recordHint = rows.length
      } else {
        data = { content: text }
      }
      break
    }
  }

  // Normalize to list of root objects for scanning
  let records: unknown[] = []
  if (Array.isArray(data)) {
    records = data
    recordHint = data.length
  } else {
    records = [data]
    recordHint = 1
  }

  const objectRecords = records
    .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
    .map((r) => r as Record<string, unknown>)

  const sampleShape =
    objectRecords.length > 0
      ? mergeObjectShapes(objectRecords, Math.min(maxScan, 100))
      : records[0]

  let root: SchemaRow[]
  if (sampleShape !== null && typeof sampleShape === 'object' && !Array.isArray(sampleShape)) {
    root = inferObjectChildren(sampleShape as Record<string, unknown>)
  } else if (Array.isArray(sampleShape)) {
    root = [inferRowsFromValue(sampleShape, 'items', 0)]
  } else {
    root = [
      {
        id: newId(),
        key: 'value',
        kind: 'value',
        sampleValue: sampleToString(sampleShape),
        isPrimary: false,
        isUnique: false,
        children: [],
        sortOrder: 0
      }
    ]
  }

  if (root.length === 0) {
    root = [
      {
        id: newId(),
        key: 'field',
        kind: 'value',
        sampleValue: '',
        isPrimary: false,
        isUnique: false,
        children: [],
        sortOrder: 0
      }
    ]
  }

  const historySamples = harvestValuesFromRecords(records, maxScan, maxVals)
  const scannedRecords = Math.min(records.length, maxScan)

  const originalName = fileName.replace(/\\/g, '/').split('/').pop() || fileName
  const fullPath = options.sourceFilePath?.trim() || undefined
  const ts = nowIso()

  const schema: SchemaDoc = {
    id: newId(),
    name: baseName(originalName),
    description: fullPath
      ? `Imported from ${originalName} (${fullPath})`
      : `Imported from ${originalName}`,
    root,
    sourceFileName: originalName,
    sourceFilePath: fullPath,
    sourceFormat: format,
    createdAt: ts,
    updatedAt: ts,
    lastOpenedAt: ts
  }

  return {
    schema,
    format,
    recordHint,
    historySamples,
    scannedRecords
  }
}
