/**
 * Pure UI helpers for list patching and layout density (no I/O).
 * Used by App.vue and covered by node --test.
 */

/** Team export formats offered in chrome (xml / csv / txt / xlsx). */
export const TEAM_EXPORT_FORMATS = ['xml', 'csv', 'txt', 'xlsx']

/**
 * Normalize a format string to a team format or fallback.
 * @param {unknown} f
 * @param {string} [fallback='xml']
 */
export function normalizeExportFormat(f, fallback = 'xml') {
  const v = String(f ?? '')
    .trim()
    .toLowerCase()
  return TEAM_EXPORT_FORMATS.includes(v) ? v : fallback
}

/**
 * Insert or replace an item by id in a list (immutably).
 * New items are prepended. Invalid item → shallow copy of list.
 * @template T
 * @param {T[]|null|undefined} list
 * @param {T & {id?: string}} item
 * @param {string} [idKey='id']
 * @returns {T[]}
 */
export function upsertById(list, item, idKey = 'id') {
  const next = Array.isArray(list) ? list.slice() : []
  if (!item || item[idKey] == null) return next
  const i = next.findIndex((x) => x && x[idKey] === item[idKey])
  if (i >= 0) next[i] = item
  else next.unshift(item)
  return next
}

/**
 * Remove an item by id (immutably).
 * @template T
 * @param {T[]|null|undefined} list
 * @param {unknown} id
 * @param {string} [idKey='id']
 * @returns {T[]}
 */
export function removeById(list, id, idKey = 'id') {
  return (Array.isArray(list) ? list : []).filter((x) => x && x[idKey] !== id)
}

/**
 * Left-nav density from panel width (matches App.vue layout rules).
 * @param {number|string|null|undefined} sideWidth
 * @param {boolean} [collapsed=false]
 * @returns {'rail'|'compact'|'cozy'|'comfortable'}
 */
export function sideNavDensityFromWidth(sideWidth, collapsed = false) {
  if (collapsed) return 'rail'
  const w = Number(sideWidth) || 280
  if (w < 228) return 'compact'
  if (w < 280) return 'cozy'
  return 'comfortable'
}

/**
 * Debounced function wrapper (≥250ms typical for search).
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {number} [ms=300]
 * @returns {F & { cancel: () => void, flush: (...args: Parameters<F>) => void, pending: () => boolean }}
 */
export function createDebounced(fn, ms = 300) {
  const delay = Math.max(0, Number(ms) || 0)
  let timer = null
  /** @type {any[]} */
  let lastArgs = []

  function cancel() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function invoke() {
    timer = null
    fn(...lastArgs)
  }

  /** @type {any} */
  const wrapped = (...args) => {
    lastArgs = args
    cancel()
    timer = setTimeout(invoke, delay)
  }

  wrapped.cancel = cancel
  wrapped.flush = (...args) => {
    if (args.length) lastArgs = args
    cancel()
    fn(...lastArgs)
  }
  wrapped.pending = () => timer != null
  return wrapped
}

/**
 * Whether the header primary Generate should show for a workspace.
 * Schema/package: hide when tools rail is visible (rail owns the CTA).
 * @param {string} workspaceMode
 * @param {boolean} toolsRailVisible
 */
export function shouldShowHeaderGenerate(workspaceMode, toolsRailVisible) {
  if (workspaceMode === 'schema' || workspaceMode === 'package') {
    return !toolsRailVisible
  }
  return false
}

/** Labeled chrome groups — App.vue aria-labels must use these strings. */
export const CHROME_ACTION_GROUPS = {
  identity: 'Identity',
  file: 'File',
  structure: 'Structure',
  edit: 'Edit',
  generate: 'Generate',
  danger: 'Danger'
}

/**
 * Visual weight for a chrome action role.
 * Generate is the only primary *generate* role; create may be primary on empty/Library.
 * @param {string} role
 * @returns {'primary'|'secondary'|'danger'|'ghost'}
 */
export function chromeActionWeight(role) {
  switch (String(role || '').toLowerCase()) {
    case 'generate':
    case 'create':
      return 'primary'
    case 'danger':
    case 'delete':
      return 'danger'
    case 'map':
    case 'save':
    case 'secondary':
      return 'secondary'
    default:
      return 'ghost'
  }
}

/**
 * Shipped button class string for a chrome role (App.vue binds this).
 * @param {string} role
 * @param {string} [extra]
 */
export function chromeButtonClass(role, extra = '') {
  const w = chromeActionWeight(role)
  let cls = 'btn btn-ghost'
  if (w === 'primary') cls = 'btn btn-primary'
  else if (w === 'danger') cls = 'btn btn-ghost danger'
  else if (w === 'secondary') cls = 'btn btn-outline'
  const more = String(extra || '').trim()
  return more ? `${cls} ${more}` : cls
}

/**
 * Accessible name for compact / icon-leading chrome. Prefer explicit ariaLabel.
 * Icon-only controls must pass ariaLabel or visibleText.
 * @param {{ visibleText?: string, ariaLabel?: string }} [opts]
 */
export function requireControlName(opts = {}) {
  const aria = String(opts.ariaLabel ?? '').trim()
  if (aria) return aria
  return String(opts.visibleText ?? '').trim()
}

/**
 * Merge /api/bootstrap JSON into a plain target bag of list/status refs-like fields.
 * Pure helper used by App.applyBootstrapPayload path (and tests).
 * Does not touch live generate format/count — caller applies settings separately on boot.
 * @param {Record<string, any>} target mutable bag: schemas, templates, …
 * @param {Record<string, any>|null|undefined} boot
 * @returns {boolean} true if boot looked usable
 */
export function mergeBootstrapPayload(target, boot) {
  if (!boot || typeof boot !== 'object' || !target) return false
  if (Array.isArray(boot.schemas)) target.schemas = boot.schemas
  if (Array.isArray(boot.templates)) target.templates = boot.templates
  if (Array.isArray(boot.customLists)) target.customLists = boot.customLists
  if (Array.isArray(boot.themes)) target.themes = boot.themes
  if (Array.isArray(boot.packages)) target.packages = boot.packages
  if (Array.isArray(boot.deliveryJobs)) target.deliveryJobs = boot.deliveryJobs
  if (Array.isArray(boot.themeCategories)) target.themeCategories = boot.themeCategories
  if (boot.status && typeof boot.status === 'object') target.status = boot.status
  if (boot.settings && typeof boot.settings === 'object') target.settings = boot.settings
  return true
}

/**
 * Build source-mix meter segments from a generate/preview report.
 * Proportions sum to ~100 (largest remainder). Zero total → empty list.
 * @param {Record<string, any>|null|undefined} report
 * @returns {{ key: string, label: string, count: number, pct: number }[]}
 */
export function summarizeFillSources(report) {
  if (!report || typeof report !== 'object') return []
  const parts = [
    { key: 'enum', label: 'Enum', count: Number(report.enumHits) || 0 },
    { key: 'theme', label: 'Theme', count: Number(report.themeHits) || 0 },
    { key: 'custom', label: 'Custom', count: Number(report.customHits) || 0 },
    { key: 'history', label: 'History', count: Number(report.historyHits) || 0 },
    { key: 'synth', label: 'Synth', count: Number(report.synthesized) || 0 },
    {
      key: 'mutate',
      label: 'Mutate',
      count: Number(report.mutatedFromSample ?? report.mutated) || 0
    }
  ]
  const total = parts.reduce((s, p) => s + Math.max(0, p.count), 0)
  if (total <= 0) return []
  const withPct = parts
    .filter((p) => p.count > 0)
    .map((p) => ({
      ...p,
      pct: Math.round((p.count / total) * 1000) / 10
    }))
  // Fix rounding drift on largest segment
  const sum = withPct.reduce((s, p) => s + p.pct, 0)
  if (withPct.length && Math.abs(sum - 100) >= 0.05) {
    let maxI = 0
    for (let i = 1; i < withPct.length; i++) {
      if (withPct[i].count > withPct[maxI].count) maxI = i
    }
    withPct[maxI] = {
      ...withPct[maxI],
      pct: Math.round((withPct[maxI].pct + (100 - sum)) * 10) / 10
    }
  }
  return withPct
}

/**
 * Flatten sample rows for a simple FE table (depth 1 nested objects).
 * Uses API sampleRows when present; else maps records.
 * @param {{ sampleRows?: any[], records?: any[] }|null|undefined} payload
 * @returns {{ columns: string[], rows: Record<string, any>[] }}
 */
export function sampleTableFromPreview(payload) {
  const raw =
    payload && Array.isArray(payload.sampleRows) && payload.sampleRows.length
      ? payload.sampleRows
      : payload && Array.isArray(payload.records)
        ? payload.records.map((r) => flattenSampleRecord(r))
        : []
  const rows = raw.filter((r) => r && typeof r === 'object' && !Array.isArray(r))
  const colSet = new Set()
  for (const r of rows) {
    for (const k of Object.keys(r)) colSet.add(k)
  }
  const columns = [...colSet]
  return { columns, rows }
}

/**
 * @param {any} rec
 * @param {string} [prefix]
 * @param {number} [depth]
 * @returns {Record<string, any>}
 */
export function flattenSampleRecord(rec, prefix = '', depth = 0) {
  const out = {}
  if (rec == null || typeof rec !== 'object' || Array.isArray(rec)) {
    out[prefix || 'value'] = rec
    return out
  }
  if (depth >= 2) {
    out[prefix || 'value'] = rec
    return out
  }
  for (const [k, v] of Object.entries(rec)) {
    const key = prefix ? `${prefix}.${k}` : String(k)
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) {
      Object.assign(out, flattenSampleRecord(v, key, depth + 1))
    } else if (Array.isArray(v)) {
      out[key] =
        v.length && typeof v[0] === 'object' ? `[${v.length} items]` : v
    } else {
      out[key] = v
    }
  }
  return out
}

