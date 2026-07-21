/**
 * Infer and preserve field formats from user samples + history.
 * Dates stay dates; numbers keep shape (decimals, padding, currency); strings learn structure.
 */

export type InferredKind =
  | 'bool'
  | 'int'
  | 'int-padded'
  | 'float'
  | 'currency'
  | 'percent'
  | 'date-iso'
  | 'datetime-iso'
  | 'date-us'
  | 'date-eu'
  | 'date-slash-ymd'
  | 'email'
  | 'uuid'
  | 'phone'
  | 'alpha'
  | 'alnum'
  | 'string'

export interface FieldPattern {
  kind: InferredKind
  samples: string[]
  /** Integer padding width (e.g. 00123 → 5) */
  padWidth?: number
  minNum?: number
  maxNum?: number
  /** Decimal places for floats / currency */
  decimals?: number
  minLen: number
  maxLen: number
  /** Currency prefix like "$" */
  currencyPrefix?: string
  /** Whether currency uses thousands separators */
  useThousands?: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/
const DATE_US = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}$/
const DATE_EU = /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/\d{4}$/
const DATE_YMD_SLASH = /^\d{4}\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE = /^[+]?[\d\s().-]{7,20}$/
const INT = /^-?\d+$/
const FLOAT = /^-?\d+\.\d+$/
const CURRENCY = /^(\$|€|£)?-?\d{1,3}(,\d{3})*(\.\d+)?$|^(\$|€|£)?-?\d+(\.\d+)?$/
const PERCENT = /^-?\d+(\.\d+)?%$/
const ALPHA = /^[A-Za-z]+$/
const ALNUM = /^[A-Za-z0-9_-]+$/

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
}

function allMatch(samples: string[], re: RegExp): boolean {
  return samples.length > 0 && samples.every((s) => re.test(s))
}

function decimalPlaces(s: string): number {
  const m = s.replace(/%$/, '').match(/\.(\d+)/)
  return m ? m[1].length : 0
}

function parseLooseNumber(s: string): number {
  return Number(s.replace(/[$€£,%]/g, '').replace(/,/g, ''))
}

/**
 * Detect pattern from history + the field's sampleValue (sample wins as format template).
 */
export function detectPattern(history: string[], sampleValue?: string): FieldPattern {
  const sample = sampleValue?.trim()
  const pool = uniqueNonEmpty([...(sample ? [sample] : []), ...history])

  if (pool.length === 0) {
    return { kind: 'string', samples: [], minLen: 4, maxLen: 12 }
  }

  // Prefer detecting from sample alone when present (user-defined format source of truth)
  const detectFrom = sample ? [sample] : pool
  const lens = pool.map((s) => s.length)
  const minLen = Math.min(...lens)
  const maxLen = Math.max(...lens)

  if (allMatch(detectFrom, /^(true|false)$/i) || allMatch(pool, /^(true|false)$/i)) {
    return { kind: 'bool', samples: pool, minLen: 4, maxLen: 5 }
  }

  if (allMatch(detectFrom, ISO_DATE) || (allMatch(pool, ISO_DATE) && !sample)) {
    return { kind: 'date-iso', samples: pool, minLen: 10, maxLen: 10 }
  }

  if (allMatch(detectFrom, ISO_DATETIME) || allMatch(pool, ISO_DATETIME)) {
    return { kind: 'datetime-iso', samples: pool, minLen: 19, maxLen: 30 }
  }

  // US vs EU: if sample matches one, lock that
  if (sample && DATE_US.test(sample) && !DATE_EU.test(sample)) {
    return { kind: 'date-us', samples: pool, minLen: 8, maxLen: 10 }
  }
  if (sample && DATE_EU.test(sample) && !/^\d{4}/.test(sample)) {
    // Prefer EU when day > 12 in samples, else if sample is DD/MM style from user region
    const day = Number(sample.split('/')[0])
    if (day > 12 || DATE_EU.test(sample)) {
      return { kind: 'date-eu', samples: pool, minLen: 8, maxLen: 10 }
    }
  }
  if (allMatch(detectFrom, DATE_YMD_SLASH) || allMatch(pool, DATE_YMD_SLASH)) {
    return { kind: 'date-slash-ymd', samples: pool, minLen: 8, maxLen: 10 }
  }
  if (allMatch(detectFrom, DATE_US) || allMatch(pool, DATE_US)) {
    return { kind: 'date-us', samples: pool, minLen: 8, maxLen: 10 }
  }
  if (allMatch(detectFrom, DATE_EU) || allMatch(pool, DATE_EU)) {
    return { kind: 'date-eu', samples: pool, minLen: 8, maxLen: 10 }
  }

  if (allMatch(detectFrom, EMAIL) || allMatch(pool, EMAIL)) {
    return { kind: 'email', samples: pool, minLen, maxLen }
  }

  if (allMatch(detectFrom, UUID) || allMatch(pool, UUID)) {
    return { kind: 'uuid', samples: pool, minLen: 36, maxLen: 36 }
  }

  if (allMatch(detectFrom, PERCENT) || allMatch(pool, PERCENT)) {
    const nums = pool.map(parseLooseNumber)
    const decimals = Math.max(...pool.map(decimalPlaces), 0)
    return {
      kind: 'percent',
      samples: pool,
      minLen,
      maxLen,
      minNum: Math.min(...nums),
      maxNum: Math.max(...nums),
      decimals
    }
  }

  if (allMatch(detectFrom, CURRENCY) || allMatch(pool, CURRENCY)) {
    const prefixMatch = (sample || pool[0]).match(/^(\$|€|£)/)
    const useThousands = pool.some((s) => s.includes(','))
    const nums = pool.map(parseLooseNumber)
    const decimals = Math.max(...pool.map(decimalPlaces), useThousands ? 2 : 0)
    return {
      kind: 'currency',
      samples: pool,
      minLen,
      maxLen,
      minNum: Math.min(...nums),
      maxNum: Math.max(...nums),
      decimals: decimals || 2,
      currencyPrefix: prefixMatch?.[1] ?? '$',
      useThousands
    }
  }

  // Padded integers (leading zeros) — keep as formatted string output
  if (sample && INT.test(sample) && /^-?0\d+/.test(sample)) {
    const nums = pool.filter((s) => INT.test(s)).map(Number)
    return {
      kind: 'int-padded',
      samples: pool,
      minLen,
      maxLen,
      padWidth: sample.replace(/^-/, '').length,
      minNum: nums.length ? Math.min(...nums) : 0,
      maxNum: nums.length ? Math.max(...nums) : 999
    }
  }

  if (allMatch(detectFrom, INT) || allMatch(pool, INT)) {
    const nums = pool.filter((s) => INT.test(s)).map(Number)
    // Mixed padded?
    if (pool.some((s) => /^-?0\d+/.test(s))) {
      const widths = pool.map((s) => s.replace(/^-/, '').length)
      return {
        kind: 'int-padded',
        samples: pool,
        minLen,
        maxLen,
        padWidth: Math.max(...widths),
        minNum: Math.min(...nums),
        maxNum: Math.max(...nums)
      }
    }
    return {
      kind: 'int',
      samples: pool,
      minLen,
      maxLen,
      minNum: Math.min(...nums),
      maxNum: Math.max(...nums)
    }
  }

  if (allMatch(detectFrom, FLOAT) || allMatch(pool, FLOAT)) {
    const nums = pool.map(Number)
    const decimals = Math.max(...pool.map(decimalPlaces), 1)
    return {
      kind: 'float',
      samples: pool,
      minLen,
      maxLen,
      minNum: Math.min(...nums),
      maxNum: Math.max(...nums),
      decimals
    }
  }

  // Phone-like (if mostly digits / separators)
  if (
    (sample && PHONE.test(sample) && /\d{7,}/.test(sample.replace(/\D/g, ''))) ||
    (allMatch(pool, PHONE) && pool.every((s) => s.replace(/\D/g, '').length >= 7))
  ) {
    return { kind: 'phone', samples: pool, minLen, maxLen }
  }

  if (allMatch(detectFrom, ALPHA) || allMatch(pool, ALPHA)) {
    return { kind: 'alpha', samples: pool, minLen, maxLen }
  }

  if (allMatch(detectFrom, ALNUM) || allMatch(pool, ALNUM)) {
    return { kind: 'alnum', samples: pool, minLen, maxLen }
  }

  return { kind: 'string', samples: pool, minLen, maxLen }
}

export function isDateKind(kind: InferredKind): boolean {
  return (
    kind === 'date-iso' ||
    kind === 'datetime-iso' ||
    kind === 'date-us' ||
    kind === 'date-eu' ||
    kind === 'date-slash-ymd'
  )
}

export function isNumericKind(kind: InferredKind): boolean {
  return (
    kind === 'int' ||
    kind === 'int-padded' ||
    kind === 'float' ||
    kind === 'currency' ||
    kind === 'percent'
  )
}
