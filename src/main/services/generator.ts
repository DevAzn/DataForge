import type {
  GenerateProgress,
  GenerateRequest,
  GenerateResult,
  GenerationReport,
  HistoryRecordInput,
  SchemaRow
} from '../../shared/types'
import {
  MAX_GENERATE_RECORDS,
  MAX_IN_MEMORY_GENERATE_RECORDS,
  MIN_GENERATE_RECORDS
} from '../../shared/types'
import { applyTiedFieldPaths, fieldPathKey } from '../../shared/fieldHistory'
import {
  fieldHistoryKey,
  fieldHistoryReadKeys,
  getValuesForFields,
  harvestSchemaSamples,
  historyRecordForField,
  logInteraction,
  recordMany
} from '../db/history'
import {
  detectPattern,
  isDateKind,
  isNumericKind,
  type FieldPattern,
  type InferredKind
} from './patterns'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length]
}

function randInt(rand: () => number, min: number, max: number): number {
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = min + 100
  if (max < min) [min, max] = [max, min]
  return Math.floor(rand() * (max - min + 1)) + min
}

function randomString(rand: () => number, charset: string, len: number): string {
  if (len < 1) len = 1
  let s = ''
  for (let i = 0; i < len; i++) s += charset[Math.floor(rand() * charset.length)]
  return s
}

function padNumber(n: number, width: number, negative: boolean): string {
  const abs = Math.abs(Math.trunc(n))
  const body = String(abs).padStart(width, '0')
  return negative ? `-${body}` : body
}

function formatThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatCurrency(n: number, pattern: FieldPattern): string {
  const decimals = pattern.decimals ?? 2
  const neg = n < 0
  const abs = Math.abs(n)
  const fixed = abs.toFixed(decimals)
  const [intPart, frac] = fixed.split('.')
  const body = pattern.useThousands
    ? `${formatThousands(intPart)}${frac !== undefined ? `.${frac}` : ''}`
    : fixed
  const prefix = pattern.currencyPrefix ?? '$'
  return `${neg ? '-' : ''}${prefix}${body}`
}

/**
 * Seeded “now” so date ranges are stable for a given seed (no wall clock).
 * Epoch ≈ 2023-11-14 plus seed-derived offset.
 */
export function epochFromSeed(seed: number): number {
  return 1_700_000_000_000 + (seed >>> 0) % 1_000_000_000
}

function randomDateMs(rand: () => number, epochMs: number): number {
  const start = epochMs - 3 * 365.25 * 24 * 3600 * 1000
  const end = epochMs + 365.25 * 24 * 3600 * 1000
  return start + rand() * (end - start)
}

function formatDate(ms: number, kind: InferredKind): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  const msPart = String(d.getUTCMilliseconds()).padStart(3, '0')

  switch (kind) {
    case 'date-iso':
      return `${y}-${m}-${day}`
    case 'datetime-iso':
      return `${y}-${m}-${day}T${hh}:${mm}:${ss}.${msPart}Z`
    case 'date-us':
      return `${m}/${day}/${y}`
    case 'date-eu':
      return `${day}/${m}/${y}`
    case 'date-slash-ymd':
      return `${y}/${m}/${day}`
    default:
      return `${y}-${m}-${day}`
  }
}

/** Mutate string preserving character classes (digits→digits, letters→letters). */
function mutateString(rand: () => number, template: string): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz'
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return template
    .split('')
    .map((ch) => {
      if (/\d/.test(ch)) return String(randInt(rand, 0, 9))
      if (/[a-z]/.test(ch)) return alpha[randInt(rand, 0, 25)]
      if (/[A-Z]/.test(ch)) return ALPHA[randInt(rand, 0, 25)]
      return ch
    })
    .join('')
}

function expandNumericRange(pattern: FieldPattern): { min: number; max: number } {
  let min = pattern.minNum ?? 1
  let max = pattern.maxNum ?? min + 100
  if (min === max) {
    const span = Math.max(Math.abs(min) * 0.2, 10)
    min = min - span
    max = max + span
  } else {
    const span = Math.max(max - min, 1)
    min = min - span * 0.1
    max = max + span * 0.25
  }
  return { min, max }
}

function synthesizeRaw(
  rand: () => number,
  pattern: FieldPattern,
  used: Set<string>,
  epochMs: number
): string {
  const maxAttempts = 100
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let value = ''

    switch (pattern.kind) {
      case 'bool':
        value = rand() > 0.5 ? 'true' : 'false'
        break

      case 'int': {
        const { min, max } = expandNumericRange(pattern)
        value = String(randInt(rand, Math.ceil(min), Math.floor(max)))
        break
      }

      case 'int-padded': {
        const { min, max } = expandNumericRange(pattern)
        const n = randInt(rand, Math.max(0, Math.ceil(min)), Math.floor(Math.max(max, min + 1)))
        value = padNumber(n, pattern.padWidth ?? 4, false)
        break
      }

      case 'float': {
        const { min, max } = expandNumericRange(pattern)
        const decimals = pattern.decimals ?? 2
        const n = min + rand() * Math.max(max - min, 0.01)
        value = n.toFixed(decimals)
        break
      }

      case 'currency': {
        const { min, max } = expandNumericRange(pattern)
        const n = min + rand() * Math.max(max - min, 0.01)
        value = formatCurrency(n, pattern)
        break
      }

      case 'percent': {
        const { min, max } = expandNumericRange(pattern)
        const decimals = pattern.decimals ?? 1
        const n = min + rand() * Math.max(max - min, 0.1)
        value = `${n.toFixed(decimals)}%`
        break
      }

      case 'date-iso':
      case 'datetime-iso':
      case 'date-us':
      case 'date-eu':
      case 'date-slash-ymd':
        value = formatDate(randomDateMs(rand, epochMs), pattern.kind)
        break

      case 'email': {
        if (pattern.samples.length > 0 && rand() < 0.4) {
          value = mutateString(rand, pick(rand, pattern.samples))
          if (!value.includes('@')) value = `${value}@example.com`
        } else {
          const user = randomString(rand, 'abcdefghijklmnopqrstuvwxyz', randInt(rand, 5, 10))
          const domain = pick(rand, [
            'example.com',
            'test.local',
            'mail.dev',
            'sample.org',
            'demo.io'
          ])
          value = `${user}${randInt(rand, 1, 999)}@${domain}`
        }
        break
      }

      case 'uuid': {
        const hex = '0123456789abcdef'
        const p = [8, 4, 4, 4, 12].map((n) => randomString(rand, hex, n))
        p[2] = `4${p[2].slice(1)}`
        value = p.join('-')
        break
      }

      case 'phone': {
        if (pattern.samples.length > 0) {
          value = mutateString(rand, pick(rand, pattern.samples))
        } else {
          value = `(${randInt(rand, 200, 999)}) ${randInt(rand, 200, 999)}-${randInt(rand, 1000, 9999)}`
        }
        break
      }

      case 'alpha': {
        if (pattern.samples.length > 0 && rand() < 0.55) {
          value = mutateString(rand, pick(rand, pattern.samples))
        } else {
          const len = randInt(
            rand,
            Math.max(1, pattern.minLen),
            Math.max(pattern.minLen, pattern.maxLen)
          )
          const template = pattern.samples[0]
          const upper = template ? /[A-Z]/.test(template[0]) : false
          value = randomString(
            rand,
            upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz',
            len
          )
        }
        break
      }

      case 'alnum': {
        if (pattern.samples.length > 0 && rand() < 0.6) {
          value = mutateString(rand, pick(rand, pattern.samples))
        } else {
          const len = randInt(
            rand,
            Math.max(1, pattern.minLen),
            Math.max(pattern.minLen, pattern.maxLen)
          )
          value = randomString(
            rand,
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            len
          )
        }
        break
      }

      default: {
        // Strings: ONLY from this field's own samples/history (passed in as pattern.samples)
        if (pattern.samples.length > 0) {
          value = mutateString(rand, pick(rand, pattern.samples))
        } else {
          const len = randInt(rand, 4, 12)
          value = randomString(rand, 'abcdefghijklmnopqrstuvwxyz', len)
        }
      }
    }

    if (!used.has(value)) return value
  }

  // Exhaustion fallbacks stay seeded (no wall clock)
  if (isDateKind(pattern.kind)) {
    return formatDate(epochMs + randInt(rand, 0, 86_400_000), pattern.kind)
  }
  if (isNumericKind(pattern.kind)) {
    return String((epochMs + Math.floor(rand() * 1e9)) % 1_000_000_000)
  }
  return `${randomString(rand, 'abcdefghijklmnopqrstuvwxyz', 6)}_${randInt(rand, 1000, 999999)}`
}

function coerceOutput(raw: string, pattern: FieldPattern): unknown {
  switch (pattern.kind) {
    case 'bool':
      return raw.toLowerCase() === 'true'
    case 'int': {
      const n = Number.parseInt(raw, 10)
      return Number.isFinite(n) ? n : raw
    }
    case 'float': {
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) ? n : raw
    }
    default:
      return raw
  }
}

interface GenStats {
  leafValues: number
  nullValues: number
  historyHits: number
  enumHits: number
  synthesized: number
  mutatedFromSample: number
  patternRetries: number
  patternFailures: number
  lengthRepairs: number
  numericRepairs: number
  uniqueExhausted: number
}

export interface GenScratch {
  rand: () => number
  uniqueSets: Map<string, Set<string>>
  historyBuffer: HistoryRecordInput[]
  historyCap: number
  /** When true, skip live value_history reads */
  ciMode: boolean
  seed: number
  /** Fixed epoch for date synthesis (from seed) */
  epochMs: number
  stats: GenStats
  /**
   * When set, pushHistory skips these field path keys (lowercase).
   * Used so CSV tie rows after the first do not pollute history with discarded values.
   */
  suppressHistoryPaths: Set<string> | null
}

/** Suppress history writes for tied leaf paths on subsequent multi-row records. */
export function setSuppressHistoryPaths(
  scratch: GenScratch,
  paths: string[] | null
): void {
  if (!paths || paths.length === 0) {
    scratch.suppressHistoryPaths = null
    return
  }
  const set = new Set<string>()
  for (const p of paths) {
    const t = p.trim().toLowerCase()
    if (t) set.add(t)
  }
  scratch.suppressHistoryPaths = set.size ? set : null
}

function emptyStats(): GenStats {
  return {
    leafValues: 0,
    nullValues: 0,
    historyHits: 0,
    enumHits: 0,
    synthesized: 0,
    mutatedFromSample: 0,
    patternRetries: 0,
    patternFailures: 0,
    lengthRepairs: 0,
    numericRepairs: 0,
    uniqueExhausted: 0
  }
}

export function finalizeGenerationReport(
  scratch: GenScratch,
  recordCount: number,
  ms: number
): GenerationReport {
  const s = scratch.stats
  const nonNull = Math.max(0, s.leafValues - s.nullValues)
  return {
    ...s,
    historyHitRate: nonNull > 0 ? Math.round((s.historyHits / nonNull) * 1000) / 10 : 0,
    nullRatePct:
      s.leafValues > 0 ? Math.round((s.nullValues / s.leafValues) * 1000) / 10 : 0,
    ciMode: scratch.ciMode,
    seed: scratch.seed,
    recordCount,
    ms
  }
}

function pushHistory(
  scratch: GenScratch,
  path: string[],
  row: SchemaRow,
  raw: string
): void {
  if (!raw || scratch.historyBuffer.length >= scratch.historyCap) return
  if (scratch.suppressHistoryPaths) {
    const pk = fieldPathKey(path, row).toLowerCase()
    if (scratch.suppressHistoryPaths.has(pk)) return
  }
  scratch.historyBuffer.push(historyRecordForField(path, row, raw))
}

function clampNullRate(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v))
}

function applyLengthConstraints(
  row: SchemaRow,
  raw: string,
  stats?: GenStats
): string {
  let s = raw
  let repaired = false
  if (typeof row.maxLength === 'number' && row.maxLength >= 0 && s.length > row.maxLength) {
    s = s.slice(0, row.maxLength)
    repaired = true
  }
  if (typeof row.minLength === 'number' && row.minLength > 0 && s.length < row.minLength) {
    const pad = 'x'.repeat(row.minLength - s.length)
    s = s + pad
    repaired = true
  }
  if (repaired && stats) stats.lengthRepairs++
  return s
}

function applyNumericConstraints(
  row: SchemaRow,
  raw: string,
  pattern: FieldPattern,
  stats?: GenStats
): string {
  if (!isNumericKind(pattern.kind) && pattern.kind !== 'currency') return raw
  let n = Number.parseFloat(raw.replace(/[^0-9.+-eE]/g, ''))
  if (!Number.isFinite(n)) return raw
  const before = n
  if (typeof row.min === 'number' && Number.isFinite(row.min) && n < row.min) n = row.min
  if (typeof row.max === 'number' && Number.isFinite(row.max) && n > row.max) n = row.max
  if (n !== before && stats) stats.numericRepairs++
  if (pattern.kind === 'int') return String(Math.trunc(n))
  if (pattern.kind === 'currency') return formatCurrency(n, pattern)
  const decimals = pattern.decimals ?? 2
  return n.toFixed(decimals)
}

function tryCompilePattern(source?: string): RegExp | null {
  const s = source?.trim()
  if (!s) return null
  try {
    return new RegExp(s)
  } catch {
    return null
  }
}

function matchesPattern(re: RegExp | null, raw: string): boolean {
  if (!re) return true
  return re.test(raw)
}

/**
 * Generate a leaf value using history scoped to this field's write key by default.
 * CI mode skips live history. Constraints (null, enum, length, range, pattern) apply last.
 */
function generateFieldValue(row: SchemaRow, path: string[], scratch: GenScratch): unknown {
  const writeKey = fieldHistoryKey(path, row)
  const stats = scratch.stats
  stats.leafValues++

  const nullRate = clampNullRate(row.nullRate)
  if (nullRate > 0 && scratch.rand() * 100 < nullRate) {
    stats.nullValues++
    return null
  }

  const enums = (row.enumValues ?? []).map((v) => String(v).trim()).filter(Boolean)
  const requireUnique = row.isPrimary || row.isUnique
  if (!scratch.uniqueSets.has(writeKey)) scratch.uniqueSets.set(writeKey, new Set())
  const used = scratch.uniqueSets.get(writeKey)!
  const re = tryCompilePattern(row.pattern)

  // Closed enum set
  if (enums.length > 0) {
    let choice: string
    if (requireUnique) {
      const remaining = enums.filter((e) => !used.has(e))
      if (remaining.length === 0) stats.uniqueExhausted++
      const pool = remaining.length ? remaining : enums
      choice = pick(scratch.rand, pool)
      used.add(choice)
    } else {
      choice = pick(scratch.rand, enums)
    }
    stats.enumHits++
    pushHistory(scratch, path, row, choice)
    return choice
  }

  const readKeys = fieldHistoryReadKeys(path, row)
  const fieldHistory = scratch.ciMode ? [] : getValuesForFields(readKeys)
  const pattern = detectPattern(fieldHistory, row.sampleValue)

  const maxAttempts = 24
  let raw: string | null = null
  let source: 'history' | 'mutate' | 'synth' = 'synth'

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let candidate: string | null = null
    let candSource: 'history' | 'mutate' | 'synth' = 'synth'

    if (requireUnique) {
      candidate = synthesizeRaw(scratch.rand, pattern, used, scratch.epochMs)
      candSource = 'synth'
    } else {
      if (fieldHistory.length > 0 && scratch.rand() < 0.5) {
        candidate = pick(scratch.rand, fieldHistory)
        candSource = 'history'
      }
      if (
        candidate === null &&
        pattern.samples.length > 0 &&
        !isDateKind(pattern.kind) &&
        !isNumericKind(pattern.kind) &&
        pattern.kind !== 'bool' &&
        scratch.rand() < 0.55
      ) {
        candidate = mutateString(scratch.rand, pick(scratch.rand, pattern.samples))
        candSource = 'mutate'
      }
      if (candidate === null) {
        candidate = synthesizeRaw(scratch.rand, pattern, new Set(), scratch.epochMs)
        candSource = 'synth'
      }
    }

    candidate = applyLengthConstraints(row, candidate, stats)
    candidate = applyNumericConstraints(row, candidate, pattern, stats)

    if (!matchesPattern(re, candidate)) {
      stats.patternRetries++
      if (attempt < maxAttempts - 1) continue
      stats.patternFailures++
    }

    // After clamps, value may collide with an already-used unique; retry
    if (requireUnique && used.has(candidate)) {
      if (attempt < maxAttempts - 1) continue
      stats.uniqueExhausted++
    }

    raw = candidate
    source = candSource
    if (requireUnique) used.add(raw)
    break
  }

  if (raw === null) {
    raw = applyLengthConstraints(
      row,
      synthesizeRaw(scratch.rand, pattern, used, scratch.epochMs),
      stats
    )
    source = 'synth'
    if (requireUnique) {
      if (used.has(raw)) stats.uniqueExhausted++
      used.add(raw)
    }
  }

  if (source === 'history') stats.historyHits++
  else if (source === 'mutate') stats.mutatedFromSample++
  else stats.synthesized++

  pushHistory(scratch, path, row, raw)
  return coerceOutput(raw, pattern)
}

function nestedCount(rand: () => number, relationship?: SchemaRow['relationship']): number {
  switch (relationship) {
    case 'one-to-one':
    case 'many-to-one':
      return 1
    case 'one-to-many':
    case 'many-to-many':
      return randInt(rand, 1, 4)
    default:
      return randInt(rand, 1, 3)
  }
}

function generateFromRow(row: SchemaRow, path: string[], scratch: GenScratch): unknown {
  if (row.kind === 'array') {
    const n = nestedCount(scratch.rand, row.relationship)
    const childPath = [...path, (row.key || 'field').trim() || 'field']
    const items: unknown[] = []
    for (let i = 0; i < n; i++) {
      if (row.children.length === 0) {
        items.push(null)
      } else if (row.children.length === 1 && row.children[0].kind === 'value') {
        // Array of scalars: history key uses the array path + child key
        items.push(generateFromRow(row.children[0], childPath, scratch))
      } else {
        items.push(generateObject(row.children, childPath, scratch))
      }
    }
    return items
  }

  if (row.kind === 'object' || row.children.length > 0) {
    const childPath = [...path, (row.key || 'field').trim() || 'field']
    return generateObject(row.children, childPath, scratch)
  }

  return generateFieldValue(row, path, scratch)
}

function generateObject(
  rows: SchemaRow[],
  path: string[],
  scratch: GenScratch
): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const row of rows) {
    obj[row.key || 'field'] = generateFromRow(row, path, scratch)
  }
  return obj
}

export function resolveSeed(seed?: number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0
  }
  return (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
}

export function createGenerationContext(
  recordCount: number,
  options?: { seed?: number; ciMode?: boolean }
): GenScratch {
  const count = Math.min(
    Math.max(recordCount || 1, MIN_GENERATE_RECORDS),
    MAX_GENERATE_RECORDS
  )
  const seed = resolveSeed(
    options?.seed !== undefined
      ? options.seed
      : (Date.now() ^ (count * 2654435761) ^ Math.floor(Math.random() * 1e9)) >>> 0
  )
  const rand = mulberry32(seed)
  const historyCap = Math.min(Math.max(count * 20, 200), 5000)
  return {
    rand,
    uniqueSets: new Map(),
    historyBuffer: [],
    historyCap,
    ciMode: Boolean(options?.ciMode),
    seed,
    epochMs: epochFromSeed(seed),
    stats: emptyStats(),
    suppressHistoryPaths: null
  }
}

/** Generate a single root record (shared by bulk + stream paths). */
export function generateOneRecord(
  root: SchemaRow[],
  scratch: GenScratch
): Record<string, unknown> {
  return generateObject(root, [], scratch)
}

export function flushGenerationHistory(
  root: SchemaRow[],
  scratch: GenScratch,
  recordHistory: boolean
): number {
  if (!recordHistory) return 0
  const fromSchema = harvestSchemaSamples(root)
  recordMany([...fromSchema, ...scratch.historyBuffer])
  return scratch.historyBuffer.length
}

/**
 * Generate records, yielding the event loop between chunks so the main process
 * stays responsive for large counts.
 */
export async function generateData(
  request: GenerateRequest,
  onProgress?: (p: GenerateProgress) => void
): Promise<GenerateResult> {
  const started = Date.now()
  const count = Math.min(
    Math.max(request.recordCount || 1, MIN_GENERATE_RECORDS),
    MAX_GENERATE_RECORDS
  )
  if (count > MAX_IN_MEMORY_GENERATE_RECORDS) {
    throw new Error(
      `In-memory generate is limited to ${MAX_IN_MEMORY_GENERATE_RECORDS.toLocaleString()} records ` +
        `(requested ${count.toLocaleString()}). Enable Stream generate (CSV / JSON / TXT) or lower the count.`
    )
  }
  const ciMode = Boolean(request.ciMode)
  const scratch = createGenerationContext(count, {
    seed: request.seed,
    ciMode
  })

  const report = (partial: Omit<GenerateProgress, 'percent'>): void => {
    const percent =
      partial.total <= 0
        ? 0
        : Math.min(100, Math.round((partial.current / partial.total) * 100))
    onProgress?.({ ...partial, percent })
  }

  report({
    phase: 'generating',
    current: 0,
    total: count,
    message: ciMode
      ? `Starting generation (CI mode, seed ${scratch.seed})…`
      : `Starting generation (seed ${scratch.seed})…`
  })

  const tiedPaths = (request.schema.csvTiedFieldPaths ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
  const records: unknown[] = []
  let templateRecord: Record<string, unknown> | null = null
  const step = Math.max(1, Math.min(50, Math.floor(count / 40) || 1))
  for (let i = 0; i < count; ) {
    const chunkEnd = Math.min(i + step, count)
    for (; i < chunkEnd; i++) {
      // After the first row, do not write discarded pre-tie values into history
      if (tiedPaths.length > 0 && i > 0) {
        setSuppressHistoryPaths(scratch, tiedPaths)
      } else {
        setSuppressHistoryPaths(scratch, null)
      }
      let rec = generateOneRecord(request.schema.root, scratch)
      if (tiedPaths.length > 0) {
        if (i === 0) {
          templateRecord = rec
        } else if (templateRecord) {
          rec = applyTiedFieldPaths(templateRecord, rec, tiedPaths)
        }
      }
      records.push(rec)
    }
    report({
      phase: 'generating',
      current: i,
      total: count,
      message: `Generating record ${i} of ${count}…`
    })
    if (i < count) {
      await new Promise<void>((r) => setImmediate(r))
    }
  }

  // CI mode defaults to not writing history unless explicitly requested true
  const shouldRecordHistory = ciMode
    ? request.recordHistory === true
    : request.recordHistory !== false

  let historyWritten = 0
  if (shouldRecordHistory) {
    report({
      phase: 'history',
      current: count,
      total: count,
      message: 'Saving values to local history…'
    })
    historyWritten = flushGenerationHistory(request.schema.root, scratch, true)
  }

  logInteraction('generate', {
    schemaId: request.schema.id,
    schemaName: request.schema.name,
    recordCount: count,
    historyWritten,
    streamed: false,
    seed: scratch.seed,
    ciMode
  })

  const ms = Date.now() - started
  const genReport = finalizeGenerationReport(scratch, count, ms)

  report({
    phase: 'done',
    current: count,
    total: count,
    message: 'Done'
  })

  return {
    records,
    recordCount: records.length,
    ms,
    seed: scratch.seed,
    ciMode,
    report: genReport
  }
}
