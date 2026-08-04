/**
 * Pure UI helpers for list patching and layout density (no I/O).
 * Used by App.vue and covered by node --test.
 */

/** Team export formats offered in chrome (xml / csv / txt only). */
export const TEAM_EXPORT_FORMATS = ['xml', 'csv', 'txt']

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
