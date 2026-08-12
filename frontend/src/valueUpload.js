/**
 * Parse uploaded value packs for Data packs (themes + field lists).
 * Formats: JSON, XML, CSV, TXT. Pure functions — no I/O.
 */

/** @typedef {{ values: string[], byCategory?: Record<string, string[]>, format: string, warnings: string[] }} ValueUploadResult */

export const VALUE_UPLOAD_ACCEPT =
  '.json,.xml,.csv,.txt,application/json,text/xml,text/csv,text/plain'

/**
 * Caps (aligned with backend defaults where practical):
 * - flat / field list → MAX_FIELD_VALUES_PER_TAG (1000)
 * - per theme category → MAX_THEME_CATEGORY_VALUES (100)
 */
export const VALUE_UPLOAD_MAX = 1000
/** Per-category cap for multi-category theme packs. */
export const VALUE_UPLOAD_MAX_PER_CATEGORY = 100
/** Max categories accepted from one multi-category file. */
export const VALUE_UPLOAD_MAX_CATEGORIES = 50
/** Max raw file size before read (bytes). */
export const VALUE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/**
 * Detect format from filename and/or content.
 * @param {string} fileName
 * @param {string} text
 * @returns {'json'|'xml'|'csv'|'txt'}
 */
export function detectValueFormat(fileName, text) {
  const name = String(fileName || '')
    .trim()
    .toLowerCase()
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.xml')) return 'xml'
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.txt') || name.endsWith('.text')) return 'txt'

  const t = String(text || '').trim()
  if (!t) return 'txt'
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  if (t.startsWith('<')) return 'xml'
  // CSV heuristic: known headers or multi-column first line
  const first = (t.split(/\r?\n/, 1)[0] || '').trim().toLowerCase()
  if (
    first === 'value' ||
    first === 'values' ||
    first === 'category,value' ||
    first === 'cat,value'
  ) {
    return 'csv'
  }
  if (first.includes(',') && /value|category|name/i.test(first)) return 'csv'
  if (first.includes(',') && t.split(/\r?\n/).length > 1) return 'csv'
  return 'txt'
}

/**
 * Normalize a single string value: trim; drop empties later.
 * @param {unknown} v
 * @returns {string}
 */
function asValue(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return String(v).trim()
}

/**
 * Deduplicate while preserving order (case-sensitive).
 * @param {string[]} list
 * @returns {string[]}
 */
export function uniqueValues(list) {
  const seen = new Set()
  const out = []
  for (const raw of list || []) {
    const v = asValue(raw)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Cap flat list length and note overflow.
 * @param {string[]} list
 * @param {string[]} warnings
 * @param {number} [max=VALUE_UPLOAD_MAX]
 * @returns {string[]}
 */
function capList(list, warnings, max = VALUE_UPLOAD_MAX) {
  const limit = Math.max(0, Number(max) || VALUE_UPLOAD_MAX)
  if (list.length <= limit) return list
  warnings.push(`Truncated to ${limit} values (file had ${list.length}).`)
  return list.slice(0, limit)
}

/**
 * Enforce per-category + total caps on a multi-category map.
 * @param {Record<string, string[]>} byCategory
 * @param {string[]} warnings
 * @returns {{ byCategory: Record<string, string[]>, values: string[] }}
 */
export function capByCategory(byCategory, warnings) {
  const src = byCategory && typeof byCategory === 'object' ? byCategory : {}
  let catKeys = Object.keys(src)
  if (catKeys.length > VALUE_UPLOAD_MAX_CATEGORIES) {
    warnings.push(
      `Kept first ${VALUE_UPLOAD_MAX_CATEGORIES} categories (file had ${catKeys.length}).`
    )
    catKeys = catKeys.slice(0, VALUE_UPLOAD_MAX_CATEGORIES)
  }

  /** @type {Record<string, string[]>} */
  const out = {}
  const flat = []
  let total = 0
  let catTrunc = 0
  let totalTrunc = false
  const totalMax = VALUE_UPLOAD_MAX_CATEGORIES * VALUE_UPLOAD_MAX_PER_CATEGORY

  for (const c of catKeys) {
    if (total >= totalMax) {
      totalTrunc = true
      break
    }
    let u = uniqueValues(src[c])
    if (u.length > VALUE_UPLOAD_MAX_PER_CATEGORY) {
      catTrunc++
      u = u.slice(0, VALUE_UPLOAD_MAX_PER_CATEGORY)
    }
    const room = totalMax - total
    if (u.length > room) {
      totalTrunc = true
      u = u.slice(0, room)
    }
    if (!u.length) continue
    out[c] = u
    flat.push(...u)
    total += u.length
  }

  if (catTrunc) {
    warnings.push(
      `${catTrunc} categor${catTrunc === 1 ? 'y' : 'ies'} truncated to ${VALUE_UPLOAD_MAX_PER_CATEGORY} values each.`
    )
  }
  if (totalTrunc) {
    warnings.push(`Multi-category total truncated to ${totalMax} values.`)
  }

  return { byCategory: out, values: flat }
}

/**
 * Finish a multi-category parse: cap map + flat list consistently.
 * @param {Record<string, string[]>} byCategory
 * @param {string[]} warnings
 * @param {string} format
 * @returns {ValueUploadResult}
 */
function finalizeCategories(byCategory, warnings, format) {
  const capped = capByCategory(byCategory, warnings)
  return {
    values: capped.values,
    byCategory: capped.byCategory,
    format,
    warnings
  }
}

/**
 * Parse CSV text into rows of cells (simple RFC4180-ish).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let i = 0
  let inQuotes = false
  const s = String(text || '').replace(/^\uFEFF/, '')
  while (i < s.length) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(cell.trim())
      cell = ''
      i++
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell.trim())
      cell = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
      i++
      continue
    }
    cell += ch
    i++
  }
  row.push(cell.trim())
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

/**
 * @param {string} text
 * @returns {ValueUploadResult}
 */
export function parseTxtValues(text) {
  const warnings = []
  const byCategory = {}
  const flat = []
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
  for (const line of lines) {
    const raw = String(line || '').trim()
    if (!raw || raw.startsWith('#')) continue
    // "category: value" / "category | value" — multi-category theme packs
    const m = raw.match(/^([^:#\n]+)\s*[:|]\s*(.+)$/)
    if (m && m[1].trim() && m[2].trim() && !m[1].includes(',')) {
      const cat = m[1].trim()
      const val = m[2].trim()
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(val)
      flat.push(val)
      continue
    }
    flat.push(raw)
  }
  const cats = Object.keys(byCategory)
  if (cats.length) {
    // Prefer structured categories when any "cat: val" lines were present
    return finalizeCategories(byCategory, warnings, 'txt')
  }
  return { values: capList(uniqueValues(flat), warnings), format: 'txt', warnings }
}

/**
 * CSV shapes:
 *  - single column (optional header value/values/name)
 *  - category,value
 *  - value only with header
 * @param {string} text
 * @returns {ValueUploadResult}
 */
export function parseCsvValues(text) {
  const warnings = []
  const rows = parseCsvRows(text)
  if (!rows.length) {
    return { values: [], format: 'csv', warnings: ['CSV file is empty.'] }
  }

  const header = rows[0].map((h) => h.toLowerCase())
  const looksHeader =
    header.some((h) =>
      ['value', 'values', 'name', 'item', 'category', 'cat', 'key'].includes(h)
    ) || header.every((h) => !/^\d+(\.\d+)?$/.test(h) && h.length < 40)

  let dataRows = rows
  let colValue = 0
  let colCategory = -1
  let hasHeader = false

  if (looksHeader) {
    const vi = header.findIndex((h) =>
      ['value', 'values', 'name', 'item', 'val'].includes(h)
    )
    const ci = header.findIndex((h) => ['category', 'cat', 'key'].includes(h))
    if (vi >= 0 || ci >= 0) {
      hasHeader = true
      dataRows = rows.slice(1)
      colValue = vi >= 0 ? vi : ci === 0 ? 1 : 0
      colCategory = ci
    } else if (header.length === 1 && header[0] === 'value') {
      hasHeader = true
      dataRows = rows.slice(1)
    } else if (
      header.length >= 2 &&
      (header[0] === 'category' || header[1] === 'value')
    ) {
      hasHeader = true
      dataRows = rows.slice(1)
      colCategory = 0
      colValue = 1
    }
  }

  // Two-column default without recognized header: treat as category,value if both non-empty often
  if (!hasHeader && rows[0].length >= 2) {
    const sample = rows.slice(0, Math.min(8, rows.length))
    const bothFilled = sample.filter((r) => r[0] && r[1]).length
    if (bothFilled >= Math.ceil(sample.length * 0.6)) {
      colCategory = 0
      colValue = 1
    }
  }

  /** @type {Record<string, string[]>} */
  const byCategory = {}
  const flat = []

  for (const r of dataRows) {
    if (colCategory >= 0 && r[colCategory]) {
      const cat = asValue(r[colCategory])
        .replace(/\s+/g, '_')
        .toLowerCase()
      const val = asValue(r[colValue] ?? r[1] ?? r[0])
      if (!cat || !val) continue
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(val)
      flat.push(val)
    } else {
      const val = asValue(r[colValue] ?? r[0])
      if (val) flat.push(val)
    }
  }

  const cats = Object.keys(byCategory)
  if (cats.length) {
    return finalizeCategories(byCategory, warnings, 'csv')
  }
  return { values: capList(uniqueValues(flat), warnings), format: 'csv', warnings }
}

/**
 * JSON shapes:
 *  - ["a","b"]
 *  - { "values": ["a","b"] }
 *  - { "items": [...] } / { "data": [...] }
 *  - { "categories": { "names": [...], "ships": [...] } }
 *  - { "categories": [ { "name":"names", "values":[...] } ] }
 *  - { "names": ["a"], "ships": ["b"] }  (object of string arrays, not reserved keys)
 * @param {string} text
 * @returns {ValueUploadResult}
 */
export function parseJsonValues(text) {
  const warnings = []
  let data
  try {
    data = JSON.parse(String(text || ''))
  } catch (e) {
    return {
      values: [],
      format: 'json',
      warnings: [`Invalid JSON: ${e?.message || e}`]
    }
  }

  if (Array.isArray(data)) {
    const values = capList(
      uniqueValues(data.map((x) => (typeof x === 'object' && x != null ? x.value ?? x.name ?? x : x))),
      warnings
    )
    return { values, format: 'json', warnings }
  }

  if (!data || typeof data !== 'object') {
    return {
      values: [],
      format: 'json',
      warnings: ['JSON root must be an array or object.']
    }
  }

  // categories array form
  if (Array.isArray(data.categories)) {
    /** @type {Record<string, string[]>} */
    const byCategory = {}
    for (const item of data.categories) {
      if (!item || typeof item !== 'object') continue
      const cat = asValue(item.name || item.category || item.key)
        .replace(/\s+/g, '_')
        .toLowerCase()
      const vals = item.values || item.items || item.data || []
      if (!cat || !Array.isArray(vals)) continue
      byCategory[cat] = uniqueValues(vals)
    }
    return finalizeCategories(byCategory, warnings, 'json')
  }

  // categories object form
  if (data.categories && typeof data.categories === 'object' && !Array.isArray(data.categories)) {
    /** @type {Record<string, string[]>} */
    const byCategory = {}
    for (const [k, vals] of Object.entries(data.categories)) {
      const cat = asValue(k).replace(/\s+/g, '_').toLowerCase()
      if (!cat || !Array.isArray(vals)) continue
      byCategory[cat] = uniqueValues(vals)
    }
    return finalizeCategories(byCategory, warnings, 'json')
  }

  // reserved list keys
  for (const key of ['values', 'items', 'data', 'list']) {
    if (Array.isArray(data[key])) {
      const values = capList(uniqueValues(data[key]), warnings)
      return { values, format: 'json', warnings }
    }
  }

  // object of string-arrays → categories (skip non-arrays)
  const arrayKeys = Object.entries(data).filter(([, v]) => Array.isArray(v))
  if (arrayKeys.length >= 1) {
    const allScalars = arrayKeys.every(([, arr]) =>
      arr.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x))
    )
    if (allScalars && arrayKeys.length >= 2) {
      /** @type {Record<string, string[]>} */
      const byCategory = {}
      for (const [k, vals] of arrayKeys) {
        const cat = asValue(k).replace(/\s+/g, '_').toLowerCase()
        if (!cat) continue
        byCategory[cat] = uniqueValues(vals)
      }
      return finalizeCategories(byCategory, warnings, 'json')
    }
    if (arrayKeys.length === 1) {
      const values = capList(uniqueValues(arrayKeys[0][1]), warnings)
      return { values, format: 'json', warnings }
    }
  }

  warnings.push('No recognizable values array in JSON object.')
  return { values: [], format: 'json', warnings }
}

/**
 * XML shapes:
 *  <values><value>a</value><value>b</value></values>
 *  <list><item>…</item></list>
 *  <theme>
 *    <category name="names"><value>Luke</value></category>
 *    <category name="ships"><value>X-Wing</value></category>
 *  </theme>
 *  Also: any leaf text nodes under repeated sibling tags.
 * @param {string} text
 * @returns {ValueUploadResult}
 */
export function parseXmlValues(text) {
  const warnings = []
  if (typeof DOMParser === 'undefined') {
    return {
      values: [],
      format: 'xml',
      warnings: ['XML parsing is not available in this environment.']
    }
  }
  const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) {
    return {
      values: [],
      format: 'xml',
      warnings: ['Invalid XML: ' + (err.textContent || 'parse error').slice(0, 120)]
    }
  }

  const root = doc.documentElement
  if (!root) {
    return { values: [], format: 'xml', warnings: ['Empty XML document.'] }
  }

  /** @type {Record<string, string[]>} */
  const byCategory = {}
  const flat = []

  // Prefer explicit category nodes
  const catNodes = root.querySelectorAll('category, cat')
  if (catNodes.length) {
    for (const node of catNodes) {
      const cat = asValue(
        node.getAttribute('name') ||
          node.getAttribute('key') ||
          node.getAttribute('id') ||
          node.getAttribute('category')
      )
        .replace(/\s+/g, '_')
        .toLowerCase()
      if (!cat) continue
      const vals = []
      for (const child of node.children) {
        const t = asValue(child.textContent)
        if (t) vals.push(t)
      }
      // also direct text if no children
      if (!vals.length) {
        const t = asValue(node.textContent)
        if (t) vals.push(t)
      }
      byCategory[cat] = uniqueValues(vals)
      flat.push(...byCategory[cat])
    }
    if (Object.keys(byCategory).length) {
      return finalizeCategories(byCategory, warnings, 'xml')
    }
  }

  // value / item / entry / name leaves
  const leaves = root.querySelectorAll('value, item, entry, name, val')
  if (leaves.length) {
    for (const el of leaves) {
      const t = asValue(el.textContent)
      if (t) flat.push(t)
    }
    return {
      values: capList(uniqueValues(flat), warnings),
      format: 'xml',
      warnings
    }
  }

  // Fallback: all element children of root that have only text
  for (const child of root.children) {
    if (child.children.length === 0) {
      const t = asValue(child.textContent)
      if (t) flat.push(t)
    } else {
      for (const grand of child.children) {
        const t = asValue(grand.textContent)
        if (t) flat.push(t)
      }
    }
  }

  if (!flat.length) {
    warnings.push('No text values found in XML.')
  }
  return { values: capList(uniqueValues(flat), warnings), format: 'xml', warnings }
}

/**
 * Parse file text into values (and optional category map).
 * @param {string} text
 * @param {string} [fileName='']
 * @param {'json'|'xml'|'csv'|'txt'|null} [forceFormat=null]
 * @returns {ValueUploadResult}
 */
export function parseValueUpload(text, fileName = '', forceFormat = null) {
  const format = forceFormat || detectValueFormat(fileName, text)
  switch (format) {
    case 'json':
      return parseJsonValues(text)
    case 'xml':
      return parseXmlValues(text)
    case 'csv':
      return parseCsvValues(text)
    case 'txt':
    default:
      return parseTxtValues(text)
  }
}

/**
 * Read a browser File and parse.
 * Rejects oversized files before loading text into memory.
 * @param {File} file
 * @returns {Promise<ValueUploadResult & { fileName: string }>}
 */
export async function parseValueFile(file) {
  if (!file) {
    return {
      values: [],
      format: 'txt',
      warnings: ['No file provided.'],
      fileName: ''
    }
  }
  const name = file.name || ''
  const size = Number(file.size) || 0
  if (size > VALUE_UPLOAD_MAX_BYTES) {
    const mb = (VALUE_UPLOAD_MAX_BYTES / (1024 * 1024)).toFixed(0)
    return {
      values: [],
      format: detectValueFormat(name, ''),
      warnings: [
        `File “${name || 'upload'}” is too large (${(size / (1024 * 1024)).toFixed(1)} MB). Max is ${mb} MB.`
      ],
      fileName: name
    }
  }
  const text = await file.text()
  const result = parseValueUpload(text, name)
  return { ...result, fileName: name }
}

// ── Schema rules + AI prompt (copy-friendly) ──────────────────────

export const VALUE_UPLOAD_SCHEMA_RULES = `DataForge — value upload format rules
=====================================
Supported files: .json · .xml · .csv · .txt
Encoding: UTF-8. One value = one string (no nested objects as values).
Duplicates are ignored. Empty lines are skipped.
Theme categories: lowercase letters, numbers, underscore, hyphen (e.g. names, lightsabers).
Theme cap: 100 values per category · Field list cap: 1000 values per list.
Upload: max 2 MB file · multi-category max 50 categories.

────────────────────────────────────
1) TXT — simplest (one value per line)
────────────────────────────────────
Luke Skywalker
Leia Organa
Han Solo

Optional category prefix (themes):
names: Luke Skywalker
names: Leia Organa
ships: Millennium Falcon

────────────────────────────────────
2) CSV
────────────────────────────────────
Single list (header optional):
value
Luke Skywalker
Leia Organa

With categories (themes):
category,value
names,Luke Skywalker
names,Leia Organa
ships,Millennium Falcon

────────────────────────────────────
3) JSON
────────────────────────────────────
Flat list:
{ "values": ["Luke Skywalker", "Leia Organa", "Han Solo"] }

Or a bare array:
["Luke Skywalker", "Leia Organa"]

Multi-category (themes):
{
  "categories": {
    "names": ["Luke Skywalker", "Leia Organa"],
    "ships": ["Millennium Falcon", "X-Wing"]
  }
}

Or:
{
  "categories": [
    { "name": "names", "values": ["Luke Skywalker", "Leia Organa"] },
    { "name": "ships", "values": ["Millennium Falcon"] }
  ]
}

────────────────────────────────────
4) XML
────────────────────────────────────
Flat:
<values>
  <value>Luke Skywalker</value>
  <value>Leia Organa</value>
</values>

Multi-category (themes):
<theme>
  <category name="names">
    <value>Luke Skywalker</value>
    <value>Leia Organa</value>
  </category>
  <category name="ships">
    <value>Millennium Falcon</value>
  </category>
</theme>

────────────────────────────────────
Field values lists vs Themes
────────────────────────────────────
• Field values (custom lists): use a flat list only. Multi-category files
  will flatten all values into the open list.
• Themes: multi-category JSON/CSV/XML imports create/fill each category.
  Flat files fill the currently selected category.
`

/**
 * Build a fill-in-the-blank AI prompt for generating upload-ready values.
 * @param {{ mode?: 'theme'|'field', themeName?: string, category?: string, listName?: string, fieldKeys?: string, count?: number, format?: string }} [opts]
 * @returns {string}
 */
export function buildValueAiPrompt(opts = {}) {
  const mode = opts.mode === 'field' ? 'field' : 'theme'
  const themeName = opts.themeName || '[THEME_NAME e.g. Star Wars]'
  const category = opts.category || '[CATEGORY e.g. names]'
  const listName = opts.listName || '[LIST_NAME e.g. Cities]'
  const fieldKeys = opts.fieldKeys || '[FIELD_KEYS e.g. city, address.city]'
  const count = opts.count || 40
  const format = (opts.format || 'json').toLowerCase()

  if (mode === 'field') {
    return `You are generating curated string values for DataForge (local ETL test-data tool).

Fill in the blanks, then output ONLY a single valid file body — no markdown fences, no commentary.

Context
- List name: ${listName}
- Schema field keys this list maps to: ${fieldKeys}
- Desired count: about ${count} unique values
- Tone / domain: [DOMAIN e.g. US cities, product SKUs, fantasy tavern names]
- Constraints: [CONSTRAINTS e.g. max 40 chars, no PII of real people, ASCII only]
- Output format: ${format}  (must be one of: json, csv, txt, xml)

Format rules (follow exactly)
- JSON: { "values": ["…", "…"] }
- CSV: header line "value" then one value per row
- TXT: one value per line
- XML: <values><value>…</value>…</values>
- Unique strings only; no empty strings; no nested objects

Generate the ${format.toUpperCase()} file body now.`
  }

  return `You are generating curated theme pack values for DataForge (local ETL test-data tool).

Fill in the blanks, then output ONLY a single valid file body — no markdown fences, no commentary.

Context
- Theme pack name: ${themeName}
- Primary category (if flat file): ${category}
- Extra categories to include (optional): [MORE_CATEGORIES e.g. ships, planets, lightsabers]
- Desired count: about ${count} unique values per category
- Tone / domain: [DOMAIN e.g. Star Wars names, medieval fantasy, cyberpunk corps]
- Constraints: [CONSTRAINTS e.g. family-friendly, max 48 chars, no copyrighted long quotes]
- Output format: ${format}  (must be one of: json, csv, txt, xml)
- Theme category names: lowercase, digits, underscore or hyphen only (e.g. names, light_sabers)

Format rules (follow exactly)
Preferred multi-category JSON:
{
  "categories": {
    "names": ["…"],
    "ships": ["…"]
  }
}
CSV: category,value
XML: <theme><category name="names"><value>…</value></category>…</theme>
TXT flat (single category only): one value per line
- Unique strings only; no empty strings
- Cap guidance: keep each category at or under 100 values

Generate the ${format.toUpperCase()} file body now.`
}
