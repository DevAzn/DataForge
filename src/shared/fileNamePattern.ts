import type { ExportFormat } from './types'
import { getValueAtPath } from './fieldHistory'

export type FileNameCollisionPolicy = 'overwrite' | 'skip' | 'suffix'
export type FileNameSanitizeMode = 'windows' | 'ascii'

export interface FileNamingSettings {
  /** Template e.g. {schema}_{index:04}.{ext} or {schema}/{date:yyyy-MM-dd}/{field:id}.{ext} */
  pattern: string
  prefix: string
  suffix: string
  /** Used when {index} has no width, e.g. :04 */
  defaultIndexPad: number
  collision: FileNameCollisionPolicy
  sanitizeMode: FileNameSanitizeMode
  /**
   * When true, {uuid}/{rand}/{date} derive from seed+index for reproducible CI packs.
   * When false, wall clock + crypto random (default for production dumps).
   */
  deterministicRandom: boolean
  /**
   * Never write two files with the same relative path in one run
   * (tracks in-memory + disk). Recommended always on.
   */
  ensureUniqueNames: boolean
}

export const DEFAULT_FILE_NAMING: FileNamingSettings = {
  pattern: '{schema}_{index:04}.{ext}',
  prefix: '',
  suffix: '',
  defaultIndexPad: 4,
  collision: 'suffix',
  sanitizeMode: 'windows',
  deterministicRandom: false,
  ensureUniqueNames: true
}

export interface FileNameRenderContext {
  schema: string
  /** 1-based record index */
  index: number
  count: number
  format: ExportFormat
  ext: string
  prefix?: string
  suffix?: string
  seed?: number
  /** Full generated record for {field:path} */
  record?: unknown
  /** Override base clock (CI / tests); each index still gets a unique offset */
  now?: Date
  defaultIndexPad?: number
  sanitizeMode?: FileNameSanitizeMode
  deterministicRandom?: boolean
  /**
   * Mutable map path → used fragments for `{field:x|unique}` within a batch.
   * Keyed by field path (lowercase).
   */
  usedFieldValues?: Map<string, Set<string>>
}

const TOKEN_RE = /\{([^{}]+)\}/g

/** Mulberry32 — same family as generator, for deterministic name tokens. */
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

function sanitizeSegment(raw: string, mode: FileNameSanitizeMode): string {
  let s = String(raw ?? '')
  s = s.replace(/[<>:"|?*\u0000-\u001f]/g, '')
  if (mode === 'ascii') {
    s = s.replace(/[^\w.\-()+@#&=,;\[\]{}!~$%^ ]+/g, '_')
  }
  s = s.replace(/[. ]+$/g, '').trim()
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) {
    s = `_${s}`
  }
  return s || 'unnamed'
}

function sanitizeRelPath(rel: string, mode: FileNameSanitizeMode): string {
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => sanitizeSegment(p, mode))
    .filter((p) => p && p !== '.' && p !== '..')
  return parts.join('/')
}

/**
 * Format a Date. Supports yyyy, yy, MM, dd, HH, mm, ss, SSS.
 * Default datetime-friendly formats when caller passes short aliases.
 */
function formatDate(d: Date, pattern: string): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const yyyy = String(d.getFullYear())
  const yy = yyyy.slice(-2)
  const MM = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const HH = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  const SSS = pad(d.getMilliseconds(), 3)
  return pattern
    .replace(/yyyy/g, yyyy)
    .replace(/yy/g, yy)
    .replace(/MM/g, MM)
    .replace(/dd/g, dd)
    .replace(/HH/g, HH)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss)
    .replace(/SSS/g, SSS)
}

function fieldToFileFragment(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

function randAlpha(rand: () => number, n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) {
    out += alphabet[Math.floor(rand() * alphabet.length) % alphabet.length]
  }
  return out
}

function uuidFromRand(rand: () => number): string {
  const hex = (): string => Math.floor(rand() * 16).toString(16)
  const block = (len: number): string => Array.from({ length: len }, hex).join('')
  return `${block(8)}-${block(4)}-4${block(3)}-${['8', '9', 'a', 'b'][Math.floor(rand() * 4)]}${block(3)}-${block(12)}`
}

function makeUuid(det: boolean, rand: () => number): string {
  if (det) return uuidFromRand(rand)
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return uuidFromRand(Math.random)
}

/**
 * Clock for this file: always varies by index so date/time tokens differ per record
 * even when the whole batch runs in the same wall-clock second.
 * - Live: base now + (index-1) milliseconds (unique SSS / ts)
 * - Deterministic: fixed epoch + index * 1000 ms
 */
export function clockForIndex(
  index: number,
  opts?: { now?: Date; seed?: number; deterministic?: boolean }
): Date {
  const det = Boolean(opts?.deterministic)
  const seed = (opts?.seed ?? 0) >>> 0
  if (det) {
    return new Date(1_700_000_000_000 + (seed % 86_400_000) + index * 1000)
  }
  const base = opts?.now?.getTime() ?? Date.now()
  return new Date(base + Math.max(0, index - 1))
}

/**
 * Expand a naming pattern for one record.
 * Returns a relative path (may include `/` for subfolders), without leading slash.
 *
 * Field tokens:
 * - `{field:path}` — value from record
 * - `{field:path|unique}` — never reuse same fragment in this batch; append index/uuid if needed
 * - `{field:path|rand}` — always append a short random suffix
 */
export function renderFileName(pattern: string, ctx: FileNameRenderContext): string {
  const mode = ctx.sanitizeMode ?? 'windows'
  const padDefault = Math.min(Math.max(ctx.defaultIndexPad ?? 4, 1), 12)
  const det = Boolean(ctx.deterministicRandom)
  const seed = (ctx.seed ?? 0) >>> 0
  const rand = det
    ? mulberry32((seed ^ Math.imul(ctx.index, 2654435761)) >>> 0)
    : Math.random

  const now = clockForIndex(ctx.index, {
    now: ctx.now,
    seed,
    deterministic: det
  })

  const schema = sanitizeSegment(ctx.schema || 'schema', mode)
  const prefix = ctx.prefix ?? ''
  const suffix = ctx.suffix ?? ''
  const ext = (ctx.ext || ctx.format || 'dat').replace(/^\./, '')

  const resolveField = (pathAndFlags: string): string => {
    let path = pathAndFlags.trim()
    let flag: 'plain' | 'unique' | 'rand' = 'plain'
    const pipe = path.lastIndexOf('|')
    if (pipe >= 0) {
      const f = path.slice(pipe + 1).trim().toLowerCase()
      path = path.slice(0, pipe).trim()
      if (f === 'unique' || f === 'rand') flag = f
    }
    let fragment = fieldToFileFragment(getValueAtPath(ctx.record, path))
    if (flag === 'rand') {
      const extra = det ? randAlpha(rand, 6) : randAlpha(Math.random, 6)
      fragment = fragment ? `${fragment}_${extra}` : extra
      return fragment
    }
    if (flag === 'unique') {
      if (!ctx.usedFieldValues) {
        // No tracker: still force per-file uniqueness via index
        fragment = fragment ? `${fragment}_${ctx.index}` : `v${ctx.index}`
        return fragment
      }
      const key = path.toLowerCase()
      let set = ctx.usedFieldValues.get(key)
      if (!set) {
        set = new Set()
        ctx.usedFieldValues.set(key, set)
      }
      let candidate = fragment || `v${ctx.index}`
      if (!set.has(candidate.toLowerCase())) {
        set.add(candidate.toLowerCase())
        return candidate
      }
      // Duplicate — append index, then short id until unique
      candidate = `${fragment || 'v'}_${ctx.index}`
      if (!set.has(candidate.toLowerCase())) {
        set.add(candidate.toLowerCase())
        return candidate
      }
      let n = 2
      while (n < 10_000) {
        const tryId = `${fragment || 'v'}_${ctx.index}_${n}`
        if (!set.has(tryId.toLowerCase())) {
          set.add(tryId.toLowerCase())
          return tryId
        }
        n++
      }
      const fallback = `${fragment || 'v'}_${makeUuid(det, rand).replace(/-/g, '').slice(0, 8)}`
      set.add(fallback.toLowerCase())
      return fallback
    }
    return fragment
  }

  const resolveToken = (raw: string): string => {
    const body = raw.trim()
    if (!body) return ''

    if (body.toLowerCase().startsWith('field:')) {
      return resolveField(body.slice(6).trim())
    }

    if (body === 'index' || body.startsWith('index:')) {
      const w = body.includes(':')
        ? Number.parseInt(body.split(':')[1] || '', 10)
        : padDefault
      const width = Number.isFinite(w) && w > 0 ? Math.min(w, 12) : padDefault
      return String(ctx.index).padStart(width, '0')
    }

    if (body === 'seq') {
      return String(ctx.index).padStart(padDefault, '0')
    }

    if (body === 'count') return String(ctx.count)
    if (body === 'schema') return schema
    if (body === 'ext') return ext
    if (body === 'format') return ctx.format
    if (body === 'prefix') return prefix
    if (body === 'suffix') return suffix
    if (body === 'seed') return String(seed)

    // Unix epoch ms — unique per index via clockForIndex
    if (body === 'ts' || body === 'timestamp') {
      return String(now.getTime())
    }

    // Time only (varies per file via ms offset)
    if (body === 'time' || body.startsWith('time:')) {
      const fmt = body.includes(':') ? body.slice(body.indexOf(':') + 1) : 'HHmmss_SSS'
      return formatDate(now, fmt || 'HHmmss_SSS')
    }

    // Full datetime (default includes time + ms so batch files differ)
    if (body === 'datetime' || body.startsWith('datetime:')) {
      const fmt = body.includes(':')
        ? body.slice(body.indexOf(':') + 1)
        : 'yyyyMMdd_HHmmss_SSS'
      return formatDate(now, fmt || 'yyyyMMdd_HHmmss_SSS')
    }

    // date — default day-only for folders; use datetime/time for uniqueness
    // Bare {date} uses date+time+ms so two files never share the same token alone
    if (body === 'date' || body.startsWith('date:')) {
      const fmt = body.includes(':')
        ? body.slice(body.indexOf(':') + 1)
        : 'yyyyMMdd_HHmmss_SSS'
      return formatDate(now, fmt || 'yyyyMMdd_HHmmss_SSS')
    }

    if (body === 'uuid') return makeUuid(det, rand)
    if (body === 'uuid8') {
      return makeUuid(det, rand).replace(/-/g, '').slice(0, 8)
    }

    if (body === 'rand' || body.startsWith('rand:')) {
      const nRaw = body.includes(':') ? Number.parseInt(body.split(':')[1] || '8', 10) : 8
      const n = Number.isFinite(nRaw) ? Math.min(Math.max(nRaw, 1), 64) : 8
      return randAlpha(det ? rand : Math.random, n)
    }

    return ''
  }

  const pat = (pattern || DEFAULT_FILE_NAMING.pattern).trim() || DEFAULT_FILE_NAMING.pattern
  let expanded = pat.replace(TOKEN_RE, (_m, inner: string) => resolveToken(inner))

  const hasExt =
    /\.[a-z0-9]+$/i.test(expanded.split('/').pop() || '') || pat.includes('{ext}')
  if (!hasExt && ext) {
    expanded = `${expanded}.${ext}`
  }

  return sanitizeRelPath(expanded, mode)
}

/**
 * Resolve collision: returns final relative path, or null if skip.
 * When `usedInBatch` is provided, treats those as already taken (same run).
 */
export function resolveFileNameCollision(
  relPath: string,
  policy: FileNameCollisionPolicy,
  exists: (rel: string) => boolean,
  usedInBatch?: Set<string>
): string | null {
  const taken = (rel: string): boolean => {
    const key = rel.toLowerCase()
    if (usedInBatch?.has(key)) return true
    return exists(rel)
  }

  if (!taken(relPath)) return relPath
  if (policy === 'overwrite' && !usedInBatch?.has(relPath.toLowerCase())) {
    // Overwrite disk only if not already used earlier in this batch
    return relPath
  }
  if (policy === 'skip') return null

  const slash = relPath.lastIndexOf('/')
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : ''
  const base = slash >= 0 ? relPath.slice(slash + 1) : relPath
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${dir}${stem}_${n}${ext}`
    if (!taken(candidate)) return candidate
  }
  return `${dir}${stem}_${Date.now()}${ext}`
}

/**
 * Guarantee a unique relative path within a batch (and optionally vs disk).
 * Prefer this for "no two files the same name".
 */
export function claimUniqueFileName(
  relPath: string,
  usedInBatch: Set<string>,
  existsOnDisk: (rel: string) => boolean,
  policy: FileNameCollisionPolicy = 'suffix'
): string | null {
  const resolved = resolveFileNameCollision(relPath, policy, existsOnDisk, usedInBatch)
  if (resolved == null) return null
  usedInBatch.add(resolved.toLowerCase())
  return resolved
}

/** Human preview examples for UI. */
export function previewFileNames(
  pattern: string,
  naming: Partial<FileNamingSettings>,
  sample: {
    schema: string
    format: ExportFormat
    ext: string
    count?: number
    record?: unknown
    seed?: number
  },
  examples = 3
): string[] {
  const cfg = { ...DEFAULT_FILE_NAMING, ...naming }
  const count = sample.count ?? examples
  const out: string[] = []
  const usedFieldValues = new Map<string, Set<string>>()
  const usedNames = new Set<string>()
  const baseNow = new Date()
  for (let i = 1; i <= Math.min(examples, count); i++) {
    // Vary sample field slightly so |unique previews look different when same id
    const record =
      sample.record && typeof sample.record === 'object'
        ? { ...(sample.record as object), __previewIndex: i }
        : sample.record
    let rel = renderFileName(cfg.pattern, {
      schema: sample.schema,
      index: i,
      count,
      format: sample.format,
      ext: sample.ext,
      prefix: cfg.prefix,
      suffix: cfg.suffix,
      seed: sample.seed ?? 42,
      record,
      now: baseNow,
      defaultIndexPad: cfg.defaultIndexPad,
      sanitizeMode: cfg.sanitizeMode,
      deterministicRandom: true,
      usedFieldValues
    })
    if (cfg.ensureUniqueNames !== false) {
      rel =
        claimUniqueFileName(rel, usedNames, () => false, cfg.collision) ??
        `${rel.replace(/(\.[^.]+)?$/, `_${i}$1`)}`
    }
    out.push(rel)
  }
  return out
}
