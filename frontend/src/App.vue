<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  api,
  downloadBase64,
  downloadBase64Zip,
  downloadBlob,
  downloadText,
  emptyRow,
  emptySchema,
  newId
} from './api'
import BrandIcon from './components/BrandIcon.vue'
import AppDialog from './components/AppDialog.vue'
import FieldValuesCenter from './components/FieldValuesCenter.vue'
import {
  buildSelfClosingMap,
  insertAsChild,
  insertAsSibling,
  moveNode,
  parseFieldClip,
  rekeyNode,
  serializeFieldClip,
  walkDisplay
} from './schemaTree.js'
import { askConfirm, askPrompt } from './dialogController.js'
import {
  TEAM_EXPORT_FORMATS,
  createDebounced,
  mergeBootstrapPayload,
  normalizeExportFormat,
  removeById,
  sampleTableFromPreview,
  shouldShowHeaderGenerate,
  sideNavDensityFromWidth,
  summarizeFillSources,
  upsertById
} from './uiHelpers.js'

const schemas = ref([])
const templates = ref([])
const active = ref(null)
const selectedId = ref(null)
/** Team formats only: xml, csv, txt (json/yaml removed from UI) */
const EXPORT_FORMATS = TEAM_EXPORT_FORMATS
const format = ref('xml')
const recordCount = ref(10)
const seed = ref('')
const ciMode = ref(false)
const csvMultiRow = ref(true)
const csvLayoutMode = ref('single-header')
const csvDelim = ref('.')
const csvNestedAsJson = ref(false)
const xmlRootTag = ref('root')
const xmlRecordTag = ref('record')
const xmlSelfClosing = ref(true)
const streamMode = ref(false)
/** one-file = all records in a single export; per-file = one file per record (archive) */
const outputMode = ref('one-file')
/** Optional download archive: none | tar | tar.gz (checkboxes are mutually exclusive) */
const archiveTar = ref(false)
const archiveTarGz = ref(false)
const generating = ref(false)
/** Last seed-based Generate result (for stats / multi-format archive — file already downloaded). */
const lastGenerated = ref(null)
/** When true, harvest generated field tokens into value_history (off by default). */
const recordGeneratedHistory = ref(false)
const lastReport = ref(null)
/** Last preview/generate payload for sample table (records or sampleRows). */
const lastSamplePayload = ref(null)
const previewing = ref(false)
const previewText = ref('')
const historyPage = ref({ items: [], total: 0, offset: 0, limit: 40 })
const historySearch = ref('')
/** Recent activity (generate runs) + value-fill subview */
const recentActivity = ref([])
const historySubTab = ref('recent') // recent | values
const dataPackSearch = ref('')
const dataPackSubTab = ref('themes') // themes | custom
/** Theme pack browser/editor: { theme, category, bulk, values, stats, loading } */
const themeEditor = ref(null)
const statusMsg = ref('')
const errorMsg = ref('')
/** True while first library load is in flight (boot affordance). */
const bootLoading = ref(false)
let statusDismissTimer = null
let errorDismissTimer = null
/** Debounce timer for theme blend weight → settings */
let themePersistTimer = null
/** Right Generate rail tab (schema options; kept for layout chrome) */
const tab = ref('generate')
const sidebar = ref('schemas')
const schemasExpandedPackages = ref(true)
const status = ref(null)
const settings = ref(null)
const settingsOpen = ref(false)
const archiveEntries = ref([])
const archiveFile = ref(null)
const archivePreview = ref('')
const customLists = ref([])
const activeCustomList = ref(null)
const customListName = ref('')
const customListKeys = ref('')
const customBulkValues = ref('')
const themes = ref([])
const themeCategories = ref([])
const useDataThemes = ref(true)
const themePrefer = ref(true)
const packages = ref([])
const activePackage = ref(null)
const packageMemberPath = ref(null)
const packagePreview = ref('')
/** Editable design sample content for the selected supported member */
const packageEditContent = ref('')
const packageEditName = ref('')
const packageCount = ref(5)
/** Interactive package generate records history only when enabled (default off). */
const packageRecordHistory = ref(false)
const packageDefaultMode = ref('random')
/** memberPath -> fieldPath -> mode */
const packageFieldModes = ref({})
const packageWorking = ref(false)
const packageEstimate = ref(null)
/** itself | tar | tar.gz — form of each package variant */
const packageOutputFormat = ref('itself')
/** Expanded folder paths in nested package explorer */
const packageTreeExpanded = ref({})
const deliveryJobs = ref([])
const deliveryWorking = ref(false)
const deliveryForm = ref({
  name: '',
  packageId: '',
  targetTotal: 100,
  windowHours: 24,
  chunkMin: 5,
  chunkMax: 20,
  destinationPath: '',
  seed: ''
})
/** @type {import('vue').Ref<Array<{ themeId: string, weight: number, name?: string }>>} */
const themeBlend = ref([])

const selected = computed(() => {
  if (!active.value || !selectedId.value) return null
  return findRow(active.value.root, selectedId.value)
})

const tiedPaths = computed(() => active.value?.csvTiedFieldPaths || [])

function findRow(rows, id) {
  for (const r of rows) {
    if (r.id === id) return r
    const c = findRow(r.children || [], id)
    if (c) return c
  }
  return null
}

function flatten(rows, depth = 0, path = []) {
  const out = []
  for (const r of rows) {
    out.push({ row: r, depth, path })
    const seg = (r.key || 'field').trim() || 'field'
    out.push(...flatten(r.children || [], depth + 1, [...path, seg]))
  }
  return out
}

const flatRows = computed(() => (active.value ? flatten(active.value.root) : []))

/** Tree display: nodes + synthetic non-draggable close tags */
const displayRows = computed(() =>
  active.value ? walkDisplay(active.value.root || []) : []
)

/** CSV/TXT: flat header+value grid instead of XML tree chrome */
const isTabularFormat = computed(
  () =>
    format.value === 'csv' ||
    format.value === 'txt' ||
    format.value === 'xlsx'
)

/** Root-level fields as columns (header = key, value rows = samples) */
const tabularColumns = computed(() =>
  active.value && Array.isArray(active.value.root) ? active.value.root : []
)

/** Per-column sample list; always at least one entry (from sampleValue). */
function fieldSampleValues(row) {
  if (!row) return ['']
  if (Array.isArray(row.sampleValues) && row.sampleValues.length) {
    return row.sampleValues.map((v) => (v == null ? '' : String(v)))
  }
  return [row.sampleValue == null ? '' : String(row.sampleValue)]
}

const tabularRowCount = computed(() => {
  const cols = tabularColumns.value
  if (!cols.length) return 1
  let n = 1
  for (const col of cols) {
    n = Math.max(n, fieldSampleValues(col).length)
  }
  return n
})

const tabularRowIndexes = computed(() =>
  Array.from({ length: tabularRowCount.value }, (_, i) => i)
)

function padSampleValues(row, len) {
  const vals = fieldSampleValues(row)
  while (vals.length < len) vals.push('')
  return vals
}

function updateColumnField(id, patch, { undo = true } = {}) {
  if (!active.value || !id) return
  if (undo) pushSchemaUndo()
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === id) {
        const next = { ...r, ...patch }
        if ('sampleValue' in patch && !('sampleValues' in patch)) {
          const vals = fieldSampleValues(r)
          vals[0] = patch.sampleValue == null ? '' : String(patch.sampleValue)
          next.sampleValues = vals
          next.sampleValue = vals[0]
        }
        return next
      }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  selectedId.value = id
  scheduleSchemaPreviewPush(20)
}

function getTabularCell(col, rowIndex) {
  const vals = fieldSampleValues(col)
  return vals[rowIndex] ?? ''
}

function setTabularCell(colId, rowIndex, value, { undo = true } = {}) {
  if (!active.value || !colId) return
  if (undo) pushSchemaUndo()
  const n = Math.max(tabularRowCount.value, rowIndex + 1)
  active.value = {
    ...active.value,
    root: active.value.root.map((r) => {
      if (r.id !== colId) return r
      const vals = padSampleValues(r, n)
      vals[rowIndex] = value == null ? '' : String(value)
      return {
        ...r,
        kind: 'value',
        sampleValues: vals,
        sampleValue: vals[0] ?? ''
      }
    })
  }
  selectedId.value = colId
  scheduleSchemaPreviewPush(20)
}

function setTabularCellLive(colId, rowIndex, value) {
  beginFieldEdit(`${colId}:r${rowIndex}`, colId)
  setTabularCell(colId, rowIndex, value, { undo: false })
}

function addColumn() {
  if (!active.value) return
  pushSchemaUndo()
  const row = emptyRow(active.value.root.length)
  const n = tabularRowCount.value
  row.sampleValues = Array.from({ length: n }, () => '')
  row.sampleValue = ''
  active.value = { ...active.value, root: [...active.value.root, row] }
  selectedId.value = row.id
}

function addTabularRow() {
  if (!active.value) return
  pushSchemaUndo()
  const n = tabularRowCount.value
  active.value = {
    ...active.value,
    root: active.value.root.map((r) => {
      const vals = padSampleValues(r, n)
      vals.push('')
      return {
        ...r,
        sampleValues: vals,
        sampleValue: vals[0] ?? ''
      }
    })
  }
}

function removeTabularRow(rowIndex) {
  if (!active.value || tabularRowCount.value <= 1) return
  if (rowIndex < 0 || rowIndex >= tabularRowCount.value) return
  pushSchemaUndo()
  const n = tabularRowCount.value
  active.value = {
    ...active.value,
    root: active.value.root.map((r) => {
      const vals = padSampleValues(r, n)
      vals.splice(rowIndex, 1)
      if (!vals.length) vals.push('')
      return {
        ...r,
        sampleValues: vals,
        sampleValue: vals[0] ?? ''
      }
    })
  }
}

/** Reorder sample data rows (all columns stay aligned). */
function reorderTabularRows(fromIndex, toIndex, mode) {
  if (!active.value) return
  const n = tabularRowCount.value
  if (n <= 1) return
  if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return

  let insertAt = mode === 'before' ? toIndex : toIndex + 1
  if (fromIndex < insertAt) insertAt -= 1
  if (fromIndex === insertAt) return

  pushSchemaUndo()
  active.value = {
    ...active.value,
    root: active.value.root.map((r) => {
      const vals = padSampleValues(r, n)
      const [moved] = vals.splice(fromIndex, 1)
      vals.splice(insertAt, 0, moved)
      return {
        ...r,
        sampleValues: vals,
        sampleValue: vals[0] ?? ''
      }
    })
  }
}

const tabRowDragFrom = ref(null)
/** @type {import('vue').Ref<{ index: number, mode: 'before'|'after' } | null>} */
const tabRowDropHint = ref(null)

function onTabRowDragStart(ev, rowIndex) {
  tabRowDragFrom.value = rowIndex
  tabRowDropHint.value = null
  try {
    ev.dataTransfer.setData('text/plain', `tab-row:${rowIndex}`)
    ev.dataTransfer.effectAllowed = 'move'
  } catch {
    /* ignore */
  }
}

function onTabRowDragEnd() {
  tabRowDragFrom.value = null
  tabRowDropHint.value = null
}

function onTabRowDragOver(ev, rowIndex) {
  if (tabRowDragFrom.value == null) return
  if (tabRowDragFrom.value === rowIndex) {
    tabRowDropHint.value = null
    return
  }
  ev.preventDefault()
  try {
    ev.dataTransfer.dropEffect = 'move'
  } catch {
    /* ignore */
  }
  const rect = ev.currentTarget.getBoundingClientRect()
  const mode = ev.clientY - rect.top < rect.height * 0.5 ? 'before' : 'after'
  tabRowDropHint.value = { index: rowIndex, mode }
}

function onTabRowDrop(ev, rowIndex) {
  ev.preventDefault()
  const from = tabRowDragFrom.value
  const hint = tabRowDropHint.value
  onTabRowDragEnd()
  if (from == null) return
  if (hint && hint.index === rowIndex) {
    reorderTabularRows(from, hint.index, hint.mode)
  } else if (from !== rowIndex) {
    const rect = ev.currentTarget.getBoundingClientRect()
    const mode = ev.clientY - rect.top < rect.height * 0.5 ? 'before' : 'after'
    reorderTabularRows(from, rowIndex, mode)
  }
}

function removeColumn(id) {
  if (!active.value || !id) return
  if (id && tabularColWidths.value[id] != null) {
    const next = { ...tabularColWidths.value }
    delete next[id]
    tabularColWidths.value = next
    saveTabularSizes()
  }
  selectedId.value = id
  deleteSelected()
}

/** CSV/TXT column width prefs (view only — not schema data) */
const TABULAR_SIZE_KEY = 'dataforge.tabularSizes.v1'
const DEFAULT_TAB_COL_W = 152
const MIN_TAB_COL_W = 72
const MAX_TAB_COL_W = 520
const tabularColWidths = ref(/** @type {Record<string, number>} */ ({}))

function loadTabularSizes() {
  try {
    const raw = localStorage.getItem(TABULAR_SIZE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed?.cols && typeof parsed.cols === 'object') {
      tabularColWidths.value = parsed.cols
    }
  } catch {
    /* ignore */
  }
}

function saveTabularSizes() {
  try {
    localStorage.setItem(
      TABULAR_SIZE_KEY,
      JSON.stringify({ cols: tabularColWidths.value })
    )
  } catch {
    /* ignore */
  }
}

function getTabColWidth(colId) {
  const w = Number(tabularColWidths.value[colId])
  if (Number.isFinite(w) && w > 0) {
    return Math.min(MAX_TAB_COL_W, Math.max(MIN_TAB_COL_W, w))
  }
  return DEFAULT_TAB_COL_W
}

function tabularColStyle(colId) {
  const w = getTabColWidth(colId)
  return {
    width: `${w}px`,
    minWidth: `${w}px`,
    maxWidth: `${w}px`
  }
}

/** @type {{ id: string, startX: number, startSize: number } | null} */
let tabResizeSession = null

function onTabColResizeDown(ev, colId) {
  ev.preventDefault()
  ev.stopPropagation()
  tabResizeSession = {
    id: colId,
    startX: ev.clientX,
    startSize: getTabColWidth(colId)
  }
  window.addEventListener('pointermove', onTabResizeMove)
  window.addEventListener('pointerup', onTabResizeUp)
  document.body.classList.add('resizing-tab-col')
}

function onTabResizeMove(ev) {
  if (!tabResizeSession) return
  const dx = ev.clientX - tabResizeSession.startX
  const w = Math.min(
    MAX_TAB_COL_W,
    Math.max(MIN_TAB_COL_W, tabResizeSession.startSize + dx)
  )
  tabularColWidths.value = {
    ...tabularColWidths.value,
    [tabResizeSession.id]: w
  }
}

function onTabResizeUp() {
  tabResizeSession = null
  window.removeEventListener('pointermove', onTabResizeMove)
  window.removeEventListener('pointerup', onTabResizeUp)
  document.body.classList.remove('resizing-tab-col')
  saveTabularSizes()
}

const dragId = ref(null)
const dropHint = ref(null) // { id, mode: 'before'|'after'|'into' }

function selfClosingSelectValue(row) {
  if (!row || typeof row.selfClosing !== 'boolean') return 'default'
  return row.selfClosing ? 'self' : 'pair'
}

function setSelfClosingMode(mode) {
  if (mode === 'default') updateSelected({ selfClosing: undefined })
  else if (mode === 'self') updateSelected({ selfClosing: true })
  else updateSelected({ selfClosing: false })
}

function onRowDragStart(ev, row) {
  dragId.value = row.id
  try {
    ev.dataTransfer.setData('text/plain', row.id)
    ev.dataTransfer.effectAllowed = 'move'
  } catch {
    /* ignore */
  }
}

function onRowDragEnd() {
  dragId.value = null
  dropHint.value = null
}

function onRowDragOver(ev, item, mode) {
  if (!dragId.value || item.type !== 'node') return
  if (dragId.value === item.row.id) return
  ev.preventDefault()
  dropHint.value = { id: item.row.id, mode }
}

function onRowDrop(ev, item, mode) {
  ev.preventDefault()
  if (!active.value || !dragId.value || item.type !== 'node') return
  const from = dragId.value
  const to = item.row.id
  // Preview move without committing so we only push undo on success
  const result = moveNode(active.value.root, from, to, mode)
  dragId.value = null
  dropHint.value = null
  if (result.error) {
    flashError(result.error)
    return
  }
  pushSchemaUndo()
  active.value = { ...active.value, root: result.root }
  selectedId.value = from
  flashStatus('Field moved')
}

/** Schema edit undo stack (field tree + selection) */
const UNDO_MAX = 50
const schemaUndoStack = ref([])

function clearSchemaUndo() {
  schemaUndoStack.value = []
}

function pushSchemaUndo() {
  if (!active.value) return
  schemaUndoStack.value.push({
    root: JSON.parse(JSON.stringify(active.value.root || [])),
    selectedId: selectedId.value
  })
  if (schemaUndoStack.value.length > UNDO_MAX) {
    schemaUndoStack.value.shift()
  }
}

function undoSchemaEdit() {
  if (!active.value) return
  if (!schemaUndoStack.value.length) {
    flashError('Nothing to undo')
    return
  }
  const snap = schemaUndoStack.value.pop()
  active.value = { ...active.value, root: snap.root }
  selectedId.value = snap.selectedId
  // Ensure selection still exists
  if (selectedId.value && !findNodeById(active.value.root, selectedId.value)) {
    selectedId.value = active.value.root[0]?.id || null
  }
  flashStatus('Undone')
}

const canUndoSchema = computed(() => schemaUndoStack.value.length > 0)

/** In-memory fallback when Clipboard API is unavailable */
const fieldClipboard = ref(null)

function findNodeById(rows, id) {
  for (const r of rows || []) {
    if (r.id === id) return r
    const hit = findNodeById(r.children || [], id)
    if (hit) return hit
  }
  return null
}

async function copyField(rowId) {
  if (!active.value) return
  const id = rowId || selectedId.value
  if (!id) {
    flashError('Select a field to copy')
    return
  }
  const node = findNodeById(active.value.root, id)
  if (!node) {
    flashError('Field not found')
    return
  }
  selectedId.value = id
  const text = serializeFieldClip(node)
  fieldClipboard.value = text
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    }
  } catch {
    /* memory fallback only */
  }
  flashStatus(`Copied “${(node.key || 'field').trim() || 'field'}”`)
}

async function pasteField() {
  if (!active.value) return
  let text = fieldClipboard.value
  try {
    if (navigator.clipboard?.readText) {
      const sys = await navigator.clipboard.readText()
      if (sys && parseFieldClip(sys)) text = sys
    }
  } catch {
    /* use memory */
  }
  const raw = parseFieldClip(text)
  if (!raw) {
    flashError('Nothing to paste — copy a field first')
    return
  }
  const node = rekeyNode(raw, newId)
  if (!node) {
    flashError('Invalid field clipboard')
    return
  }
  pushSchemaUndo()
  let next
  if (selectedId.value) {
    next = insertAsSibling(active.value.root, selectedId.value, node, 'after')
  } else {
    next = insertAsChild(active.value.root, null, node, -1)
  }
  active.value = { ...active.value, root: next }
  selectedId.value = node.id
  flashStatus(`Pasted “${(node.key || 'field').trim() || 'field'}”`)
}

function isEditableTarget(el) {
  if (!el || !(el instanceof Element)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return !!el.closest('input, textarea, select, [contenteditable="true"]')
}

function onSchemaClipboardKeydown(ev) {
  if (workspaceMode.value !== 'schema' || !active.value) return
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return
  const key = (ev.key || '').toLowerCase()
  if (key === 'z' && !ev.shiftKey) {
    if (isEditableTarget(ev.target)) return
    ev.preventDefault()
    undoSchemaEdit()
    return
  }
  if (key !== 'c' && key !== 'v') return
  if (isEditableTarget(ev.target)) return
  if (key === 'c') {
    if (!selectedId.value) return
    ev.preventDefault()
    copyField(selectedId.value)
  } else {
    ev.preventDefault()
    pasteField()
  }
}

function pathLabel(path, row) {
  const leaf = (row.key || 'field').trim() || 'field'
  return [...path, leaf].join('.')
}

function pathIsTied(pathStr) {
  if (!pathStr) return false
  const p = String(pathStr).toLowerCase()
  return tiedPaths.value.some((t) => String(t).toLowerCase() === p)
}

/** random | same | unique — same model for XML / CSV / TXT value fields */
function getSelectedGenerateMode() {
  const row = selected.value
  if (!row || row.kind !== 'value') return 'random'
  if (row.isPrimary || row.isUnique) return 'unique'
  if (pathIsTied(selectedFieldPath.value)) return 'same'
  return 'random'
}

/**
 * Set generate mode for the selected value field.
 * same → csvTiedFieldPaths (backend keeps value constant across records)
 * unique → isUnique
 * random → neither
 * @param {'random'|'same'|'unique'} mode
 * @param {{ primary?: boolean }} [opts]
 */
function setSelectedGenerateMode(mode, opts = {}) {
  if (!active.value || !selectedId.value || !selected.value) return
  if (selected.value.kind !== 'value') return
  const m = mode === 'same' || mode === 'unique' ? mode : 'random'
  pushSchemaUndo()
  const id = selectedId.value
  const path = selectedFieldPath.value
  let tied = [...(active.value.csvTiedFieldPaths || [])]
  if (path) {
    tied = tied.filter((t) => String(t).toLowerCase() !== path.toLowerCase())
    if (m === 'same') tied.push(path)
  }
  const forcePrimary = opts.primary === true
  const clearPrimary = opts.primary === false || m !== 'unique'
  function walk(rows) {
    return (rows || []).map((r) => {
      if (r.id === id) {
        return {
          ...r,
          isUnique: m === 'unique',
          isPrimary: forcePrimary ? true : clearPrimary ? false : !!r.isPrimary,
          children: walk(r.children || [])
        }
      }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = {
    ...active.value,
    root: walk(active.value.root),
    csvTiedFieldPaths: tied.length ? tied : undefined
  }
}

/**
 * Apply a /api/bootstrap payload into local refs (no settings clobber of live format).
 * @param {Record<string, any>} boot
 */
function applyBootstrapPayload(boot) {
  const bag = {}
  if (!mergeBootstrapPayload(bag, boot)) return false
  if (bag.schemas) schemas.value = bag.schemas
  if (bag.templates) templates.value = bag.templates
  if (bag.customLists) customLists.value = bag.customLists
  if (bag.themes) themes.value = bag.themes
  if (bag.packages) packages.value = bag.packages
  if (bag.deliveryJobs) deliveryJobs.value = bag.deliveryJobs
  if (bag.themeCategories) themeCategories.value = bag.themeCategories
  if (bag.status) status.value = bag.status
  if (bag.settings) settings.value = bag.settings
  return true
}

/**
 * Full library reload for boot / backup import.
 * Prefers /api/bootstrap; falls back to multi-GET path if missing/failed.
 * Does not re-apply settings to live generate controls (use applySettingsLocal).
 */
async function refresh() {
  let usedBootstrap = false
  try {
    const boot = await api.bootstrap()
    usedBootstrap = applyBootstrapPayload(boot)
  } catch {
    usedBootstrap = false
  }
  if (!usedBootstrap) {
    schemas.value = await api.listSchemas()
    templates.value = await api.listTemplates()
    try {
      customLists.value = await api.listCustomLists()
      themes.value = await api.listThemes()
      const cats = await api.themeCategories()
      themeCategories.value = cats.categories || []
      packages.value = await api.listPackages()
      try {
        deliveryJobs.value = await api.listDeliveryJobs()
      } catch {
        /* older */
      }
    } catch {
      /* optional lists may fail on older backends */
    }
    status.value = await api.status()
    settings.value = await api.getSettings()
  }
  await loadHistory()
  // Keep Field settings Category dropdown in sync with theme pools
  await reloadFieldThemeCategories()
}

/** Schemas + packages + templates only (library mutations). */
async function refreshLibraryLists() {
  try {
    schemas.value = await api.listSchemas()
    templates.value = await api.listTemplates()
    packages.value = await api.listPackages()
  } catch (e) {
    flashError(e.message || 'Could not refresh library')
  }
}

/** Themes + custom field lists (data packs mutations). */
async function refreshDataPackLists() {
  try {
    customLists.value = await api.listCustomLists()
    themes.value = await api.listThemes()
    const cats = await api.themeCategories()
    themeCategories.value = cats.categories || []
  } catch (e) {
    flashError(e.message || 'Could not refresh data packs')
  }
}

/** Status counters only (no settings clobber). */
async function refreshStatusOnly() {
  try {
    status.value = await api.status()
  } catch {
    /* ignore */
  }
}

/**
 * Apply persisted settings into live controls.
 * Call only on boot and after explicit Settings saves — not after every list refresh
 * (otherwise defaultExportFormat / defaultRecordCount clobber the active run).
 */
function applySettingsLocal(s) {
  if (!s) return
  if (s.defaultExportFormat) {
    format.value = normalizeExportFormat(s.defaultExportFormat, 'xml')
  }
  if (s.defaultRecordCount) recordCount.value = s.defaultRecordCount
  if (typeof s.csvMultiRow === 'boolean') csvMultiRow.value = s.csvMultiRow
  if (s.csvLayoutMode) csvLayoutMode.value = s.csvLayoutMode
  if (s.csvFlattenDelimiter) csvDelim.value = s.csvFlattenDelimiter
  if (typeof s.csvNestedAsJson === 'boolean') csvNestedAsJson.value = s.csvNestedAsJson
  if (s.xmlRootTag) xmlRootTag.value = s.xmlRootTag
  if (s.xmlRecordTag) xmlRecordTag.value = s.xmlRecordTag
  if (typeof s.xmlSelfClosing === 'boolean') xmlSelfClosing.value = s.xmlSelfClosing
  if (s.dataThemes) {
    useDataThemes.value = s.dataThemes.enabled !== false
    themePrefer.value = s.dataThemes.preferOverHistory !== false
    const blend = s.dataThemes.blend || []
    themeBlend.value = blend.map((b) => ({
      themeId: b.themeId,
      weight: b.weight ?? 1,
      name: themes.value.find((t) => t.id === b.themeId)?.name
    }))
  }
  if (s.themeMode) applyTheme(s.themeMode, s.customColors)
}

async function persistDataThemes() {
  try {
    settings.value = await api.setSettings({
      dataThemes: {
        enabled: useDataThemes.value,
        preferOverHistory: themePrefer.value,
        blend: themeBlend.value.map((b) => ({
          themeId: b.themeId,
          weight: Number(b.weight) || 1
        }))
      }
    })
  } catch (e) {
    flashError(e.message || 'Could not save theme settings')
  }
}

function toggleThemeInBlend(theme) {
  const i = themeBlend.value.findIndex((b) => b.themeId === theme.id)
  if (i >= 0) themeBlend.value.splice(i, 1)
  else themeBlend.value.push({ themeId: theme.id, weight: 1, name: theme.name })
  void persistDataThemes()
}

function isThemeActive(id) {
  return themeBlend.value.some((b) => b.themeId === id)
}

function setThemeWeight(id, weight) {
  const b = themeBlend.value.find((x) => x.themeId === id)
  if (b) {
    b.weight = Number(weight) || 1
    schedulePersistDataThemes()
  }
}

/** Debounce weight edits so each keystroke does not hit the API. */
function schedulePersistDataThemes() {
  if (themePersistTimer) clearTimeout(themePersistTimer)
  themePersistTimer = setTimeout(() => {
    themePersistTimer = null
    void persistDataThemes()
  }, 350)
}

/** Field marked as the multi-record unit (isRecordTag). */
function findRecordTagField(rows) {
  for (const r of rows || []) {
    if (r?.isRecordTag) return r
    const hit = findRecordTagField(r.children || [])
    if (hit) return hit
  }
  return null
}

/** Schema path to the record-tag field, e.g. ['catalog','book']. */
function pathToRecordTag(rows, prefix = []) {
  for (const r of rows || []) {
    const key = ((r?.key || 'field') + '').trim() || 'field'
    const full = [...prefix, key]
    if (r?.isRecordTag) return full
    const hit = pathToRecordTag(r.children || [], full)
    if (hit) return hit
  }
  return null
}

function resolveXmlRecordTag() {
  const marked = active.value ? findRecordTagField(active.value.root) : null
  if (marked) {
    const tag = (marked.key || 'record').trim() || 'record'
    return tag
  }
  return (xmlRecordTag.value || 'record').trim() || 'record'
}

/** Keep schema meta + local ref aligned with the marked field (if any). */
function syncXmlRecordTagFromSchema() {
  const tag = resolveXmlRecordTag()
  xmlRecordTag.value = tag
  if (active.value && active.value.xmlRecordTag !== tag) {
    active.value = { ...active.value, xmlRecordTag: tag }
  }
}

/** Exclusive checkbox: only one field can be the record tag. */
function setSelectedAsRecordTag(enabled) {
  if (!active.value || !selectedId.value) return
  pushSchemaUndo()
  const id = selectedId.value
  function walk(rows) {
    return (rows || []).map((r) => ({
      ...r,
      isRecordTag: enabled ? r.id === id : false,
      children: walk(r.children || [])
    }))
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  if (enabled) {
    const row = findRow(active.value.root, id)
    const tag = (row?.key || 'record').trim() || 'record'
    xmlRecordTag.value = tag
    active.value = { ...active.value, xmlRecordTag: tag }
  } else {
    xmlRecordTag.value = 'record'
    active.value = { ...active.value, xmlRecordTag: 'record' }
  }
}

function xmlExportOpts() {
  const map =
    active.value?.root != null
      ? buildSelfClosingMap(active.value.root)
      : {}
  const recTag = resolveXmlRecordTag()
  xmlRecordTag.value = recTag
  const opts = {
    xmlRootTag: xmlRootTag.value || 'root',
    xmlRecordTag: recTag,
    xmlSelfClosing: xmlSelfClosing.value
  }
  if (map && Object.keys(map).length) opts.xmlSelfClosingMap = map
  return opts
}

async function persistXmlSettings() {
  try {
    settings.value = await api.setSettings({
      xmlRootTag: xmlRootTag.value || 'root',
      xmlRecordTag: xmlRecordTag.value || 'record',
      xmlSelfClosing: xmlSelfClosing.value
    })
  } catch {
    /* ignore soft save failures */
  }
}

function applyTheme(mode, colors) {
  const root = document.documentElement
  const dark = mode !== 'light'
  root.dataset.theme = dark ? 'dark' : 'light'
  if (colors) {
    for (const [k, v] of Object.entries(colors)) {
      root.style.setProperty(`--${k === 'surface2' ? 'surface-2' : k}`, v)
    }
  }
}

async function loadHistory() {
  historyPage.value = await api.historyPage(
    0,
    historyPage.value.limit || 40,
    historySearch.value
  )
}

/** A4: debounced Fill values search (≥250ms) against history page API. */
const loadHistoryDebounced = createDebounced(() => {
  void loadHistory()
}, 300)

watch(historySearch, () => {
  if (historySubTab.value !== 'values') return
  loadHistoryDebounced()
})

async function loadRecentActivity() {
  try {
    recentActivity.value = await api.activity(50)
  } catch {
    recentActivity.value = []
  }
}

function flashStatus(msg) {
  statusMsg.value = msg
  errorMsg.value = ''
}

function flashError(msg) {
  errorMsg.value = msg
}

watch(statusMsg, (v) => {
  if (statusDismissTimer) clearTimeout(statusDismissTimer)
  statusDismissTimer = null
  if (!v) return
  statusDismissTimer = setTimeout(() => {
    if (statusMsg.value === v) statusMsg.value = ''
  }, 5000)
})

watch(errorMsg, (v) => {
  if (errorDismissTimer) clearTimeout(errorDismissTimer)
  errorDismissTimer = null
  if (!v) return
  // Errors stay a bit longer so users can read them
  errorDismissTimer = setTimeout(() => {
    if (errorMsg.value === v) errorMsg.value = ''
  }, 8000)
})

onMounted(async () => {
  loadLayoutPrefs()
  loadTabularSizes()
  loadSchemaPreviewPrefs()
  ensureSchemaPreviewChannel()
  applyWorkspaceLayoutDefaults(workspaceMode.value)
  window.addEventListener('keydown', onSchemaClipboardKeydown)
  bootLoading.value = true
  try {
    await refresh()
    applySettingsLocal(settings.value)
    await loadRecentActivity()
    if (schemas.value.length) {
      active.value = schemas.value[0]
      selectedId.value = active.value.root[0]?.id || null
      syncXmlTagsFromSchema(active.value)
    } else {
      active.value = emptySchema('My first schema')
      selectedId.value = active.value.root[0].id
    }
  } catch (e) {
    flashError(e.message + ' — is the API running? (uvicorn on port 8765)')
  } finally {
    bootLoading.value = false
  }
})

onUnmounted(() => {
  if (statusDismissTimer) clearTimeout(statusDismissTimer)
  if (errorDismissTimer) clearTimeout(errorDismissTimer)
  if (themePersistTimer) clearTimeout(themePersistTimer)
  loadHistoryDebounced.cancel()
  window.removeEventListener('keydown', onSchemaClipboardKeydown)
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointermove', onPropsResizeMove)
  window.removeEventListener('pointerup', onPropsResizeUp)
  window.removeEventListener('pointermove', onTabResizeMove)
  window.removeEventListener('pointerup', onTabResizeUp)
  window.removeEventListener('pointermove', onSchemaFloatDragMove)
  window.removeEventListener('pointerup', onSchemaFloatDragUp)
  document.body.classList.remove('resizing-cols')
  document.body.classList.remove('resizing-props')
  document.body.classList.remove('resizing-tab-col')
  document.body.classList.remove('dragging-schema-float')
  stopSchemaPreviewWatch()
  if (previewPushTimer) {
    clearTimeout(previewPushTimer)
    previewPushTimer = null
  }
  try {
    schemaPreviewBc?.close()
  } catch {
    /* ignore */
  }
  schemaPreviewBc = null
  // Leave pop-out open if user still wants it; drop our handle
  schemaPreviewWin = null
})

function syncXmlTagsFromSchema(schema) {
  if (!schema) return
  if (schema.xmlRootTag) xmlRootTag.value = schema.xmlRootTag
  if (schema.xmlRecordTag) xmlRecordTag.value = schema.xmlRecordTag
}

function prepareSchemaForSave() {
  if (!active.value) return null
  active.value.xmlRootTag = xmlRootTag.value || 'root'
  active.value.xmlRecordTag = xmlRecordTag.value || 'record'
  if (format.value && EXPORT_FORMATS.includes(format.value)) {
    active.value.sourceFormat = format.value
  }
  return active.value
}

async function saveSchema() {
  if (!active.value) return
  try {
    prepareSchemaForSave()
    const saved = await api.saveSchema(active.value)
    active.value = saved
    syncXmlTagsFromSchema(saved)
    schemas.value = upsertById(schemas.value, saved)
    flashStatus(`Saved “${saved.name}”`)
    await refreshStatusOnly()
  } catch (e) {
    flashError(e.message)
  }
}

/** Map every non-theme sample value into Field values pools (by tag/column). */
async function mapSchemaFields() {
  if (!active.value) return
  try {
    prepareSchemaForSave()
    const res = await api.mapSchemaFields(active.value)
    const saved = res.schema || res
    active.value = saved
    syncXmlTagsFromSchema(saved)
    const sync = res.fieldValuesSynced || {}
    const inserted = Number(sync.inserted) || 0
    const fields = Number(sync.fields) || 0
    const warn = Array.isArray(sync.warnings) && sync.warnings.length ? ` · ${sync.warnings[0]}` : ''
    if (inserted || fields) {
      flashStatus(
        `Mapped ${inserted} new value(s) into ${fields} tag pool(s)${warn}`
      )
    } else {
      flashStatus(
        'No new pool values (add samples on fields, or pools already have them)'
      )
    }
    schemas.value = upsertById(schemas.value, saved)
    await refreshDataPackLists()
    await refreshStatusOnly()
  } catch (e) {
    flashError(e.message)
  }
}

function newSchema() {
  clearSchemaUndo()
  active.value = emptySchema()
  selectedId.value = active.value.root[0].id
  lastGenerated.value = null
  previewText.value = ''
}

async function selectSchema(id) {
  const s = schemas.value.find((x) => x.id === id)
  if (!s) return
  clearSchemaUndo()
  active.value = JSON.parse(JSON.stringify(s))
  selectedId.value = active.value.root[0]?.id || null
  lastGenerated.value = null
  syncXmlTagsFromSchema(active.value)
  if (s.sourceFormat && EXPORT_FORMATS.includes(String(s.sourceFormat).toLowerCase())) {
    format.value = String(s.sourceFormat).toLowerCase()
  }
  // Multifile preview → open package workspace for real edit layers
  if (s.isMultifile && s.packageId) {
    sidebar.value = 'packages'
    await openPackage(s.packageId)
    return
  }
  sidebar.value = 'schemas'
  try {
    await api.touchSchema(id)
  } catch {
    /* ignore */
  }
}

async function deleteSchema() {
  if (!active.value?.id) return
  if (active.value.isMultifile || active.value.isPackageMember || active.value.packageId) {
    errorMsg.value =
      'This schema belongs to a package. Open Packages and delete the package instead.'
    return
  }
  if (
    !(await askConfirm(`Delete schema “${active.value.name}”?`, {
      title: 'Delete schema',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  try {
    const deletedId = active.value.id
    await api.deleteSchema(deletedId)
    schemas.value = removeById(schemas.value, deletedId)
    await refreshStatusOnly()
    if (schemas.value.length) selectSchema(schemas.value[0].id)
    else newSchema()
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function cloneSchema() {
  if (!active.value?.id) return
  if (!schemas.value.some((s) => s.id === active.value.id)) {
    errorMsg.value = 'Save the schema to the library before duplicating.'
    return
  }
  if (active.value.isMultifile || active.value.isPackageMember || active.value.packageId) {
    errorMsg.value =
      'Package member schemas cannot be duplicated here. Open Packages and save a member as a new schema instead.'
    return
  }
  try {
    const cloned = await api.cloneSchema(active.value.id)
    schemas.value = upsertById(schemas.value, cloned)
    clearSchemaUndo()
    active.value = cloned
    selectedId.value = active.value.root?.[0]?.id || null
    await refreshStatusOnly()
    flashStatus(`Duplicated as “${cloned.name}”`)
  } catch (e) {
    flashError(e.message)
  }
}

async function onImport(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  try {
    const res = await api.importFile(file)
    clearSchemaUndo()
    active.value = res.schema
    selectedId.value = active.value.root[0]?.id || null
    format.value = res.format || format.value
    if (res.recordHint) {
      recordCount.value = Math.min(Math.max(res.recordHint, 1), 10000)
    }
    statusMsg.value = `Imported “${res.schema.name}” (${String(res.format).toUpperCase()}) · scanned ${res.scannedRecords} · history ${res.historyValues}`
    errorMsg.value = ''
    await refreshLibraryLists()
    await refreshStatusOnly()
    await api.setSettings({ defaultExportFormat: format.value })
  } catch (e) {
    errorMsg.value = e.message
  }
}

function addRoot() {
  if (!active.value) return
  pushSchemaUndo()
  const row = emptyRow(active.value.root.length)
  active.value = { ...active.value, root: [...active.value.root, row] }
  selectedId.value = row.id
}

function addChild() {
  if (!active.value || !selectedId.value) return
  pushSchemaUndo()
  const parentId = selectedId.value
  const row = emptyRow()
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === parentId) {
        const children = [...(r.children || []), row]
        return {
          ...r,
          kind: r.kind === 'value' ? 'object' : r.kind,
          children
        }
      }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  selectedId.value = row.id
}

function updateSelected(patch) {
  if (!active.value || !selectedId.value) return
  pushSchemaUndo()
  patchSelectedField(selectedId.value, patch, { undo: false })
}

/**
 * Patch a field by id. Use undo:true for discrete actions; undo:false for live typing
 * (caller should pushSchemaUndo once on focus).
 */
function patchSelectedField(id, patch, { undo = false } = {}) {
  if (!active.value || !id) return
  if (undo) pushSchemaUndo()
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === id) {
        const next = { ...r, ...patch }
        if ('sampleValue' in patch && !('sampleValues' in patch)) {
          const vals = fieldSampleValues(r)
          vals[0] = patch.sampleValue == null ? '' : String(patch.sampleValue)
          next.sampleValues = vals
          next.sampleValue = vals[0]
        }
        return next
      }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  if (patch && (Object.prototype.hasOwnProperty.call(patch, 'key') || patch.isRecordTag)) {
    syncXmlRecordTagFromSchema()
  }
  scheduleSchemaPreviewPush(20)
}

/** One undo snapshot per focused field edit session */
let fieldEditUndoId = null
function beginFieldEdit(sessionId, fieldId = null) {
  if (!sessionId) return
  if (fieldId) selectField(fieldId)
  if (fieldEditUndoId !== sessionId) {
    pushSchemaUndo()
    fieldEditUndoId = sessionId
  }
}
function endFieldEdit() {
  fieldEditUndoId = null
}

/** Select a schema field/column so row highlight tracks pointer/focus. */
function selectField(id) {
  if (!id || selectedId.value === id) return
  selectedId.value = id
}

function deleteSelected() {
  if (!active.value || !selectedId.value) return
  pushSchemaUndo()
  const id = selectedId.value
  function walk(rows) {
    return rows
      .filter((r) => r.id !== id)
      .map((r) => ({ ...r, children: walk(r.children || []) }))
  }
  const root = walk(active.value.root)
  active.value = {
    ...active.value,
    root: root.length ? root : [emptyRow(0)]
  }
  selectedId.value = active.value.root[0]?.id || null
}

function genBody(extra = {}) {
  const seedNum = seed.value.trim() === '' ? null : Number(seed.value)
  syncXmlRecordTagFromSchema()
  return {
    schema: {
      ...active.value,
      xmlRecordTag: resolveXmlRecordTag(),
      // Tied paths = Generate mode "Same" (all formats; key name is legacy)
      csvTiedFieldPaths: active.value.csvTiedFieldPaths
    },
    recordCount: recordCount.value,
    seed: Number.isFinite(seedNum) ? seedNum >>> 0 : null,
    ciMode: ciMode.value,
    // Only write field tokens to SQLite history when user opts in (never full rows)
    recordHistory: !ciMode.value && recordGeneratedHistory.value,
    useDataThemes: useDataThemes.value,
    themePreferOverHistory: themePrefer.value,
    themeBlend: themeBlend.value.map((b) => ({
      themeId: b.themeId,
      weight: Number(b.weight) || 1
    })),
    format: format.value,
    multiRow: csvMultiRow.value,
    layoutMode: csvLayoutMode.value,
    delim: csvDelim.value,
    nestedAsJson: csvNestedAsJson.value,
    ...xmlExportOpts(),
    ...extra
  }
}

const generateButtonLabel = computed(() =>
  generating.value ? 'Working…' : 'Generate'
)

const fillSourceMeters = computed(() => summarizeFillSources(lastReport.value))

const sampleTable = computed(() => sampleTableFromPreview(lastSamplePayload.value))

async function previewSamples() {
  if (!active.value) return
  if (active.value.isMultifile) {
    errorMsg.value =
      'This is a package preview schema. Open Packages and Generate variants there.'
    return
  }
  previewing.value = true
  errorMsg.value = ''
  try {
    // Cap for UI table; does not change user's Generate recordCount
    const n = Math.min(20, Math.max(1, Number(recordCount.value) || 5))
    const res = await api.generatePreview(
      genBody({
        recordCount: Math.min(n, 20),
        recordHistory: false
      })
    )
    lastReport.value = res.report || null
    lastSamplePayload.value = res
    lastGenerated.value = {
      ...res,
      previewOnly: true,
      format: format.value
    }
    // Compact text fallback for existing preview pane
    try {
      const rows = res.sampleRows || res.records || []
      previewText.value = JSON.stringify(rows, null, 2)
    } catch {
      previewText.value = String(res.recordCount || 0) + ' sample row(s)'
    }
    tab.value = 'generate'
    if (!showRightPanel.value) {
      layout.value.previewCollapsed = false
      saveLayoutPrefs()
    }
    flashStatus(
      `Preview ${res.recordCount} sample(s) · seed ${res.seed} · ${res.ms}ms (not downloaded)`
    )
  } catch (e) {
    flashError(e.message)
  } finally {
    previewing.value = false
  }
}

function sanitizeFileBase(name) {
  return (
    String(name || 'export')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\.+$/, '')
      .trim() || 'export'
  )
}

/**
 * Folder name placed inside the archive (and archive file base name).
 * Prefer a parent directory from source path; else schema name / file base.
 */
function resolveArchiveDirName() {
  const schema = active.value
  if (!schema) return 'export'
  const src = String(schema.sourceFileName || '').replace(/\\/g, '/')
  const parts = src.split('/').filter(Boolean)
  if (parts.length >= 2) {
    // path like MyDir/file.xml → archive dir MyDir
    return sanitizeFileBase(parts[parts.length - 2])
  }
  let base = schema.name || (parts[0] ? parts[0].replace(/\.[^.]+$/, '') : '') || 'export'
  base = String(base).replace(/\.(xml|csv|txt|json|yaml|yml)$/i, '')
  return sanitizeFileBase(base)
}

function selectedArchiveFormat() {
  if (archiveTarGz.value) return 'tar.gz'
  if (archiveTar.value) return 'tar'
  return null
}

function setArchiveTar(on) {
  archiveTar.value = !!on
  if (on) archiveTarGz.value = false
}

function setArchiveTarGz(on) {
  archiveTarGz.value = !!on
  if (on) archiveTar.value = false
}

function exportFileName(fmt) {
  const base = sanitizeFileBase(active.value?.name || 'data')
  const ext = EXPORT_FORMATS.includes(fmt) ? fmt : 'xml'
  return `${base}.${ext}`
}

function designExportFileName(fmt) {
  const base = sanitizeFileBase(active.value?.name || 'design')
  const ext = EXPORT_FORMATS.includes(fmt) ? fmt : 'xml'
  return `${base}-design.${ext}`
}

function generatedExportFileName(fmt) {
  const base = sanitizeFileBase(active.value?.name || 'data')
  const ext = EXPORT_FORMATS.includes(fmt) ? fmt : 'xml'
  return `${base}-generated.${ext}`
}

/**
 * Build export from the schema the user is editing (samples only, no seed generate).
 * @returns {Promise<{ text?: string, contentBase64?: string, binary?: boolean }>}
 */
async function buildDesignExport(fmt) {
  const f = (fmt || format.value || 'xml').toLowerCase()
  if (f === 'xml') {
    return { text: liveSchemaPreview.value || '', binary: false }
  }
  if (!active.value) return { text: '', binary: false }
  const sample = buildSample(active.value.root)
  const exp = await api.exportData({
    data: sample,
    format: f,
    multiRow: false,
    layoutMode: csvLayoutMode.value,
    delim: csvDelim.value,
    nestedAsJson: csvNestedAsJson.value,
    ...xmlExportOpts()
  })
  if (exp.binary || exp.contentBase64) {
    return {
      contentBase64: exp.contentBase64,
      binary: true,
      mediaType: exp.mediaType
    }
  }
  return { text: exp.content || '', binary: false }
}

/** Download user/design sample (schema + sample values you edited). */
async function downloadDesignOutput() {
  if (!active.value) {
    flashError('Open a schema first')
    return
  }
  const fmt = format.value || 'xml'
  const built = await buildDesignExport(fmt)
  if (!built.text && !built.contentBase64) {
    flashError('Nothing to download for this design sample')
    return
  }
  const archFmt = selectedArchiveFormat()
  const dirName = resolveArchiveDirName()
  if (archFmt) {
    const packed = await downloadAsArchive({
      text: built.text,
      contentBase64: built.contentBase64,
      fmt,
      archFmt,
      dirName
    })
    flashStatus(`Downloaded design sample as ${packed.fileName}`)
  } else if (built.contentBase64) {
    downloadBase64(built.contentBase64, designExportFileName(fmt), built.mediaType)
    flashStatus(`Downloaded design sample (${fmt.toUpperCase()})`)
  } else {
    downloadText(built.text, designExportFileName(fmt))
    flashStatus(`Downloaded design sample (${fmt.toUpperCase()})`)
  }
}

/** Pack text or structured data into tar / tar.gz under archiveDir/ and download. */
async function downloadAsArchive({ text, contentBase64, data, fmt, archFmt, dirName }) {
  const dir = sanitizeFileBase(dirName || resolveArchiveDirName())
  const fileName = exportFileName(fmt)
  const innerName = fileName.includes('/') ? fileName.split('/').pop() : fileName
  const ext = archFmt === 'tar' ? '.tar' : '.tar.gz'
  const files = [
    {
      fileName: innerName,
      format: fmt,
      content: text != null && text !== '' ? text : undefined,
      contentBase64: contentBase64 || undefined,
      data: data,
      multiRow: csvMultiRow.value,
      layoutMode: csvLayoutMode.value,
      delim: csvDelim.value,
      nestedAsJson: csvNestedAsJson.value,
      documentShaped: !!(data && typeof data === 'object' && !Array.isArray(data)),
      ...xmlExportOpts()
    }
  ]
  const blob = await api.exportArchive({
    extension: ext,
    topFolderName: dir,
    files
  })
  const outName = `${dir}${ext}`
  downloadBlob(blob, outName)
  return { fileName: outName, archiveDir: dir, archiveFormat: archFmt }
}

const fileNamePattern = computed(
  () => settings.value?.fileNaming?.pattern || '{schema}_{index:04}.{ext}'
)

/** Layout + chrome adapt to the active sidebar workflow */
const workspaceMode = computed(() => {
  switch (sidebar.value) {
    case 'packages':
      return 'package'
    case 'delivery':
      return 'delivery'
    case 'archive':
      return 'archive'
    case 'history':
      return 'history'
    case 'custom':
    case 'themes':
    case 'datapacks':
      return 'datapacks'
    case 'templates':
      return 'templates'
    default:
      return 'schema'
  }
})

const showFormatSelector = computed(() => workspaceMode.value === 'schema')
/** Workspaces that can show a right tools/preview rail */
const workspaceSupportsPreview = computed(() =>
  ['schema', 'package', 'delivery', 'archive'].includes(workspaceMode.value)
)
const streamSupported = computed(() => ['csv', 'txt'].includes(format.value))
/** Binary exports (xlsx) download as base64, not plain text. */
const isBinaryFormat = computed(() => format.value === 'xlsx')

/** Default column widths per workflow (center always flexes) */
const WORKSPACE_LAYOUT = {
  schema: { side: 280, preview: 360 },
  package: { side: 280, preview: 320 },
  delivery: { side: 280, preview: 280 },
  archive: { side: 280, preview: 360 },
  history: { side: 340, preview: 0 },
  datapacks: { side: 340, preview: 0 },
  templates: { side: 300, preview: 0 }
}

const LAYOUT_STORAGE_KEY = 'dataforge.layout.v1'
const layout = ref({
  sideCollapsed: false,
  previewCollapsed: false,
  sideWidth: 280,
  previewWidth: 360,
  /** Field settings panel height (px); user-resizable */
  propsHeight: 200,
  propsCollapsed: false,
  /** When true, keep user drag widths across workspace switches */
  lockWidths: false
})

function loadLayoutPrefs() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    layout.value = {
      ...layout.value,
      ...parsed,
      sideWidth: Math.min(480, Math.max(200, Number(parsed.sideWidth) || 280)),
      previewWidth: Math.min(560, Math.max(240, Number(parsed.previewWidth) || 360)),
      propsHeight: Math.min(520, Math.max(120, Number(parsed.propsHeight) || 220)),
      propsCollapsed: !!parsed.propsCollapsed
    }
  } catch {
    /* ignore */
  }
}

function saveLayoutPrefs() {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout.value))
  } catch {
    /* ignore */
  }
}

function applyWorkspaceLayoutDefaults(mode) {
  const d = WORKSPACE_LAYOUT[mode] || WORKSPACE_LAYOUT.schema
  if (!layout.value.lockWidths) {
    layout.value.sideWidth = d.side
    if (d.preview > 0) layout.value.previewWidth = d.preview
  }
  // Focus workspaces: never force a empty right rail open
  if (!WORKSPACE_LAYOUT[mode]?.preview) {
    layout.value.previewCollapsed = false // irrelevant; panel hidden by mode
  }
}

const showRightPanel = computed(
  () => workspaceSupportsPreview.value && !layout.value.previewCollapsed
)

/** A5: header Generate only when tools rail is hidden (rail owns the primary CTA). */
const showHeaderGenerate = computed(() =>
  shouldShowHeaderGenerate(workspaceMode.value, showRightPanel.value)
)
const showHeaderPackageGenerate = computed(
  () => workspaceMode.value === 'package' && !showRightPanel.value
)

const mainLayoutStyle = computed(() => {
  const side = layout.value.sideCollapsed
    ? '52px'
    : `${layout.value.sideWidth}px`
  if (showRightPanel.value) {
    return {
      gridTemplateColumns: `${side} 5px minmax(0, 1fr) 5px ${layout.value.previewWidth}px`
    }
  }
  return {
    gridTemplateColumns: `${side} 5px minmax(0, 1fr)`
  }
})

const mainLayoutClass = computed(() => ({
  [`ws-${workspaceMode.value}`]: true,
  'side-collapsed': layout.value.sideCollapsed,
  'has-preview': showRightPanel.value,
  'focus-layout': !workspaceSupportsPreview.value
}))

/**
 * How dense the left nav should be based on live panel width.
 * comfortable = full words, cozy = short labels, compact = 2-letter codes.
 */
const sideNavDensity = computed(() =>
  sideNavDensityFromWidth(layout.value.sideWidth, layout.value.sideCollapsed)
)

function toggleSidePanel() {
  layout.value.sideCollapsed = !layout.value.sideCollapsed
  saveLayoutPrefs()
}

function togglePreviewPanel() {
  if (!workspaceSupportsPreview.value) return
  layout.value.previewCollapsed = !layout.value.previewCollapsed
  saveLayoutPrefs()
}

function resetLayoutToWorkspace() {
  layout.value.lockWidths = false
  layout.value.sideCollapsed = false
  layout.value.previewCollapsed = false
  applyWorkspaceLayoutDefaults(workspaceMode.value)
  saveLayoutPrefs()
}

/** Drag-resize left list or right tools column */
let resizeSession = null
function onResizePointerDown(which, ev) {
  if (layout.value.sideCollapsed && which === 'side') return
  ev.preventDefault()
  const startX = ev.clientX
  const startSide = layout.value.sideWidth
  const startPreview = layout.value.previewWidth
  resizeSession = { which, startX, startSide, startPreview }
  window.addEventListener('pointermove', onResizePointerMove)
  window.addEventListener('pointerup', onResizePointerUp)
  document.body.classList.add('resizing-cols')
}

function onResizePointerMove(ev) {
  if (!resizeSession) return
  const dx = ev.clientX - resizeSession.startX
  if (resizeSession.which === 'side') {
    layout.value.sideWidth = Math.min(480, Math.max(200, resizeSession.startSide + dx))
  } else if (resizeSession.which === 'preview') {
    // Dragging the left edge of preview: moving right shrinks preview
    layout.value.previewWidth = Math.min(
      560,
      Math.max(240, resizeSession.startPreview - dx)
    )
  }
  layout.value.lockWidths = true
}

function onResizePointerUp() {
  resizeSession = null
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  document.body.classList.remove('resizing-cols')
  saveLayoutPrefs()
}

/** Vertical resize for Field settings panel */
let propsResizeSession = null
function onPropsResizeDown(ev) {
  ev.preventDefault()
  if (layout.value.propsCollapsed) {
    layout.value.propsCollapsed = false
  }
  propsResizeSession = {
    startY: ev.clientY,
    startH: layout.value.propsHeight
  }
  window.addEventListener('pointermove', onPropsResizeMove)
  window.addEventListener('pointerup', onPropsResizeUp)
  document.body.classList.add('resizing-props')
}

function onPropsResizeMove(ev) {
  if (!propsResizeSession) return
  // Drag handle is above the panel: moving up grows panel
  const dy = propsResizeSession.startY - ev.clientY
  layout.value.propsHeight = Math.min(
    520,
    Math.max(120, propsResizeSession.startH + dy)
  )
}

function onPropsResizeUp() {
  propsResizeSession = null
  window.removeEventListener('pointermove', onPropsResizeMove)
  window.removeEventListener('pointerup', onPropsResizeUp)
  document.body.classList.remove('resizing-props')
  saveLayoutPrefs()
}

function togglePropsCollapsed() {
  layout.value.propsCollapsed = !layout.value.propsCollapsed
  saveLayoutPrefs()
}

const propsPanelStyle = computed(() => {
  if (layout.value.propsCollapsed) {
    return { height: 'auto', maxHeight: 'none', flexShrink: 0 }
  }
  return {
    height: `${layout.value.propsHeight}px`,
    maxHeight: 'none',
    flexShrink: 0
  }
})

watch(workspaceMode, (mode) => {
  applyWorkspaceLayoutDefaults(mode)
})

const workspaceTitle = computed(() => {
  switch (workspaceMode.value) {
    case 'package':
      return activePackage.value?.name || 'Packages'
    case 'delivery':
      return 'Delivery jobs'
    case 'archive':
      return 'Archive browser'
    case 'history':
      return historySubTab.value === 'values' ? 'Fill values' : 'Recent activity'
    case 'datapacks':
      return dataPackSubTab.value === 'custom'
        ? activeCustomList.value?.name || 'Custom field values'
        : 'Data themes'
    case 'templates':
      return 'Templates'
    default:
      return active.value?.name || 'Schema'
  }
})

const workspaceHint = computed(() => {
  switch (workspaceMode.value) {
    case 'schema':
      return 'Edit fields · generate · export'
    case 'package':
      return 'Layers · member schemas · variants'
    case 'delivery':
      return 'Plan chunked dumps to disk'
    case 'archive':
      return 'Browse archive contents'
    case 'history':
      return 'Jump back into recent work'
    case 'datapacks':
      return 'Themes & field value lists'
    case 'templates':
      return 'Reusable schema snapshots'
    default:
      return ''
  }
})

const standaloneSchemas = computed(() =>
  schemas.value.filter((s) => !s.isMultifile)
)
const packageSchemas = computed(() => schemas.value.filter((s) => s.isMultifile))

const filteredThemes = computed(() => {
  const q = dataPackSearch.value.trim().toLowerCase()
  if (!q) return themes.value
  return themes.value.filter(
    (t) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.slug || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
  )
})

const filteredCustomLists = computed(() => {
  const q = dataPackSearch.value.trim().toLowerCase()
  if (!q) return customLists.value
  return customLists.value.filter(
    (c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.keys || []).some((k) => String(k).toLowerCase().includes(q))
  )
})

const recentSchemas = computed(() => {
  // Recently opened/updated schemas — primary “what was used lately”
  return [...schemas.value]
    .filter((s) => !s.isPackageMember)
    .sort((a, b) => {
      const ta = Date.parse(a.lastOpenedAt || a.updatedAt || 0) || 0
      const tb = Date.parse(b.lastOpenedAt || b.updatedAt || 0) || 0
      return tb - ta
    })
    .slice(0, 30)
})

watch(outputMode, (mode) => {
  if (mode === 'per-file') streamMode.value = false
})

watch(format, (f) => {
  if (!EXPORT_FORMATS.includes(f)) {
    format.value = 'xml'
    return
  }
  if (!['csv', 'txt'].includes(f) && streamMode.value) {
    streamMode.value = false
  }
  if (active.value) active.value.sourceFormat = f
})

watch(sidebar, (s) => {
  if (s === 'schemas') {
    tab.value = 'generate'
  }
  if (s === 'packages' && activePackage.value) {
    void refreshPackageEstimate()
  }
  if (s === 'delivery') {
    void refreshDeliveryJobs()
  }
})

async function generate() {
  if (!active.value) return
  if (active.value.isMultifile) {
    errorMsg.value =
      'This is a package preview schema. Open Packages and Generate variants there (or Edit member schema).'
    return
  }
  if (outputMode.value === 'per-file') {
    return generatePerFile()
  }
  generating.value = true
  errorMsg.value = ''
  try {
    const archFmt = selectedArchiveFormat()
    const dirName = resolveArchiveDirName()
    if (streamMode.value) {
      const text = await api.generateStream(genBody())
      previewText.value = text
      lastReport.value = null
      tab.value = 'generate'
      if (archFmt) {
        const packed = await downloadAsArchive({
          text,
          fmt: format.value,
          archFmt,
          dirName
        })
        lastGenerated.value = {
          records: null,
          document: null,
          recordCount: recordCount.value,
          seed: seed.value,
          streamed: true,
          format: format.value,
          outputText: text,
          fileName: packed.fileName,
          archiveFormat: packed.archiveFormat,
          archiveDir: packed.archiveDir
        }
        flashStatus(
          `Streamed ${recordCount.value} · downloaded ${packed.fileName} (${dirName}/…)`
        )
      } else {
        lastGenerated.value = {
          records: null,
          document: null,
          recordCount: recordCount.value,
          seed: seed.value,
          streamed: true,
          format: format.value,
          outputText: text
        }
        downloadText(text, generatedExportFileName(format.value))
        flashStatus(
          `Streamed ${recordCount.value} record(s) · downloaded ${format.value.toUpperCase()} file`
        )
      }
    } else {
      const res = await api.generate(genBody())
      lastReport.value = res.report || null
      lastSamplePayload.value = res
      tab.value = 'generate'
      // XML: schema-shaped document (matches tree / design preview).
      // CSV/TXT: flat record list (tabular columns).
      const fmt = (format.value || 'xml').toLowerCase()
      const useDoc =
        fmt === 'xml' &&
        res.document != null &&
        typeof res.document === 'object' &&
        !Array.isArray(res.document)
      const payload = useDoc ? res.document : res.records
      const exp = await api.exportData({
        data: payload,
        format: format.value,
        multiRow: csvMultiRow.value,
        layoutMode: csvLayoutMode.value,
        delim: csvDelim.value,
        nestedAsJson: csvNestedAsJson.value,
        documentShaped: useDoc,
        singleObject: useDoc,
        ...xmlExportOpts()
      })
      const isBin = !!(exp.binary || exp.contentBase64)
      const text = isBin
        ? `// ${String(format.value).toUpperCase()} binary · download to open in Excel`
        : exp.content || ''
      previewText.value = text
      if (archFmt) {
        const packed = await downloadAsArchive({
          text: isBin ? undefined : text,
          contentBase64: isBin ? exp.contentBase64 : undefined,
          data: isBin ? undefined : payload,
          fmt: format.value,
          archFmt,
          dirName
        })
        lastGenerated.value = {
          ...res,
          format: format.value,
          outputText: text,
          contentBase64: isBin ? exp.contentBase64 : undefined,
          fileName: packed.fileName,
          archiveFormat: packed.archiveFormat,
          archiveDir: packed.archiveDir
        }
        flashStatus(
          `Generated ${res.recordCount} · downloaded ${packed.fileName} (${dirName}/…) · seed ${res.seed}`
        )
      } else {
        lastGenerated.value = {
          ...res,
          format: format.value,
          outputText: text,
          contentBase64: isBin ? exp.contentBase64 : undefined
        }
        if (isBin) {
          downloadBase64(
            exp.contentBase64,
            generatedExportFileName(format.value),
            exp.mediaType
          )
        } else {
          downloadText(text, generatedExportFileName(format.value))
        }
        flashStatus(
          `Generated ${res.recordCount} record(s) · downloaded · seed ${res.seed} · ${res.ms}ms`
        )
      }
    }
    await loadRecentActivity()
    await refreshStatusOnly()
  } catch (e) {
    flashError(e.message)
  } finally {
    generating.value = false
  }
}

async function generatePerFile() {
  if (!active.value) return
  generating.value = true
  errorMsg.value = ''
  try {
    const archFmt = selectedArchiveFormat()
    const dirName = resolveArchiveDirName()
    const res = await api.generatePerFile(
      genBody({
        previewSampleSize: 5,
        archiveFormat: archFmt || undefined,
        archiveDir: dirName
      })
    )
    downloadBase64Zip(res.zipBase64 || res.archiveBase64, res.fileName)
    lastGenerated.value = {
      ...res,
      records: null,
      perFile: true,
      archiveDir: res.archiveDir || dirName
    }
    lastReport.value = null
    const arch =
      res.archiveFormat ||
      (String(res.fileName || '').endsWith('.tar.gz')
        ? 'tar.gz'
        : String(res.fileName || '').endsWith('.tar')
          ? 'tar'
          : 'ZIP')
    flashStatus(
      `One file per record: ${res.written} file(s) in ${arch} as ${res.fileName} (${dirName}/…) · seed ${res.seed}`
    )
    if (res.sample?.length) {
      previewText.value = res.sample
        .map((s) => `// ${s.path}\n${s.preview}`)
        .join('\n\n')
      tab.value = 'generate'
    }
    await loadRecentActivity()
    await refreshStatusOnly()
  } catch (e) {
    flashError(e.message)
  } finally {
    generating.value = false
  }
}

async function refreshPreview() {
  const gen = lastGenerated.value
  const doc = gen?.document
  const data = gen?.records
  const fmtNow = (format.value || 'xml').toLowerCase()
  // XLSX is binary — show a short note instead of dumping base64 into the preview pane
  if (fmtNow === 'xlsx') {
    if (gen?.contentBase64 && (gen.format || fmtNow) === fmtNow) {
      previewText.value =
        '// XLSX binary ready · use Generate / download to open in Excel'
      return
    }
    if (!data?.length && active.value) {
      previewText.value =
        '// XLSX design sample · Generate or Download design to get a .xlsx file'
      return
    }
  }
  if (
    fmtNow === 'xml' &&
    doc &&
    typeof doc === 'object' &&
    !Array.isArray(doc)
  ) {
    // Prefer cached generate payload so re-export doesn't thrash after download
    if (gen?.outputText && (gen.format || format.value) === format.value) {
      previewText.value = gen.outputText
      return
    }
    const exp = await api.exportData({
      data: doc,
      format: format.value,
      multiRow: csvMultiRow.value,
      layoutMode: csvLayoutMode.value,
      delim: csvDelim.value,
      nestedAsJson: csvNestedAsJson.value,
      documentShaped: true,
      singleObject: true,
      ...xmlExportOpts()
    })
    previewText.value = exp.content
    if (lastGenerated.value) {
      lastGenerated.value = { ...lastGenerated.value, outputText: exp.content }
    }
    return
  }
  if (!data?.length) {
    if (!active.value) return
    // Design sample — client live preview already matches tree; keep API path for CSV/TXT
    if (fmtNow === 'xml') {
      previewText.value = liveSchemaPreview.value
      return
    }
    const sample = buildSample(active.value.root)
    const exp = await api.exportData({
      data: sample,
      format: format.value,
      multiRow: false,
      layoutMode: csvLayoutMode.value,
      delim: csvDelim.value,
      nestedAsJson: csvNestedAsJson.value,
      ...xmlExportOpts()
    })
    previewText.value =
      exp.binary || exp.contentBase64
        ? `// ${fmtNow.toUpperCase()} binary · download to open`
        : exp.content
    return
  }
  const exp = await api.exportData({
    data,
    format: format.value,
    multiRow: csvMultiRow.value,
    layoutMode: csvLayoutMode.value,
    delim: csvDelim.value,
    nestedAsJson: csvNestedAsJson.value,
    ...xmlExportOpts()
  })
  previewText.value =
    exp.binary || exp.contentBase64
      ? `// ${fmtNow.toUpperCase()} binary · download to open`
      : exp.content
}

function buildSample(rows) {
  const o = {}
  for (const r of rows) {
    const k = r.key || 'field'
    if (r.kind === 'array') {
      o[k] = r.children?.length ? [buildSample(r.children)] : []
    } else if (r.kind === 'object' || (r.children || []).length) {
      o[k] = buildSample(r.children || [])
    } else {
      o[k] = r.sampleValue ?? null
    }
  }
  return o
}

/** —— Live schema preview: pop-out window (can leave main browser UI) —— */
const SCHEMA_PREVIEW_BC = 'dataforge-schema-preview-v1'
const SCHEMA_PREVIEW_STORE = 'dataforge.schemaPreview.state.v1'
const SCHEMA_PREVIEW_PREF = 'dataforge.schemaPreview.pref.v1'
const DEFAULT_PREVIEW_W = 440
const DEFAULT_PREVIEW_H = 360
/** Docked fallback only if pop-up blocked */
const DEFAULT_FLOAT_W = 380
const DEFAULT_FLOAT_H = 280

const schemaPreviewOpen = ref(false)
/** true when using in-page float because window.open was blocked */
const schemaPreviewDocked = ref(false)
const schemaFloat = ref({
  x: null,
  y: null,
  w: DEFAULT_FLOAT_W,
  h: DEFAULT_FLOAT_H
})

/** @type {Window | null} */
let schemaPreviewWin = null
/** @type {BroadcastChannel | null} */
let schemaPreviewBc = null
/** @type {ReturnType<typeof setInterval> | null} */
let schemaPreviewWatchTimer = null

function loadSchemaPreviewPrefs() {
  try {
    const raw = localStorage.getItem(SCHEMA_PREVIEW_PREF)
    if (!raw) return
    const p = JSON.parse(raw)
    if (typeof p.docked === 'boolean') schemaPreviewDocked.value = p.docked
    if (p.float && typeof p.float === 'object') {
      schemaFloat.value = {
        x: Number.isFinite(p.float.x) ? p.float.x : null,
        y: Number.isFinite(p.float.y) ? p.float.y : null,
        w: DEFAULT_FLOAT_W,
        h: DEFAULT_FLOAT_H
      }
    }
  } catch {
    /* ignore */
  }
}

function saveSchemaPreviewPrefs() {
  try {
    localStorage.setItem(
      SCHEMA_PREVIEW_PREF,
      JSON.stringify({
        docked: schemaPreviewDocked.value,
        float: {
          x: schemaFloat.value.x,
          y: schemaFloat.value.y
          // size intentionally not persisted — always reset default on drag/open
        }
      })
    )
  } catch {
    /* ignore */
  }
}

function previewThemePayload() {
  const cs = getComputedStyle(document.documentElement)
  return {
    bg: cs.getPropertyValue('--surface').trim() || '#1a2332',
    bg2: cs.getPropertyValue('--surface-2').trim() || '#243044',
    text: cs.getPropertyValue('--text').trim() || '#e8eef7',
    muted: cs.getPropertyValue('--muted').trim() || '#8b9bb4',
    border: cs.getPropertyValue('--border').trim() || '#2d3a4d',
    accent: cs.getPropertyValue('--accent').trim() || '#3b82f6'
  }
}

function schemaPreviewPayload() {
  return {
    type: 'preview',
    text: liveSchemaPreview.value,
    format: (format.value || 'xml').toUpperCase(),
    name: active.value?.name || 'Schema',
    theme: previewThemePayload(),
    ts: Date.now()
  }
}

function ensureSchemaPreviewChannel() {
  if (schemaPreviewBc || typeof BroadcastChannel === 'undefined') return
  try {
    schemaPreviewBc = new BroadcastChannel(SCHEMA_PREVIEW_BC)
  } catch {
    schemaPreviewBc = null
  }
}

/** Debounced push so deep watches / typing stay smooth */
let previewPushTimer = null
function scheduleSchemaPreviewPush(delayMs = 40) {
  if (previewPushTimer) clearTimeout(previewPushTimer)
  previewPushTimer = setTimeout(() => {
    previewPushTimer = null
    pushSchemaPreviewLive()
  }, delayMs)
}

function pushSchemaPreviewLive() {
  const winOpen = !!(schemaPreviewWin && !schemaPreviewWin.closed)
  if (!schemaPreviewOpen.value && !winOpen) {
    return
  }
  const payload = schemaPreviewPayload()
  try {
    localStorage.setItem(SCHEMA_PREVIEW_STORE, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
  ensureSchemaPreviewChannel()
  try {
    schemaPreviewBc?.postMessage(payload)
  } catch {
    /* ignore */
  }
  if (winOpen) {
    // Most reliable path for same-origin pop-outs (postMessage can race document.write)
    try {
      const doc = schemaPreviewWin.document
      const bodyEl = doc.getElementById('body')
      const metaEl = doc.getElementById('meta')
      if (bodyEl) {
        const text = payload.text == null ? '' : String(payload.text)
        bodyEl.textContent = text || '// Empty sample'
        bodyEl.classList.toggle('empty', !text)
      }
      if (metaEl) {
        const name = payload.name || 'Schema'
        const fmt = payload.format || ''
        metaEl.textContent =
          '· ' + name + (fmt ? ' · ' + fmt : '') + ' · design sample'
        doc.title = 'DataForge · ' + name + ' preview'
      }
      const t = payload.theme || {}
      const root = doc.documentElement
      if (t.bg) root.style.setProperty('--bg', t.bg)
      if (t.bg2) root.style.setProperty('--bg2', t.bg2)
      if (t.text) root.style.setProperty('--text', t.text)
      if (t.muted) root.style.setProperty('--muted', t.muted)
      if (t.border) root.style.setProperty('--border', t.border)
      if (t.accent) root.style.setProperty('--accent', t.accent)
    } catch {
      /* fall through to postMessage */
    }
    try {
      schemaPreviewWin.postMessage(
        { channel: SCHEMA_PREVIEW_BC, ...payload },
        '*'
      )
    } catch {
      /* ignore */
    }
  }
}

function writeSchemaPreviewDocument(win) {
  const doc = win.document
  doc.open()
  doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DataForge · Live schema preview</title>
  <style>
    :root {
      --bg: #1a2332; --bg2: #243044; --text: #e8eef7;
      --muted: #8b9bb4; --border: #2d3a4d; --accent: #3b82f6;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: system-ui, Segoe UI, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
    }
    header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--accent) 14%, var(--bg2));
      user-select: none;
    }
    header .title { font-size: 13px; font-weight: 600; min-width: 0; }
    header .meta { font-size: 11px; color: var(--muted); font-weight: 500; }
    #body {
      margin: 0;
      padding: 0.65rem 0.8rem;
      flex: 1;
      min-height: 0;
      overflow: auto;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre;
      tab-size: 2;
    }
    .empty { color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <div class="title">Live schema preview <span class="meta" id="meta"></span></div>
  </header>
  <pre id="body" class="empty">// Waiting for DataForge…</pre>
  <script>
    const BC = ${JSON.stringify(SCHEMA_PREVIEW_BC)};
    const STORE = ${JSON.stringify(SCHEMA_PREVIEW_STORE)};
    const bodyEl = document.getElementById('body');
    const metaEl = document.getElementById('meta');
    const root = document.documentElement;

    function apply(payload) {
      if (!payload || payload.type !== 'preview') return;
      const t = payload.theme || {};
      if (t.bg) root.style.setProperty('--bg', t.bg);
      if (t.bg2) root.style.setProperty('--bg2', t.bg2);
      if (t.text) root.style.setProperty('--text', t.text);
      if (t.muted) root.style.setProperty('--muted', t.muted);
      if (t.border) root.style.setProperty('--border', t.border);
      if (t.accent) root.style.setProperty('--accent', t.accent);
      const text = payload.text == null ? '' : String(payload.text);
      bodyEl.textContent = text || '// Empty sample';
      bodyEl.classList.toggle('empty', !text);
      const name = payload.name || 'Schema';
      const fmt = payload.format || '';
      metaEl.textContent = '· ' + name + (fmt ? ' · ' + fmt : '') + ' · design sample';
      document.title = 'DataForge · ' + name + ' preview';
    }

    function fromStorage() {
      try {
        const raw = localStorage.getItem(STORE);
        if (raw) apply(JSON.parse(raw));
      } catch (e) {}
    }

    window.addEventListener('message', function (ev) {
      const d = ev.data;
      if (!d || d.channel !== BC) return;
      apply(d);
    });

    window.addEventListener('storage', function (ev) {
      if (ev.key === STORE && ev.newValue) {
        try { apply(JSON.parse(ev.newValue)); } catch (e) {}
      }
    });

    try {
      const ch = new BroadcastChannel(BC);
      ch.onmessage = function (ev) { apply(ev.data); };
    } catch (e) {}

    fromStorage();
    setInterval(fromStorage, 200);
  <\/script>
</body>
</html>`)
  doc.close()
}

function stopSchemaPreviewWatch() {
  if (schemaPreviewWatchTimer) {
    clearInterval(schemaPreviewWatchTimer)
    schemaPreviewWatchTimer = null
  }
}

function startSchemaPreviewWatch() {
  stopSchemaPreviewWatch()
  schemaPreviewWatchTimer = setInterval(() => {
    if (schemaPreviewWin && schemaPreviewWin.closed) {
      schemaPreviewWin = null
      if (!schemaPreviewDocked.value) {
        schemaPreviewOpen.value = false
        saveSchemaPreviewPrefs()
      }
      stopSchemaPreviewWatch()
      return
    }
    // Keep pop-out in sync even if a reactive watch is missed
    if (schemaPreviewOpen.value || (schemaPreviewWin && !schemaPreviewWin.closed)) {
      pushSchemaPreviewLive()
    }
  }, 250)
}

function openSchemaPreviewPopout() {
  // Always open / re-show at default size (size resets)
  const w = DEFAULT_PREVIEW_W
  const h = DEFAULT_PREVIEW_H
  const left = Math.max(40, Math.round((window.screenX || 0) + 60))
  const top = Math.max(40, Math.round((window.screenY || 0) + 80))

  if (schemaPreviewWin && !schemaPreviewWin.closed) {
    try {
      schemaPreviewWin.focus()
      schemaPreviewWin.resizeTo(w, h)
    } catch {
      /* some browsers block resizeTo */
    }
    schemaPreviewOpen.value = true
    schemaPreviewDocked.value = false
    pushSchemaPreviewLive()
    startSchemaPreviewWatch()
    saveSchemaPreviewPrefs()
    return
  }

  schemaPreviewWin = window.open(
    '',
    'dataforgeSchemaPreview',
    `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no`
  )

  if (!schemaPreviewWin) {
    // Pop-up blocked → docked fallback inside the page
    schemaPreviewDocked.value = true
    schemaPreviewOpen.value = true
    schemaFloat.value = {
      x: null,
      y: null,
      w: DEFAULT_FLOAT_W,
      h: DEFAULT_FLOAT_H
    }
    flashError(
      'Pop-up blocked — using docked preview. Allow pop-ups for DataForge to move the preview outside this window.'
    )
    saveSchemaPreviewPrefs()
    return
  }

  writeSchemaPreviewDocument(schemaPreviewWin)
  schemaPreviewDocked.value = false
  schemaPreviewOpen.value = true
  // First paint after document ready
  setTimeout(() => pushSchemaPreviewLive(), 30)
  setTimeout(() => pushSchemaPreviewLive(), 120)
  startSchemaPreviewWatch()
  saveSchemaPreviewPrefs()
}

function closeSchemaPreview() {
  if (schemaPreviewWin && !schemaPreviewWin.closed) {
    try {
      schemaPreviewWin.close()
    } catch {
      /* ignore */
    }
  }
  schemaPreviewWin = null
  schemaPreviewOpen.value = false
  schemaPreviewDocked.value = false
  stopSchemaPreviewWatch()
  saveSchemaPreviewPrefs()
}

function toggleSchemaPreview() {
  // Docked fallback: button toggles closed
  if (schemaPreviewDocked.value && schemaPreviewOpen.value) {
    closeSchemaPreview()
    return
  }
  // Pop-out: open, or focus + reset size if already open (close via the window chrome)
  openSchemaPreviewPopout()
}

const schemaFloatStyle = computed(() => {
  const f = schemaFloat.value
  /** Size is always the default — resets whenever the docked popup is dragged */
  const style = {
    width: `${DEFAULT_FLOAT_W}px`,
    height: `${DEFAULT_FLOAT_H}px`
  }
  if (f.x != null && f.y != null) {
    style.left = `${f.x}px`
    style.top = `${f.y}px`
    style.right = 'auto'
    style.bottom = 'auto'
  }
  return style
})

/** @type {{ startX: number, startY: number, origX: number, origY: number } | null} */
let floatDragSession = null

function onSchemaFloatDragDown(ev) {
  if (ev.button != null && ev.button !== 0) return
  if (ev.target?.closest?.('button')) return
  ev.preventDefault()
  const el = ev.currentTarget?.closest?.('.schema-float')
  const rect = el?.getBoundingClientRect?.()
  const f = schemaFloat.value
  const origX = f.x != null ? f.x : rect ? rect.left : 24
  const origY = f.y != null ? f.y : rect ? rect.top : 80
  // Size always resets to default when dragging the docked popup
  schemaFloat.value = {
    x: origX,
    y: origY,
    w: DEFAULT_FLOAT_W,
    h: DEFAULT_FLOAT_H
  }
  floatDragSession = {
    startX: ev.clientX,
    startY: ev.clientY,
    origX,
    origY
  }
  window.addEventListener('pointermove', onSchemaFloatDragMove)
  window.addEventListener('pointerup', onSchemaFloatDragUp)
  document.body.classList.add('dragging-schema-float')
}

function onSchemaFloatDragMove(ev) {
  if (!floatDragSession) return
  const dx = ev.clientX - floatDragSession.startX
  const dy = ev.clientY - floatDragSession.startY
  const maxX = Math.max(0, window.innerWidth - 120)
  const maxY = Math.max(0, window.innerHeight - 48)
  schemaFloat.value = {
    x: Math.min(maxX, Math.max(0, floatDragSession.origX + dx)),
    y: Math.min(maxY, Math.max(0, floatDragSession.origY + dy)),
    w: DEFAULT_FLOAT_W,
    h: DEFAULT_FLOAT_H
  }
}

function onSchemaFloatDragUp() {
  floatDragSession = null
  window.removeEventListener('pointermove', onSchemaFloatDragMove)
  window.removeEventListener('pointerup', onSchemaFloatDragUp)
  document.body.classList.remove('dragging-schema-float')
  saveSchemaPreviewPrefs()
}

function escapeDelimCell(val, delim) {
  const t = val == null ? '' : String(val)
  if (t.includes('"') || t.includes('\n') || t.includes('\r') || t.includes(delim)) {
    return `"${t.replace(/"/g, '""')}"`
  }
  return t
}

function sanitizePreviewTag(name) {
  const s = String(name || 'field')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/^[^A-Za-z_]/, '_$&')
  return s || 'field'
}

function buildXmlPreviewNodes(rows, indent, selfCloseDefault) {
  const pad = '  '.repeat(indent)
  const lines = []
  for (const r of rows || []) {
    const tag = sanitizePreviewTag(r.key || 'field')
    const kids = r.children || []
    const isContainer =
      r.kind === 'object' || r.kind === 'array' || kids.length > 0
    if (isContainer) {
      if (r.kind === 'array') {
        lines.push(`${pad}<${tag}>`)
        if (kids.length) {
          lines.push(...buildXmlPreviewNodes(kids, indent + 1, selfCloseDefault))
        }
        lines.push(`${pad}</${tag}>`)
      } else {
        lines.push(`${pad}<${tag}>`)
        if (kids.length) {
          lines.push(...buildXmlPreviewNodes(kids, indent + 1, selfCloseDefault))
        }
        lines.push(`${pad}</${tag}>`)
      }
      continue
    }
    const raw = r.sampleValue
    const empty = raw == null || String(raw) === ''
    const sc =
      typeof r.selfClosing === 'boolean' ? r.selfClosing : selfCloseDefault
    if (empty && sc) {
      lines.push(`${pad}<${tag}/>`)
    } else if (empty) {
      lines.push(`${pad}<${tag}></${tag}>`)
    } else {
      const text = String(raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      lines.push(`${pad}<${tag}>${text}</${tag}>`)
    }
  }
  return lines
}

/** Instant client-side design preview (no generate, no API). */
const liveSchemaPreview = computed(() => {
  if (!active.value) return '// Select or create a schema'
  const fmt = (format.value || 'xml').toLowerCase()
  const root = active.value.root || []

  if (fmt === 'csv' || fmt === 'txt') {
    const delim = fmt === 'csv' ? ',' : '\t'
    const cols = root
    if (!cols.length) {
      return fmt === 'csv' ? '// No columns yet' : '// No columns yet'
    }
    const headers = cols.map((c) =>
      escapeDelimCell((c.key || 'field').trim() || 'field', delim)
    )
    const lines = [headers.join(delim)]
    let n = 1
    for (const c of cols) {
      n = Math.max(n, fieldSampleValues(c).length)
    }
    for (let i = 0; i < n; i++) {
      lines.push(
        cols
          .map((c) => escapeDelimCell(fieldSampleValues(c)[i] ?? '', delim))
          .join(delim)
      )
    }
    return lines.join('\n')
  }

  // XML design sample — same tree shape as generate.document / download
  const rootTagOverride = sanitizePreviewTag(xmlRootTag.value || 'root')
  const scDefault = xmlSelfClosing.value !== false
  const recPath = pathToRecordTag(root)
  const recField = findRecordTagField(root)
  if (recField && recPath?.length) {
    const recTag = sanitizePreviewTag(recField.key || 'record')
    const kids = recField.children || []
    const isContainer =
      recField.kind === 'object' ||
      recField.kind === 'array' ||
      kids.length > 0
    const bodyRows = isContainer ? kids : [recField]
    // Body lines relative indent 1; outer wraps add indent
    const body = buildXmlPreviewNodes(bodyRows, 1, scDefault)
    const one =
      body.length > 0
        ? `<${recTag}>\n${body.join('\n')}\n</${recTag}>`
        : `<${recTag}/>`
    // Two sample records (same multi-record shape as download)
    let content = `${one}\n${one}`
    // Ancestors outside the record tag: catalog.book → wrap books in <catalog>
    for (let i = recPath.length - 2; i >= 0; i--) {
      const tag = sanitizePreviewTag(recPath[i])
      content =
        `<${tag}>\n` +
        content
          .split('\n')
          .map((ln) => (ln ? '  ' + ln : ln))
          .join('\n') +
        `\n</${tag}>`
    }
    // Rename outermost schema key to xmlRootTag when user overrode document root
    const outerSchema = sanitizePreviewTag(recPath[0])
    if (rootTagOverride && rootTagOverride !== outerSchema) {
      if (recPath.length >= 2) {
        content = content
          .replace(new RegExp(`^<${outerSchema}>`), `<${rootTagOverride}>`)
          .replace(new RegExp(`</${outerSchema}>\\s*$`), `</${rootTagOverride}>`)
      } else {
        // Record tag alone at root: wrap with xmlRootTag
        content =
          `<${rootTagOverride}>\n` +
          content
            .split('\n')
            .map((ln) => (ln ? '  ' + ln : ln))
            .join('\n') +
          `\n</${rootTagOverride}>`
      }
    }
    return content + '\n'
  }
  // No record tag: single top-level field is the document root (matches download)
  if (root.length === 1) {
    const only = root[0]
    const tag = sanitizePreviewTag(only?.key || 'root')
    const kids = only?.children || []
    const isContainer =
      only?.kind === 'object' || only?.kind === 'array' || kids.length > 0
    if (isContainer) {
      const inner = buildXmlPreviewNodes(kids, 1, scDefault)
      let doc =
        inner.length > 0
          ? `<${tag}>\n${inner.join('\n')}\n</${tag}>\n`
          : `<${tag}/>\n`
      if (rootTagOverride && rootTagOverride !== tag) {
        doc = doc
          .replace(new RegExp(`^<${tag}>`), `<${rootTagOverride}>`)
          .replace(new RegExp(`</${tag}>\\s*$`), `</${rootTagOverride}>\n`)
      }
      return doc
    }
  }
  const body = buildXmlPreviewNodes(root, 1, scDefault)
  if (!body.length) {
    return `<${rootTagOverride}/>\n`
  }
  return `<${rootTagOverride}>\n${body.join('\n')}\n</${rootTagOverride}>\n`
})

/** Docked float only when the OS pop-out window was blocked */
const showSchemaFloat = computed(
  () =>
    schemaPreviewOpen.value &&
    schemaPreviewDocked.value &&
    workspaceMode.value === 'schema' &&
    !!active.value
)

// Live preview must track nested field edits (keys, samples, modes, rows)
watch(
  liveSchemaPreview,
  () => {
    scheduleSchemaPreviewPush(20)
  },
  { flush: 'post' }
)

watch(
  active,
  () => {
    scheduleSchemaPreviewPush(30)
  },
  { deep: true, flush: 'post' }
)

watch(
  [format, xmlRootTag, xmlRecordTag, xmlSelfClosing, () => active.value?.name],
  () => {
    scheduleSchemaPreviewPush(20)
  }
)

watch(
  [
    format,
    csvLayoutMode,
    csvDelim,
    csvNestedAsJson,
    csvMultiRow,
    xmlRootTag,
    xmlRecordTag,
    xmlSelfClosing
  ],
  () => {
    void refreshPreview()
  }
)

watch(tab, () => {
  void refreshPreview()
})

function downloadPreview() {
  // Schema preview chrome: download the design sample (what you are editing)
  void downloadDesignOutput()
}

async function downloadArchiveMulti() {
  if (!lastGenerated.value?.records) {
    flashError('Generate first, then pack archive')
    return
  }
  try {
    const gen = lastGenerated.value
    const doc =
      gen?.document && typeof gen.document === 'object' && !Array.isArray(gen.document)
        ? gen.document
        : null
    // Multi-format = team formats only → tar.gz when more than one file
    // XML uses schema-shaped document; CSV/TXT use flat records
    const blob = await api.exportArchive({
      topFolderName: active.value?.name || 'export',
      files: EXPORT_FORMATS.map((f) => ({
        fileName: `data.${f}`,
        format: f,
        data: f === 'xml' && doc ? doc : gen.records,
        multiRow: csvMultiRow.value,
        layoutMode: csvLayoutMode.value,
        delim: csvDelim.value,
        nestedAsJson: csvNestedAsJson.value,
        ...xmlExportOpts()
      }))
    })
    downloadBlob(blob, `${active.value?.name || 'data'}-multi.tar.gz`)
    flashStatus('Downloaded multi-format archive (XML + CSV + TXT + XLSX)')
  } catch (e) {
    flashError(e.message)
  }
}

async function saveAsTemplate() {
  if (!active.value) return
  const name = await askPrompt('Template name', active.value.name + ' template', {
    title: 'Save template'
  })
  if (!name?.trim()) return
  const saved = await api.saveTemplate({
    name: name.trim(),
    schema: active.value,
    schemaJson: JSON.stringify(active.value)
  })
  statusMsg.value = `Template “${name.trim()}” saved`
  if (saved?.id) templates.value = upsertById(templates.value, saved)
  else {
    try {
      templates.value = await api.listTemplates()
    } catch {
      /* ignore */
    }
  }
}

async function loadTemplate(t) {
  try {
    const schema = JSON.parse(t.schemaJson)
    schema.id = newId()
    clearSchemaUndo()
    active.value = schema
    selectedId.value = active.value.root?.[0]?.id || null
    statusMsg.value = `Loaded template “${t.name}”`
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function removeTemplate(id) {
  if (
    !(await askConfirm('Delete template?', {
      title: 'Delete template',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  await api.deleteTemplate(id)
  templates.value = removeById(templates.value, id)
}

async function saveSettingsPatch(patch) {
  settings.value = await api.setSettings(patch)
  applySettingsLocal(settings.value)
  statusMsg.value = 'Settings saved'
}

async function openSettings() {
  if (settingsOpen.value) {
    settingsOpen.value = false
    return
  }
  if (!settings.value) {
    try {
      settings.value = await api.getSettings()
      applySettingsLocal(settings.value)
    } catch (e) {
      flashError(e.message || 'Could not load settings — is the API running?')
      return
    }
  }
  settingsOpen.value = true
}

async function exportBackup() {
  const blob = await api.backupExport()
  downloadBlob(blob, `DataForge-backup.json`)
  statusMsg.value = 'Backup downloaded'
}

async function importBackup(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  const res = await api.backupImport(file)
  statusMsg.value = `Imported backup (${res.imported} items)`
  await refresh()
  applySettingsLocal(settings.value)
}

async function onArchiveOpen(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  archiveFile.value = file
  const res = await api.archiveList(file)
  archiveEntries.value = res.entries || []
  archivePreview.value = ''
  sidebar.value = 'archive'
}

async function readArchiveEntry(path) {
  if (!archiveFile.value) return
  const res = await api.archiveRead(archiveFile.value, path)
  archivePreview.value = res.content
  previewText.value = res.content
}

async function clearHistoryAll() {
  const c = await api.historyClearCount({ mode: 'all', confirmAll: true })
  if (
    !(await askConfirm(`Delete all ${c.count} history rows?`, {
      title: 'Clear fill values',
      danger: true,
      confirmLabel: 'Clear all'
    }))
  )
    return
  const r = await api.historyClear({ mode: 'all', confirmAll: true })
  statusMsg.value = `Cleared ${r.deleted} history rows`
  await loadHistory()
  await refreshStatusOnly()
}

async function openCustomList(id) {
  activeCustomList.value = await api.getCustomList(id)
  customListName.value = activeCustomList.value.name
  customListKeys.value = (activeCustomList.value.keys || []).join(', ')
}

async function createCustomList() {
  const name = await askPrompt('List name (e.g. Heroes, Cities)', '', {
    title: 'New field list'
  })
  if (!name?.trim()) return
  const saved = await api.saveCustomList({ name: name.trim(), keys: [] })
  await refreshDataPackLists()
  await openCustomList(saved.id)
  statusMsg.value = `Custom list “${saved.name}” created`
  sidebar.value = 'datapacks'
  dataPackSubTab.value = 'custom'
}

async function saveActiveCustomList() {
  if (!activeCustomList.value) return
  const keys = customListKeys.value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const saved = await api.saveCustomList({
    id: activeCustomList.value.id,
    name: customListName.value.trim() || activeCustomList.value.name,
    description: activeCustomList.value.description,
    keys
  })
  activeCustomList.value = saved
  customLists.value = upsertById(customLists.value, {
    ...saved,
    valueCount: saved.values?.length ?? saved.valueCount
  })
  statusMsg.value = 'Custom list saved'
}

async function addBulkCustomValues() {
  if (!activeCustomList.value) return
  const values = customBulkValues.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!values.length) return
  const res = await api.addCustomValues(activeCustomList.value.id, values)
  customBulkValues.value = ''
  await openCustomList(activeCustomList.value.id)
  await refreshDataPackLists()
  await refreshStatusOnly()
  statusMsg.value = `Added ${res.inserted} value(s)`
}

async function editCustomValue(v) {
  const next = await askPrompt('Edit value', v.value, { title: 'Edit list value' })
  if (next == null || !next.trim()) return
  await api.updateCustomValue(v.id, next.trim())
  await openCustomList(activeCustomList.value.id)
}

async function removeCustomValue(id) {
  await api.deleteCustomValue(id)
  await openCustomList(activeCustomList.value.id)
  await refreshDataPackLists()
  await refreshStatusOnly()
}

async function removeCustomList() {
  if (!activeCustomList.value) return
  if (
    !(await askConfirm(`Delete list “${activeCustomList.value.name}”?`, {
      title: 'Delete field list',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  const id = activeCustomList.value.id
  await api.deleteCustomList(id)
  activeCustomList.value = null
  customLists.value = removeById(customLists.value, id)
  await refreshStatusOnly()
}

async function createTheme() {
  const name = await askPrompt('Theme name (e.g. Star Wars, Westeros)', '', {
    title: 'New theme'
  })
  if (!name?.trim()) return
  try {
    await api.saveTheme({ name: name.trim() })
    await refreshDataPackLists()
    await reloadFieldThemeCategories()
    flashStatus(`Theme “${name.trim()}” created`)
  } catch (e) {
    flashError(e.message || 'Could not create theme')
  }
}

async function deleteTheme(theme) {
  if (!theme?.id) return
  if (
    !(await askConfirm(`Delete theme “${theme.name}”?`, {
      title: 'Delete theme',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  try {
    await api.deleteTheme(theme.id)
    if (themeEditor.value?.theme?.id === theme.id) themeEditor.value = null
    themes.value = removeById(themes.value, theme.id)
    themeBlend.value = themeBlend.value.filter((b) => b.themeId !== theme.id)
    await refreshDataPackLists()
    await reloadFieldThemeCategories()
    void persistDataThemes()
    flashStatus(`Deleted theme “${theme.name}”`)
  } catch (e) {
    flashError(e.message || 'Could not delete theme')
  }
}

async function openThemeValuesEditor(theme, categoryHint) {
  themeEditor.value = {
    theme,
    category: categoryHint || 'names',
    bulk: '',
    values: [],
    stats: [],
    /** Local categories created before any values exist (chips only). */
    localCategories: [],
    loading: true
  }
  sidebar.value = 'datapacks'
  dataPackSubTab.value = 'themes'
  await loadThemeEditorValues()
}

async function loadThemeEditorValues() {
  if (!themeEditor.value?.theme) return
  themeEditor.value = { ...themeEditor.value, loading: true }
  try {
    const cat = (themeEditor.value.category || '').trim()
    const res = await api.getThemeValues(
      themeEditor.value.theme.id,
      cat || undefined
    )
    // API returns { values, categories, count } (legacy list still handled)
    const values = Array.isArray(res) ? res : res.values || []
    const stats = Array.isArray(res) ? [] : res.categories || []
    let filtered = values
    if (cat) {
      filtered = values.filter(
        (v) => String(v.category || '').toLowerCase() === cat.toLowerCase()
      )
    }
    // Drop local stubs once the category exists in DB stats
    const dbCats = new Set(stats.map((s) => String(s.category).toLowerCase()))
    const localCategories = (themeEditor.value.localCategories || []).filter(
      (c) => !dbCats.has(String(c).toLowerCase())
    )
    themeEditor.value = {
      ...themeEditor.value,
      values: filtered,
      stats,
      localCategories,
      loading: false
    }
  } catch (e) {
    themeEditor.value = { ...themeEditor.value, loading: false, values: [] }
    flashError(e.message)
  }
}

function themeCatStat(category) {
  const stats = themeEditor.value?.stats || []
  const hit = stats.find(
    (s) => String(s.category).toLowerCase() === String(category || '').toLowerCase()
  )
  return (
    hit || {
      category,
      count: themeEditor.value?.values?.length || 0,
      limit: THEME_CAT_LIMIT,
      warnAt: THEME_CAT_WARN_AT,
      nearLimit: false,
      full: false
    }
  )
}

/** Chips: DB categories + empty local ones the user just created. */
const themeEditorCategoryChips = computed(() => {
  const ed = themeEditor.value
  if (!ed) return []
  const stats = [...(ed.stats || [])]
  const seen = new Set(stats.map((s) => String(s.category).toLowerCase()))
  for (const c of ed.localCategories || []) {
    const key = String(c).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    stats.push({
      category: c,
      count: 0,
      limit: THEME_CAT_LIMIT,
      warnAt: THEME_CAT_WARN_AT,
      nearLimit: false,
      full: false,
      local: true
    })
  }
  return stats
})

const themeEditorCatStat = computed(() =>
  themeCatStat(themeEditor.value?.category || '')
)

/**
 * Create / switch to a category under the open theme.
 * Categories are registered in SQLite immediately (even with zero values).
 */
async function addThemeCategory() {
  if (!themeEditor.value?.theme) return
  const raw = await askPrompt(
    'New category name (e.g. names, ships, lightsabers, codes)',
    '',
    { title: 'Add category' }
  )
  if (raw == null) return
  const name = String(raw).trim().replace(/\s+/g, '_').toLowerCase()
  if (!name) {
    flashError('Category name is required')
    return
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(name)) {
    flashError('Use letters, numbers, underscore, or hyphen (max 48 chars)')
    return
  }
  const chips = themeEditorCategoryChips.value
  const exists = chips.some(
    (s) => String(s.category).toLowerCase() === name.toLowerCase()
  )
  try {
    if (!exists) {
      const res = await api.ensureThemeCategory(themeEditor.value.theme.id, name)
      themeEditor.value = {
        ...themeEditor.value,
        category: name,
        localCategories: [],
        bulk: '',
        values: [],
        stats: res.categories || themeEditor.value.stats
      }
      await refreshDataPackLists()
      await loadThemeEditorValues()
      await reloadFieldThemeCategories()
      flashStatus(`Category “${name}” saved — add values below`)
    } else {
      themeEditor.value = {
        ...themeEditor.value,
        category: name,
        bulk: '',
        values: themeEditor.value.values
      }
      void loadThemeEditorValues()
      flashStatus(`Switched to category “${name}”`)
    }
  } catch (e) {
    flashError(e.message || 'Could not save category')
  }
}

function selectThemeCategory(name) {
  if (!themeEditor.value) return
  themeEditor.value = { ...themeEditor.value, category: name, bulk: '' }
  void loadThemeEditorValues()
}

/** Delete a theme category pool (all values) or a local empty chip. */
async function deleteThemeCategory(name) {
  if (!themeEditor.value?.theme) return
  const cat = String(name || themeEditor.value.category || '').trim()
  if (!cat) {
    flashError('No category selected')
    return
  }
  const chip = themeEditorCategoryChips.value.find(
    (s) => String(s.category).toLowerCase() === cat.toLowerCase()
  )
  const count = chip?.count ?? themeEditor.value.values?.length ?? 0
  const isLocalOnly = !!chip?.local || count === 0
  const msg = isLocalOnly
    ? `Remove empty category “${cat}”?`
    : `Delete category “${cat}” and all ${count} value(s)? This cannot be undone.`
  if (
    !(await askConfirm(msg, {
      title: 'Delete category',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  try {
    // Always try API delete so DB pool is cleared when values exist
    const res = await api.deleteThemeCategory(themeEditor.value.theme.id, cat)
    const deleted = Number(res?.deleted) || 0
    // Drop local chip if present
    const local = (themeEditor.value.localCategories || []).filter(
      (c) => String(c).toLowerCase() !== cat.toLowerCase()
    )
    const remaining = (res?.categories || []).map((s) => s.category)
    const nextCat =
      remaining.find((c) => String(c).toLowerCase() !== cat.toLowerCase()) ||
      local[0] ||
      ''
    themeEditor.value = {
      ...themeEditor.value,
      category: nextCat,
      localCategories: local,
      bulk: '',
      values: [],
      stats: res?.categories || []
    }
    await refreshDataPackLists()
    await refreshStatusOnly()
    await loadThemeEditorValues()
    await reloadFieldThemeCategories()
    flashStatus(
      deleted
        ? `Deleted category “${cat}” (${deleted} value(s))`
        : `Removed category “${cat}”`
    )
  } catch (e) {
    // Local-only empty category (never saved) — just drop the chip
    if (isLocalOnly) {
      const local = (themeEditor.value.localCategories || []).filter(
        (c) => String(c).toLowerCase() !== cat.toLowerCase()
      )
      const chips = themeEditorCategoryChips.value.filter(
        (s) => String(s.category).toLowerCase() !== cat.toLowerCase()
      )
      themeEditor.value = {
        ...themeEditor.value,
        category: chips[0]?.category || local[0] || '',
        localCategories: local,
        values: [],
        bulk: ''
      }
      flashStatus(`Removed category “${cat}”`)
      return
    }
    flashError(e.message)
  }
}

async function submitThemeValuesEditor() {
  if (!themeEditor.value?.theme) return
  const { theme, category, bulk } = themeEditor.value
  const values = String(bulk || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!category?.trim()) {
    flashError('Enter a category (e.g. names, ships, lightsabers)')
    return
  }
  if (!values.length) {
    flashError('Add at least one value')
    return
  }
  try {
    const res = await api.addThemeValues(theme.id, {
      category: category.trim(),
      values
    })
    themeEditor.value = { ...themeEditor.value, bulk: '' }
    if (res.warning) flashError(res.warning)
    else
      flashStatus(
        `Theme “${theme.name}”: +${res.inserted} in “${category.trim()}” (${res.total}/${res.limit})`
      )
    await refreshDataPackLists()
    await refreshStatusOnly()
    await loadThemeEditorValues()
    await reloadFieldThemeCategories()
  } catch (e) {
    flashError(e.message)
  }
}

async function deleteThemeValueRow(row) {
  if (!themeEditor.value?.theme || !row?.id) return
  if (
    !(await askConfirm(`Remove “${row.value}” from ${row.category}?`, {
      title: 'Remove value',
      danger: true,
      confirmLabel: 'Remove'
    }))
  )
    return
  try {
    await api.deleteThemeValue(themeEditor.value.theme.id, row.id)
    await loadThemeEditorValues()
    await refreshDataPackLists()
    await refreshStatusOnly()
    await reloadFieldThemeCategories()
    flashStatus('Value removed')
  } catch (e) {
    flashError(e.message)
  }
}

async function editThemeValueRow(row) {
  if (!themeEditor.value?.theme || !row?.id) return
  const next = await askPrompt('Edit value', row.value, { title: 'Edit theme value' })
  if (next == null) return
  const v = String(next).trim()
  if (!v || v === row.value) return
  try {
    await api.updateThemeValue(themeEditor.value.theme.id, row.id, v)
    await loadThemeEditorValues()
    await refreshDataPackLists()
    await reloadFieldThemeCategories()
    flashStatus('Value updated')
  } catch (e) {
    flashError(e.message)
  }
}

async function onThemeEditorCategoryChange() {
  const raw = (themeEditor.value?.category || '').trim()
  if (!raw || !themeEditor.value?.theme) {
    void loadThemeEditorValues()
    return
  }
  const cat = raw.replace(/\s+/g, '_').toLowerCase()
  const known = themeEditorCategoryChips.value.some(
    (s) => String(s.category).toLowerCase() === cat
  )
  if (!known) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(cat)) {
      flashError('Use letters, numbers, underscore, or hyphen (max 48 chars)')
      return
    }
    try {
      const res = await api.ensureThemeCategory(themeEditor.value.theme.id, cat)
      themeEditor.value = {
        ...themeEditor.value,
        category: cat,
        localCategories: [],
        stats: res.categories || themeEditor.value.stats
      }
      await reloadFieldThemeCategories()
      flashStatus(`Category “${cat}” saved`)
    } catch (e) {
      flashError(e.message || 'Could not save category')
      return
    }
  } else if (cat !== themeEditor.value.category) {
    themeEditor.value = { ...themeEditor.value, category: cat }
  }
  void loadThemeEditorValues()
}

function openFieldThemeInDataPacks() {
  sidebar.value = 'datapacks'
  dataPackSubTab.value = 'themes'
  const tid = selected.value?.themeId
  const cat = selected.value?.themeCategory
  const pack =
    (tid && tid !== 'blend' && themes.value.find((t) => t.id === tid)) ||
    themes.value[0]
  if (pack) void openThemeValuesEditor(pack, cat || 'names')
}

async function openRecentSchema(item) {
  const schemaId = item?.payload?.schemaId || item?.id
  if (!schemaId) {
    flashError('No schema linked to this activity')
    return
  }
  // Prefer list, else fetch by id
  let s = schemas.value.find((x) => x.id === schemaId)
  if (!s) {
    try {
      s = await api.getSchema(schemaId)
    } catch (e) {
      flashError(e.message)
      return
    }
  }
  sidebar.value = 'schemas'
  await selectSchema(s.id || schemaId)
  if (!schemas.value.find((x) => x.id === schemaId)) {
    active.value = JSON.parse(JSON.stringify(s))
    selectedId.value = active.value.root?.[0]?.id || null
    syncXmlTagsFromSchema(active.value)
  }
  flashStatus(`Opened “${s.name || schemaId}”`)
}

const COMMON_THEME_CATS = [
  'names',
  'person_name',
  'place',
  'ships',
  'ship',
  'lightsabers',
  'hairstyles',
  'numbers',
  'codes',
  'house',
  'creature',
  'weapon',
  'title',
  'general'
]

const THEME_CAT_LIMIT = 100
const THEME_CAT_WARN_AT = 95

/**
 * Categories actually present in Data packs theme values for the Field settings
 * dropdown. Re-fetched from API whenever a theme pool is saved (not a stale cache).
 */
const fieldPackCategories = ref([])
let _fieldCatLoadSeq = 0

function _uniqCats(list) {
  const seen = new Set()
  const out = []
  for (const raw of list || []) {
    const s = String(raw || '').trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/** Always re-query the API so Category matches the latest pool contents. */
async function loadFieldPackCategories(themeId) {
  const seq = ++_fieldCatLoadSeq
  const tid = (themeId || '').trim()
  let next = []
  try {
    if (tid && tid !== 'blend') {
      // Specific pack → only categories that pack actually has values for
      const res = await api.themeCategories(tid)
      next = _uniqCats(res?.categories)
    } else {
      // Blend: union of active blend packs; else all themes with values
      const activeIds = (themeBlend.value || [])
        .map((b) => b.themeId)
        .filter(Boolean)
      if (activeIds.length) {
        const results = await Promise.all(
          activeIds.map((id) =>
            api.themeCategories(id).catch(() => ({ categories: [] }))
          )
        )
        const merged = []
        for (const res of results) {
          for (const c of res?.categories || []) merged.push(c)
        }
        next = _uniqCats(merged)
      } else {
        const res = await api.themeCategories()
        next = _uniqCats(res?.categories)
      }
    }
  } catch {
    next = []
  }
  // Drop stale responses if a newer reload started
  if (seq !== _fieldCatLoadSeq) return
  fieldPackCategories.value = next
}

/** Public reload — call after any theme pool save / delete / refresh. */
async function reloadFieldThemeCategories() {
  await loadFieldPackCategories(selected.value?.themeId)
}

watch(
  () => [
    selected.value?.themeId,
    selectedId.value,
    themeBlend.value.map((b) => b.themeId).join(',')
  ],
  () => {
    void reloadFieldThemeCategories()
  },
  { immediate: true }
)

/** Category options: only what exists in Data packs for the chosen Theme pack. */
const fieldThemeCategoryOptions = computed(() => {
  const out = _uniqCats(fieldPackCategories.value)
  // Keep current selection visible if it was saved but pack no longer has it
  const cur = (selected.value?.themeCategory || '').trim()
  if (cur && !out.some((c) => c.toLowerCase() === cur.toLowerCase())) {
    out.push(cur)
  }
  return out
})

const PACKAGE_SUPPORTED_EXTS = ['.xml', '.csv', '.txt']

function isPackageSupportedMember(m) {
  if (!m || m.kind !== 'text') return false
  const fmt = (m.format || '').toLowerCase()
  if (fmt === 'xml' || fmt === 'csv' || fmt === 'txt') return true
  const name = (m.name || m.path || '').toLowerCase()
  return PACKAGE_SUPPORTED_EXTS.some((e) => name.endsWith(e))
}

/** Build nested tree nodes from flat member paths (explorer). */
function buildPackagePathTree(members) {
  const root = { name: '', path: '', kind: 'dir', children: {} }
  for (const m of members || []) {
    const p = String(m.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!p) continue
    const parts = p.split('/').filter(Boolean)
    let node = root
    let acc = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      acc.push(part)
      const full = acc.join('/')
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: full,
          kind: i === parts.length - 1 ? (m.kind === 'nested_archive_folder' ? 'dir' : 'file') : 'dir',
          member: i === parts.length - 1 ? m : null,
          children: {}
        }
      } else if (i === parts.length - 1) {
        node.children[part].member = m
        if (m.kind === 'text') node.children[part].kind = 'file'
      }
      node = node.children[part]
    }
  }
  function freeze(n) {
    const kids = Object.keys(n.children || {})
      .sort()
      .map((k) => freeze(n.children[k]))
    return {
      name: n.name,
      path: n.path,
      kind: n.kind,
      member: n.member,
      children: kids
    }
  }
  return Object.keys(root.children)
    .sort()
    .map((k) => freeze(root.children[k]))
}

const packageExplorerTree = computed(() =>
  buildPackagePathTree(activePackage.value?.members || [])
)

function togglePackageTreeDir(path) {
  packageTreeExpanded.value = {
    ...packageTreeExpanded.value,
    [path]: !packageTreeExpanded.value[path]
  }
}

function isPackageTreeExpanded(path) {
  // Default expanded for top-level
  if (packageTreeExpanded.value[path] === undefined) return true
  return !!packageTreeExpanded.value[path]
}

/** Flat rows for explorer (depth-aware, respects collapsed folders). */
const packageExplorerRows = computed(() => {
  const rows = []
  function walk(nodes, depth) {
    for (const n of nodes || []) {
      const isDir = n.kind === 'dir' || n.member?.kind === 'nested_archive_folder'
      if (isDir) {
        rows.push({ ...n, depth, isDir: true })
        if (isPackageTreeExpanded(n.path)) {
          walk(n.children || [], depth + 1)
        }
      } else {
        rows.push({ ...n, depth, isDir: false })
      }
    }
  }
  walk(packageExplorerTree.value, 0)
  return rows
})

async function onPackageImport(ev) {
  const files = Array.from(ev.target.files || [])
  ev.target.value = ''
  if (!files.length) return
  packageWorking.value = true
  errorMsg.value = ''
  try {
    const res = await api.importPackage(files)
    activePackage.value = res
    packageFieldModes.value = {}
    packageTreeExpanded.value = {}
    packageMemberPath.value =
      res.members?.find((m) => m.kind === 'text' && isPackageSupportedMember(m))?.path ||
      res.members?.find((m) => m.kind === 'text')?.path ||
      null
    selectPackageMember(packageMemberPath.value)
    sidebar.value = 'packages'
    const multi = res.multifileSchemaId ? ' · Multifile preview schema saved' : ''
    const skipN = res.skipped?.length || 0
    statusMsg.value = `Package “${res.name}” · ${res.members?.filter((x) => x.kind === 'text').length || 0} text · nested ${res.nestedArchives?.length || 0} · skipped ${skipN}${multi}`
    await refreshLibraryLists()
    await refreshStatusOnly()
    await refreshPackageEstimate()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    packageWorking.value = false
  }
}

function listLeafPaths(rows, parent = []) {
  const out = []
  for (const r of rows || []) {
    const leaf = (r.key || 'field').trim() || 'field'
    const path = [...parent, leaf]
    const kids = r.children || []
    const kind = r.kind || 'value'
    if (kind === 'value' || (!kids.length && kind !== 'object' && kind !== 'array')) {
      out.push(path.join('.'))
    } else if (kids.length) {
      out.push(...listLeafPaths(kids, path))
    }
  }
  return out
}

function packageMemberLeaves(memberPath) {
  const schema = activePackage.value?.schemas?.[memberPath]
  if (!schema?.root) return []
  return listLeafPaths(schema.root)
}

function setPackageFieldMode(memberPath, fieldPath, mode) {
  if (!packageFieldModes.value[memberPath]) {
    packageFieldModes.value[memberPath] = {}
  }
  packageFieldModes.value[memberPath][fieldPath] = mode
}

function getPackageFieldMode(memberPath, fieldPath) {
  return (
    packageFieldModes.value[memberPath]?.[fieldPath] || packageDefaultMode.value
  )
}

async function refreshPackageEstimate() {
  if (!activePackage.value?.id) {
    packageEstimate.value = null
    return
  }
  try {
    packageEstimate.value = await api.estimatePackage(
      activePackage.value.id,
      packageCount.value || 1
    )
  } catch {
    // Client-side fallback from layout
    packageEstimate.value = clientPackageEstimate(
      activePackage.value,
      packageCount.value || 1
    )
  }
}

function clientPackageEstimate(pkg, n) {
  const members = pkg.members || []
  const nested = pkg.nestedArchives || []
  const folders = nested.map((x) => x.folderPath).filter(Boolean)
  const under = (path) =>
    folders.some((f) => path === f || path.startsWith(f + '/'))
  const text = members.filter((m) => m.kind === 'text')
  const topText = text.filter((m) => !under(m.path)).length
  const topEntries = topText + nested.length
  const textCount = text.length
  return {
    recordCount: n,
    textFilesPerPackage: textCount,
    nestedArchivesPerPackage: nested.length,
    topLevelEntriesPerPackage: topEntries,
    estimatedOuterPackages: n,
    estimatedLogicalContentFiles: n * textCount,
    estimatedTopLevelEntriesTotal: n * topEntries,
    downloadBundles: 1,
    downloadContainsPackages: n,
    downloadBundleFormat: n > 1 ? 'tar.gz' : 'zip',
    summary: `${n} package(s) × ${topEntries} top-level entries ≈ ${n * textCount} content files; download 1 ${n > 1 ? 'tar.gz' : 'ZIP'} with ${n} package(s)`
  }
}

watch(packageCount, () => {
  void refreshPackageEstimate()
})

async function openPackage(id) {
  errorMsg.value = ''
  try {
    activePackage.value = await api.getPackage(id)
    packageFieldModes.value = {}
    packageTreeExpanded.value = {}
    packageMemberPath.value =
      activePackage.value.members?.find((m) => m.kind === 'text' && isPackageSupportedMember(m))
        ?.path ||
      activePackage.value.members?.find((m) => m.kind === 'text')?.path ||
      null
    selectPackageMember(packageMemberPath.value)
    if (!deliveryForm.value.packageId) {
      deliveryForm.value.packageId = id
    }
    await refreshPackageEstimate()
  } catch (e) {
    errorMsg.value = e.message
  }
}

function selectPackageMember(path) {
  packageMemberPath.value = path
  const m = activePackage.value?.members?.find((x) => x.path === path)
  if (!m) {
    packagePreview.value = ''
    packageEditContent.value = ''
    packageEditName.value = ''
    return
  }
  if (m.kind === 'nested_archive_folder') {
    packagePreview.value = `// Nested archive folder → re-packs to ${m.nestedArchivePath}\n// format: ${m.nestedArchiveFormat}`
    packageEditContent.value = ''
    packageEditName.value = m.name || ''
    return
  }
  if (!isPackageSupportedMember(m)) {
    packagePreview.value = `// Unsupported for edit (${m.format || m.name}). Supported: xml, csv, txt.`
    packageEditContent.value = ''
    packageEditName.value = m.name || ''
    return
  }
  packagePreview.value = m.content || ''
  packageEditContent.value = m.content || ''
  packageEditName.value = m.name || ''
}

const selectedPackageMember = computed(() => {
  if (!activePackage.value || !packageMemberPath.value) return null
  return (
    activePackage.value.members?.find((x) => x.path === packageMemberPath.value) || null
  )
})

const packageMemberEditable = computed(() =>
  isPackageSupportedMember(selectedPackageMember.value)
)

async function verifyPackageMember(verified) {
  if (!activePackage.value || !packageMemberPath.value) return
  await api.verifyPackageMember(
    activePackage.value.id,
    packageMemberPath.value,
    verified
  )
  activePackage.value = await api.getPackage(activePackage.value.id)
}

async function savePackageMemberContent() {
  if (!activePackage.value || !packageMemberPath.value || !packageMemberEditable.value) return
  packageWorking.value = true
  errorMsg.value = ''
  try {
    const body = {
      memberPath: packageMemberPath.value,
      content: packageEditContent.value
    }
    const name = (packageEditName.value || '').trim()
    if (name && name !== selectedPackageMember.value?.name) {
      body.newName = name
    }
    // Backend re-infers schema root/sampleValues from content so generate uses edits
    const res = await api.updatePackageMember(activePackage.value.id, body)
    activePackage.value = res
    // path may have changed after rename
    const nextPath =
      res.members?.find(
        (m) => m.name === name || m.path === packageMemberPath.value || m.path.endsWith('/' + name)
      )?.path || packageMemberPath.value
    packageMemberPath.value = nextPath
    selectPackageMember(nextPath)
    statusMsg.value =
      'Member + schema saved from content (design sample re-inferred; not bulk generate)'
    await refreshLibraryLists()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    packageWorking.value = false
  }
}

async function savePackageMemberSchemaInPlace() {
  // Schema-from-edited-content: same path as Save member (re-infer on content)
  if (!packageMemberEditable.value) {
    errorMsg.value = 'Select a supported member (xml/csv/txt) to save schema from content'
    return
  }
  await savePackageMemberContent()
}

async function savePackageMemberSchemaAs() {
  if (!activePackage.value || !packageMemberPath.value) return
  const m = selectedPackageMember.value
  if (!m?.schemaId) {
    errorMsg.value = 'This member has no schema'
    return
  }
  if (!packageMemberEditable.value) {
    errorMsg.value = 'Only XML, CSV, and TXT members support save-as from content'
    return
  }
  const name = await askPrompt(
    'Save schema as (new name, inferred from current editor content):',
    `${m.name || 'member'} schema copy`,
    { title: 'Save member schema as' }
  )
  if (name == null) return
  packageWorking.value = true
  errorMsg.value = ''
  try {
    const res = await api.savePackageMemberAs(activePackage.value.id, {
      memberPath: packageMemberPath.value,
      newSchemaName: name.trim() || undefined,
      content: packageEditContent.value,
      reinferFromContent: true,
      linkToPackage: true
    })
    if (res.package) activePackage.value = res.package
    else activePackage.value = await api.getPackage(activePackage.value.id)
    selectPackageMember(packageMemberPath.value)
    statusMsg.value = `Saved as new schema “${res.schema?.name || name}” from edited content (linked)`
    await refreshLibraryLists()
    await refreshStatusOnly()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    packageWorking.value = false
  }
}

async function runPackageGenerate() {
  if (!activePackage.value) return
  packageWorking.value = true
  errorMsg.value = ''
  try {
    const n = Math.min(Math.max(Number(packageCount.value) || 1, 1), 100)
    if (packageCount.value > 100) {
      packageCount.value = 100
      statusMsg.value =
        'Interactive package generate is capped at 100 variants (use Delivery later for bulk).'
    }
    const res = await api.generatePackage(activePackage.value.id, {
      recordCount: n,
      seed: seed.value.trim() === '' ? null : Number(seed.value),
      ciMode: ciMode.value,
      recordHistory: packageRecordHistory.value && !ciMode.value,
      defaultFieldMode: packageDefaultMode.value,
      fieldModes: packageFieldModes.value,
      outputFormat: packageOutputFormat.value || 'itself',
      useDataThemes: useDataThemes.value,
      themePreferOverHistory: themePrefer.value,
      themeBlend: themeBlend.value.map((b) => ({
        themeId: b.themeId,
        weight: Number(b.weight) || 1
      }))
    })
    downloadBase64Zip(res.zipBase64 || res.archiveBase64, res.fileName)
    const arch =
      res.archiveFormat ||
      (String(res.fileName || '').endsWith('.tar.gz') ? 'tar.gz' : 'ZIP')
    statusMsg.value = `Package variants: ${res.written} written as ${arch} · seed ${res.seed}${res.themeHits != null ? ` · themeHits ${res.themeHits}` : ''} (not stored in DB)`
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    packageWorking.value = false
  }
}

async function editPackageMemberSchema() {
  if (!activePackage.value || !packageMemberPath.value) return
  const m = activePackage.value.members?.find((x) => x.path === packageMemberPath.value)
  if (!m?.schemaId) {
    errorMsg.value = 'This member has no editable schema'
    return
  }
  if (!isPackageSupportedMember(m)) {
    errorMsg.value = 'Only XML, CSV, and TXT members can be edited'
    return
  }
  errorMsg.value = ''
  try {
    // Member schemas are hidden from list_schemas; load by id
    const s = await api.getSchema(m.schemaId)
    clearSchemaUndo()
    active.value = JSON.parse(JSON.stringify(s))
    selectedId.value = active.value.root?.[0]?.id || null
    sidebar.value = 'schemas'
    statusMsg.value = `Editing package member schema: ${m.path} (save updates package generate)`
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function removePackage(id) {
  if (
    !(await askConfirm(
      'Delete package layout and its linked schemas from SQLite? Generated files on disk are not removed.',
      { title: 'Delete package', danger: true, confirmLabel: 'Delete' }
    ))
  )
    return
  errorMsg.value = ''
  try {
    await api.deletePackage(id)
    if (activePackage.value?.id === id) activePackage.value = null
    packages.value = removeById(packages.value, id)
    await refreshLibraryLists()
    await refreshDeliveryJobs()
    await refreshStatusOnly()
    statusMsg.value = 'Package deleted (linked schemas and delivery jobs cleaned up)'
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function createDeliveryJob() {
  deliveryWorking.value = true
  errorMsg.value = ''
  try {
    const f = deliveryForm.value
    if (!f.packageId) {
      errorMsg.value = 'Select a package for the delivery job'
      return
    }
    const job = await api.createDeliveryJob({
      name: f.name || undefined,
      packageId: f.packageId,
      targetTotal: Number(f.targetTotal) || 100,
      windowHours: Number(f.windowHours) || 24,
      chunkMin: Number(f.chunkMin) || 1,
      chunkMax: Number(f.chunkMax) || 10,
      destinationType: 'local_dir',
      destinationPath: f.destinationPath || undefined,
      seed: f.seed.trim() === '' ? null : Number(f.seed)
    })
    statusMsg.value = `Delivery job “${job.name}” planned · ${job.plan?.length || 0} chunks · total ${job.targetTotal}`
    deliveryJobs.value = await api.listDeliveryJobs()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    deliveryWorking.value = false
  }
}

async function runDeliveryChunk(jobId) {
  deliveryWorking.value = true
  errorMsg.value = ''
  try {
    const res = await api.runDeliveryChunk(jobId)
    statusMsg.value = res.message || `Chunk done · sent ${res.sentTotal}/${res.targetTotal}`
    deliveryJobs.value = await api.listDeliveryJobs()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    deliveryWorking.value = false
  }
}

async function refreshDeliveryJobs() {
  deliveryJobs.value = await api.listDeliveryJobs()
}

async function removeDeliveryJob(id) {
  if (
    !(await askConfirm('Delete this delivery job?', {
      title: 'Delete delivery job',
      danger: true,
      confirmLabel: 'Delete'
    }))
  )
    return
  await api.deleteDeliveryJob(id)
  await refreshDeliveryJobs()
}

async function deleteHist(id) {
  await api.historyDelete([id])
  await loadHistory()
}

async function editHist(h) {
  const v = await askPrompt('Edit value', h.value, { title: 'Edit fill value' })
  if (v == null) return
  await api.historyUpdate(h.id, v)
  await loadHistory()
}

const kindOptions = computed(() => {
  const f = (active.value?.sourceFormat || format.value || 'xml').toLowerCase()
  if (f === 'csv' || f === 'txt') return [{ v: 'value', l: 'Value' }]
  if (f === 'xml')
    return [
      { v: 'value', l: 'Value / element' },
      { v: 'array', l: 'Repeated' }
    ]
  return [
    { v: 'value', l: 'Value' },
    { v: 'object', l: 'Object' },
    { v: 'array', l: 'Array' }
  ]
})

/** Kind is only meaningful for hierarchical XML (CSV/TXT are always value columns). */
const showFieldKind = computed(() => {
  const f = (active.value?.sourceFormat || format.value || 'xml').toLowerCase()
  return f === 'xml' || (f !== 'csv' && f !== 'txt')
})

const selectedFieldPath = computed(() => {
  if (!active.value || !selectedId.value) return ''
  const hit = flatRows.value.find((x) => x.row.id === selectedId.value)
  if (!hit) return (selected.value?.key || '').trim() || ''
  const leaf = (hit.row.key || 'field').trim() || 'field'
  return [...hit.path, leaf].join('.')
})

/** Secondary Field settings (bounds, null %, primary, XML empty) */
const fieldHasAdvanced = computed(() => {
  const s = selected.value
  if (!s) return false
  return (
    s.minLength != null ||
    s.maxLength != null ||
    s.min != null ||
    s.max != null ||
    !!s.isPrimary ||
    typeof s.selfClosing === 'boolean'
  )
})

const selectedGenerateMode = computed(() => getSelectedGenerateMode())

/** Single “More” disclosure for secondary field options */
const propsMoreOpen = ref(false)
/** Generate rail: power opts (stream, CSV layout, archive, CI, history) behind disclosure */
const genMoreOpen = ref(false)
/** Collapsed-rail / expanded nav: demoted workspaces under More */
const navMoreOpen = ref(false)

watch(selectedId, () => {
  propsMoreOpen.value = fieldHasAdvanced.value
})

function goToLibrary() {
  sidebar.value = 'schemas'
  layout.value.sideCollapsed = false
  saveLayoutPrefs()
}

const enumText = computed({
  get: () => (selected.value?.enumValues || []).join('\n'),
  set: (v) => {
    const lines = v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    updateSelected({ enumValues: lines.length ? lines : undefined })
  }
})

/** Hover help tooltips — Settings → Show UI help tips (default on). */
const showUiHelp = computed(() => settings.value?.showUiHelp !== false)

/** Return title text only when UI help is enabled; otherwise undefined (no browser tooltip). */
function tip(msg) {
  if (!showUiHelp.value) return undefined
  if (msg == null || msg === '') return undefined
  return String(msg)
}
</script>

<template>
  <div class="shell" :aria-busy="bootLoading ? 'true' : undefined">
    <header class="top">
      <div class="brand">
        <div class="brand-row">
          <BrandIcon :size="30" />
          <strong class="brand-name">Data<span class="accent">Forge</span></strong>
        </div>
        <span class="muted brand-tagline">Local ETL test-data generator</span>
      </div>
      <div class="workspace-chip" :title="tip(workspaceHint)">
        <span class="workspace-chip-title">{{ workspaceTitle }}</span>
        <span v-if="workspaceHint" class="workspace-chip-hint muted tiny">{{ workspaceHint }}</span>
      </div>
      <div class="layout-tools" role="group" aria-label="Workspace panels">
        <span class="layout-tools-label" aria-hidden="true">Panels</span>
        <button
          type="button"
          class="layout-btn"
          :class="{ on: !layout.sideCollapsed }"
          :aria-pressed="!layout.sideCollapsed"
          :title="
            tip(
              layout.sideCollapsed
                ? 'Show the left Library / list panel'
                : 'Hide the left list panel for more editor space'
            )
          "
          @click="toggleSidePanel"
        >
          <span class="layout-btn-icon" aria-hidden="true">{{
            layout.sideCollapsed ? '»' : '«'
          }}</span>
          <span class="layout-btn-text">List</span>
        </button>
        <button
          type="button"
          class="layout-btn"
          :class="{ on: showRightPanel }"
          :disabled="!workspaceSupportsPreview"
          :aria-pressed="showRightPanel"
          :title="
            tip(
              !workspaceSupportsPreview
                ? 'Tools panel is not used in this workspace'
                : layout.previewCollapsed
                  ? 'Show the right tools panel (run options)'
                  : 'Hide the right tools panel for more editor space'
            )
          "
          @click="togglePreviewPanel"
        >
          <span class="layout-btn-text">Tools</span>
          <span class="layout-btn-icon" aria-hidden="true">{{
            showRightPanel ? '»' : '«'
          }}</span>
        </button>
        <button
          type="button"
          class="layout-btn layout-btn-reset"
          :title="tip('Reset list/tools panel sizes to defaults for this workspace')"
          @click="resetLayoutToWorkspace"
        >
          <span class="layout-btn-icon layout-btn-spin" aria-hidden="true">↺</span>
          <span class="layout-btn-text">Reset</span>
        </button>
      </div>
      <div class="top-actions">
        <select v-if="showFormatSelector" v-model="format" class="input fmt" :title="tip('Export format')">
          <option value="xml">XML</option>
          <option value="csv">CSV</option>
          <option value="txt">TXT</option>
          <option value="xlsx">XLSX</option>
        </select>
        <button
          v-if="workspaceMode === 'schema'"
          type="button"
          class="btn btn-ghost"
          :class="{ on: schemaPreviewOpen }"
          :aria-pressed="schemaPreviewOpen"
          :title="tip('Open live schema preview in a separate window (can drag outside this browser window)')"
          @click="toggleSchemaPreview"
        >
          {{
            schemaPreviewOpen
              ? schemaPreviewDocked
                ? 'Preview · docked'
                : 'Preview · open'
              : 'Preview'
          }}
        </button>
        <button
          class="btn btn-ghost"
          :title="tip('App preferences: theme, defaults, file naming, and UI help tips')"
          @click="openSettings"
        >
          Settings
        </button>
        <button
          v-if="showHeaderGenerate && workspaceMode === 'schema'"
          class="btn btn-primary"
          :disabled="generating || !active"
          :title="tip('Generate test records from the current schema and download/export')"
          @click="generate"
        >
          {{ generateButtonLabel }}
        </button>
        <button
          v-else-if="showHeaderPackageGenerate"
          class="btn btn-primary"
          :disabled="packageWorking || !activePackage"
          :title="tip('Generate package variants from the selected package layout')"
          @click="runPackageGenerate"
        >
          {{ packageWorking ? 'Working…' : 'Generate' }}
        </button>
      </div>
    </header>

    <AppDialog />

    <div v-if="bootLoading" class="banner boot" role="status">
      Loading library…
    </div>
    <div v-else-if="errorMsg" class="banner err" role="alert">
      {{ errorMsg }}
      <button class="btn btn-ghost" type="button" @click="errorMsg = ''">Dismiss</button>
    </div>
    <div v-else-if="statusMsg" class="banner ok" role="status">
      {{ statusMsg }}
      <button class="btn btn-ghost" type="button" @click="statusMsg = ''">Dismiss</button>
      <span class="banner-timer muted tiny" aria-hidden="true">auto-hides</span>
    </div>

    <!-- Settings drawer -->
    <div v-if="settingsOpen && settings" class="settings panel">
      <div class="settings-grid">
        <label class="chk settings-help-toggle" :title="tip('Hover tips on buttons and panels. Turn off when you know the app.')">
          <input
            type="checkbox"
            :checked="settings.showUiHelp !== false"
            @change="saveSettingsPatch({ showUiHelp: $event.target.checked })"
          />
          Show UI help tips (hover)
        </label>
        <label :title="tip('Color theme for the DataForge window')">
          Theme
          <select
            class="input"
            :value="settings.themeMode"
            @change="saveSettingsPatch({ themeMode: $event.target.value })"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>
        <label :title="tip('Default export format for new work and Generate')">
          Default format
          <select
            class="input"
            :value="EXPORT_FORMATS.includes(settings.defaultExportFormat) ? settings.defaultExportFormat : 'xml'"
            @change="saveSettingsPatch({ defaultExportFormat: $event.target.value })"
          >
            <option value="xml">XML</option>
            <option value="csv">CSV</option>
            <option value="txt">TXT</option>
            <option value="xlsx">XLSX</option>
          </select>
        </label>
        <label>
          Default record count
          <input
            type="number"
            class="input"
            :value="settings.defaultRecordCount"
            @change="
              saveSettingsPatch({
                defaultRecordCount: Number($event.target.value) || 10
              })
            "
          />
        </label>
        <label>
          CSV layout
          <select
            class="input"
            :value="settings.csvLayoutMode"
            @change="
              saveSettingsPatch({ csvLayoutMode: $event.target.value });
              csvLayoutMode = $event.target.value
            "
          >
            <option value="single-header">Single header table</option>
            <option value="entity-sections">Entity sections</option>
            <option value="per-key-sections">Per-key sections</option>
          </select>
        </label>
        <label>
          CSV flatten delimiter
          <input
            class="input"
            :value="settings.csvFlattenDelimiter"
            @change="
              saveSettingsPatch({ csvFlattenDelimiter: $event.target.value || '.' });
              csvDelim = $event.target.value || '.'
            "
          />
        </label>
        <label class="chk">
          <input
            type="checkbox"
            :checked="settings.csvNestedAsJson"
            @change="
              saveSettingsPatch({ csvNestedAsJson: $event.target.checked });
              csvNestedAsJson = $event.target.checked
            "
          />
          Nested as JSON in CSV
        </label>
        <label class="chk">
          <input
            type="checkbox"
            :checked="settings.csvMultiRow"
            @change="
              saveSettingsPatch({ csvMultiRow: $event.target.checked });
              csvMultiRow = $event.target.checked
            "
          />
          Multi-row CSV default
        </label>
        <label>
          XML root tag
          <input
            class="input mono"
            :value="settings.xmlRootTag || 'root'"
            @change="
              saveSettingsPatch({ xmlRootTag: $event.target.value || 'root' });
              xmlRootTag = $event.target.value || 'root'
            "
          />
        </label>
        <label class="chk">
          <input
            type="checkbox"
            :checked="settings.xmlSelfClosing !== false"
            @change="
              saveSettingsPatch({ xmlSelfClosing: $event.target.checked });
              xmlSelfClosing = $event.target.checked
            "
          />
          XML self-closing empty tags
        </label>
        <label>
          File name pattern
          <input
            class="input mono"
            :value="settings.fileNaming?.pattern"
            @change="
              saveSettingsPatch({
                fileNaming: {
                  ...settings.fileNaming,
                  pattern: $event.target.value
                }
              })
            "
          />
        </label>
        <label>
          Index pad
          <input
            type="number"
            class="input"
            :value="settings.fileNaming?.defaultIndexPad"
            @change="
              saveSettingsPatch({
                fileNaming: {
                  ...settings.fileNaming,
                  defaultIndexPad: Number($event.target.value) || 4
                }
              })
            "
          />
        </label>
        <label class="chk">
          <input
            type="checkbox"
            :checked="settings.fileNaming?.deterministicRandom"
            @change="
              saveSettingsPatch({
                fileNaming: {
                  ...settings.fileNaming,
                  deterministicRandom: $event.target.checked
                }
              })
            "
          />
          Deterministic name tokens
        </label>
        <label class="chk">
          <input
            type="checkbox"
            :checked="settings.fileNaming?.ensureUniqueNames !== false"
            @change="
              saveSettingsPatch({
                fileNaming: {
                  ...settings.fileNaming,
                  ensureUniqueNames: $event.target.checked
                }
              })
            "
          />
          Ensure unique file names
        </label>
        <div class="settings-actions">
          <button class="btn btn-ghost" @click="exportBackup">Export backup</button>
          <label class="btn btn-ghost">
            Import backup
            <input type="file" accept=".json" hidden @change="importBackup" />
          </label>
          <button class="btn btn-ghost" @click="settingsOpen = false">Close</button>
        </div>
      </div>
    </div>

    <div class="main" :class="mainLayoutClass" :style="mainLayoutStyle">
      <aside
        class="side panel"
        :class="[{ collapsed: layout.sideCollapsed }, 'nav-' + sideNavDensity]"
      >
        <div v-if="layout.sideCollapsed" class="side-collapsed-rail">
          <button
            type="button"
            class="btn btn-ghost full"
            :title="tip('Expand library panel')"
            @click="toggleSidePanel"
          >
            »
          </button>
          <button
            type="button"
            class="rail-nav rail-nav-primary"
            :class="{ on: sidebar === 'schemas' || sidebar === 'packages' }"
            :title="tip('Library')"
            @click="goToLibrary()"
          >
            Ly
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'history' }"
            :title="tip('Recent')"
            @click="sidebar = 'history'; layout.sideCollapsed = false; saveLayoutPrefs(); loadRecentActivity(); loadHistory()"
          >
            Re
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'datapacks' || sidebar === 'themes' || sidebar === 'custom' }"
            :title="tip('Data packs')"
            @click="sidebar = 'datapacks'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Dp
          </button>
          <button
            type="button"
            class="rail-nav rail-nav-muted"
            :class="{ on: sidebar === 'templates' }"
            :title="tip('Templates')"
            @click="sidebar = 'templates'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Tm
          </button>
          <button
            type="button"
            class="rail-nav rail-nav-muted"
            :class="{ on: sidebar === 'delivery' }"
            :title="tip('Delivery — plan chunked package dumps to disk')"
            @click="sidebar = 'delivery'; layout.sideCollapsed = false; saveLayoutPrefs(); refreshDeliveryJobs()"
          >
            Dv
          </button>
          <button
            type="button"
            class="rail-nav rail-nav-muted"
            :class="{ on: sidebar === 'archive' }"
            :title="tip('Archive — browse an existing ZIP/TAR without importing')"
            @click="sidebar = 'archive'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Ar
          </button>
        </div>
        <template v-else>
        <nav class="tabs workspace-tabs" aria-label="Workspaces">
          <div class="nav-primary">
            <button
              type="button"
              class="nav-tab-primary"
              :class="{ on: sidebar === 'schemas' || sidebar === 'packages' }"
              :aria-current="sidebar === 'schemas' || sidebar === 'packages' ? 'page' : undefined"
              :title="tip('Schemas and multifile packages — edit and Generate')"
              @click="sidebar = 'schemas'"
            >
              <span class="tab-code" aria-hidden="true">Ly</span>
              <span class="tab-short">Lib</span>
              <span class="tab-full">Library</span>
            </button>
          </div>
          <div class="nav-secondary" role="group" aria-label="Supporting workspaces">
            <button
              type="button"
              :class="{ on: sidebar === 'history' }"
              :title="tip('Recently used schemas and generate runs')"
              @click="
                sidebar = 'history';
                loadRecentActivity();
                loadHistory()
              "
            >
              <span class="tab-code" aria-hidden="true">Re</span>
              <span class="tab-short">Recent</span>
              <span class="tab-full">Recent</span>
            </button>
            <button
              type="button"
              :class="{ on: sidebar === 'datapacks' || sidebar === 'themes' || sidebar === 'custom' }"
              :title="tip('Themes (genres) and custom field values')"
              @click="sidebar = 'datapacks'"
            >
              <span class="tab-code" aria-hidden="true">Dp</span>
              <span class="tab-short">Packs</span>
              <span class="tab-full">Data packs</span>
            </button>
          </div>
          <div class="nav-demoted">
            <button
              type="button"
              class="nav-more-toggle"
              :aria-expanded="navMoreOpen || ['templates', 'delivery', 'archive'].includes(sidebar)"
              :title="tip('Templates, Delivery, Archive')"
              @click="navMoreOpen = !navMoreOpen"
            >
              <span class="muted tiny">More</span>
              <span class="muted tiny" aria-hidden="true">{{
                navMoreOpen || ['templates', 'delivery', 'archive'].includes(sidebar) ? '▾' : '▸'
              }}</span>
            </button>
            <div
              v-show="navMoreOpen || ['templates', 'delivery', 'archive'].includes(sidebar)"
              class="nav-demoted-row"
              role="group"
              aria-label="More tools"
            >
              <button
                type="button"
                class="nav-tab-demoted"
                :class="{ on: sidebar === 'templates' }"
                :title="tip('Schema templates')"
                @click="sidebar = 'templates'"
              >
                <span class="tab-code" aria-hidden="true">Tm</span>
                <span class="tab-short">Tmpl</span>
                <span class="tab-full">Templates</span>
              </button>
              <button
                type="button"
                class="nav-tab-demoted"
                :class="{ on: sidebar === 'delivery' }"
                :title="tip('Bulk delivery later')"
                @click="
                  sidebar = 'delivery';
                  refreshDeliveryJobs()
                "
              >
                <span class="tab-code" aria-hidden="true">Dv</span>
                <span class="tab-short">Deliv</span>
                <span class="tab-full">Delivery</span>
              </button>
              <button
                type="button"
                class="nav-tab-demoted"
                :class="{ on: sidebar === 'archive' }"
                :title="tip('Browse an existing archive')"
                @click="sidebar = 'archive'"
              >
                <span class="tab-code" aria-hidden="true">Ar</span>
                <span class="tab-short">Arch</span>
                <span class="tab-full">Archive</span>
              </button>
            </div>
          </div>
        </nav>

        <div v-if="sidebar === 'schemas' || sidebar === 'packages'" class="side-body">
          <button
            class="btn btn-primary full"
            type="button"
            :title="tip('Create a blank schema in the Library')"
            @click="newSchema"
          >
            + New schema
          </button>
          <label
            class="drop"
            :title="tip('Import one XML, CSV, or TXT sample file and infer a field schema')"
          >
            Import sample file → schema
            <input
              type="file"
              accept=".csv,.xml,.txt"
              hidden
              @change="onImport"
            />
          </label>
          <div class="import-pkg-block">
            <div class="side-section-label import-pkg-label">
              {{ packageWorking ? 'Import package · Working…' : 'Import package' }}
            </div>
            <div class="import-pkg-row">
              <label
                class="drop drop-split"
                :title="tip('Import a package from .tar / .tar.gz / .zip or multi-select XML, CSV, TXT files')"
                :class="{ disabled: packageWorking }"
              >
                Archive or files
                <input
                  type="file"
                  multiple
                  accept=".zip,.tar,.tgz,.gz,.xml,.csv,.txt"
                  hidden
                  :disabled="packageWorking"
                  @change="onPackageImport"
                />
              </label>
              <label
                class="drop drop-split"
                :title="tip('Import a whole folder as a package; nested paths are kept')"
                :class="{ disabled: packageWorking }"
              >
                Folder
                <input
                  type="file"
                  multiple
                  webkitdirectory
                  directory
                  hidden
                  :disabled="packageWorking"
                  @change="onPackageImport"
                />
              </label>
            </div>
          </div>

          <div class="side-section-label">Schemas</div>
          <ul class="schema-list">
            <li
              v-for="s in standaloneSchemas"
              :key="s.id"
              role="button"
              tabindex="0"
              :class="{ active: active?.id === s.id && workspaceMode === 'schema' }"
              @click="selectSchema(s.id)"
              @keydown.enter="selectSchema(s.id)"
            >
              <div class="name">{{ s.name }}</div>
              <div class="meta">
                {{ s.root?.length || 0 }} fields · {{ s.sourceFormat || format || '—' }}
              </div>
            </li>
            <li v-if="!standaloneSchemas.length" class="muted tiny" style="padding: 0.5rem">
              No single-file schemas yet.
            </li>
          </ul>

          <button
            type="button"
            class="side-section-label clickable-label"
            @click="schemasExpandedPackages = !schemasExpandedPackages"
          >
            Packages
            <span class="muted">{{ packages.length }}</span>
            <span class="muted">{{ schemasExpandedPackages ? '▾' : '▸' }}</span>
          </button>
          <ul v-if="schemasExpandedPackages" class="schema-list">
            <li
              v-for="p in packages"
              :key="p.id"
              role="button"
              tabindex="0"
              :class="{ active: activePackage?.id === p.id && workspaceMode === 'package' }"
              @click="
                sidebar = 'packages';
                openPackage(p.id)
              "
              @keydown.enter="
                sidebar = 'packages';
                openPackage(p.id)
              "
            >
              <div class="name">
                {{ p.name }}
                <span class="badge-multi">package</span>
              </div>
              <div class="meta">
                {{ (p.members || []).filter((m) => m.kind === 'text').length }} files ·
                {{ p.outerFormat }}
              </div>
              <div class="hist-row-actions">
                <button
                  type="button"
                  class="btn btn-ghost tiny-btn"
                  @click.stop="
                    sidebar = 'packages';
                    openPackage(p.id)
                  "
                >
                  Open layers
                </button>
                <button
                  type="button"
                  class="btn btn-ghost tiny-btn danger"
                  @click.stop="removePackage(p.id)"
                >
                  Del
                </button>
              </div>
            </li>
            <li v-if="!packages.length" class="muted tiny" style="padding: 0.5rem">
              Use Import package (archive/files or folder) above.
            </li>
          </ul>
          <p v-if="status" class="muted tiny">
            DB: {{ status.schemaCount }} schemas · {{ status.packageCount ?? 0 }} packages ·
            {{ status.customListCount ?? 0 }} custom · {{ status.valueHistoryCount }} fill values
          </p>
        </div>

        <div v-else-if="sidebar === 'history'" class="side-body hist">
          <div class="subtabs">
            <button
              type="button"
              :class="{ on: historySubTab === 'recent' }"
              @click="historySubTab = 'recent'; loadRecentActivity()"
            >
              Recent schemas
            </button>
            <button
              type="button"
              :class="{ on: historySubTab === 'values' }"
              @click="historySubTab = 'values'; loadHistory()"
            >
              Fill values
            </button>
          </div>
          <template v-if="historySubTab === 'recent'">
            <p class="muted tiny">
              Jump back into schemas you opened or generated. Open loads the schema for edit/generate.
            </p>
            <ul class="schema-list">
              <li
                v-for="s in recentSchemas"
                :key="'rs-' + s.id"
                role="button"
                tabindex="0"
                @click="openRecentSchema(s)"
                @keydown.enter="openRecentSchema(s)"
              >
                <div class="name">
                  {{ s.name }}
                  <span v-if="s.isMultifile" class="badge-multi">package</span>
                </div>
                <div class="meta">
                  {{ s.sourceFormat || '—' }} ·
                  {{ (s.lastOpenedAt || s.updatedAt || '').slice(0, 19).replace('T', ' ') }}
                </div>
                <div class="hist-row-actions">
                  <button type="button" class="btn btn-ghost tiny-btn" @click.stop="openRecentSchema(s)">
                    Open / edit
                  </button>
                </div>
              </li>
            </ul>
            <div class="side-section-label">Generate activity</div>
            <ul class="hist-list">
              <li v-for="a in recentActivity" :key="a.id">
                <span class="k">{{ a.payload?.schemaName || a.type }}</span>
                <span class="v">
                  {{ a.payload?.count != null ? a.payload.count + ' rec' : '' }}
                  · seed {{ a.payload?.seed ?? '—' }}
                </span>
                <div class="hist-row-actions">
                  <button
                    v-if="a.payload?.schemaId"
                    type="button"
                    class="btn btn-ghost tiny-btn"
                    @click="openRecentSchema(a)"
                  >
                    Open
                  </button>
                </div>
              </li>
              <li v-if="!recentActivity.length" class="muted tiny">No generate runs logged yet.</li>
            </ul>
          </template>
          <template v-else>
            <p class="muted tiny">
              Learned field values used when filling records (not a schema list). Prefer
              <strong>Data packs</strong> for curated lists.
            </p>
            <input
              v-model="historySearch"
              class="input"
              placeholder="Search fill values…"
              aria-label="Search fill values"
              @keyup.enter="loadHistoryDebounced.cancel(); loadHistory()"
            />
            <div class="hist-actions">
              <button
                type="button"
                class="btn btn-ghost"
                @click="loadHistoryDebounced.cancel(); loadHistory()"
              >
                Search
              </button>
              <button type="button" class="btn btn-ghost danger" @click="clearHistoryAll">
                Clear all
              </button>
            </div>
            <p class="muted tiny">{{ historyPage.total }} entries</p>
            <ul class="hist-list">
              <li v-for="h in historyPage.items" :key="h.id">
                <span class="k">{{ h.keyName }}</span>
                <span class="v">{{ h.value }}</span>
                <div class="hist-row-actions">
                  <button type="button" class="btn btn-ghost tiny-btn" @click="editHist(h)">
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost tiny-btn danger"
                    @click="deleteHist(h.id)"
                  >
                    Del
                  </button>
                </div>
              </li>
            </ul>
          </template>
        </div>

        <div v-else-if="sidebar === 'templates'" class="side-body">
          <button class="btn btn-primary full" @click="saveAsTemplate">
            Save current as template
          </button>
          <ul class="schema-list">
            <li v-for="t in templates" :key="t.id">
              <div class="name" @click="loadTemplate(t)">{{ t.name }}</div>
              <div class="meta">
                <button class="btn btn-ghost tiny-btn" @click="loadTemplate(t)">Load</button>
                <button class="btn btn-ghost tiny-btn danger" @click="removeTemplate(t.id)">
                  Delete
                </button>
              </div>
            </li>
            <li v-if="!templates.length" class="muted tiny" style="padding: 0.5rem">
              No templates yet — save the current schema as a template.
            </li>
          </ul>
        </div>

        <div
          v-else-if="sidebar === 'datapacks' || sidebar === 'themes' || sidebar === 'custom'"
          class="side-body datapacks-side"
        >
          <input
            v-model="dataPackSearch"
            class="input"
            placeholder="Search themes & field lists…"
            aria-label="Search data packs"
          />
          <div class="subtabs pack-subtabs">
            <button
              type="button"
              :class="{ on: dataPackSubTab === 'themes' }"
              @click="dataPackSubTab = 'themes'"
            >
              Themes
            </button>
            <button
              type="button"
              :class="{ on: dataPackSubTab === 'custom' }"
              @click="dataPackSubTab = 'custom'"
            >
              Field values
            </button>
          </div>

          <template v-if="dataPackSubTab === 'themes'">
            <p class="muted tiny pack-lead">
              Genre packs (Star Wars, …). Map fields in Field settings → Theme pack + Category.
            </p>
            <div class="pack-toolbar">
              <label class="chk pack-enable">
                <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
                Enable on generate
              </label>
              <button type="button" class="btn btn-primary pack-cta" @click="createTheme">
                + New theme
              </button>
            </div>
            <ul class="pack-card-list">
              <li v-for="t in filteredThemes" :key="t.id" class="pack-card">
                <div class="pack-card-top">
                  <label class="chk pack-card-title">
                    <input
                      type="checkbox"
                      :checked="isThemeActive(t.id)"
                      @change="toggleThemeInBlend(t)"
                    />
                    <span class="name">{{ t.name }}</span>
                  </label>
                  <span class="pack-badge">{{ t.valueCount ?? 0 }} values</span>
                </div>
                <div class="meta pack-card-meta">{{ t.slug }}</div>
                <label v-if="isThemeActive(t.id)" class="pack-weight muted tiny">
                  Blend weight
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    class="input"
                    :value="themeBlend.find((b) => b.themeId === t.id)?.weight ?? 1"
                    @change="setThemeWeight(t.id, $event.target.value)"
                  />
                </label>
                <div class="pack-card-actions">
                  <button
                    type="button"
                    class="btn btn-accent pack-action"
                    @click.stop="openThemeValuesEditor(t)"
                  >
                    Browse / edit
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-danger pack-action"
                    @click.stop="deleteTheme(t)"
                  >
                    Delete
                  </button>
                </div>
              </li>
              <li v-if="!filteredThemes.length" class="muted tiny pack-empty">No themes yet.</li>
            </ul>
            <p v-if="themeCategories.length" class="muted tiny pack-cats">
              Categories: {{ themeCategories.join(', ') }}
            </p>
          </template>

          <template v-else>
            <p class="muted tiny pack-lead">
              Lists tied to schema tags/columns. Used after theme, before history.
            </p>
            <div class="pack-toolbar">
              <button type="button" class="btn btn-primary pack-cta full" @click="createCustomList">
                + New field list
              </button>
            </div>
            <ul class="pack-card-list">
              <li
                v-for="c in filteredCustomLists"
                :key="c.id"
                class="pack-card"
                :class="{ active: activeCustomList?.id === c.id }"
                role="button"
                tabindex="0"
                @click="openCustomList(c.id)"
                @keydown.enter="openCustomList(c.id)"
              >
                <div class="pack-card-top">
                  <span class="name">{{ c.name }}</span>
                  <span class="pack-badge">{{ c.valueCount ?? 0 }} values</span>
                </div>
                <div class="meta pack-card-meta">
                  keys: {{ (c.keys || []).join(', ') || '—' }}
                </div>
                <div class="pack-card-actions" @click.stop>
                  <button
                    type="button"
                    class="btn btn-accent pack-action"
                    @click="openCustomList(c.id)"
                  >
                    Open
                  </button>
                </div>
              </li>
              <li v-if="!filteredCustomLists.length" class="muted tiny pack-empty">
                No field lists yet — save a schema or create one.
              </li>
            </ul>
            <p v-if="activeCustomList" class="muted tiny pack-lead" style="margin-top: 0.5rem">
              Editing <strong>{{ activeCustomList.name }}</strong> in the center panel.
            </p>
          </template>
        </div>

        <div v-else-if="sidebar === 'delivery'" class="side-body">
          <p class="muted tiny">Jobs write package variants to disk in chunks.</p>
          <button class="btn btn-ghost full" @click="refreshDeliveryJobs">Refresh jobs</button>
          <ul class="schema-list" style="margin-top: 0.5rem">
            <li v-for="j in deliveryJobs" :key="j.id">
              <div class="name">{{ j.name }}</div>
              <div class="meta">
                {{ j.status }} · {{ j.sentTotal }}/{{ j.targetTotal }} · chunks
                {{ j.chunksDone }}/{{ j.planLength }}
              </div>
              <div class="hist-row-actions">
                <button
                  class="btn btn-ghost tiny-btn"
                  :disabled="deliveryWorking || j.status === 'completed'"
                  @click="runDeliveryChunk(j.id)"
                >
                  Run next
                </button>
                <button class="btn btn-ghost tiny-btn danger" @click="removeDeliveryJob(j.id)">
                  Del
                </button>
              </div>
            </li>
            <li v-if="!deliveryJobs.length" class="muted tiny" style="padding: 0.5rem">
              No delivery jobs yet — create one in the center panel.
            </li>
          </ul>
        </div>

        <div v-else-if="sidebar === 'archive'" class="side-body">
          <label class="drop">
            Open archive (ZIP/TAR)
            <input type="file" accept=".zip,.tar,.tgz,.gz" hidden @change="onArchiveOpen" />
          </label>
          <ul class="hist-list">
            <li
              v-for="e in archiveEntries"
              :key="e.path"
              class="clickable"
              @click="readArchiveEntry(e.path)"
            >
              <span class="k">{{ e.path }}</span>
              <span class="v">{{ e.size }} B</span>
            </li>
          </ul>
        </div>
        </template>
      </aside>

      <div
        class="col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel"
        :title="tip('Drag to resize list')"
        @pointerdown="onResizePointerDown('side', $event)"
      />

      <section v-if="workspaceMode === 'schema'" class="center panel">
        <div
          v-if="!active"
          class="empty-workspace empty-cta-panel"
        >
          <p><strong>No schema open</strong></p>
          <p class="muted tiny">
            Create a blank schema or import a sample file to start editing fields and Generate.
          </p>
          <div class="empty-cta-row">
            <button
              type="button"
              class="btn btn-primary pack-cta"
              :title="tip('Create a blank schema in the Library')"
              @click="newSchema"
            >
              + New schema
            </button>
            <label
              class="btn btn-ghost pack-cta"
              :title="tip('Import one XML, CSV, or TXT sample file and infer a field schema')"
            >
              Import sample file → schema
              <input type="file" accept=".csv,.xml,.txt" hidden @change="onImport" />
            </label>
          </div>
        </div>
        <template v-if="active">
        <div
          v-if="
            active &&
            !standaloneSchemas.length &&
            !schemas.some((s) => s.id === active.id)
          "
          class="empty-workspace empty-cta-panel empty-cta-banner"
        >
          <p>
            <strong>Library is empty</strong> — you are editing an unsaved draft. Save it, or
            import a sample to infer fields.
          </p>
          <div class="empty-cta-row">
            <button
              type="button"
              class="btn btn-primary pack-cta"
              :title="tip('Save this draft schema to the local library')"
              @click="saveSchema"
            >
              Save schema
            </button>
            <label
              class="btn btn-ghost pack-cta"
              :title="tip('Import one XML, CSV, or TXT sample file and infer a field schema')"
            >
              Import sample file → schema
              <input type="file" accept=".csv,.xml,.txt" hidden @change="onImport" />
            </label>
          </div>
        </div>
        <div class="center-head schema-head">
          <!-- Row 1: identity + schema-level danger -->
          <div class="schema-head-row schema-head-identity">
            <div class="schema-title-block">
              <span class="schema-head-kicker muted tiny">Title</span>
              <input
                v-if="active"
                v-model="active.name"
                class="input title schema-title-input"
                :title="tip('Schema / file name')"
                @change="saveSchema"
              />
              <span v-else class="muted schema-title-placeholder">Select or create a schema</span>
            </div>
            <label
              v-if="active && format === 'xml'"
              class="xml-tag-inline muted tiny"
              :title="tip('XML document root element for this schema')"
            >
              Root tag
              <input
                v-model="xmlRootTag"
                class="input mono tag-input"
                placeholder="root"
                @change="
                  active.xmlRootTag = xmlRootTag || 'root';
                  persistXmlSettings()
                "
              />
            </label>
            <div class="schema-head-grow" />
            <button
              v-if="active?.id && schemas.some((s) => s.id === active.id)"
              type="button"
              class="btn btn-ghost"
              :title="tip('Create a library copy of this schema design with a new id')"
              @click="cloneSchema"
            >
              Duplicate
            </button>
            <button
              v-if="active?.id && schemas.some((s) => s.id === active.id)"
              type="button"
              class="btn btn-ghost danger schema-delete-btn"
              :title="tip('Remove this schema from the library (not package members)')"
              @click="deleteSchema"
            >
              Delete schema
            </button>
          </div>

          <!-- Row 2: grouped actions -->
          <div v-if="active" class="schema-head-row schema-head-tools">
            <div class="schema-btn-group" role="group" aria-label="File">
              <span class="schema-group-label muted tiny">File</span>
              <button
                type="button"
                class="btn btn-ghost"
                :title="tip('Save this schema design to the local SQLite library')"
                @click="saveSchema"
              >
                Save
              </button>
              <button
                type="button"
                class="btn btn-primary schema-map-btn"
                :title="
                  tip(
                    'Save design and map all non-theme sample values into Field values pools by tag/column (max 1000 per tag). Use Field settings for per-field control on Save.'
                  )
                "
                @click="mapSchemaFields"
              >
                Map fields
              </button>
            </div>

            <div class="schema-btn-group" role="group" aria-label="Structure">
              <span class="schema-group-label muted tiny">Structure</span>
              <button
                type="button"
                class="btn btn-ghost"
                :title="
                  tip(
                    isTabularFormat
                      ? 'Add a CSV/TXT column (header field)'
                      : 'Add a top-level field / XML element'
                  )
                "
                @click="isTabularFormat ? addColumn() : addRoot()"
              >
                {{ isTabularFormat ? '+ Column' : '+ Field' }}
              </button>
              <button
                v-if="isTabularFormat"
                type="button"
                class="btn btn-ghost"
                :disabled="!tabularColumns.length"
                :title="tip('Add another sample data row used as a generation template')"
                @click="addTabularRow"
              >
                + Row
              </button>
              <button
                v-if="!isTabularFormat"
                type="button"
                class="btn btn-ghost"
                :disabled="!selectedId"
                :title="tip('Add a nested child field under the selected element')"
                @click="addChild"
              >
                + Child
              </button>
            </div>

            <div class="schema-btn-group" role="group" aria-label="Edit">
              <span class="schema-group-label muted tiny">Edit</span>
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="!selectedId"
                :title="tip('Copy selected field subtree (Ctrl+C)')"
                @click="copyField()"
              >
                Copy
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                :title="tip('Paste field after the selection (Ctrl+V)')"
                @click="pasteField()"
              >
                Paste
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="!canUndoSchema"
                :title="tip('Undo last field edit (Ctrl+Z)')"
                @click="undoSchemaEdit"
              >
                Undo
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="!selectedId"
                :title="tip('Remove the selected field from the schema')"
                @click="deleteSelected"
              >
                Delete field
              </button>
            </div>
          </div>
        </div>

        <!-- CSV / TXT: header = columns, body = sample data rows -->
        <div
          v-if="isTabularFormat"
          class="rows tabular-schema"
          :class="{ 'with-props': selected }"
        >
          <p class="muted tiny tabular-hint">
            <strong>{{ format === 'csv' ? 'CSV' : 'TXT' }}:</strong>
            header = column names; data rows = sample templates. Drag the
            <strong>⋮⋮</strong> handle to reorder rows; drag a column’s
            <strong>right edge</strong> to resize width.
          </p>
          <div class="table-scroll">
            <table class="schema-table" role="grid" aria-label="Column and value editor">
              <colgroup>
                <col class="col-gutter" />
                <col
                  v-for="col in tabularColumns"
                  :key="'cg-' + col.id"
                  :style="{ width: getTabColWidth(col.id) + 'px' }"
                />
                <col class="col-add" />
              </colgroup>
              <thead>
                <tr class="header-row">
                  <th class="row-gutter" scope="col">
                    <span class="col-label muted tiny">Row</span>
                  </th>
                  <th
                    v-for="col in tabularColumns"
                    :key="'h-' + col.id"
                    class="tab-col"
                    :class="{ sel: selectedId === col.id }"
                    :style="tabularColStyle(col.id)"
                    scope="col"
                    @pointerdown="selectField(col.id)"
                  >
                    <label class="col-label muted tiny">Column</label>
                    <input
                      class="input key mono"
                      :value="col.key"
                      :aria-label="`Column name for ${col.key || 'field'}`"
                      placeholder="column"
                      @focus="beginFieldEdit(col.id, col.id)"
                      @blur="endFieldEdit"
                      @pointerdown="selectField(col.id)"
                      @input="
                        (e) =>
                          updateColumnField(col.id, { key: e.target.value }, { undo: false })
                      "
                    />
                    <div class="col-actions">
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn"
                        :title="tip('Copy column')"
                        @pointerdown="selectField(col.id)"
                        @click.stop="copyField(col.id)"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn danger"
                        :title="tip('Remove column')"
                        @pointerdown="selectField(col.id)"
                        @click.stop="removeColumn(col.id)"
                      >
                        Del
                      </button>
                    </div>
                    <span
                      class="tab-col-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      :aria-label="`Resize column ${col.key || 'field'}`"
                      :title="tip('Drag to resize column')"
                      @pointerdown.stop="onTabColResizeDown($event, col.id)"
                    />
                  </th>
                  <th class="add-col-cell" scope="col">
                    <button
                      type="button"
                      class="btn btn-ghost tiny-btn"
                      :disabled="!active"
                      :title="tip('Add column')"
                      @click="addColumn"
                    >
                      + Col
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ri in tabularRowIndexes"
                  :key="'r-' + ri"
                  class="value-row"
                  :class="{
                    'tab-row-dragging': tabRowDragFrom === ri,
                    'tab-drop-before':
                      tabRowDropHint &&
                      tabRowDropHint.index === ri &&
                      tabRowDropHint.mode === 'before',
                    'tab-drop-after':
                      tabRowDropHint &&
                      tabRowDropHint.index === ri &&
                      tabRowDropHint.mode === 'after'
                  }"
                  @dragover="onTabRowDragOver($event, ri)"
                  @drop="onTabRowDrop($event, ri)"
                >
                  <td class="row-gutter">
                    <span
                      class="tab-row-drag"
                      draggable="true"
                      :title="tip('Drag to reorder row')"
                      aria-label="Drag to reorder row"
                      @dragstart="onTabRowDragStart($event, ri)"
                      @dragend="onTabRowDragEnd"
                    >⋮⋮</span>
                    <span class="row-num muted tiny">{{ ri + 1 }}</span>
                    <button
                      type="button"
                      class="btn btn-ghost tiny-btn danger"
                      :disabled="tabularRowCount <= 1"
                      :title="tip('Remove this sample row')"
                      @click="removeTabularRow(ri)"
                    >
                      Del
                    </button>
                  </td>
                  <td
                    v-for="col in tabularColumns"
                    :key="'v-' + col.id + '-' + ri"
                    class="tab-col"
                    :class="{ sel: selectedId === col.id }"
                    :style="tabularColStyle(col.id)"
                    @pointerdown="selectField(col.id)"
                  >
                    <label class="col-label muted tiny">
                      {{ ri === 0 ? 'Value' : 'Sample' }}
                    </label>
                    <input
                      class="input sample mono"
                      :value="getTabularCell(col, ri)"
                      :aria-label="`Sample row ${ri + 1} for ${col.key || 'field'}`"
                      placeholder="sample value"
                      @focus="beginFieldEdit(`${col.id}:r${ri}`, col.id)"
                      @blur="endFieldEdit"
                      @pointerdown="selectField(col.id)"
                      @input="(e) => setTabularCellLive(col.id, ri, e.target.value)"
                    />
                    <span
                      class="tab-col-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      :aria-label="`Resize column ${col.key || 'field'}`"
                      :title="tip('Drag to resize column')"
                      @pointerdown.stop="onTabColResizeDown($event, col.id)"
                    />
                  </td>
                  <td class="add-col-cell" />
                </tr>
                <tr class="add-row-tr">
                  <td class="row-gutter" />
                  <td :colspan="Math.max(tabularColumns.length, 1) + 1">
                    <button
                      type="button"
                      class="btn btn-ghost tiny-btn"
                      :disabled="!active || !tabularColumns.length"
                      :title="tip('Add sample data row')"
                      @click="addTabularRow"
                    >
                      + Row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!tabularColumns.length" class="muted tiny" style="padding: 0.5rem">
            No columns yet — click <strong>+ Column</strong> to define headers, then
            <strong>+ Row</strong> for more sample data.
          </p>
        </div>

        <!-- XML: hierarchical tree with open/close chrome -->
        <div
          v-else
          class="rows schema-tree"
          :class="{ 'with-props': selected }"
        >
          <div
            v-for="(item, idx) in displayRows"
            :key="item.type === 'close' ? 'c-' + item.row.id + '-' + idx : item.row.id"
            class="row"
            :class="{
              sel: selectedId === item.row.id,
              'row-close': item.type === 'close',
              'row-container':
                item.type === 'node' &&
                (item.row.kind === 'object' ||
                  item.row.kind === 'array' ||
                  (item.row.children || []).length),
              'drop-before':
                dropHint &&
                item.type === 'node' &&
                dropHint.id === item.row.id &&
                dropHint.mode === 'before',
              'drop-after':
                dropHint &&
                item.type === 'node' &&
                dropHint.id === item.row.id &&
                dropHint.mode === 'after',
              'drop-into':
                dropHint &&
                item.type === 'node' &&
                dropHint.id === item.row.id &&
                dropHint.mode === 'into',
              dragging: dragId === item.row.id
            }"
            :style="{ marginLeft: item.depth * 14 + 'px' }"
            :draggable="item.type === 'node'"
            @pointerdown="selectField(item.row.id)"
            @dragstart="item.type === 'node' && onRowDragStart($event, item.row)"
            @dragend="onRowDragEnd"
            @dragover="
              (e) => {
                if (item.type !== 'node') return
                const rect = e.currentTarget.getBoundingClientRect()
                const y = e.clientY - rect.top
                const h = rect.height
                let mode = 'after'
                if (
                  item.row.kind === 'object' ||
                  item.row.kind === 'array' ||
                  (item.row.children || []).length
                ) {
                  if (y < h * 0.28) mode = 'before'
                  else if (y > h * 0.72) mode = 'after'
                  else mode = 'into'
                } else {
                  mode = y < h * 0.5 ? 'before' : 'after'
                }
                onRowDragOver(e, item, mode)
              }
            "
            @drop="
              (e) => {
                if (item.type !== 'node' || !dropHint) return
                onRowDrop(e, item, dropHint.mode)
              }
            "
          >
            <template v-if="item.type === 'close'">
              <span class="drag-handle ghost" aria-hidden="true" />
              <span class="kind close-kind">&lt;/&gt;</span>
              <span class="close-tag mono muted">&lt;/{{ item.closeKey }}&gt;</span>
            </template>
            <template v-else>
              <span
                class="drag-handle"
                :title="tip('Drag to reorder · drop on a group to nest')"
                @pointerdown="selectField(item.row.id)"
              >⋮⋮</span>
              <span class="kind">{{
                item.row.kind === 'object'
                  ? '{}'
                  : item.row.kind === 'array'
                    ? '[]'
                    : '·'
              }}</span>
              <span class="tag-open mono muted">&lt;</span>
              <input
                class="input key"
                :value="item.row.key"
                @focus="beginFieldEdit(item.row.id, item.row.id)"
                @blur="endFieldEdit"
                @pointerdown="selectField(item.row.id)"
                @input="(e) => patchSelectedField(item.row.id, { key: e.target.value })"
              />
              <span
                v-if="item.row.isRecordTag"
                class="badge-record"
                :title="tip('Record tag — wraps each record in multi-record one-file XML')"
              >rec</span>
              <span
                v-if="item.row.kind === 'value'"
                class="tag-open mono muted"
                >{{
                  item.row.selfClosing === true ||
                  (item.row.selfClosing === undefined && xmlSelfClosing)
                    ? ' /&gt;'
                    : '&gt;'
                }}</span
              >
              <span
                v-else
                class="tag-open mono muted"
                >&gt;</span
              >
              <input
                v-if="item.row.kind === 'value'"
                class="input sample"
                :value="item.row.sampleValue || ''"
                placeholder="sample"
                @focus="beginFieldEdit(item.row.id, item.row.id)"
                @blur="endFieldEdit"
                @pointerdown="selectField(item.row.id)"
                @input="
                  (e) =>
                    patchSelectedField(item.row.id, { sampleValue: e.target.value })
                "
              />
              <button
                type="button"
                class="btn btn-ghost tiny-btn row-copy-btn"
                :title="tip('Copy field')"
                @pointerdown="selectField(item.row.id)"
                @click.stop="copyField(item.row.id)"
              >
                Copy
              </button>
            </template>
          </div>
        </div>

        <div
          v-if="selected"
          class="props-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize field settings"
          :title="tip('Drag to resize Field settings')"
          @pointerdown="onPropsResizeDown"
        />
        <div
          v-if="selected"
          class="props"
          :class="{ collapsed: layout.propsCollapsed }"
          :style="propsPanelStyle"
        >
          <div class="props-head">
            <div class="props-head-text">
              <div class="label">Field settings</div>
              <span
                v-if="selectedFieldPath"
                class="props-path mono muted tiny"
                :title="tip(selectedFieldPath)"
              >
                {{ selectedFieldPath }}
              </span>
            </div>
            <button
              type="button"
              class="btn btn-ghost tiny-btn"
              :title="tip(layout.propsCollapsed ? 'Expand field settings' : 'Collapse field settings')"
              @click="togglePropsCollapsed"
            >
              {{ layout.propsCollapsed ? 'Expand' : 'Collapse' }}
            </button>
          </div>
          <template v-if="!layout.propsCollapsed">
            <div class="props-body">
              <!-- 1. Structure -->
              <section class="props-section">
                <header class="props-section-head">
                  <span class="props-section-title">Structure</span>
                  <span class="props-section-sub muted tiny">How this node sits in the tree</span>
                </header>
                <div class="props-section-body props-row-2">
                  <label v-if="showFieldKind" class="props-field">
                    <span class="props-field-label">Kind</span>
                    <select
                      class="input"
                      :value="selected.kind"
                      @change="updateSelected({ kind: $event.target.value })"
                    >
                      <option v-for="o in kindOptions" :key="o.v" :value="o.v">{{ o.l }}</option>
                    </select>
                  </label>
                  <label
                    v-if="format === 'xml'"
                    class="chk props-field props-field-check"
                    :title="tip('This tag wraps each generated record when using All records in one file (XML). Only one field can be the record tag.')"
                  >
                    <input
                      type="checkbox"
                      :checked="!!selected.isRecordTag"
                      @change="setSelectedAsRecordTag($event.target.checked)"
                    />
                    <span>
                      <span class="props-field-label">Record tag</span>
                      <span class="muted tiny block">Wraps each multi-record unit</span>
                    </span>
                  </label>
                </div>
                <p
                  v-if="selected.kind !== 'value' && format !== 'xml'"
                  class="muted tiny props-hint"
                >
                  Container — add children in the tree. Fill options apply to value fields only.
                </p>
                <p
                  v-else-if="selected.kind !== 'value' && format === 'xml' && selected.isRecordTag"
                  class="muted tiny props-hint"
                >
                  Record unit for multi-record one-file XML — children are fields of each record.
                </p>
                <p
                  v-else-if="selected.kind !== 'value'"
                  class="muted tiny props-hint"
                >
                  Container — add children in the tree. Enable <strong>Record tag</strong> if this
                  element repeats once per record.
                </p>
              </section>

              <!-- 2. Generate -->
              <section v-if="selected.kind === 'value'" class="props-section">
                <header class="props-section-head">
                  <span class="props-section-title">Generate</span>
                  <span class="props-section-sub muted tiny">How values vary across records</span>
                </header>
                <div class="props-section-body props-row-2">
                  <label
                    class="props-field"
                    :title="tip('How this field is filled across generated records (all formats)')"
                  >
                    <span class="props-field-label">Mode</span>
                    <select
                      class="input"
                      :value="selectedGenerateMode"
                      @change="setSelectedGenerateMode($event.target.value)"
                    >
                      <option value="random">Random — new each record</option>
                      <option value="same">Same — identical every record</option>
                      <option value="unique">Unique — no duplicates</option>
                    </select>
                  </label>
                  <label
                    class="props-field"
                    :title="tip('Percent of records where this field is empty (0 = always present)')"
                  >
                    <span class="props-field-label">Empty chance %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      class="input"
                      :value="selected.nullRate ?? 0"
                      @change="
                        updateSelected({ nullRate: Number($event.target.value) || 0 })
                      "
                    />
                  </label>
                  <label
                    class="chk props-field props-field-check"
                    :title="tip('Marks field as primary key and forces Unique generate mode')"
                  >
                    <input
                      type="checkbox"
                      :checked="selected.isPrimary"
                      @change="
                        (e) =>
                          setSelectedGenerateMode('unique', {
                            primary: e.target.checked
                          })
                      "
                    />
                    <span class="props-field-label">Primary key</span>
                  </label>
                </div>
              </section>

              <!-- 3. Value sources -->
              <section v-if="selected.kind === 'value'" class="props-section">
                <header class="props-section-head">
                  <span class="props-section-title">Value sources</span>
                  <span class="props-section-sub muted tiny"
                    >Priority: fixed → theme → custom → history → synth</span
                  >
                </header>
                <div class="props-section-body props-stack">
                  <label class="props-field">
                    <span class="props-field-label">
                      1 · Fixed values
                      <span class="muted tiny">optional · one per line · highest priority</span>
                    </span>
                    <textarea
                      class="input mono"
                      rows="2"
                      :value="enumText"
                      placeholder="Leave empty to use theme / lists / history / sample"
                      @change="
                        (e) => {
                          const lines = e.target.value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter(Boolean)
                          updateSelected({
                            enumValues: lines.length ? lines : undefined
                          })
                        }
                      "
                    />
                  </label>

                  <div class="props-subcard">
                    <div class="props-subcard-head">
                      <span class="props-field-label">2 · Field values pool (tag / column)</span>
                    </div>
                    <label
                      class="chk props-field props-field-check"
                      :title="tip('Finer control: when Save is pressed, only this field’s samples join the tag pool. Use toolbar Map fields to store all tags at once.')"
                    >
                      <input
                        type="checkbox"
                        :checked="!!selected.saveToFieldPool"
                        @change="
                          updateSelected({
                            saveToFieldPool: $event.target.checked ? true : undefined
                          })
                        "
                      />
                      <span>
                        <span class="props-field-label">Include this field on Save</span>
                        <span class="muted tiny block">
                          Pool key =
                          <strong class="mono">{{
                            (selected.key || 'tag').trim() || 'tag'
                          }}</strong>
                          · max 1000 values shared by this tag
                        </span>
                      </span>
                    </label>
                    <p class="muted tiny props-hint">
                      <strong>Map fields</strong> (toolbar) stores samples for
                      <em>all</em> non-theme tags now. This checkbox only narrows what
                      ordinary <strong>Save</strong> appends. Theme fields use Theme pool
                      below. Manage lists in <strong>Data packs → Field values</strong>.
                    </p>
                  </div>

                  <div class="props-subcard">
                    <div class="props-subcard-head">
                      <span class="props-field-label">3 · Theme pool</span>
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn"
                        @click="openFieldThemeInDataPacks"
                      >
                        Manage pools
                      </button>
                    </div>
                    <div class="props-row-2">
                      <label class="props-field">
                        <span class="props-field-label">Theme pack</span>
                        <select
                          class="input"
                          :value="selected.themeId || 'blend'"
                          @change="
                            updateSelected({
                              themeId:
                                $event.target.value === 'blend'
                                  ? undefined
                                  : $event.target.value || undefined
                            })
                          "
                        >
                          <option value="blend">All active themes (blend)</option>
                          <option v-for="t in themes" :key="'th-' + t.id" :value="t.id">
                            {{ t.name }}
                          </option>
                        </select>
                      </label>
                      <label class="props-field">
                        <span class="props-field-label">Category</span>
                        <select
                          class="input"
                          :value="selected.themeCategory || ''"
                          :title="
                            tip(
                              'Only categories that exist under Data packs → Themes for the selected Theme pack (or active blend). None skips theme fill.'
                            )
                          "
                          @change="
                            updateSelected({
                              themeCategory: $event.target.value.trim() || undefined
                            })
                          "
                        >
                          <option value="">None (skip theme fill)</option>
                          <option
                            v-for="c in fieldThemeCategoryOptions"
                            :key="'ftc-' + c"
                            :value="c"
                          >
                            {{ c }}
                          </option>
                        </select>
                      </label>
                    </div>
                    <p class="muted tiny props-hint">
                      Categories list only what the selected pack (or active blend)
                      actually has in <strong>Data packs → Themes</strong>. Add values
                      there to appear here. None skips theme fill.
                    </p>
                  </div>
                </div>
              </section>

              <!-- 4. Constraints -->
              <section v-if="selected.kind === 'value'" class="props-section props-section-muted">
                <button
                  type="button"
                  class="props-section-toggle"
                  :aria-expanded="propsMoreOpen"
                  @click="propsMoreOpen = !propsMoreOpen"
                >
                  <span class="props-chevron" aria-hidden="true">{{
                    propsMoreOpen ? '▾' : '▸'
                  }}</span>
                  <span class="props-section-title">Constraints</span>
                  <span class="muted tiny"
                    >length · numeric bounds<span v-if="format === 'xml'"> · empty tags</span
                    ><span v-if="fieldHasAdvanced"> · customized</span></span
                  >
                </button>
                <div v-if="propsMoreOpen" class="props-section-body">
                  <div class="props-row-4">
                    <label class="props-field">
                      <span class="props-field-label">Min length</span>
                      <input
                        type="number"
                        class="input"
                        :value="selected.minLength ?? ''"
                        @change="
                          updateSelected({
                            minLength:
                              $event.target.value === ''
                                ? undefined
                                : Math.max(0, Number($event.target.value) || 0)
                          })
                        "
                      />
                    </label>
                    <label class="props-field">
                      <span class="props-field-label">Max length</span>
                      <input
                        type="number"
                        class="input"
                        :value="selected.maxLength ?? ''"
                        @change="
                          updateSelected({
                            maxLength:
                              $event.target.value === ''
                                ? undefined
                                : Math.max(0, Number($event.target.value) || 0)
                          })
                        "
                      />
                    </label>
                    <label class="props-field">
                      <span class="props-field-label">Min (number)</span>
                      <input
                        type="number"
                        class="input"
                        :value="selected.min ?? ''"
                        @change="
                          updateSelected({
                            min:
                              $event.target.value === ''
                                ? undefined
                                : Number($event.target.value)
                          })
                        "
                      />
                    </label>
                    <label class="props-field">
                      <span class="props-field-label">Max (number)</span>
                      <input
                        type="number"
                        class="input"
                        :value="selected.max ?? ''"
                        @change="
                          updateSelected({
                            max:
                              $event.target.value === ''
                                ? undefined
                                : Number($event.target.value)
                          })
                        "
                      />
                    </label>
                  </div>
                  <label v-if="format === 'xml'" class="props-field props-field-wide">
                    <span class="props-field-label">Empty tag style</span>
                    <select
                      class="input"
                      :value="selfClosingSelectValue(selected)"
                      @change="setSelfClosingMode($event.target.value)"
                    >
                      <option value="default">
                        Schema default ({{ xmlSelfClosing ? 'self-closing' : 'open pair' }})
                      </option>
                      <option value="self">Self-closing (&lt;tag/&gt;)</option>
                      <option value="pair">Open pair (&lt;tag&gt;&lt;/tag&gt;)</option>
                    </select>
                  </label>
                </div>
              </section>
            </div>
          </template>
        </div>
        </template>
      </section>


      <!-- Package workspace (dynamic): explorer + center editor -->
      <section v-else-if="workspaceMode === 'package'" class="center panel workspace-panel">
        <div class="center-head">
          <strong v-if="activePackage">{{ activePackage.name }}</strong>
          <span v-else class="muted">Select a package</span>
          <span v-if="activePackage" class="muted tiny">
            {{ activePackage.outerFormat }} · nested
            {{ (activePackage.nestedArchives || []).length }}
          </span>
          <button
            v-if="activePackage"
            class="btn btn-ghost danger"
            @click="removePackage(activePackage.id)"
          >
            Delete package
          </button>
        </div>
        <div v-if="!activePackage" class="empty-workspace empty-cta-panel">
          <p><strong>No package selected</strong></p>
          <p class="muted tiny">
            Import an archive, files, or folder. Nested paths show in the explorer. Editable
            members: XML, CSV, TXT. Variants download only — not stored in SQLite.
          </p>
          <div class="empty-cta-row">
            <label
              class="btn btn-primary pack-cta"
              :class="{ disabled: packageWorking }"
              :title="tip('Import a package from .tar / .tar.gz / .zip or multi-select XML, CSV, TXT files')"
            >
              Import package
              <input
                type="file"
                multiple
                accept=".zip,.tar,.tgz,.gz,.xml,.csv,.txt"
                hidden
                :disabled="packageWorking"
                @change="onPackageImport"
              />
            </label>
            <button
              type="button"
              class="btn btn-ghost"
              :title="tip('Open Library list to pick an existing package')"
              @click="goToLibrary()"
            >
              Open Library
            </button>
          </div>
        </div>
        <div v-else class="pkg-layout">
          <!-- Nested explorer (left of center) -->
          <aside class="pkg-explorer" aria-label="Package file explorer">
            <div class="muted tiny pkg-explorer-title">Explorer</div>
            <ul class="pkg-tree">
              <li v-for="row in packageExplorerRows" :key="'r-' + row.path">
                <button
                  v-if="row.isDir"
                  type="button"
                  class="pkg-tree-row dir"
                  :style="{ paddingLeft: 0.35 + row.depth * 0.85 + 'rem' }"
                  @click="togglePackageTreeDir(row.path)"
                >
                  <span class="pkg-chevron">{{
                    isPackageTreeExpanded(row.path) ? '▾' : '▸'
                  }}</span>
                  <span class="pkg-icon" aria-hidden="true">📁</span>
                  <span class="pkg-name">{{ row.name }}</span>
                </button>
                <button
                  v-else
                  type="button"
                  class="pkg-tree-row file"
                  :class="{
                    active: packageMemberPath === row.path,
                    unsupported: row.member && !isPackageSupportedMember(row.member)
                  }"
                  :style="{ paddingLeft: 0.35 + row.depth * 0.85 + 'rem' }"
                  :title="tip(row.path)"
                  @click="selectPackageMember(row.path)"
                >
                  <span class="pkg-icon" aria-hidden="true">{{
                    isPackageSupportedMember(row.member) ? '📄' : '📎'
                  }}</span>
                  <span class="pkg-name">{{ row.name }}</span>
                </button>
              </li>
            </ul>
            <div
              v-if="(activePackage.skipped || []).length"
              class="muted tiny pkg-skipped"
            >
              Skipped ({{ activePackage.skipped.length }}):
              {{ activePackage.skipped.slice(0, 6).join(', ')
              }}{{ activePackage.skipped.length > 6 ? '…' : '' }}
            </div>
          </aside>

          <!-- Center editor -->
          <div class="pkg-editor">
            <template v-if="packageMemberEditable">
              <div class="row-actions pkg-editor-toolbar">
                <label class="muted tiny pkg-name-edit">
                  File name
                  <input
                    v-model="packageEditName"
                    class="input mono"
                    aria-label="Member file name"
                  />
                </label>
                <label class="chk">
                  <input
                    type="checkbox"
                    :checked="!!selectedPackageMember?.verified"
                    @change="verifyPackageMember($event.target.checked)"
                  />
                  Verified
                </label>
                <button
                  class="btn btn-ghost"
                  type="button"
                  :disabled="packageWorking"
                  @click="savePackageMemberContent"
                >
                  Save (content → schema)
                </button>
                <button
                  class="btn btn-ghost"
                  type="button"
                  :disabled="packageWorking"
                  @click="savePackageMemberSchemaInPlace"
                >
                  Save schema
                </button>
                <button class="btn btn-ghost" type="button" @click="editPackageMemberSchema">
                  Edit schema tags
                </button>
                <button
                  class="btn btn-ghost"
                  type="button"
                  :disabled="packageWorking"
                  @click="savePackageMemberSchemaAs"
                >
                  Save schema as…
                </button>
              </div>
              <label class="muted tiny" style="display: block; margin: 0 0.5rem">
                Content (design sample — xml / csv / txt)
                <textarea
                  v-model="packageEditContent"
                  class="input pkg-content-editor mono"
                  rows="16"
                  spellcheck="false"
                  aria-label="Member file content"
                />
              </label>
              <div class="field-modes" style="padding: 0.5rem 0.75rem">
                <div class="muted tiny">
                  Field modes (immutable = <strong>same</strong>) ·
                  <span class="mono">{{ packageMemberPath }}</span>
                </div>
                <div
                  v-for="fp in packageMemberLeaves(packageMemberPath)"
                  :key="fp"
                  class="field-mode-row"
                >
                  <span class="mono tiny">{{ fp }}</span>
                  <select
                    class="input mode-sel"
                    :aria-label="`Mode for ${fp}`"
                    :value="getPackageFieldMode(packageMemberPath, fp)"
                    @change="setPackageFieldMode(packageMemberPath, fp, $event.target.value)"
                  >
                    <option value="random">random</option>
                    <option value="same">same (immutable)</option>
                    <option value="unique">unique</option>
                  </select>
                </div>
              </div>
            </template>
            <template v-else-if="selectedPackageMember">
              <pre class="code-mini" style="margin: 0.5rem 0.75rem">{{
                packagePreview || '// not editable'
              }}</pre>
              <p class="muted tiny" style="margin: 0.5rem 0.75rem">
                Only XML, CSV, and TXT members open in the editor.
              </p>
            </template>
            <template v-else>
              <p class="muted" style="margin: 1rem">Select a file in the explorer.</p>
            </template>
          </div>
        </div>
      </section>

      <!-- Delivery workspace (demoted — no feature growth) -->
      <section v-else-if="workspaceMode === 'delivery'" class="center panel workspace-panel">
        <div class="center-head">
          <strong>Plan a delivery job</strong>
        </div>
        <div class="workspace-scroll gen" style="max-width: 520px">
          <p v-if="!deliveryJobs.length" class="muted tiny">
            No jobs yet — fill the form below and create a plan. Artifacts go to disk only.
          </p>
          <p class="muted tiny">
            Incremental dump: random chunk sizes (min/max each used at least once when target
            allows). Writes under <span class="mono">data/exports/delivery/</span> (or your path).
          </p>
          <label class="muted tiny">
            Name
            <input v-model="deliveryForm.name" class="input" placeholder="nightly-pack" />
          </label>
          <label class="muted tiny">
            Package
            <select v-model="deliveryForm.packageId" class="input">
              <option value="">— select —</option>
              <option v-for="p in packages" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="muted tiny">
            Target total (records / package variants)
            <input v-model.number="deliveryForm.targetTotal" type="number" min="1" class="input" />
          </label>
          <div
            v-if="deliveryForm.packageId && packages.find((p) => p.id === deliveryForm.packageId)"
            class="obs-panel"
          >
            <div class="obs-title">Delivery output estimate</div>
            <p class="obs-summary muted tiny">
              {{
                clientPackageEstimate(
                  packages.find((p) => p.id === deliveryForm.packageId),
                  deliveryForm.targetTotal || 1
                ).summary
              }}
            </p>
            <div class="obs-total">
              ≈
              <strong>{{
                clientPackageEstimate(
                  packages.find((p) => p.id === deliveryForm.packageId),
                  deliveryForm.targetTotal || 1
                ).estimatedLogicalContentFiles.toLocaleString()
              }}</strong>
              content files across all chunks
            </div>
          </div>
          <label class="muted tiny">
            Window hours
            <input v-model.number="deliveryForm.windowHours" type="number" min="1" class="input" />
          </label>
          <div class="row-2">
            <label class="muted tiny">
              Chunk min
              <input v-model.number="deliveryForm.chunkMin" type="number" min="1" class="input" />
            </label>
            <label class="muted tiny">
              Chunk max
              <input v-model.number="deliveryForm.chunkMax" type="number" min="1" class="input" />
            </label>
          </div>
          <label class="muted tiny">
            Destination folder (optional)
            <input
              v-model="deliveryForm.destinationPath"
              class="input mono"
              placeholder="empty = data/exports/delivery/{job}/"
            />
          </label>
          <label class="muted tiny">
            Seed (optional)
            <input v-model="deliveryForm.seed" class="input" placeholder="random" />
          </label>
          <button
            class="btn btn-primary full"
            :disabled="deliveryWorking || !deliveryForm.packageId"
            @click="createDeliveryJob"
          >
            Create planned job
          </button>
        </div>
      </section>

      <!-- Focus workspaces: recent / data packs / templates / archive -->
      <section v-else class="center panel workspace-panel">
        <div class="center-head">
          <strong>{{ workspaceTitle }}</strong>
        </div>
        <div class="workspace-scroll">
          <template v-if="workspaceMode === 'history'">
            <div class="empty-workspace" style="padding: 1rem">
              <p>
                <strong>Recent</strong> jumps back into schemas you work with — not a raw
                key/value dump.
              </p>
              <p class="muted tiny">
                Left list: open a schema to edit and generate. “Fill values” is optional learned
                data used after Data packs.
              </p>
              <ul v-if="recentSchemas.length" class="schema-list" style="max-width: 520px">
                <li
                  v-for="s in recentSchemas.slice(0, 12)"
                  :key="'c-' + s.id"
                  class="clickable"
                  @click="openRecentSchema(s)"
                >
                  <div class="name">{{ s.name }}</div>
                  <div class="meta">Click to open &amp; edit</div>
                </li>
              </ul>
              <div v-else class="empty-cta-panel" style="padding: 0; margin-top: 0.75rem">
                <p class="muted tiny">No recent schemas yet.</p>
                <div class="empty-cta-row">
                  <button
                    type="button"
                    class="btn btn-primary pack-cta"
                    :title="tip('Open Library to create or import a schema')"
                    @click="goToLibrary()"
                  >
                    Open Library
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    :title="tip('Create a blank schema')"
                    @click="goToLibrary(); newSchema()"
                  >
                    + New schema
                  </button>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="workspaceMode === 'datapacks'">
            <div class="empty-workspace theme-pack-workspace" style="padding: 1rem; max-width: 640px">
              <template v-if="themeEditor">
                <h3 style="margin-top: 0">
                  {{ themeEditor.theme?.name }}
                  <span class="muted tiny">· theme values</span>
                </h3>
                <p class="muted tiny">
                  Categories are your buckets (names, ships, lightsabers…) and are saved as soon as
                  you add them. Map a schema field’s <strong>Theme pack</strong> +
                  <strong>Category</strong> to pull random values from this pool. Cap:
                  <strong>{{ THEME_CAT_LIMIT }}</strong> values per category.
                </p>

                <div class="theme-cat-bar">
                  <div class="theme-cat-chips">
                    <div
                      v-for="s in themeEditorCategoryChips"
                      :key="'chip-' + s.category"
                      class="theme-cat-chip-wrap"
                    >
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn"
                        :class="{
                          on:
                            String(themeEditor.category || '').toLowerCase() ===
                            String(s.category).toLowerCase(),
                          warn: s.nearLimit,
                          full: s.full
                        }"
                        :title="tip('Select category “' + s.category + '”')"
                        @click="selectThemeCategory(s.category)"
                      >
                        {{ s.category }}
                        <span class="muted">{{ s.count }}/{{ s.limit ?? THEME_CAT_LIMIT }}</span>
                      </button>
                      <button
                        type="button"
                        class="btn btn-outline-danger pack-action-sm theme-cat-del"
                        :title="tip('Delete category “' + s.category + '” and all its values')"
                        @click.stop="deleteThemeCategory(s.category)"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>

                <div class="theme-cat-create">
                  <label class="muted tiny gen-field" style="flex: 1; min-width: 0">
                    <span class="gen-field-label">Active category</span>
                    <input
                      v-model="themeEditor.category"
                      class="input mono"
                      list="theme-cat-list"
                      placeholder="names, ships, lightsabers…"
                      @change="onThemeEditorCategoryChange"
                      @keydown.enter.prevent="onThemeEditorCategoryChange"
                    />
                    <datalist id="theme-cat-list">
                      <option v-for="c in COMMON_THEME_CATS" :key="c" :value="c" />
                      <option v-for="c in themeCategories" :key="'t-' + c" :value="c" />
                      <option
                        v-for="s in themeEditorCategoryChips"
                        :key="'chip-dl-' + s.category"
                        :value="s.category"
                      />
                    </datalist>
                  </label>
                  <button
                    type="button"
                    class="btn btn-primary"
                    style="align-self: flex-end"
                    :title="tip('Create a new value category under this theme (names, ships, …)')"
                    @click="addThemeCategory"
                  >
                    + Add category
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-danger"
                    style="align-self: flex-end"
                    :disabled="!themeEditor.category"
                    :title="
                      tip(
                        'Delete the active category and all of its values from this theme pack'
                      )
                    "
                    @click="deleteThemeCategory(themeEditor.category)"
                  >
                    Delete category
                  </button>
                </div>

                <p
                  v-if="themeEditorCatStat.nearLimit || themeEditorCatStat.full"
                  class="banner err"
                  style="margin: 0.5rem 0"
                  role="status"
                >
                  <template v-if="themeEditorCatStat.full">
                    Category “{{ themeEditor.category }}” is full
                    ({{ themeEditorCatStat.count }}/{{ THEME_CAT_LIMIT }}). Remove values before
                    adding more.
                  </template>
                  <template v-else>
                    Category “{{ themeEditor.category }}” is nearly full
                    ({{ themeEditorCatStat.count }}/{{ THEME_CAT_LIMIT }} — warn at
                    {{ THEME_CAT_WARN_AT }}+).
                  </template>
                </p>
                <p v-else class="muted tiny">
                  Pool size:
                  <strong
                    >{{ themeEditorCatStat.count }}/{{ THEME_CAT_LIMIT }}</strong
                  >
                  in “{{ themeEditor.category || '…' }}”
                </p>

                <div class="theme-value-list">
                  <div class="label muted tiny">
                    Values
                    <span v-if="themeEditor.loading">· loading…</span>
                  </div>
                  <ul v-if="themeEditor.values?.length" class="pack-value-list theme-values-ul">
                    <li v-for="row in themeEditor.values" :key="row.id" class="pack-value-row">
                      <span class="v mono">{{ row.value }}</span>
                      <div class="pack-value-actions">
                        <button
                          type="button"
                          class="btn btn-outline pack-action-sm"
                          @click="editThemeValueRow(row)"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-outline-danger pack-action-sm"
                          @click="deleteThemeValueRow(row)"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  </ul>
                  <p v-else-if="!themeEditor.loading" class="muted tiny">
                    No values in this category yet — add some below.
                  </p>
                </div>

                <label class="muted tiny">
                  Add values (one per line or comma-separated)
                  <textarea
                    v-model="themeEditor.bulk"
                    class="input mono"
                    rows="5"
                    placeholder="Luke Skywalker&#10;Leia Organa&#10;Han Solo"
                  />
                </label>
                <div class="pack-editor-actions">
                  <button
                    type="button"
                    class="btn btn-primary pack-cta"
                    :disabled="themeEditorCatStat.full"
                    @click="submitThemeValuesEditor"
                  >
                    Add to pool
                  </button>
                  <button type="button" class="btn btn-outline pack-action" @click="themeEditor = null">
                    Done
                  </button>
                </div>
              </template>
              <template v-else-if="dataPackSubTab === 'custom'">
                <FieldValuesCenter
                  :list="activeCustomList"
                  :list-name="customListName"
                  :list-keys="customListKeys"
                  :bulk-values="customBulkValues"
                  :list-count="customLists.length"
                  @update:list-name="customListName = $event"
                  @update:list-keys="customListKeys = $event"
                  @update:bulk-values="customBulkValues = $event"
                  @save="saveActiveCustomList"
                  @add-values="addBulkCustomValues"
                  @edit-value="editCustomValue"
                  @remove-value="removeCustomValue"
                  @delete-list="removeCustomList"
                  @close="activeCustomList = null"
                />
              </template>
              <template v-else>
                <h3 style="margin-top: 0">Data packs</h3>
                <p>
                  <strong>Themes</strong> = genre packs (Star Wars, …) with categories you invent
                  (names, ships, lightsabers). Map fields in Field settings → Theme pack + Category.
                  <strong>Field values</strong> = curated lists on schema paths. Fill order: enums →
                  theme → custom → history → synth.
                </p>
                <p class="muted tiny">
                  Each category holds up to {{ THEME_CAT_LIMIT }} values (warning at
                  {{ THEME_CAT_WARN_AT }}+). Open a theme with
                  <em>Browse / edit</em> on the left.
                </p>
                <p class="muted tiny">
                  Active blend:
                  {{
                    themeBlend.length
                      ? themeBlend.map((b) => b.name || b.themeId).join(' + ')
                      : 'none'
                  }}
                </p>
                <div
                  v-if="!themes.length && !customLists.length"
                  class="empty-cta-panel"
                  style="margin-top: 1rem; padding: 0"
                >
                  <p class="muted tiny">No themes or field lists yet.</p>
                  <div class="empty-cta-row">
                    <button
                      type="button"
                      class="btn btn-primary pack-cta"
                      :title="tip('Create a new theme pack')"
                      @click="dataPackSubTab = 'themes'; createTheme()"
                    >
                      + New theme
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      :title="tip('Create a custom field value list')"
                      @click="dataPackSubTab = 'custom'; createCustomList()"
                    >
                      + New field list
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </template>
          <template v-else-if="workspaceMode === 'templates'">
            <div class="empty-workspace empty-cta-panel" style="padding: 1rem; max-width: 520px">
              <h3 style="margin-top: 0">Templates</h3>
              <p>
                Snapshots of a schema design you can reload later. Save the current schema, then
                <strong>Load</strong> to open a copy in Library for edit/generate.
              </p>
              <template v-if="!templates.length">
                <p class="muted tiny">No templates saved yet.</p>
                <div class="empty-cta-row">
                  <button
                    type="button"
                    class="btn btn-primary pack-cta"
                    :disabled="!active"
                    :title="tip('Save the current schema design as a reusable template')"
                    @click="saveAsTemplate"
                  >
                    Save current as template
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    :title="tip('Open Library to edit a schema first')"
                    @click="goToLibrary()"
                  >
                    Open Library
                  </button>
                </div>
              </template>
              <p v-else class="muted tiny">
                {{ templates.length }} template(s) in the left list.
              </p>
            </div>
          </template>
          <template v-else-if="workspaceMode === 'archive'">
            <div v-if="!archiveEntries.length" class="empty-workspace empty-cta-panel" style="padding: 1rem">
              <p><strong>Archive browse</strong></p>
              <p class="muted tiny">
                Open a ZIP/TAR from the left list to preview entries. Does not import into Library.
              </p>
              <label
                class="btn btn-primary pack-cta"
                :title="tip('Open an existing ZIP/TAR without importing')"
              >
                Open archive
                <input type="file" accept=".zip,.tar,.tgz,.gz" hidden @change="onArchiveOpen" />
              </label>
            </div>
            <pre v-else class="code" style="margin: 0; flex: 1; width: 100%">{{
              archivePreview || '// Select an entry from the left list'
            }}</pre>
          </template>
          <template v-else>
            <p class="muted" style="padding: 1rem">Choose a tool from the left navigation.</p>
          </template>
        </div>
      </section>

      <div
        v-if="showRightPanel"
        class="col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Generate panel"
        :title="tip('Drag to resize the Generate panel')"
        @pointerdown="onResizePointerDown('preview', $event)"
      />

      <aside v-if="showRightPanel" class="preview panel">
        <div class="preview-bar">
          <span class="muted tiny">Generate</span>
          <button
            type="button"
            class="btn btn-ghost tiny-btn"
            :title="tip('Hide the Generate panel')"
            @click="togglePreviewPanel"
          >
            Hide
          </button>
        </div>
        <template v-if="workspaceMode === 'schema'">
        <div class="ptabs">
          <button
            type="button"
            class="on"
            :title="tip('Configure and run generation for the active schema')"
          >
            Generate
          </button>
        </div>

        <div class="gen">
          <!-- 1. Run size — first paint: Records -->
          <section class="gen-section">
            <header class="gen-section-head">
              <span class="gen-section-title">Run</span>
              <span class="gen-section-sub muted tiny">How much to produce</span>
            </header>
            <div class="gen-section-body">
              <label
                class="gen-field"
                :title="tip('How many records (rows / XML record units) to produce in this run')"
              >
                <span class="gen-field-label">Records</span>
                <input
                  v-model.number="recordCount"
                  type="number"
                  min="1"
                  max="1000000"
                  class="input"
                />
              </label>
            </div>
          </section>

          <!-- 2. Output shape — first paint: mode only -->
          <section class="gen-section">
            <header class="gen-section-head">
              <span class="gen-section-title">Output</span>
              <span class="gen-section-sub muted tiny">File layout for this run</span>
            </header>
            <div class="gen-section-body">
              <div class="gen-choice-list">
                <label
                  class="gen-choice"
                  :class="{ on: outputMode === 'one-file' }"
                  :title="tip('Write every generated record into a single XML, CSV, or TXT file')"
                >
                  <input v-model="outputMode" type="radio" value="one-file" />
                  <span class="gen-choice-text">
                    <strong>All records in one file</strong>
                    <span class="muted tiny">
                      Single {{ format.toUpperCase() }} download
                      <template v-if="format === 'xml'">
                        · record tag
                        <span class="mono">{{ resolveXmlRecordTag() }}</span>
                      </template>
                    </span>
                  </span>
                </label>
                <label
                  class="gen-choice"
                  :class="{ on: outputMode === 'per-file' }"
                  :title="tip('Each record becomes its own file; multi-file bundles download as tar.gz')"
                >
                  <input v-model="outputMode" type="radio" value="per-file" />
                  <span class="gen-choice-text">
                    <strong>One file per record</strong>
                    <span class="muted tiny">
                      Multi-file → tar.gz · single → ZIP
                    </span>
                  </span>
                </label>
              </div>
              <p v-if="outputMode === 'per-file'" class="muted tiny mono gen-hint">
                Name pattern: {{ fileNamePattern }}
              </p>
              <p class="muted tiny gen-hint">
                Per-field mode / empty chance / themes → <strong>Field settings</strong>
              </p>
            </div>
          </section>

          <!-- 3. Actions — single primary CTA on first paint -->
          <section class="gen-section gen-section-actions">
            <div class="gen-section-body gen-actions">
              <button
                class="btn btn-primary full"
                :disabled="generating || previewing || !active"
                :title="tip('Generate from seed and download immediately')"
                @click="generate"
              >
                {{ generateButtonLabel }}
              </button>
              <button
                type="button"
                class="btn btn-ghost full"
                :disabled="generating || previewing || !active"
                :title="
                  tip(
                    'Generate a small sample (max 20) for the table and source mix — no download, no history harvest'
                  )
                "
                @click="previewSamples"
              >
                {{ previewing ? 'Working…' : 'Preview samples' }}
              </button>
              <button
                v-if="active"
                class="btn btn-ghost full"
                :title="tip('Download the schema design you are editing (sample values only — not a seed Generate)')"
                @click="downloadDesignOutput"
              >
                Download design sample
              </button>
            </div>
            <div
              v-if="fillSourceMeters.length"
              class="source-mix"
              :title="tip('Where leaf values came from on the last generate or preview')"
            >
              <div class="source-mix-head muted tiny">Source mix</div>
              <div class="source-mix-bar" role="img" :aria-label="'Fill source proportions'">
                <span
                  v-for="seg in fillSourceMeters"
                  :key="seg.key"
                  class="source-mix-seg"
                  :class="'src-' + seg.key"
                  :style="{ width: seg.pct + '%' }"
                  :title="seg.label + ' ' + seg.pct + '%'"
                />
              </div>
              <ul class="source-mix-legend">
                <li v-for="seg in fillSourceMeters" :key="'leg-' + seg.key">
                  <span class="src-dot" :class="'src-' + seg.key" aria-hidden="true" />
                  {{ seg.label }} {{ seg.pct }}%
                </li>
              </ul>
            </div>
            <div
              v-if="lastReport"
              class="gen-report muted tiny"
              :title="tip('Stats from the last generate: fill sources, null rate, timing')"
            >
              history {{ lastReport.historyHitRate }}% · theme
              {{ lastReport.themeHits ?? 0 }} · null {{ lastReport.nullRatePct }}% · synth
              {{ lastReport.synthesized }} · enum {{ lastReport.enumHits }} ·
              {{ lastReport.ms }}ms
              <span v-if="lastGenerated?.previewOnly"> · preview</span>
            </div>
            <div
              v-else-if="lastGenerated?.perFile"
              class="gen-report muted tiny"
              :title="tip('Summary of the last per-file generate archive')"
            >
              Per-file · {{ lastGenerated.written }} file(s) ·
              {{ lastGenerated.archiveFormat || 'archive' }} · seed
              {{ lastGenerated.seed }}
            </div>
            <div
              v-if="sampleTable.rows.length"
              class="sample-table-wrap"
              :title="tip('Sample records from last preview or generate')"
            >
              <div class="source-mix-head muted tiny">
                Sample rows ({{ sampleTable.rows.length }})
              </div>
              <div class="sample-table-scroll">
                <table class="sample-table">
                  <thead>
                    <tr>
                      <th v-for="col in sampleTable.columns" :key="col">{{ col }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in sampleTable.rows" :key="'sr-' + ri">
                      <td v-for="col in sampleTable.columns" :key="col + '-' + ri">
                        {{
                          row[col] == null
                            ? '—'
                            : typeof row[col] === 'object'
                              ? JSON.stringify(row[col])
                              : row[col]
                        }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <!-- 4. Power options behind progressive disclosure -->
          <section class="gen-section gen-section-more">
            <button
              type="button"
              class="props-section-toggle gen-more-toggle"
              :aria-expanded="genMoreOpen"
              @click="genMoreOpen = !genMoreOpen"
            >
              <span class="props-chevron" aria-hidden="true">{{ genMoreOpen ? '▾' : '▸' }}</span>
              <span class="gen-section-title">More options</span>
              <span class="muted tiny">seed · stream · CSV · archive · sources</span>
            </button>
            <div v-if="genMoreOpen" class="gen-section-body gen-more-body">
              <label
                class="gen-field"
                :title="tip('Optional number for repeatable output. Leave empty for a random seed each run.')"
              >
                <span class="gen-field-label">Seed</span>
                <input v-model="seed" class="input" placeholder="empty = random" />
              </label>

              <div class="gen-checks">
                <label
                  v-if="outputMode === 'one-file' && streamSupported"
                  class="chk"
                  :title="tip('Stream large CSV/TXT runs row-by-row so the full result is not held in memory')"
                >
                  <input v-model="streamMode" type="checkbox" />
                  Stream large counts
                </label>
                <label
                  v-if="isTabularFormat && outputMode === 'one-file'"
                  class="chk"
                  :title="tip('Write multiple data lines under one header row (tabular export)')"
                >
                  <input v-model="csvMultiRow" type="checkbox" />
                  Multiple data rows
                </label>
                <label
                  v-if="format === 'xml'"
                  class="chk"
                  :title="tip('Default for empty XML elements: self-closing vs open pair. Override per field under Field settings → Constraints.')"
                >
                  <input
                    v-model="xmlSelfClosing"
                    type="checkbox"
                    @change="persistXmlSettings"
                  />
                  Self-closing empty tags
                </label>
              </div>

              <div v-if="format === 'csv' || isTabularFormat" class="gen-format-opts">
                <label
                  v-if="format === 'csv'"
                  class="gen-field"
                  :title="tip('How nested objects are laid out in the CSV export')"
                >
                  <span class="gen-field-label">CSV layout</span>
                  <select v-model="csvLayoutMode" class="input">
                    <option value="single-header">Single header</option>
                    <option value="entity-sections">Entity sections</option>
                    <option value="per-key-sections">Per-key sections</option>
                  </select>
                </label>
                <label
                  v-if="isTabularFormat"
                  class="gen-field"
                  :title="tip('Character used to flatten nested paths into column names')"
                >
                  <span class="gen-field-label">Flatten delimiter</span>
                  <input v-model="csvDelim" class="input" />
                </label>
                <label
                  v-if="isTabularFormat"
                  class="chk"
                  :title="tip('Store nested objects as JSON strings in one cell instead of flattening')"
                >
                  <input v-model="csvNestedAsJson" type="checkbox" />
                  Nested as JSON
                </label>
              </div>

              <header class="gen-section-head gen-more-subhead">
                <span class="gen-section-title">Data sources</span>
                <span class="gen-section-sub muted tiny">After field enums</span>
              </header>
              <div class="gen-checks">
                <label
                  class="chk"
                  :title="tip('Skip live history, themes, and custom lists — only enums, samples, and synthesis')"
                >
                  <input v-model="ciMode" type="checkbox" />
                  CI mode (ignore history / themes / custom)
                </label>
                <label
                  class="chk"
                  :title="tip('Use Data packs themes for fields that have a Theme category')"
                >
                  <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
                  Use data themes
                  <span v-if="themeBlend.length" class="muted tiny">
                    ({{ themeBlend.map((b) => b.name || b.themeId.slice(0, 6)).join(' + ') }})
                  </span>
                </label>
                <label
                  class="chk"
                  :title="tip('Optional: save individual field values from this Generate into the history bank. Full rows/files are never stored. Off by default.')"
                >
                  <input v-model="recordGeneratedHistory" type="checkbox" :disabled="ciMode" />
                  Remember field values in history bank
                </label>
              </div>

              <header class="gen-section-head gen-more-subhead">
                <span class="gen-section-title">Archive</span>
                <span class="gen-section-sub muted tiny">Optional wrap</span>
              </header>
              <div class="gen-checks">
                <label
                  class="chk"
                  :title="tip('Download as .tar with files under a directory named after the schema (or source folder)')"
                >
                  <input
                    type="checkbox"
                    :checked="archiveTar"
                    @change="setArchiveTar($event.target.checked)"
                  />
                  Archive (.tar)
                </label>
                <label
                  class="chk"
                  :title="tip('Download as .tar.gz with files under a directory named after the schema (or source folder)')"
                >
                  <input
                    type="checkbox"
                    :checked="archiveTarGz"
                    @change="setArchiveTarGz($event.target.checked)"
                  />
                  Compressed archive (.tar.gz)
                </label>
                <p v-if="archiveTar || archiveTarGz" class="muted tiny mono gen-hint">
                  {{ resolveArchiveDirName() }}{{ archiveTarGz ? '.tar.gz' : '.tar' }}
                  · files in
                  <strong>{{ resolveArchiveDirName() }}/</strong>
                </p>
              </div>

              <button
                v-if="outputMode === 'one-file' && lastGenerated?.records?.length"
                class="btn btn-ghost full"
                :title="tip('Pack the last generate as XML + CSV + TXT in one archive')"
                @click="downloadArchiveMulti"
              >
                Multi-format archive (XML+CSV+TXT)
              </button>
            </div>
          </section>
        </div>

        </template>

        <template v-else-if="workspaceMode === 'package'">
          <div class="ptabs">
            <button
              type="button"
              class="on"
              :title="tip('Generate package variants from the open package')"
            >
              Generate
            </button>
          </div>
          <div class="gen">
            <div v-if="!activePackage" class="muted tiny">Select a package first.</div>
            <template v-else>
              <label
                :title="tip('How many package variants to generate (each variant is one “record”)')"
              >
                Records (= package variants)
                <input
                  v-model.number="packageCount"
                  type="number"
                  min="1"
                  max="100"
                  class="input"
                  @change="refreshPackageEstimate"
                />
              </label>
              <p class="muted tiny">Interactive cap: 100 variants. High volume → Delivery later.</p>
              <label
                :title="tip('Optional seed for repeatable package variants. Empty = random.')"
              >
                Seed (empty = random)
                <input v-model="seed" class="input" placeholder="random" />
              </label>
              <label
                class="chk"
                :title="tip('Skip history, themes, and custom lists for deterministic CI-style package data')"
              >
                <input v-model="ciMode" type="checkbox" />
                CI mode (ignore live history / themes / custom)
              </label>
              <label
                class="chk"
                :title="tip('Fill member fields from Data packs themes when categories are set')"
              >
                <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
                Use data themes
                <span v-if="themeBlend.length" class="muted tiny">
                  ({{ themeBlend.map((b) => b.name || b.themeId.slice(0, 6)).join(' + ') }})
                </span>
              </label>
              <label
                class="chk"
                :title="tip('Write generated field values into value history for later fills (off by default)')"
              >
                <input v-model="packageRecordHistory" type="checkbox" :disabled="ciMode" />
                Record value history from this run
              </label>
              <div v-if="packageEstimate" class="obs-panel">
                <div class="obs-title">Output estimate</div>
                <div class="obs-grid">
                  <div>
                    <span class="obs-n">{{ packageEstimate.recordCount }}</span>
                    <span class="obs-l">records / packages</span>
                  </div>
                  <div>
                    <span class="obs-n">{{ packageEstimate.textFilesPerPackage }}</span>
                    <span class="obs-l">text files / package</span>
                  </div>
                  <div>
                    <span class="obs-n">{{ packageEstimate.nestedArchivesPerPackage }}</span>
                    <span class="obs-l">nested archives / package</span>
                  </div>
                  <div>
                    <span class="obs-n">{{ packageEstimate.topLevelEntriesPerPackage }}</span>
                    <span class="obs-l">top-level entries / package</span>
                  </div>
                </div>
                <div class="obs-total">
                  <strong>{{
                    packageEstimate.estimatedLogicalContentFiles?.toLocaleString?.() ??
                    packageEstimate.estimatedLogicalContentFiles
                  }}</strong>
                  content files total
                </div>
                <div class="obs-total muted tiny">
                  Download:
                  <strong>1</strong>
                  {{
                    packageEstimate.downloadBundleFormat ||
                    (packageEstimate.downloadContainsPackages > 1 ? 'tar.gz' : 'ZIP')
                  }}
                  with
                  <strong>{{ packageEstimate.downloadContainsPackages }}</strong> package(s)
                </div>
                <p class="obs-summary muted tiny">{{ packageEstimate.summary }}</p>
              </div>
              <label
                class="muted tiny"
                :title="tip('Default random / same / unique for member fields that have no per-field mode')"
              >
                Default field mode
                <select v-model="packageDefaultMode" class="input">
                  <option value="random">Random</option>
                  <option value="same">Same (immutable across variants)</option>
                  <option value="unique">Unique across variants</option>
                </select>
              </label>
              <label
                class="muted tiny"
                :title="tip('How each package variant is packaged: bare files, tar, or tar.gz')"
              >
                Output format (each package variant)
                <select v-model="packageOutputFormat" class="input" aria-label="Package output format">
                  <option value="itself">Itself (original / bare file)</option>
                  <option value="tar">.tar</option>
                  <option value="tar.gz">.tar.gz</option>
                </select>
              </label>
              <button
                class="btn btn-primary full"
                :disabled="packageWorking"
                :aria-busy="packageWorking"
                :title="tip('Generate package variants and download the bundle')"
                @click="runPackageGenerate"
              >
                {{ packageWorking ? 'Working…' : 'Generate' }}
              </button>
              <p class="muted tiny">
                Multi-variant download bundle defaults to <strong>tar.gz</strong> (single → ZIP or bare
                file). Use Output format for each variant’s form. Field mode
                <strong>same</strong> keeps values immutable across records.
              </p>
            </template>
          </div>
        </template>

        <template v-else-if="workspaceMode === 'delivery'">
          <div class="ptabs">
            <button type="button" class="on" :title="tip('Delivery job tools')">Jobs</button>
          </div>
          <div class="gen">
            <p class="muted tiny">
              Create a plan in the center panel, then run chunks from the left job list.
            </p>
            <p class="muted tiny">
              Artifacts land under <span class="mono">data/exports/delivery/</span>.
            </p>
            <button
              class="btn btn-ghost full"
              :title="tip('Reload delivery job status from the server')"
              @click="refreshDeliveryJobs"
            >
              Refresh
            </button>
          </div>
        </template>

        <template v-else-if="workspaceMode === 'archive'">
          <div class="ptabs">
            <button type="button" class="on" :title="tip('Contents of the selected archive entry')">
              Entry
            </button>
          </div>
          <pre
            class="code"
            :title="tip('Text preview of the selected archive file')"
          >{{ archivePreview || '// Select an entry from the list' }}</pre>
        </template>
      </aside>
    </div>

    <!-- Docked fallback only when the pop-out window is blocked -->
    <div
      v-if="showSchemaFloat"
      class="schema-float"
      :style="schemaFloatStyle"
      role="dialog"
      aria-label="Live schema preview (docked)"
    >
      <div class="schema-float-head" @pointerdown="onSchemaFloatDragDown">
        <span class="schema-float-title">
          Live preview
          <span class="muted tiny">· docked · drag resets size</span>
        </span>
        <div class="schema-float-actions">
          <button
            type="button"
            class="btn btn-ghost tiny-btn"
            :title="tip('Try opening outside this window again')"
            @click="openSchemaPreviewPopout"
          >
            Pop out
          </button>
          <button
            type="button"
            class="btn btn-ghost tiny-btn"
            :title="tip('Close preview')"
            @click="closeSchemaPreview"
          >
            ✕
          </button>
        </div>
      </div>
      <pre class="schema-float-body mono">{{ liveSchemaPreview }}</pre>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}
.schema-float {
  position: fixed;
  z-index: 80;
  right: 1.25rem;
  bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  width: 380px;
  height: 280px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--surface);
  box-shadow:
    0 12px 40px color-mix(in srgb, #000 35%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent);
  overflow: hidden;
  /* no resize handle — size resets to default whenever the popup is dragged */
}
.schema-float-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem 0.4rem 0.65rem;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  touch-action: none;
}
.schema-float-head:active {
  cursor: grabbing;
}
.schema-float-title {
  font-size: 12px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.schema-float-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
.schema-float-body {
  margin: 0;
  padding: 0.55rem 0.7rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
  tab-size: 2;
  background: var(--surface);
  color: var(--text);
}
body.dragging-schema-float {
  cursor: grabbing !important;
  user-select: none !important;
}
body.dragging-schema-float * {
  cursor: grabbing !important;
  user-select: none !important;
}
.top-actions .btn.on {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
}
.settings-help-toggle {
  grid-column: 1 / -1;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
  font-weight: 600;
}
.last-output-details {
  margin-top: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
  background: var(--surface-2);
}
.last-output-details summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  user-select: none;
}
.last-output-pre {
  margin: 0.4rem 0 0;
  max-height: 180px;
  overflow: auto;
  font-size: 11px;
}
.top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-wrap: wrap;
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.brand-name {
  font-size: 1.05rem;
  letter-spacing: 0.01em;
  line-height: 1.1;
}
.brand .accent {
  color: var(--accent);
}
.brand-tagline {
  margin-left: calc(30px + 0.5rem);
  font-size: 11px;
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 11px;
}
.top-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.fmt {
  width: auto;
}
.banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 13px;
  animation: banner-in 0.2s ease;
}
.banner.err {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger);
}
.banner.ok {
  background: rgba(74, 222, 128, 0.12);
  color: var(--success);
}
.banner.boot {
  background: rgba(59, 130, 246, 0.12);
  color: var(--muted);
}
.banner-timer {
  margin-left: auto;
  opacity: 0.75;
}
@keyframes banner-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.schema-head {
  flex-direction: column;
  align-items: stretch;
  flex-wrap: nowrap;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
}
.schema-head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
  min-width: 0;
}
.schema-head-identity {
  gap: 0.5rem 0.75rem;
}
.schema-title-block {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
  flex: 1 1 12rem;
  max-width: min(28rem, 100%);
}
.schema-head-kicker {
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
}
.schema-title-input {
  max-width: none !important;
  width: 100%;
  font-weight: 600;
}
.schema-title-placeholder {
  padding: 0.35rem 0;
}
.schema-head-grow {
  flex: 1 1 auto;
  min-width: 0.5rem;
}
.schema-delete-btn {
  flex-shrink: 0;
  margin-left: auto;
}
.schema-head-tools {
  padding-top: 0.35rem;
  border-top: 1px solid var(--border);
  gap: 0.55rem 0.75rem;
}
.schema-btn-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.28rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2, transparent);
  min-width: 0;
}
.schema-group-label {
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0 0.25rem;
  opacity: 0.85;
}
.schema-map-btn {
  font-weight: 600;
}
.xml-tag-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  flex-shrink: 0;
}
.xml-tag-inline .tag-input {
  width: 6.5rem;
  padding: 0.25rem 0.4rem;
}
.subtabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.subtabs button {
  flex: 1;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  padding: 0.3rem 0.4rem;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease;
}
.subtabs button.on {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--accent);
}
.subtabs button:active {
  transform: scale(0.96);
}
.side-section-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin: 0.75rem 0 0.35rem;
  padding: 0 0.15rem;
}
.clickable-label {
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.clickable-label:hover {
  color: var(--text);
}
.tabs button:active:not(:disabled) {
  transform: scale(0.96);
}
.settings {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  max-height: 40vh;
  overflow: auto;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
  align-items: end;
}
.settings-grid label {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.settings-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.workspace-chip {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  padding: 0.2rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  max-width: min(36vw, 280px);
  min-width: 0;
}
.workspace-chip-title {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-chip-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  padding: 0.3rem 0.4rem 0.3rem 0.55rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--accent) 20%, transparent),
    0 4px 14px color-mix(in srgb, var(--accent) 12%, transparent);
}
.layout-tools-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent) 75%, var(--muted));
  margin-right: 0.15rem;
  user-select: none;
}
.layout-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2.15rem;
  padding: 0.4rem 0.85rem;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 2px color-mix(in srgb, #000 18%, transparent);
  transition:
    transform 0.16s cubic-bezier(0.34, 1.4, 0.64, 1),
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    color 0.16s ease;
}
.layout-btn-icon {
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  opacity: 0.9;
  transition: transform 0.18s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.layout-btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.04);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  box-shadow:
    0 4px 12px color-mix(in srgb, var(--accent) 22%, transparent),
    0 1px 0 color-mix(in srgb, var(--accent) 25%, transparent);
}
.layout-btn:hover:not(:disabled) .layout-btn-icon {
  transform: scale(1.15);
}
.layout-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 16%, transparent);
  transition-duration: 0.08s;
}
.layout-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.layout-btn.on {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
  color: var(--text);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
    0 2px 8px color-mix(in srgb, var(--accent) 18%, transparent);
}
.layout-btn.on .layout-btn-icon {
  color: var(--accent);
}
.layout-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}
.layout-btn-reset:hover:not(:disabled) .layout-btn-spin {
  animation: layout-spin 0.55s cubic-bezier(0.34, 1.3, 0.64, 1);
}
@keyframes layout-spin {
  from {
    transform: rotate(0deg) scale(1.15);
  }
  to {
    transform: rotate(-360deg) scale(1.15);
  }
}
.workspace-panel {
  min-height: 0;
}
.workspace-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0;
}
.pkg-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(160px, 240px) minmax(0, 1fr);
  overflow: hidden;
}
.pkg-explorer {
  border-right: 1px solid var(--border);
  overflow: auto;
  padding: 0.35rem 0;
  background: var(--surface-2, var(--surface));
}
.pkg-explorer-title {
  padding: 0.25rem 0.6rem;
  font-weight: 600;
}
.pkg-tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pkg-tree-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 0.2rem 0.4rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  border-radius: 4px;
}
.pkg-tree-row:hover {
  background: var(--surface);
}
.pkg-tree-row.active {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
}
.pkg-tree-row.unsupported {
  opacity: 0.65;
}
.pkg-chevron {
  width: 0.9rem;
  color: var(--muted);
  flex-shrink: 0;
}
.pkg-icon {
  flex-shrink: 0;
  font-size: 0.85rem;
}
.pkg-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pkg-skipped {
  padding: 0.5rem 0.6rem;
  border-top: 1px solid var(--border);
  margin-top: 0.35rem;
}
.pkg-editor {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.pkg-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin: 0.5rem 0.75rem;
}
.pkg-name-edit {
  flex: 1 1 140px;
  min-width: 120px;
}
.pkg-content-editor {
  width: 100%;
  min-height: 220px;
  resize: vertical;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.4;
  margin-top: 0.25rem;
}
.field-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0.25rem 0;
}
.field-mode-row .mode-sel {
  width: auto;
  min-width: 9rem;
}
.empty-workspace {
  padding: 1.25rem 1rem;
  color: var(--text);
  line-height: 1.45;
}
.empty-workspace p {
  margin: 0 0 0.5rem;
}
.empty-cta-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}
.empty-cta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
}
.empty-cta-row .btn,
.empty-cta-row label.btn {
  margin: 0;
  cursor: pointer;
}
.empty-cta-banner {
  margin: 0.5rem 0.75rem 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 80%, transparent);
}
.main {
  display: grid;
  grid-template-columns: 280px 5px minmax(0, 1fr) 5px 360px;
  flex: 1;
  min-height: 0;
  transition: none;
}
.main.focus-layout {
  /* history / datapacks / templates — wide center */
}
.main.side-collapsed .side {
  overflow: hidden;
}
.col-resizer {
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 2;
  touch-action: none;
}
.col-resizer::after {
  content: '';
  position: absolute;
  inset: 0 1px;
  background: var(--border);
  opacity: 0.65;
  transition: background 0.12s ease, opacity 0.12s ease;
}
.col-resizer:hover::after,
.col-resizer:active::after {
  background: var(--accent);
  opacity: 1;
}
body.resizing-cols {
  cursor: col-resize !important;
  user-select: none !important;
}
body.resizing-cols iframe,
body.resizing-cols * {
  cursor: col-resize !important;
}
.side,
.center,
.preview {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.center {
  min-width: 0;
  flex: 1;
}
.preview {
  border-right: none;
  border-left: none;
}
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.side-collapsed-rail {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.4rem 0.3rem;
  height: 100%;
  align-items: stretch;
}
.rail-nav {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  padding: 0.45rem 0;
  cursor: pointer;
  font-weight: 700;
  font-size: 12px;
  transition: transform 0.08s ease, background 0.12s ease;
}
.rail-nav.on {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.rail-nav:active {
  transform: scale(0.94);
}
.rail-nav-primary {
  font-weight: 800;
}
.rail-nav-muted {
  opacity: 0.72;
  font-weight: 600;
  font-size: 11px;
  padding: 0.32rem 0;
}
.rail-nav-muted.on {
  opacity: 1;
}
.tabs,
.ptabs {
  display: flex;
  gap: 2px;
  padding: 0.4rem;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
/* Workspace nav: primary Library + secondary + demoted More (not equal 6-tab weight) */
.workspace-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.45rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.nav-primary {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.3rem;
}
.nav-secondary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.3rem;
}
.nav-demoted {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.1rem;
  padding-top: 0.35rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}
.nav-more-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 0.2rem 0.25rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}
.nav-more-toggle:hover {
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
  color: var(--text);
}
.nav-demoted-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
}
.workspace-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  min-width: 0;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  padding: 0.4rem 0.35rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.15;
  transition:
    transform 0.08s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.workspace-tabs .nav-tab-primary {
  font-weight: 700;
  padding: 0.48rem 0.4rem;
  border-color: color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--surface-2) 45%, transparent);
}
.workspace-tabs .nav-tab-demoted {
  font-size: 11px;
  font-weight: 500;
  padding: 0.32rem 0.2rem;
  opacity: 0.88;
}
.workspace-tabs button .tab-full,
.workspace-tabs button .tab-short,
.workspace-tabs button .tab-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
/* Label density driven by live side width */
.side.nav-comfortable .tab-code,
.side.nav-comfortable .tab-short {
  display: none;
}
.side.nav-comfortable .tab-full {
  display: inline;
}
.side.nav-cozy .tab-full,
.side.nav-cozy .tab-code {
  display: none;
}
.side.nav-cozy .tab-short {
  display: inline;
}
.side.nav-cozy .workspace-tabs button {
  font-size: 11px;
  padding: 0.38rem 0.25rem;
}
.side.nav-cozy .workspace-tabs .nav-tab-primary {
  padding: 0.42rem 0.3rem;
}
.side.nav-compact .tab-full,
.side.nav-compact .tab-short {
  display: none;
}
.side.nav-compact .tab-code {
  display: inline;
  font-size: 11px;
  letter-spacing: 0.02em;
}
.side.nav-compact .workspace-tabs button {
  padding: 0.42rem 0.15rem;
}
.side.nav-compact .nav-demoted-row {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.tabs button,
.ptabs button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 0.35rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.workspace-tabs button.on,
.tabs button.on,
.ptabs button.on {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--border);
}
.workspace-tabs .nav-tab-primary.on {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.workspace-tabs button:hover:not(.on) {
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  color: var(--text);
}
.gen-more-toggle {
  width: 100%;
  margin: 0;
  text-align: left;
}
.gen-more-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-top: 0.35rem;
}
.gen-more-subhead {
  margin-top: 0.25rem;
  padding-top: 0.35rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.side-body {
  padding: 0.5rem;
  overflow: auto;
  flex: 1;
  min-width: 0;
}
/* Smooth content reflow while dragging side width */
.side {
  transition: none;
}
.side .drop,
.side .btn.full,
.side .input,
.side .schema-list .name,
.side .schema-list .meta {
  min-width: 0;
}
.side .schema-list .name,
.side .schema-list .meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side.nav-compact .drop {
  font-size: 11px;
  padding: 0.45rem 0.35rem;
}
.side.nav-compact .btn.full {
  font-size: 12px;
  padding: 0.4rem 0.45rem;
}
.side.nav-compact .side-section-label {
  font-size: 10px;
}
.full {
  width: 100%;
  margin-bottom: 0.4rem;
}
.drop {
  display: block;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 0.6rem;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 0.5rem;
  cursor: pointer;
}
.drop:hover {
  border-color: var(--accent);
  color: var(--text);
}
.drop.disabled,
.drop:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
.import-pkg-block {
  margin-bottom: 0.65rem;
}
.import-pkg-label {
  margin-bottom: 0.3rem;
}
.import-pkg-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
}
.import-pkg-row .drop-split {
  margin-bottom: 0;
  padding: 0.5rem 0.35rem;
  font-size: 11px;
  line-height: 1.25;
}
.side.nav-compact .import-pkg-row .drop-split {
  font-size: 10px;
  padding: 0.4rem 0.25rem;
}
.schema-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.schema-list li {
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}
.schema-list li:hover,
.schema-list li.active {
  background: var(--surface-2);
}
.schema-list .name {
  font-size: 13px;
  font-weight: 600;
}
.schema-list .meta {
  font-size: 10px;
  color: var(--muted);
}
.center-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.center-head .title {
  max-width: 220px;
  font-weight: 600;
}
.danger {
  color: var(--danger);
}
.rows {
  flex: 1;
  overflow: auto;
  padding: 0.5rem;
  min-height: 80px;
}
.tabular-schema {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.tabular-hint {
  margin: 0;
  padding: 0 0.15rem;
  line-height: 1.35;
}
.table-scroll {
  overflow: auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}
.schema-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}
.schema-table th,
.schema-table td {
  vertical-align: top;
  padding: 0.45rem 0.5rem;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  position: relative;
  box-sizing: border-box;
}
.schema-table th:last-child,
.schema-table td:last-child {
  border-right: none;
}
.schema-table thead th {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  position: sticky;
  top: 0;
  z-index: 1;
}
.schema-table .header-row th.sel,
.schema-table .value-row td.sel {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.schema-table .tab-col {
  overflow: hidden;
}
.schema-table .row-gutter {
  min-width: 3.75rem;
  max-width: 4.25rem;
  width: 3.75rem;
  text-align: center;
  vertical-align: middle;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
}
.schema-table thead .row-gutter {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  z-index: 3;
}
.schema-table .row-gutter .row-num {
  display: block;
  font-variant-numeric: tabular-nums;
  margin-bottom: 0.2rem;
}
.tab-row-drag {
  display: block;
  cursor: grab;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: -1px;
  user-select: none;
  line-height: 1;
  margin-bottom: 0.15rem;
  padding: 0.1rem 0;
}
.tab-row-drag:active {
  cursor: grabbing;
}
.schema-table .value-row.tab-row-dragging {
  opacity: 0.45;
}
.schema-table .value-row.tab-drop-before td {
  box-shadow: inset 0 2px 0 0 var(--accent);
}
.schema-table .value-row.tab-drop-after td {
  box-shadow: inset 0 -2px 0 0 var(--accent);
}
.schema-table .add-row-tr td {
  border-bottom: none;
  padding: 0.4rem 0.5rem;
  vertical-align: middle;
}
.schema-table .col-label {
  display: block;
  margin-bottom: 0.2rem;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.schema-table .input.key,
.schema-table .input.sample {
  width: 100%;
  min-width: 0;
  font-size: 12px;
  box-sizing: border-box;
}
.schema-table .input.sample {
  resize: none;
}
.schema-table .col-actions {
  display: flex;
  gap: 0.2rem;
  margin-top: 0.3rem;
}
.schema-table .add-col-cell {
  min-width: 4.5rem;
  max-width: 5rem;
  width: 4.5rem;
  vertical-align: middle;
  background: transparent;
}
.schema-table .value-row td {
  background: var(--surface);
}
/* Column resize handle (right edge) */
.tab-col-resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 7px;
  bottom: 0;
  cursor: col-resize;
  z-index: 4;
  touch-action: none;
  user-select: none;
}
.tab-col-resizer::after {
  content: '';
  position: absolute;
  top: 12%;
  bottom: 12%;
  left: 2px;
  width: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background 0.12s ease;
}
.tab-col:hover .tab-col-resizer::after,
.tab-col-resizer:hover::after {
  background: color-mix(in srgb, var(--accent) 70%, transparent);
}
body.resizing-tab-col {
  cursor: col-resize !important;
  user-select: none !important;
}
body.resizing-tab-col * {
  cursor: col-resize !important;
  user-select: none !important;
}
.props-resizer {
  flex-shrink: 0;
  height: 5px;
  cursor: row-resize;
  background: transparent;
  position: relative;
  z-index: 2;
  touch-action: none;
}
.props-resizer::after {
  content: '';
  position: absolute;
  left: 12%;
  right: 12%;
  top: 1px;
  bottom: 1px;
  border-radius: 2px;
  background: var(--border);
  opacity: 0.75;
}
.props-resizer:hover::after,
.props-resizer:active::after {
  background: var(--accent);
  opacity: 1;
}
body.resizing-props {
  cursor: row-resize !important;
  user-select: none !important;
}
body.resizing-props * {
  cursor: row-resize !important;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 6px;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.row:hover {
  background: var(--surface-2);
}
.row.sel {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.row.tied {
  border-color: var(--gold);
  background: rgba(255, 215, 0, 0.12);
}
.row .kind {
  width: 1.2rem;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.row .key {
  width: 140px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.row .sample {
  flex: 1;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.row-copy-btn {
  flex-shrink: 0;
  opacity: 0.55;
}
.row:hover .row-copy-btn,
.row.sel .row-copy-btn {
  opacity: 1;
}
.drag-handle {
  cursor: grab;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: -1px;
  user-select: none;
  width: 1.1rem;
  text-align: center;
  flex-shrink: 0;
}
.drag-handle.ghost {
  visibility: hidden;
  cursor: default;
}
.row.dragging {
  opacity: 0.45;
}
.row.drop-before {
  box-shadow: inset 0 2px 0 0 var(--accent);
}
.row.drop-after {
  box-shadow: inset 0 -2px 0 0 var(--accent);
}
.row.drop-into {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.row-close {
  opacity: 0.75;
  cursor: pointer;
}
.row-close:hover {
  opacity: 1;
}
.close-tag {
  font-size: 12px;
}
.tag-open {
  font-size: 11px;
  flex-shrink: 0;
}
.schema-tree .row-container .key {
  font-weight: 600;
}
.props {
  border-top: 1px solid var(--border);
  padding: 0.45rem 0.75rem 0.6rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.props.collapsed {
  overflow: hidden;
}
.props-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
}
.props-head-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.props-path {
  max-width: 28rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.props-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 0.4rem;
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding-bottom: 0.25rem;
}
.props-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2, color-mix(in srgb, var(--surface) 88%, #000));
  padding: 0.5rem 0.65rem 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.props-section-muted {
  background: transparent;
  border-style: dashed;
}
.props-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.65rem;
}
.props-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text);
}
.props-section-sub {
  font-weight: 400;
}
.props-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.props-section-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 0.05rem 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.props-section-toggle:hover .props-section-title {
  color: var(--accent);
}
.props-chevron {
  width: 0.9rem;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
}
.props-field {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}
.props-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.props-field-check {
  flex-direction: row !important;
  align-items: flex-start !important;
  gap: 0.45rem !important;
  padding-top: 0.15rem;
}
.props-field-check .props-field-label {
  color: var(--text);
}
.props-field-wide {
  max-width: 24rem;
}
.props-row-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.75rem;
  align-items: start;
}
.props-row-4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem 0.65rem;
  align-items: start;
}
.props-stack {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.props-subcard {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.45rem 0.55rem 0.5rem;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.props-subcard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.props-hint {
  margin: 0;
  line-height: 1.35;
}
.props-field textarea.input {
  min-height: 2.6rem;
  resize: vertical;
}
@media (max-width: 900px) {
  .props-row-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .props-row-2,
  .props-row-4 {
    grid-template-columns: 1fr;
  }
}
.chk {
  flex-direction: row !important;
  align-items: center;
  gap: 0.4rem !important;
  color: var(--text) !important;
}
.chk.gold {
  color: var(--gold) !important;
}
.mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
.gen {
  padding: 0.65rem 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
}
.gen-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2, color-mix(in srgb, var(--surface) 88%, #000));
  padding: 0.5rem 0.6rem 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.gen-section-actions {
  background: transparent;
  border-style: dashed;
}
.gen-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 0.55rem;
}
.gen-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text);
}
.gen-section-sub {
  font-weight: 400;
}
.gen-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.gen-field {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}
.gen-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.gen-row-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem 0.65rem;
}
.gen-choice-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.gen-choice {
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-start !important;
  gap: 0.45rem !important;
  margin: 0;
  padding: 0.4rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
  color: var(--text) !important;
}
.gen-choice.on {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.gen-choice input {
  margin-top: 0.15rem;
  flex-shrink: 0;
}
.gen-choice-text {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
  line-height: 1.3;
}
.gen-choice-text strong {
  font-size: 12px;
}
.gen-checks {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.gen-checks .chk {
  font-size: 12px;
}
.gen-format-opts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem 0.55rem;
  align-items: end;
  padding-top: 0.15rem;
}
.gen-format-opts .chk {
  grid-column: 1 / -1;
}
.gen-hint {
  margin: 0;
  line-height: 1.35;
}
.gen-actions {
  gap: 0.4rem;
}
.gen-report {
  margin-top: 0.15rem;
  line-height: 1.4;
  padding: 0.3rem 0.15rem 0;
}
.source-mix {
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.source-mix-head {
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  font-size: 10px;
}
.source-mix-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--border);
  min-width: 0;
}
.source-mix-seg {
  display: block;
  min-width: 2px;
  height: 100%;
}
.source-mix-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.65rem;
  font-size: 11px;
  color: var(--muted);
}
.source-mix-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
}
.src-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.src-enum,
.src-dot.src-enum {
  background: #5b8def;
}
.src-theme,
.src-dot.src-theme {
  background: #9b6bff;
}
.src-custom,
.src-dot.src-custom {
  background: #3ecf8e;
}
.src-history,
.src-dot.src-history {
  background: #f0b429;
}
.src-synth,
.src-dot.src-synth {
  background: #8b95a8;
}
.src-mutate,
.src-dot.src-mutate {
  background: #e07a5f;
}
.sample-table-wrap {
  margin-top: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}
.sample-table-scroll {
  max-height: 160px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.sample-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sample-table th,
.sample-table td {
  padding: 0.22rem 0.4rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sample-table th {
  position: sticky;
  top: 0;
  background: var(--surface-2, var(--surface));
  font-weight: 600;
  color: var(--muted);
  z-index: 1;
}
@media (max-width: 720px) {
  .gen-row-2,
  .gen-format-opts {
    grid-template-columns: 1fr;
  }
}
.pattern-hint {
  margin: 0;
  padding: 0.3rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg, #0b0d10);
  word-break: break-all;
}
.archive-opts {
  /* legacy class kept for any leftover markup */
  display: none;
}
.code {
  flex: 1;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  font-size: 11px;
  font-family: ui-monospace, Consolas, monospace;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.hist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 11px;
}
.hist-list li {
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border);
}
.hist-list .k {
  display: block;
  font-family: ui-monospace, monospace;
  color: var(--accent);
}
.hist-list .v {
  color: var(--text);
  word-break: break-all;
}
.hist-actions {
  display: flex;
  gap: 0.35rem;
  margin: 0.35rem 0;
}
.hist-row-actions {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.2rem;
}
.custom-editor {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.custom-editor label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.block {
  display: block;
}
.badge-record {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
}
.badge-multi {
  margin-left: 0.35rem;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--gold);
  background: rgba(212, 160, 23, 0.15);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}
.code-mini {
  max-height: 140px;
  overflow: auto;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: var(--muted);
  white-space: pre-wrap;
  margin: 0.35rem 0;
  padding: 0.4rem;
  background: var(--bg);
  border-radius: 6px;
  border: 1px solid var(--border);
}
.field-modes {
  margin: 0.4rem 0;
  padding: 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 180px;
  overflow: auto;
}
.field-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  margin-bottom: 0.25rem;
}
.mode-sel {
  width: auto;
  max-width: 6.5rem;
  padding: 0.2rem 0.35rem;
  font-size: 11px;
}
.row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}
.obs-panel {
  margin: 0.5rem 0;
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.obs-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 0.4rem;
}
.obs-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem 0.5rem;
}
.obs-n {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.obs-l {
  font-size: 10px;
  color: var(--muted);
}
.obs-total {
  margin-top: 0.45rem;
  font-size: 12px;
  color: var(--text);
}
.obs-summary {
  margin: 0.35rem 0 0;
  line-height: 1.35;
}
.tiny-btn {
  font-size: 10px;
  padding: 0.15rem 0.4rem;
}

/* Data packs — Themes & Field values */
.datapacks-side {
  gap: 0.55rem;
}
.pack-subtabs button {
  font-weight: 700;
  padding: 0.45rem 0.5rem;
}
.pack-lead {
  margin: 0 0 0.15rem;
  line-height: 1.35;
}
.pack-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.15rem 0 0.35rem;
}
.pack-enable {
  font-size: 12px;
}
.pack-cta {
  font-weight: 700;
  letter-spacing: 0.01em;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 25%, transparent),
    0 2px 8px color-mix(in srgb, var(--accent) 28%, transparent);
}
.pack-cta:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
}
.pack-cta:active:not(:disabled) {
  transform: translateY(0);
}
.btn-accent {
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
  font-weight: 650;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 18%, transparent);
}
.btn-accent:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 32%, var(--surface));
  border-color: var(--accent);
}
.btn-outline {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  font-weight: 600;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 12%, transparent);
}
.btn-outline:hover:not(:disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.btn-outline-danger {
  background: var(--surface);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
  font-weight: 600;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 12%, transparent);
}
.btn-outline-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
  border-color: var(--danger);
}
.pack-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.pack-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.55rem 0.6rem 0.5rem;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  box-shadow: 0 1px 0 color-mix(in srgb, #000 14%, transparent);
}
.pack-card.active {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}
.pack-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.pack-card-title {
  margin: 0;
  min-width: 0;
  flex: 1;
}
.pack-card-title .name {
  font-weight: 650;
  color: var(--text);
}
.pack-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
}
.pack-card-meta {
  font-size: 11px;
  line-height: 1.3;
}
.pack-weight {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.pack-weight .input {
  max-width: 5.5rem;
}
.pack-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.15rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border);
}
.pack-action {
  flex: 1 1 auto;
  min-width: 5.5rem;
  padding: 0.4rem 0.55rem;
  font-size: 12px;
}
.pack-action-sm {
  padding: 0.28rem 0.5rem;
  font-size: 11px;
}
.pack-empty {
  padding: 0.5rem 0.15rem;
}
.pack-cats {
  margin: 0.25rem 0 0;
  line-height: 1.35;
}
.pack-editor {
  margin-top: 0.65rem;
  padding: 0.65rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 2px 10px color-mix(in srgb, #000 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.pack-editor-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.pack-value-list {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  max-height: 200px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.pack-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  padding: 0.35rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2, var(--bg));
}
.pack-value-row .v {
  min-width: 0;
  word-break: break-word;
  color: var(--text);
  font-size: 12px;
}
.pack-value-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.3rem;
}
.pack-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.35rem;
}
.pack-editor-actions .pack-cta {
  flex: 1 1 8rem;
}
.clickable {
  cursor: pointer;
}
.clickable:hover {
  background: var(--surface-2);
}
.report {
  margin-top: 0.25rem;
  line-height: 1.4;
}
</style>
