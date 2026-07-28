<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  api,
  downloadBase64Zip,
  downloadBlob,
  downloadText,
  emptyRow,
  emptySchema,
  newId
} from './api'
import BrandIcon from './components/BrandIcon.vue'
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

const schemas = ref([])
const templates = ref([])
const active = ref(null)
const selectedId = ref(null)
/** Team formats only: xml, csv, txt (json/yaml removed from UI) */
const EXPORT_FORMATS = ['xml', 'csv', 'txt']
const format = ref('xml')
const recordCount = ref(10)
const seed = ref('')
const ciMode = ref(false)
const csvMultiRow = ref(true)
const csvTieOn = ref(false)
const csvLayoutMode = ref('single-header')
const csvDelim = ref('.')
const csvNestedAsJson = ref(false)
const xmlRootTag = ref('root')
const xmlRecordTag = ref('record')
const xmlSelfClosing = ref(true)
const streamMode = ref(false)
/** one-file = all records in a single export; per-file = one file per record (archive) */
const outputMode = ref('one-file')
const generating = ref(false)
const lastGenerated = ref(null)
const lastReport = ref(null)
const previewText = ref('')
const historyPage = ref({ items: [], total: 0, offset: 0, limit: 40 })
const historySearch = ref('')
/** Recent activity (generate runs) + value-fill subview */
const recentActivity = ref([])
const historySubTab = ref('recent') // recent | values
const dataPackSearch = ref('')
const dataPackSubTab = ref('themes') // themes | custom
const themeEditor = ref(null) // { theme, category, bulk }
const statusMsg = ref('')
const errorMsg = ref('')
let statusDismissTimer = null
let errorDismissTimer = null
const tab = ref('schema')
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
const packageCount = ref(5)
/** Interactive package generate records history only when enabled (default off). */
const packageRecordHistory = ref(false)
const packageDefaultMode = ref('random')
/** memberPath -> fieldPath -> mode */
const packageFieldModes = ref({})
const packageWorking = ref(false)
const packageEstimate = ref(null)
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
  () => format.value === 'csv' || format.value === 'txt'
)

/** Root-level fields as columns (header = key, value row = sample) */
const tabularColumns = computed(() =>
  active.value && Array.isArray(active.value.root) ? active.value.root : []
)

function updateColumnField(id, patch) {
  if (!active.value || !id) return
  pushSchemaUndo()
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === id) return { ...r, ...patch }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  selectedId.value = id
}

function addColumn() {
  addRoot()
}

function removeColumn(id) {
  if (!active.value || !id) return
  selectedId.value = id
  deleteSelected()
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

function isTied(path, row) {
  const p = pathLabel(path, row).toLowerCase()
  return tiedPaths.value.some((t) => t.toLowerCase() === p)
}

function toggleTie(path, row) {
  if (!active.value || row.kind !== 'value') return
  const p = pathLabel(path, row)
  const cur = [...(active.value.csvTiedFieldPaths || [])]
  const i = cur.findIndex((x) => x.toLowerCase() === p.toLowerCase())
  if (i >= 0) cur.splice(i, 1)
  else cur.push(p)
  pushSchemaUndo()
  active.value = {
    ...active.value,
    csvTiedFieldPaths: cur.length ? cur : undefined
  }
}

async function refresh() {
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
  applySettingsLocal(settings.value)
  await loadHistory()
}

function applySettingsLocal(s) {
  if (!s) return
  if (s.defaultExportFormat) {
    const f = String(s.defaultExportFormat).toLowerCase()
    format.value = EXPORT_FORMATS.includes(f) ? f : 'xml'
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
  } catch {
    /* ignore */
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
    void persistDataThemes()
  }
}

function xmlExportOpts() {
  const map =
    active.value?.root != null
      ? buildSelfClosingMap(active.value.root)
      : {}
  const opts = {
    xmlRootTag: xmlRootTag.value || 'root',
    xmlRecordTag: xmlRecordTag.value || 'record',
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
  applyWorkspaceLayoutDefaults(workspaceMode.value)
  window.addEventListener('keydown', onSchemaClipboardKeydown)
  try {
    await refresh()
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
  }
})

onUnmounted(() => {
  if (statusDismissTimer) clearTimeout(statusDismissTimer)
  if (errorDismissTimer) clearTimeout(errorDismissTimer)
  window.removeEventListener('keydown', onSchemaClipboardKeydown)
  window.removeEventListener('pointermove', onResizePointerMove)
  window.removeEventListener('pointerup', onResizePointerUp)
  window.removeEventListener('pointermove', onPropsResizeMove)
  window.removeEventListener('pointerup', onPropsResizeUp)
  document.body.classList.remove('resizing-cols')
  document.body.classList.remove('resizing-props')
})

function syncXmlTagsFromSchema(schema) {
  if (!schema) return
  if (schema.xmlRootTag) xmlRootTag.value = schema.xmlRootTag
  if (schema.xmlRecordTag) xmlRecordTag.value = schema.xmlRecordTag
}

async function saveSchema() {
  if (!active.value) return
  try {
    // Persist per-schema XML tags with the schema
    active.value.xmlRootTag = xmlRootTag.value || 'root'
    active.value.xmlRecordTag = xmlRecordTag.value || 'record'
    if (format.value && EXPORT_FORMATS.includes(format.value)) {
      active.value.sourceFormat = format.value
    }
    const saved = await api.saveSchema(active.value)
    active.value = saved
    syncXmlTagsFromSchema(saved)
    flashStatus(`Saved “${saved.name}”`)
    await refresh()
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
  if (!confirm(`Delete schema “${active.value.name}”?`)) return
  try {
    await api.deleteSchema(active.value.id)
    await refresh()
    if (schemas.value.length) selectSchema(schemas.value[0].id)
    else newSchema()
  } catch (e) {
    errorMsg.value = e.message
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
    await refresh()
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
  const id = selectedId.value
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === id) return { ...r, ...patch }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
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
  return {
    schema: {
      ...active.value,
      csvTiedFieldPaths: csvTieOn.value
        ? active.value.csvTiedFieldPaths
        : undefined
    },
    recordCount: recordCount.value,
    seed: Number.isFinite(seedNum) ? seedNum >>> 0 : null,
    ciMode: ciMode.value,
    recordHistory: !ciMode.value,
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
const showHeaderGenerate = computed(() => workspaceMode.value === 'schema')
/** Workspaces that can show a right tools/preview rail */
const workspaceSupportsPreview = computed(() =>
  ['schema', 'package', 'delivery', 'archive'].includes(workspaceMode.value)
)
const streamSupported = computed(() => ['csv', 'txt'].includes(format.value))

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
  propsHeight: 220,
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
const sideNavDensity = computed(() => {
  if (layout.value.sideCollapsed) return 'rail'
  const w = Number(layout.value.sideWidth) || 280
  if (w < 228) return 'compact'
  if (w < 280) return 'cozy'
  return 'comfortable'
})

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
  if (s === 'schemas' && !['schema', 'generated', 'generate'].includes(tab.value)) {
    tab.value = 'schema'
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
    if (streamMode.value) {
      const text = await api.generateStream(genBody())
      previewText.value = text
      // Keep a lightweight shell so download/export chrome stays usable after stream
      lastGenerated.value = {
        records: null,
        recordCount: recordCount.value,
        seed: seed.value,
        streamed: true,
        format: format.value
      }
      lastReport.value = null
      tab.value = 'generated'
      flashStatus(
        `Streamed ${recordCount.value} record(s) into one ${format.value.toUpperCase()} file`
      )
    } else {
      const res = await api.generate(genBody())
      lastGenerated.value = res
      lastReport.value = res.report || null
      tab.value = 'generated'
      // Always export the record list (stable ETL shape: array, even for N=1)
      const exp = await api.exportData({
        data: res.records,
        format: format.value,
        multiRow: csvMultiRow.value,
        layoutMode: csvLayoutMode.value,
        delim: csvDelim.value,
        nestedAsJson: csvNestedAsJson.value,
        ...xmlExportOpts()
      })
      previewText.value = exp.content
      flashStatus(
        `Generated ${res.recordCount} record(s) in one file · seed ${res.seed} · ${res.ms}ms`
      )
    }
    await refresh()
    await loadRecentActivity()
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
    const res = await api.generatePerFile(genBody({ previewSampleSize: 5 }))
    downloadBase64Zip(res.zipBase64 || res.archiveBase64, res.fileName)
    lastGenerated.value = { ...res, records: null, perFile: true }
    lastReport.value = null
    const arch =
      res.archiveFormat ||
      (String(res.fileName || '').endsWith('.tar.gz') ? 'tar.gz' : 'ZIP')
    flashStatus(
      `One file per record: wrote ${res.written} file(s) in ${arch} (skipped ${res.skipped}) · seed ${res.seed}`
    )
    if (res.sample?.length) {
      previewText.value = res.sample
        .map((s) => `// ${s.path}\n${s.preview}`)
        .join('\n\n')
      tab.value = 'generated'
    }
    await refresh()
    await loadRecentActivity()
  } catch (e) {
    flashError(e.message)
  } finally {
    generating.value = false
  }
}

async function refreshPreview() {
  const data = lastGenerated.value?.records
  if (!data?.length) {
    if (!active.value) return
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
    previewText.value = exp.content
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
  previewText.value = exp.content
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
  if (!previewText.value) return
  const ext = EXPORT_FORMATS.includes(format.value) ? format.value : 'xml'
  downloadText(previewText.value, `${active.value?.name || 'data'}.${ext}`)
}

async function downloadArchiveMulti() {
  if (!lastGenerated.value?.records) {
    flashError('Generate first, then pack archive')
    return
  }
  try {
    // Multi-format = team formats only → tar.gz when more than one file
    const blob = await api.exportArchive({
      topFolderName: active.value?.name || 'export',
      files: EXPORT_FORMATS.map((f) => ({
        fileName: `data.${f}`,
        format: f,
        data: lastGenerated.value.records,
        multiRow: csvMultiRow.value,
        layoutMode: csvLayoutMode.value,
        delim: csvDelim.value,
        nestedAsJson: csvNestedAsJson.value,
        ...xmlExportOpts()
      }))
    })
    downloadBlob(blob, `${active.value?.name || 'data'}-multi.tar.gz`)
    flashStatus('Downloaded multi-format archive (XML + CSV + TXT)')
  } catch (e) {
    flashError(e.message)
  }
}

async function saveAsTemplate() {
  if (!active.value) return
  const name = prompt('Template name', active.value.name + ' template')
  if (!name) return
  await api.saveTemplate({
    name,
    schema: active.value,
    schemaJson: JSON.stringify(active.value)
  })
  statusMsg.value = `Template “${name}” saved`
  await refresh()
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
  if (!confirm('Delete template?')) return
  await api.deleteTemplate(id)
  await refresh()
}

async function saveSettingsPatch(patch) {
  settings.value = await api.setSettings(patch)
  applySettingsLocal(settings.value)
  statusMsg.value = 'Settings saved'
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
  tab.value = 'generated'
}

async function clearHistoryAll() {
  const c = await api.historyClearCount({ mode: 'all', confirmAll: true })
  if (!confirm(`Delete all ${c.count} history rows?`)) return
  const r = await api.historyClear({ mode: 'all', confirmAll: true })
  statusMsg.value = `Cleared ${r.deleted} history rows`
  await loadHistory()
  await refresh()
}

async function openCustomList(id) {
  activeCustomList.value = await api.getCustomList(id)
  customListName.value = activeCustomList.value.name
  customListKeys.value = (activeCustomList.value.keys || []).join(', ')
}

async function createCustomList() {
  const name = prompt('List name (e.g. Heroes, Cities)')
  if (!name?.trim()) return
  const saved = await api.saveCustomList({ name: name.trim(), keys: [] })
  await refresh()
  await openCustomList(saved.id)
  statusMsg.value = `Custom list “${saved.name}” created`
  sidebar.value = 'custom'
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
  await refresh()
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
  await refresh()
  statusMsg.value = `Added ${res.inserted} value(s)`
}

async function editCustomValue(v) {
  const next = prompt('Edit value', v.value)
  if (next == null || !next.trim()) return
  await api.updateCustomValue(v.id, next.trim())
  await openCustomList(activeCustomList.value.id)
}

async function removeCustomValue(id) {
  await api.deleteCustomValue(id)
  await openCustomList(activeCustomList.value.id)
  await refresh()
}

async function removeCustomList() {
  if (!activeCustomList.value) return
  if (!confirm(`Delete list “${activeCustomList.value.name}”?`)) return
  await api.deleteCustomList(activeCustomList.value.id)
  activeCustomList.value = null
  await refresh()
}

async function createTheme() {
  const name = prompt('Theme name (e.g. Star Wars, Westeros)')
  if (!name?.trim()) return
  await api.saveTheme({ name: name.trim() })
  await refresh()
  statusMsg.value = `Theme “${name.trim()}” created`
}

function openThemeValuesEditor(theme) {
  themeEditor.value = {
    theme,
    category: 'person_name',
    bulk: ''
  }
  sidebar.value = 'datapacks'
  dataPackSubTab.value = 'themes'
}

async function submitThemeValuesEditor() {
  if (!themeEditor.value?.theme) return
  const { theme, category, bulk } = themeEditor.value
  const values = String(bulk || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!category?.trim()) {
    flashError('Enter a category (maps to schema Theme category)')
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
    await refresh()
    flashStatus(`Theme “${theme.name}”: +${res.inserted} value(s) in ${category.trim()}`)
  } catch (e) {
    flashError(e.message)
  }
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
  'person_name',
  'place',
  'ship',
  'house',
  'creature',
  'weapon',
  'title',
  'general'
]

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
    packageMemberPath.value =
      res.members?.find((m) => m.kind === 'text')?.path || null
    const m = res.members?.find((x) => x.path === packageMemberPath.value)
    packagePreview.value = m?.content?.slice(0, 40000) || ''
    sidebar.value = 'packages'
    const multi = res.multifileSchemaId ? ' · Multifile preview schema saved' : ''
    const skipN = res.skipped?.length || 0
    statusMsg.value = `Package “${res.name}” · ${res.members?.filter((x) => x.kind === 'text').length || 0} text · nested ${res.nestedArchives?.length || 0} · skipped ${skipN}${multi}`
    await refresh()
    await refreshPackageEstimate()
    // Stay on Packages — package generate uses member schemas, not the umbrella preview.
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
    packageMemberPath.value =
      activePackage.value.members?.find((m) => m.kind === 'text')?.path || null
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
  if (m?.kind === 'nested_archive_folder') {
    packagePreview.value = `// Nested archive folder → re-packs to ${m.nestedArchivePath}\n// format: ${m.nestedArchiveFormat}`
  } else {
    packagePreview.value = m?.content?.slice(0, 40000) || ''
  }
}

async function verifyPackageMember(verified) {
  if (!activePackage.value || !packageMemberPath.value) return
  await api.verifyPackageMember(
    activePackage.value.id,
    packageMemberPath.value,
    verified
  )
  activePackage.value = await api.getPackage(activePackage.value.id)
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
    !confirm(
      'Delete package layout and its linked schemas from SQLite? Generated files on disk are not removed.'
    )
  )
    return
  errorMsg.value = ''
  try {
    await api.deletePackage(id)
    if (activePackage.value?.id === id) activePackage.value = null
    await refresh()
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
  if (!confirm('Delete this delivery job?')) return
  await api.deleteDeliveryJob(id)
  await refreshDeliveryJobs()
}

async function deleteHist(id) {
  await api.historyDelete([id])
  await loadHistory()
}

async function editHist(h) {
  const v = prompt('Edit value', h.value)
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
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <div class="brand-row">
          <BrandIcon :size="30" />
          <strong class="brand-name">Data<span class="accent">Forge</span></strong>
        </div>
        <span class="muted brand-tagline">Local ETL test-data generator</span>
      </div>
      <div class="workspace-chip" :title="workspaceHint">
        <span class="workspace-chip-title">{{ workspaceTitle }}</span>
        <span v-if="workspaceHint" class="workspace-chip-hint muted tiny">{{ workspaceHint }}</span>
      </div>
      <div class="layout-tools" title="Adjust workspace panels">
        <button
          type="button"
          class="btn btn-ghost tiny-btn"
          :aria-pressed="!layout.sideCollapsed"
          :title="layout.sideCollapsed ? 'Show left panel' : 'Hide left panel'"
          @click="toggleSidePanel"
        >
          {{ layout.sideCollapsed ? '» List' : '« List' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost tiny-btn"
          :disabled="!workspaceSupportsPreview"
          :aria-pressed="showRightPanel"
          :title="
            !workspaceSupportsPreview
              ? 'No tools panel in this workspace'
              : layout.previewCollapsed
                ? 'Show tools panel'
                : 'Hide tools panel'
          "
          @click="togglePreviewPanel"
        >
          {{ showRightPanel ? 'Tools »' : '« Tools' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost tiny-btn"
          title="Reset panel sizes for this workspace"
          @click="resetLayoutToWorkspace"
        >
          Reset layout
        </button>
      </div>
      <div class="top-actions">
        <select v-if="showFormatSelector" v-model="format" class="input fmt" title="Export format">
          <option value="xml">XML</option>
          <option value="csv">CSV</option>
          <option value="txt">TXT</option>
        </select>
        <button class="btn btn-ghost" @click="settingsOpen = !settingsOpen">Settings</button>
        <button
          v-if="showHeaderGenerate"
          class="btn btn-primary"
          :disabled="generating || !active"
          @click="generate"
        >
          {{ generateButtonLabel }}
        </button>
        <button
          v-else-if="workspaceMode === 'package'"
          class="btn btn-primary"
          :disabled="packageWorking || !activePackage"
          @click="runPackageGenerate"
        >
          {{ packageWorking ? 'Working…' : 'Generate' }}
        </button>
      </div>
    </header>

    <div v-if="errorMsg" class="banner err" role="alert">
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
        <label>
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
        <label>
          Default format
          <select
            class="input"
            :value="EXPORT_FORMATS.includes(settings.defaultExportFormat) ? settings.defaultExportFormat : 'xml'"
            @change="saveSettingsPatch({ defaultExportFormat: $event.target.value })"
          >
            <option value="xml">XML</option>
            <option value="csv">CSV</option>
            <option value="txt">TXT</option>
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
        <label>
          XML record tag
          <input
            class="input mono"
            :value="settings.xmlRecordTag || 'record'"
            @change="
              saveSettingsPatch({ xmlRecordTag: $event.target.value || 'record' });
              xmlRecordTag = $event.target.value || 'record'
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
            title="Expand library panel"
            @click="toggleSidePanel"
          >
            »
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'schemas' || sidebar === 'packages' }"
            title="Library"
            @click="sidebar = 'schemas'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Ly
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'history' }"
            title="Recent"
            @click="sidebar = 'history'; layout.sideCollapsed = false; saveLayoutPrefs(); loadRecentActivity(); loadHistory()"
          >
            Re
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'datapacks' || sidebar === 'themes' || sidebar === 'custom' }"
            title="Data packs"
            @click="sidebar = 'datapacks'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Dp
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'templates' }"
            title="Templates"
            @click="sidebar = 'templates'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Tm
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'delivery' }"
            title="Delivery"
            @click="sidebar = 'delivery'; layout.sideCollapsed = false; saveLayoutPrefs(); refreshDeliveryJobs()"
          >
            Dv
          </button>
          <button
            type="button"
            class="rail-nav"
            :class="{ on: sidebar === 'archive' }"
            title="Archive"
            @click="sidebar = 'archive'; layout.sideCollapsed = false; saveLayoutPrefs()"
          >
            Ar
          </button>
        </div>
        <template v-else>
        <nav class="tabs workspace-tabs" aria-label="Workspaces">
          <button
            type="button"
            :class="{ on: sidebar === 'schemas' || sidebar === 'packages' }"
            :aria-current="sidebar === 'schemas' || sidebar === 'packages' ? 'page' : undefined"
            title="Schemas and multifile packages"
            @click="sidebar = 'schemas'"
          >
            <span class="tab-code" aria-hidden="true">Ly</span>
            <span class="tab-short">Lib</span>
            <span class="tab-full">Library</span>
          </button>
          <button
            type="button"
            :class="{ on: sidebar === 'history' }"
            title="Recently used schemas and generate runs"
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
            title="Themes (genres) and custom field values"
            @click="sidebar = 'datapacks'"
          >
            <span class="tab-code" aria-hidden="true">Dp</span>
            <span class="tab-short">Packs</span>
            <span class="tab-full">Data packs</span>
          </button>
          <button
            type="button"
            :class="{ on: sidebar === 'templates' }"
            title="Schema templates"
            @click="sidebar = 'templates'"
          >
            <span class="tab-code" aria-hidden="true">Tm</span>
            <span class="tab-short">Tmpl</span>
            <span class="tab-full">Templates</span>
          </button>
          <button
            type="button"
            :class="{ on: sidebar === 'delivery' }"
            title="Bulk delivery later"
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
            :class="{ on: sidebar === 'archive' }"
            title="Browse an existing archive"
            @click="sidebar = 'archive'"
          >
            <span class="tab-code" aria-hidden="true">Ar</span>
            <span class="tab-short">Arch</span>
            <span class="tab-full">Archive</span>
          </button>
        </nav>

        <div v-if="sidebar === 'schemas' || sidebar === 'packages'" class="side-body">
          <button class="btn btn-primary full" type="button" @click="newSchema">+ New schema</button>
          <label class="drop">
            Import sample (XML / CSV / TXT)
            <input
              type="file"
              accept=".csv,.xml,.txt"
              hidden
              @change="onImport"
            />
          </label>
          <label class="drop">
            {{ packageWorking ? 'Working…' : 'Import package (archive / multi-file)' }}
            <input
              type="file"
              multiple
              accept=".zip,.tar,.tgz,.gz,.xml,.csv,.txt"
              hidden
              :disabled="packageWorking"
              @change="onPackageImport"
            />
          </label>

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
              Import a ZIP/TAR of XML/CSV/TXT files to edit as a package.
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
              @keyup.enter="loadHistory"
            />
            <div class="hist-actions">
              <button type="button" class="btn btn-ghost" @click="loadHistory">Search</button>
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
          </ul>
        </div>

        <div
          v-else-if="sidebar === 'datapacks' || sidebar === 'themes' || sidebar === 'custom'"
          class="side-body"
        >
          <input
            v-model="dataPackSearch"
            class="input"
            placeholder="Search themes & custom lists…"
            aria-label="Search data packs"
          />
          <div class="subtabs">
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
            <p class="muted tiny">
              <strong>Theme</strong> = genre / dataset flavor (Star Wars, banking, …). Map schema
              fields with <em>Theme category</em>. Stored in SQLite.
            </p>
            <label class="chk">
              <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
              Enable themes on generate
            </label>
            <button type="button" class="btn btn-primary full" @click="createTheme">
              + New theme
            </button>
            <ul class="schema-list">
              <li v-for="t in filteredThemes" :key="t.id">
                <label class="chk">
                  <input
                    type="checkbox"
                    :checked="isThemeActive(t.id)"
                    @change="toggleThemeInBlend(t)"
                  />
                  <span class="name">{{ t.name }}</span>
                </label>
                <div class="meta">{{ t.valueCount }} values · {{ t.slug }}</div>
                <label v-if="isThemeActive(t.id)" class="muted tiny">
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
                <div class="meta">
                  <button
                    type="button"
                    class="btn btn-ghost tiny-btn"
                    @click.stop="openThemeValuesEditor(t)"
                  >
                    + Values
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost tiny-btn danger"
                    @click.stop="api.deleteTheme(t.id).then(refresh)"
                  >
                    Delete
                  </button>
                </div>
              </li>
            </ul>
            <p v-if="themeCategories.length" class="muted tiny">
              Categories: {{ themeCategories.join(', ') }}
            </p>
          </template>

          <template v-else>
            <p class="muted tiny">
              <strong>Field values</strong> = curated lists mapped to schema paths
              (<span class="mono">name</span>, <span class="mono">person.city</span>. Used after
              theme, before fill history.
            </p>
            <button type="button" class="btn btn-primary full" @click="createCustomList">
              + New field list
            </button>
            <ul class="schema-list">
              <li
                v-for="c in filteredCustomLists"
                :key="c.id"
                :class="{ active: activeCustomList?.id === c.id }"
                role="button"
                tabindex="0"
                @click="openCustomList(c.id)"
                @keydown.enter="openCustomList(c.id)"
              >
                <div class="name">{{ c.name }}</div>
                <div class="meta">
                  {{ c.valueCount }} values · keys: {{ (c.keys || []).join(', ') || '—' }}
                </div>
              </li>
            </ul>
            <div v-if="activeCustomList" class="custom-editor">
              <label class="muted tiny">
                Name
                <input v-model="customListName" class="input" />
              </label>
              <label class="muted tiny">
                Field keys (comma-separated)
                <input
                  v-model="customListKeys"
                  class="input mono"
                  placeholder="name, person.name, city"
                />
              </label>
              <button type="button" class="btn btn-ghost full" @click="saveActiveCustomList">
                Save list
              </button>
              <label class="muted tiny">
                Add values (one per line)
                <textarea v-model="customBulkValues" class="input mono" rows="4" />
              </label>
              <button type="button" class="btn btn-primary full" @click="addBulkCustomValues">
                Add values
              </button>
              <ul class="hist-list">
                <li v-for="v in activeCustomList.values || []" :key="v.id">
                  <span class="v">{{ v.value }}</span>
                  <div class="hist-row-actions">
                    <button type="button" class="btn btn-ghost tiny-btn" @click="editCustomValue(v)">
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost tiny-btn danger"
                      @click="removeCustomValue(v.id)"
                    >
                      Del
                    </button>
                  </div>
                </li>
              </ul>
              <button type="button" class="btn btn-ghost full danger" @click="removeCustomList">
                Delete list
              </button>
            </div>
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
        title="Drag to resize list"
        @pointerdown="onResizePointerDown('side', $event)"
      />

      <section v-if="workspaceMode === 'schema'" class="center panel">
        <div class="center-head schema-head">
          <input
            v-if="active"
            v-model="active.name"
            class="input title"
            title="Schema / file name"
            @change="saveSchema"
          />
          <span v-else class="muted">Select or create a schema</span>
          <label
            v-if="active && format === 'xml'"
            class="xml-tag-inline muted tiny"
            title="XML document root element for this schema"
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
          <label
            v-if="active && format === 'xml'"
            class="xml-tag-inline muted tiny"
            title="Wrapper tag when exporting multiple records"
          >
            Record tag
            <input
              v-model="xmlRecordTag"
              class="input mono tag-input"
              placeholder="record"
              @change="
                active.xmlRecordTag = xmlRecordTag || 'record';
                persistXmlSettings()
              "
            />
          </label>
          <button type="button" class="btn btn-ghost" :disabled="!active" @click="saveSchema">
            Save
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!active"
            @click="isTabularFormat ? addColumn() : addRoot()"
          >
            {{ isTabularFormat ? '+ Column' : '+ Field' }}
          </button>
          <button
            v-if="!isTabularFormat"
            type="button"
            class="btn btn-ghost"
            :disabled="!selectedId"
            @click="addChild"
          >
            + Child
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!selectedId"
            title="Copy field (Ctrl+C)"
            @click="copyField()"
          >
            Copy
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!active"
            title="Paste field after selection (Ctrl+V)"
            @click="pasteField()"
          >
            Paste
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!canUndoSchema"
            title="Undo last field edit (Ctrl+Z)"
            @click="undoSchemaEdit"
          >
            Undo
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="!selectedId"
            @click="deleteSelected"
          >
            Delete
          </button>
          <button
            v-if="active?.id && schemas.some((s) => s.id === active.id)"
            type="button"
            class="btn btn-ghost danger"
            @click="deleteSchema"
          >
            Delete schema
          </button>
        </div>

        <!-- CSV / TXT: header row = columns, value row = samples -->
        <div
          v-if="isTabularFormat"
          class="rows tabular-schema"
          :class="{ 'with-props': selected }"
        >
          <p class="muted tiny tabular-hint">
            <strong>{{ format === 'csv' ? 'CSV' : 'TXT' }} columns:</strong>
            first row = column names (headers); value row = sample/templates used when
            generating. Export writes header line then data rows.
          </p>
          <div class="table-scroll">
            <table class="schema-table" role="grid" aria-label="Column and value editor">
              <thead>
                <tr class="header-row">
                  <th
                    v-for="col in tabularColumns"
                    :key="'h-' + col.id"
                    :class="{ sel: selectedId === col.id }"
                    scope="col"
                    @click="selectedId = col.id"
                  >
                    <label class="col-label muted tiny">Column</label>
                    <input
                      class="input key mono"
                      :value="col.key"
                      :aria-label="`Column name for ${col.key || 'field'}`"
                      placeholder="column"
                      @click.stop="selectedId = col.id"
                      @change="
                        (e) => updateColumnField(col.id, { key: e.target.value })
                      "
                    />
                    <div class="col-actions">
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn"
                        title="Copy column"
                        @click.stop="copyField(col.id)"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost tiny-btn danger"
                        title="Remove column"
                        @click.stop="removeColumn(col.id)"
                      >
                        Del
                      </button>
                    </div>
                  </th>
                  <th class="add-col-cell" scope="col">
                    <button
                      type="button"
                      class="btn btn-ghost tiny-btn"
                      :disabled="!active"
                      title="Add column"
                      @click="addColumn"
                    >
                      + Col
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr class="value-row">
                  <td
                    v-for="col in tabularColumns"
                    :key="'v-' + col.id"
                    :class="{ sel: selectedId === col.id }"
                    @click="selectedId = col.id"
                  >
                    <label class="col-label muted tiny">Value</label>
                    <input
                      class="input sample mono"
                      :value="col.sampleValue || ''"
                      :aria-label="`Sample value for ${col.key || 'field'}`"
                      placeholder="sample value"
                      @click.stop="selectedId = col.id"
                      @change="
                        (e) =>
                          updateColumnField(col.id, {
                            sampleValue: e.target.value,
                            kind: 'value'
                          })
                      "
                    />
                  </td>
                  <td class="add-col-cell" />
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!tabularColumns.length" class="muted tiny" style="padding: 0.5rem">
            No columns yet — click <strong>+ Column</strong> to define headers.
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
              sel: item.type === 'node' && selectedId === item.row.id,
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
            @click="
              item.type === 'close'
                ? (selectedId = item.row.id)
                : (selectedId = item.row.id)
            "
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
                title="Drag to reorder · drop on a group to nest"
                @click.stop
              >⋮⋮</span>
              <input
                v-if="csvTieOn && item.row.kind === 'value'"
                type="checkbox"
                :checked="isTied(item.path.slice(0, -1), item.row)"
                title="Tie sample value across rows"
                @click.stop
                @change="toggleTie(item.path.slice(0, -1), item.row)"
              />
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
                @click.stop
                @change="
                  (e) => {
                    selectedId = item.row.id
                    updateSelected({ key: e.target.value })
                  }
                "
              />
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
                @click.stop
                @change="
                  (e) => {
                    selectedId = item.row.id
                    updateSelected({ sampleValue: e.target.value })
                  }
                "
              />
              <button
                type="button"
                class="btn btn-ghost tiny-btn row-copy-btn"
                title="Copy field"
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
          title="Drag to resize Field settings"
          @pointerdown="onPropsResizeDown"
        />
        <div
          v-if="selected"
          class="props"
          :class="{ collapsed: layout.propsCollapsed }"
          :style="propsPanelStyle"
        >
          <div class="props-head">
            <div class="label">Field settings</div>
            <button
              type="button"
              class="btn btn-ghost tiny-btn"
              :title="layout.propsCollapsed ? 'Expand field settings' : 'Collapse field settings'"
              @click="togglePropsCollapsed"
            >
              {{ layout.propsCollapsed ? 'Expand' : 'Collapse' }}
            </button>
          </div>
          <template v-if="!layout.propsCollapsed">
          <p class="muted tiny props-hint">
            Controls how this field is randomized. Sample value on the row is the primary template.
            Drag the bar above to resize.
          </p>
          <div class="props-grid">
            <label>
              Kind
              <select
                class="input"
                :value="selected.kind"
                @change="updateSelected({ kind: $event.target.value })"
              >
                <option v-for="o in kindOptions" :key="o.v" :value="o.v">{{ o.l }}</option>
              </select>
            </label>
            <label class="chk">
              <input
                type="checkbox"
                :checked="selected.isPrimary"
                @change="
                  updateSelected({
                    isPrimary: $event.target.checked,
                    isUnique: $event.target.checked ? true : selected.isUnique
                  })
                "
              />
              Primary key
            </label>
            <label class="chk">
              <input
                type="checkbox"
                :checked="selected.isUnique || selected.isPrimary"
                :disabled="selected.isPrimary"
                @change="updateSelected({ isUnique: $event.target.checked })"
              />
              Unique in run
            </label>
            <label v-if="selected.kind === 'value'">
              Null %
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
            <label v-if="selected.kind === 'value'">
              Min length
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
            <label v-if="selected.kind === 'value'">
              Max length
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
            <label v-if="selected.kind === 'value'">
              Min (number)
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
            <label v-if="selected.kind === 'value'">
              Max (number)
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
            <label v-if="selected.kind === 'value' && format === 'xml'" class="wide">
              Empty tag style
              <select
                class="input"
                :value="selfClosingSelectValue(selected)"
                @change="setSelfClosingMode($event.target.value)"
              >
                <option value="default">
                  Schema default ({{ xmlSelfClosing ? 'self-closing' : 'open pair' }})
                </option>
                <option value="self">Self-closing when empty (&lt;tag/&gt;)</option>
                <option value="pair">Open pair when empty (&lt;tag&gt;&lt;/tag&gt;)</option>
              </select>
              <span class="muted tiny"
                >Only affects empty/null values. Nesting is controlled by parent/child structure —
                closing tags in the list are visual only.</span
              >
            </label>
            <label v-if="selected.kind === 'value'" class="wide">
              Allowed values (enum, one per line)
              <textarea
                class="input mono"
                rows="3"
                :value="enumText"
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
            <label v-if="selected.kind === 'value'" class="wide">
              Theme category
              <input
                class="input mono"
                list="field-theme-cat-list"
                :value="selected.themeCategory || ''"
                placeholder="person_name, place, ship…"
                @change="
                  updateSelected({
                    themeCategory: $event.target.value.trim() || undefined
                  })
                "
              />
              <datalist id="field-theme-cat-list">
                <option v-for="c in COMMON_THEME_CATS" :key="'fc-' + c" :value="c" />
                <option v-for="c in themeCategories" :key="'ft-' + c" :value="c" />
              </datalist>
              <span class="muted tiny"
                >Optional — maps field to Data packs theme values</span
              >
            </label>
          </div>
          </template>
        </div>
      </section>


      <!-- Package workspace (dynamic) -->
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
        <div v-if="!activePackage" class="empty-workspace">
          <p>Import or select a package from the list.</p>
          <p class="muted tiny">
            Nested ZIP/TAR/TAR.GZ expand to named folders. Variants download only — not stored in
            SQLite.
          </p>
        </div>
        <div v-else class="workspace-scroll">
          <div class="muted tiny">Members</div>
          <ul class="hist-list">
            <li
              v-for="m in activePackage.members"
              :key="m.id"
              class="clickable"
              :class="{ active: packageMemberPath === m.path }"
              @click="selectPackageMember(m.path)"
            >
              <span class="k">{{ m.path }}</span>
              <span class="v">
                {{ m.kind === 'text' ? m.format : m.nestedArchiveFormat }}
                <template v-if="m.kind === 'text'">
                  · {{ m.verified ? 'verified' : 'review' }}
                </template>
              </span>
            </li>
          </ul>
          <div
            v-if="activePackage.members?.find((m) => m.path === packageMemberPath)?.kind === 'text'"
            class="row-actions"
            style="margin: 0.5rem 0.75rem; display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center"
          >
            <label class="chk">
              <input
                type="checkbox"
                :checked="
                  !!activePackage.members?.find((m) => m.path === packageMemberPath)?.verified
                "
                @change="verifyPackageMember($event.target.checked)"
              />
              Member verified
            </label>
            <button class="btn btn-ghost" type="button" @click="editPackageMemberSchema">
              Edit member schema
            </button>
          </div>
          <div
            v-if="(activePackage.skipped || []).length"
            class="muted tiny"
            style="margin: 0.25rem 0.75rem"
          >
            Skipped on import ({{ activePackage.skipped.length }}):
            {{ activePackage.skipped.slice(0, 8).join(', ')
            }}{{ activePackage.skipped.length > 8 ? '…' : '' }}
          </div>
          <pre class="code-mini" style="margin: 0.5rem 0.75rem; flex: 1">{{
            packagePreview || '// select a member'
          }}</pre>
          <div
            v-if="
              packageMemberPath &&
              activePackage.members?.find((m) => m.path === packageMemberPath)?.kind === 'text'
            "
            class="field-modes"
            style="padding: 0.5rem 0.75rem"
          >
            <div class="muted tiny">
              Per-field modes for <span class="mono">{{ packageMemberPath }}</span>
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
                <option value="same">same</option>
                <option value="unique">unique</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- Delivery workspace -->
      <section v-else-if="workspaceMode === 'delivery'" class="center panel workspace-panel">
        <div class="center-head">
          <strong>Plan a delivery job</strong>
        </div>
        <div class="workspace-scroll gen" style="max-width: 520px">
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
              <ul class="schema-list" style="max-width: 520px">
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
            </div>
          </template>
          <template v-else-if="workspaceMode === 'datapacks'">
            <div class="empty-workspace" style="padding: 1rem; max-width: 560px">
              <template v-if="themeEditor">
                <h3 style="margin-top: 0">Add values · {{ themeEditor.theme?.name }}</h3>
                <p class="muted tiny">
                  Category must match the schema field’s <strong>Theme category</strong>.
                </p>
                <label class="muted tiny">
                  Category
                  <input v-model="themeEditor.category" class="input mono" list="theme-cat-list" />
                  <datalist id="theme-cat-list">
                    <option v-for="c in COMMON_THEME_CATS" :key="c" :value="c" />
                    <option v-for="c in themeCategories" :key="'t-' + c" :value="c" />
                  </datalist>
                </label>
                <label class="muted tiny">
                  Values (one per line or comma-separated)
                  <textarea v-model="themeEditor.bulk" class="input mono" rows="8" />
                </label>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem">
                  <button type="button" class="btn btn-primary" @click="submitThemeValuesEditor">
                    Save values
                  </button>
                  <button type="button" class="btn btn-ghost" @click="themeEditor = null">
                    Cancel
                  </button>
                </div>
              </template>
              <template v-else>
                <h3 style="margin-top: 0">Data packs</h3>
                <p>
                  <strong>Themes</strong> = genre of data.
                  <strong>Field values</strong> = curated lists on schema paths. Both in SQLite.
                  Fill order: enums → theme → custom → history → synth.
                </p>
                <p class="muted tiny">
                  Local search on the left is enough — Elastic is overkill here. Keep lists per
                  field key when they grow large.
                </p>
                <p class="muted tiny">
                  Active blend:
                  {{
                    themeBlend.length
                      ? themeBlend.map((b) => b.name || b.themeId).join(' + ')
                      : 'none'
                  }}
                </p>
              </template>
            </div>
          </template>
          <template v-else-if="workspaceMode === 'templates'">
            <div class="empty-workspace" style="padding: 1rem">
              <p>Save and load schema templates from the left list.</p>
            </div>
          </template>
          <template v-else-if="workspaceMode === 'archive'">
            <pre class="code" style="margin: 0; flex: 1; width: 100%">{{
              archivePreview || '// Open an archive and select an entry'
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
        aria-label="Resize tools panel"
        title="Drag to resize tools"
        @pointerdown="onResizePointerDown('preview', $event)"
      />

      <aside v-if="showRightPanel" class="preview panel">
        <div class="preview-bar">
          <span class="muted tiny">Tools</span>
          <button
            type="button"
            class="btn btn-ghost tiny-btn"
            title="Hide tools panel"
            @click="togglePreviewPanel"
          >
            Hide
          </button>
        </div>
        <template v-if="workspaceMode === 'schema'">
        <div class="ptabs">
          <button :class="{ on: tab === 'schema' }" @click="tab = 'schema'">Schema</button>
          <button :class="{ on: tab === 'generated' }" @click="tab = 'generated'">
            Auto-Gen
          </button>
          <button :class="{ on: tab === 'generate' }" @click="tab = 'generate'">
            Generate
          </button>
        </div>

        <div v-if="tab === 'generate'" class="gen">
          <label>
            Records
            <input
              v-model.number="recordCount"
              type="number"
              min="1"
              max="1000000"
              class="input"
            />
          </label>
          <label>
            Seed (empty = random)
            <input v-model="seed" class="input" placeholder="random" />
          </label>

          <div class="output-mode">
            <div class="label">Output mode</div>
            <label class="chk radio">
              <input v-model="outputMode" type="radio" value="one-file" />
              <span>
                <strong>All records in one file</strong>
                <span class="muted tiny block">
                  One export (XML / CSV / TXT). Use stream for large CSV/TXT counts.
                </span>
              </span>
            </label>
            <label class="chk radio">
              <input v-model="outputMode" type="radio" value="per-file" />
              <span>
                <strong>One file per record</strong>
                <span class="muted tiny block">
                  Each record becomes its own file. Multi-file bundles download as
                  <strong>tar.gz</strong> (space-optimized); a single file uses ZIP. Names use
                  Settings → File name pattern.
                </span>
              </span>
            </label>
            <p v-if="outputMode === 'per-file'" class="pattern-hint mono muted tiny">
              Pattern: {{ fileNamePattern }}
            </p>
          </div>

          <label class="chk">
            <input v-model="ciMode" type="checkbox" />
            CI mode (ignore live history)
          </label>
          <label class="chk">
            <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
            Use data themes
            <span v-if="themeBlend.length" class="muted tiny">
              ({{ themeBlend.map((b) => b.name || b.themeId.slice(0, 6)).join(' + ') }})
            </span>
          </label>
          <label v-if="outputMode === 'one-file' && streamSupported" class="chk">
            <input v-model="streamMode" type="checkbox" />
            Stream generate (large counts → one file)
          </label>
          <label
            v-if="isTabularFormat && outputMode === 'one-file'"
            class="chk"
          >
            <input v-model="csvMultiRow" type="checkbox" />
            Multiple data rows ({{ format === 'csv' ? 'CSV' : 'TXT' }})
          </label>
          <label
            v-if="format === 'csv' && outputMode === 'one-file' && csvMultiRow"
            class="chk gold"
          >
            <input v-model="csvTieOn" type="checkbox" />
            Tie keys across rows (lock schema samples)
          </label>
          <label v-if="format === 'csv'">
            CSV layout
            <select v-model="csvLayoutMode" class="input">
              <option value="single-header">Single header</option>
              <option value="entity-sections">Entity sections</option>
              <option value="per-key-sections">Per-key sections</option>
            </select>
          </label>
          <label v-if="isTabularFormat">
            Flatten delimiter
            <input v-model="csvDelim" class="input" />
          </label>
          <label v-if="isTabularFormat" class="chk">
            <input v-model="csvNestedAsJson" type="checkbox" />
            Nested as JSON
          </label>
          <p v-if="format === 'txt'" class="muted tiny">
            TXT export: tab-separated header line, then one value line per record.
          </p>
          <p v-if="format === 'xml'" class="muted tiny">
            Root / record tags are editable next to the schema name (saved with the schema).
          </p>
          <label v-if="format === 'xml'" class="chk">
            <input
              v-model="xmlSelfClosing"
              type="checkbox"
              @change="persistXmlSettings"
            />
            Self-closing empty tags
            <span class="muted tiny" style="margin-left: 0.25rem"
              >(&lt;tag/&gt; vs &lt;tag&gt;&lt;/tag&gt;)</span
            >
          </label>
          <button class="btn btn-primary full" :disabled="generating" @click="generate">
            {{ generateButtonLabel }}
          </button>
          <button
            v-if="outputMode === 'one-file'"
            class="btn btn-ghost full"
            :disabled="!previewText"
            @click="downloadPreview"
          >
            Download preview
          </button>
          <button
            v-if="outputMode === 'one-file'"
            class="btn btn-ghost full"
            :disabled="!lastGenerated?.records"
            @click="downloadArchiveMulti"
          >
            Multi-format archive (XML+CSV+TXT)
          </button>
          <div v-if="lastReport" class="report muted tiny">
            history hit {{ lastReport.historyHitRate }}% · theme
            {{ lastReport.themeHits ?? 0 }} · null {{ lastReport.nullRatePct }}% · synth
            {{ lastReport.synthesized }} · enum {{ lastReport.enumHits }} · ms
            {{ lastReport.ms }}
          </div>
          <div v-else-if="lastGenerated?.perFile" class="report muted tiny">
            Per-file run · {{ lastGenerated.written }} file(s) in
            {{ lastGenerated.archiveFormat || 'archive' }} · seed
            {{ lastGenerated.seed }}
          </div>
        </div>

        <pre v-else class="code">{{ previewText || '// Generate or switch tabs to preview' }}</pre>

        </template>

        <template v-else-if="workspaceMode === 'package'">
          <div class="ptabs">
            <button class="on">Generate</button>
          </div>
          <div class="gen">
            <div v-if="!activePackage" class="muted tiny">Select a package first.</div>
            <template v-else>
              <label>
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
              <label>
                Seed (empty = random)
                <input v-model="seed" class="input" placeholder="random" />
              </label>
              <label class="chk">
                <input v-model="ciMode" type="checkbox" />
                CI mode (ignore live history / themes / custom)
              </label>
              <label class="chk">
                <input v-model="useDataThemes" type="checkbox" @change="persistDataThemes" />
                Use data themes
                <span v-if="themeBlend.length" class="muted tiny">
                  ({{ themeBlend.map((b) => b.name || b.themeId.slice(0, 6)).join(' + ') }})
                </span>
              </label>
              <label class="chk">
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
              <label class="muted tiny">
                Default field mode
                <select v-model="packageDefaultMode" class="input">
                  <option value="random">Random</option>
                  <option value="same">Same (sample lock)</option>
                  <option value="unique">Unique across variants</option>
                </select>
              </label>
              <button
                class="btn btn-primary full"
                :disabled="packageWorking"
                :aria-busy="packageWorking"
                @click="runPackageGenerate"
              >
                {{ packageWorking ? 'Working…' : 'Generate' }}
              </button>
              <p class="muted tiny">
                Multi-variant downloads use <strong>tar.gz</strong>; a single variant uses ZIP.
                Package generate uses <strong>member schemas</strong> (Edit member schema) — not the
                Schemas “preview” umbrella.
              </p>
            </template>
          </div>
        </template>

        <template v-else-if="workspaceMode === 'delivery'">
          <div class="ptabs"><button class="on">Jobs</button></div>
          <div class="gen">
            <p class="muted tiny">
              Create a plan in the center panel, then run chunks from the left job list.
            </p>
            <p class="muted tiny">
              Artifacts land under <span class="mono">data/exports/delivery/</span>.
            </p>
            <button class="btn btn-ghost full" @click="refreshDeliveryJobs">Refresh</button>
          </div>
        </template>

        <template v-else-if="workspaceMode === 'archive'">
          <div class="ptabs"><button class="on">Entry</button></div>
          <pre class="code">{{ archivePreview || '// Select an entry from the list' }}</pre>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  flex-wrap: wrap;
  gap: 0.4rem 0.6rem;
}
.xml-tag-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
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
  gap: 0.25rem;
  align-items: center;
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
.empty-workspace {
  padding: 1.25rem 1rem;
  color: var(--text);
  line-height: 1.45;
}
.empty-workspace p {
  margin: 0 0 0.5rem;
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
.tabs,
.ptabs {
  display: flex;
  gap: 2px;
  padding: 0.4rem;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
/* Workspace nav: grid that reflows with sidebar width (never crushes words) */
.workspace-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.3rem;
  padding: 0.45rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
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
.workspace-tabs button .tab-full,
.workspace-tabs button .tab-short,
.workspace-tabs button .tab-code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
/* Label density driven by live side width */
.side.nav-comfortable .workspace-tabs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.side.nav-comfortable .tab-code,
.side.nav-comfortable .tab-short {
  display: none;
}
.side.nav-comfortable .tab-full {
  display: inline;
}
.side.nav-cozy .workspace-tabs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.side.nav-compact .workspace-tabs {
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.workspace-tabs button:hover:not(.on) {
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  color: var(--text);
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
  min-width: 9.5rem;
  max-width: 16rem;
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
  min-width: 7rem;
  font-size: 12px;
}
.schema-table .col-actions {
  display: flex;
  gap: 0.2rem;
  margin-top: 0.3rem;
}
.schema-table .add-col-cell {
  min-width: 4.5rem;
  max-width: 5rem;
  vertical-align: middle;
  background: transparent;
}
.schema-table .value-row td {
  background: var(--surface);
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
.props-hint {
  margin: 0 0 0.5rem;
  padding: 0 0.15rem;
  flex-shrink: 0;
}
.props-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  margin-top: 0.35rem;
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.props-grid label {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 7rem;
}
.props-grid label.wide {
  min-width: 100%;
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
.output-mode {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  background: var(--surface-2, color-mix(in srgb, var(--surface) 80%, #000));
}
.output-mode .label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.output-mode .radio {
  align-items: flex-start !important;
}
.output-mode .radio input {
  margin-top: 0.2rem;
}
.output-mode .block {
  display: block;
  margin-top: 0.15rem;
  line-height: 1.35;
}
.pattern-hint {
  margin: 0;
  padding: 0.3rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg, #0b0d10);
  word-break: break-all;
}
.gen {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow: auto;
}
.gen label {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
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
