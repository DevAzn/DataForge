import { create } from 'zustand'
import type {
  AppSettings,
  AppStatus,
  ArchiveExportRequest,
  EncryptionSettings,
  ExportFormat,
  GenerateProgress,
  GenerateResult,
  SchemaDoc,
  SchemaRow,
  Template,
  ThemeColors,
  ValueHistoryEntry
} from '@shared/types'
import {
  DEFAULT_ENCRYPTION,
  DEFAULT_SETTINGS,
  MAX_GENERATE_RECORDS,
  MIN_GENERATE_RECORDS
} from '@shared/types'
import { applyThemeTokens } from '../theme/applyTheme'

function remapRowIds(rows: SchemaRow[]): SchemaRow[] {
  return rows.map((r) => ({
    ...r,
    id: newId(),
    children: remapRowIds(r.children)
  }))
}

function newId(): string {
  return crypto.randomUUID()
}

function createEmptyRow(sortOrder = 0): SchemaRow {
  return {
    id: newId(),
    key: 'field',
    kind: 'value',
    sampleValue: '',
    isPrimary: false,
    isUnique: false,
    children: [],
    sortOrder
  }
}

function createEmptySchema(name = 'Untitled schema'): SchemaDoc {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name,
    root: [createEmptyRow(0)],
    createdAt: now,
    updatedAt: now
  }
}

export type DropPosition = 'before' | 'after' | 'inside'

interface AppState {
  ready: boolean
  status: AppStatus | null
  settings: AppSettings
  schemas: SchemaDoc[]
  templates: Template[]
  history: Array<ValueHistoryEntry & { categoryName: string }>
  activeSchema: SchemaDoc | null
  selectedRowId: string | null
  sidebarTab: 'schemas' | 'templates' | 'history' | 'settings'
  error: string | null
  recordCount: number
  /** Optional generation seed (empty string = random each run) */
  generateSeed: string
  /** When true, reuse seed field after generate; when false, keep empty for random next run */
  lockSeed: boolean
  /** CI mode: ignore live history for reproducible output */
  ciMode: boolean
  /** When CI is on, still write generated values into history if true */
  ciRecordHistory: boolean
  /** Write .manifest.json next to export / stream output */
  writeManifest: boolean
  generating: boolean
  streamGenerate: boolean
  /** Format selected in preview panel (used by stream generate) */
  previewFormat: ExportFormat
  generateProgress: GenerateProgress | null
  lastGenerated: GenerateResult | null
  lastStreamPath: string | null
  clearError: () => void
  setStreamGenerate: (on: boolean) => void
  setPreviewFormat: (f: ExportFormat) => void
  setGenerateSeed: (seed: string) => void
  setLockSeed: (on: boolean) => void
  setCiMode: (on: boolean) => void
  setCiRecordHistory: (on: boolean) => void
  setWriteManifest: (on: boolean) => void
  /**
   * Pick a *.manifest.json, apply seed/CI/count to generate settings.
   * Returns preview (hash match + warnings) or null if canceled.
   */
  loadManifestForReplay: () => Promise<import('@shared/types').ManifestApplyPreview | null>

  init: () => Promise<void>
  refreshStatus: () => Promise<void>
  refreshHistory: () => Promise<void>
  setSidebarTab: (tab: AppState['sidebarTab']) => void
  setThemeMode: (mode: AppSettings['themeMode']) => Promise<void>
  setEncryption: (encryption: EncryptionSettings) => Promise<void>
  setCustomColors: (colors: ThemeColors | null) => Promise<void>
  patchSettings: (partial: Partial<AppSettings>) => Promise<void>
  newSchema: () => void
  selectSchema: (id: string) => Promise<void>
  deleteActiveSchema: () => Promise<void>
  /** Load inferred schema from uploaded/picked file into the builder */
  importSchemaFromFile: (fileName: string, content: string) => Promise<void>
  importSchemaBrowse: () => Promise<void>
  updateActiveSchema: (patch: Partial<SchemaDoc>) => void
  saveActiveSchema: () => Promise<void>
  saveAsTemplate: (name?: string, description?: string) => Promise<void>
  loadTemplate: (id: string) => Promise<void>
  duplicateTemplate: (id: string) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  refreshTemplates: () => Promise<void>
  /** Add a root-level row (end of root list). */
  addRootRow: () => void
  /** Add a sibling after the given row (same parent). */
  addSiblingRow: (siblingId: string) => void
  /** Add a nested child under the given row. */
  addChildRow: (parentId: string) => void
  /** @deprecated use addRootRow / addSiblingRow / addChildRow */
  addRow: (parentId?: string | null) => void
  selectRow: (id: string | null) => void
  updateRow: (id: string, patch: Partial<SchemaRow>) => void
  deleteRow: (id: string) => void
  /** Drag-and-drop: move active row before/after/inside over row. */
  moveRow: (activeId: string, overId: string, position: DropPosition) => void
  setRecordCount: (n: number) => void
  generate: () => Promise<GenerateResult | null>
  /** Export arbitrary payload (schema sample or generated records). */
  exportData: (
    format: ExportFormat,
    data: unknown,
    fileName?: string,
    opts?: { source?: 'generated' | 'schema' | 'definition' }
  ) => Promise<string | null>
  exportArchive: (request: ArchiveExportRequest) => Promise<string | null>
  exportBackup: () => Promise<string | null>
  importBackup: () => Promise<number | null>
}

function applyTheme(mode: AppSettings['themeMode'], custom?: ThemeColors | null): void {
  applyThemeTokens(mode, custom)
}

function reindex(rows: SchemaRow[]): SchemaRow[] {
  return rows.map((row, i) => ({
    ...row,
    sortOrder: i,
    children: reindex(row.children)
  }))
}

function findAndUpdate(
  rows: SchemaRow[],
  id: string,
  patch: Partial<SchemaRow>
): SchemaRow[] {
  return rows.map((row) => {
    if (row.id === id) return { ...row, ...patch }
    return { ...row, children: findAndUpdate(row.children, id, patch) }
  })
}

function findAndDelete(rows: SchemaRow[], id: string): SchemaRow[] {
  return rows
    .filter((row) => row.id !== id)
    .map((row) => ({ ...row, children: findAndDelete(row.children, id) }))
}

function addChild(
  rows: SchemaRow[],
  parentId: string | null | undefined,
  child: SchemaRow
): SchemaRow[] {
  if (!parentId) {
    return reindex([...rows, { ...child, sortOrder: rows.length }])
  }
  return reindex(
    rows.map((row) => {
      if (row.id === parentId) {
        const children = [...row.children, { ...child, sortOrder: row.children.length }]
        return {
          ...row,
          kind: row.kind === 'value' ? 'object' : row.kind,
          children
        }
      }
      return { ...row, children: addChild(row.children, parentId, child) }
    })
  )
}

/** Insert a new row immediately after `siblingId` at the same level. */
function insertSiblingAfter(
  rows: SchemaRow[],
  siblingId: string,
  newRow: SchemaRow
): SchemaRow[] | null {
  const idx = rows.findIndex((r) => r.id === siblingId)
  if (idx !== -1) {
    const next = [...rows]
    next.splice(idx + 1, 0, newRow)
    return reindex(next)
  }
  for (let i = 0; i < rows.length; i++) {
    const childResult = insertSiblingAfter(rows[i].children, siblingId, newRow)
    if (childResult) {
      const next = [...rows]
      next[i] = { ...rows[i], children: childResult }
      return reindex(next)
    }
  }
  return null
}

function extractRow(
  rows: SchemaRow[],
  id: string
): { tree: SchemaRow[]; extracted: SchemaRow | null } {
  let extracted: SchemaRow | null = null
  const tree = rows
    .filter((row) => {
      if (row.id === id) {
        extracted = row
        return false
      }
      return true
    })
    .map((row) => {
      if (extracted) return row
      const child = extractRow(row.children, id)
      if (child.extracted) {
        extracted = child.extracted
        return { ...row, children: child.tree }
      }
      return row
    })
  return { tree, extracted }
}

function isDescendant(row: SchemaRow, id: string): boolean {
  for (const child of row.children) {
    if (child.id === id || isDescendant(child, id)) return true
  }
  return false
}

function insertRelative(
  rows: SchemaRow[],
  overId: string,
  item: SchemaRow,
  position: DropPosition
): SchemaRow[] | null {
  if (position === 'inside') {
    let found = false
    const mapped = rows.map((row) => {
      if (row.id === overId) {
        found = true
        return {
          ...row,
          kind: row.kind === 'value' ? 'object' : row.kind,
          children: reindex([...row.children, item])
        }
      }
      const children = insertRelative(row.children, overId, item, position)
      if (children) {
        found = true
        return { ...row, children }
      }
      return row
    })
    return found ? reindex(mapped) : null
  }

  const idx = rows.findIndex((r) => r.id === overId)
  if (idx !== -1) {
    const next = [...rows]
    next.splice(position === 'before' ? idx : idx + 1, 0, item)
    return reindex(next)
  }

  for (let i = 0; i < rows.length; i++) {
    const children = insertRelative(rows[i].children, overId, item, position)
    if (children) {
      const next = [...rows]
      next[i] = { ...rows[i], children }
      return reindex(next)
    }
  }
  return null
}

function moveRowInTree(
  root: SchemaRow[],
  activeId: string,
  overId: string,
  position: DropPosition
): SchemaRow[] {
  if (activeId === overId && position !== 'inside') return root

  const { tree: without, extracted } = extractRow(root, activeId)
  if (!extracted) return root
  if (isDescendant(extracted, overId)) return root

  const inserted = insertRelative(without, overId, extracted, position)
  return inserted ?? root
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  status: null,
  settings: { ...DEFAULT_SETTINGS, encryption: { ...DEFAULT_ENCRYPTION } },
  schemas: [],
  templates: [],
  history: [],
  activeSchema: null,
  selectedRowId: null,
  sidebarTab: 'schemas',
  error: null,
  recordCount: DEFAULT_SETTINGS.defaultRecordCount,
  generateSeed: '',
  lockSeed: false,
  ciMode: false,
  ciRecordHistory: false,
  writeManifest: false,
  generating: false,
  streamGenerate: false,
  previewFormat: DEFAULT_SETTINGS.defaultExportFormat,
  generateProgress: null,
  lastGenerated: null,
  lastStreamPath: null,
  clearError: () => set({ error: null }),
  setStreamGenerate: (on) => set({ streamGenerate: on }),
  setPreviewFormat: (f) => set({ previewFormat: f }),
  setGenerateSeed: (seed) => set({ generateSeed: seed }),
  setLockSeed: (on) => set({ lockSeed: on }),
  setCiMode: (on) => set({ ciMode: on }),
  setCiRecordHistory: (on) => set({ ciRecordHistory: on }),
  setWriteManifest: (on) => set({ writeManifest: on }),

  loadManifestForReplay: async () => {
    if (typeof window.dataforge?.pickManifest !== 'function') {
      set({
        error: 'Manifest API unavailable — fully restart the app (npm run dev)'
      })
      return null
    }
    try {
      const picked = await window.dataforge.pickManifest()
      if (picked.canceled) return null
      if (picked.error || !picked.manifest) {
        set({ error: picked.error || 'Failed to load manifest' })
        return null
      }
      const preview = await window.dataforge.previewManifest({
        manifest: picked.manifest,
        schema: get().activeSchema,
        filePath: picked.filePath
      })
      const m = preview.manifest
      set({
        generateSeed: String(m.seed >>> 0),
        lockSeed: true,
        ciMode: Boolean(m.ciMode),
        recordCount: Math.min(
          Math.max(Math.floor(m.recordCount) || 1, MIN_GENERATE_RECORDS),
          MAX_GENERATE_RECORDS
        ),
        writeManifest: true,
        error: null
      })
      return preview
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Failed to load manifest'
      })
      return null
    }
  },

  init: async () => {
    try {
      const [status, settings, schemas, templates, history] = await Promise.all([
        window.dataforge.getStatus(),
        window.dataforge.getSettings(),
        window.dataforge.listSchemas(),
        window.dataforge.listTemplates(),
        window.dataforge.listHistory(80)
      ])
      applyTheme(settings.themeMode, settings.customColors)
      set({
        ready: true,
        status,
        settings,
        schemas,
        templates,
        history,
        recordCount: settings.defaultRecordCount || 10,
        activeSchema: schemas[0] ?? createEmptySchema('My first schema'),
        error: null
      })
    } catch (e) {
      set({
        ready: true,
        error: e instanceof Error ? e.message : 'Failed to initialize',
        activeSchema: createEmptySchema()
      })
      applyTheme('dark')
    }
  },

  refreshStatus: async () => {
    try {
      const status = await window.dataforge.getStatus()
      set({ status })
    } catch {
      /* ignore */
    }
  },

  refreshHistory: async () => {
    try {
      const history = await window.dataforge.listHistory(80)
      set({ history })
    } catch {
      /* ignore */
    }
  },

  setSidebarTab: (tab) => {
    set({ sidebarTab: tab })
    if (tab === 'history') void get().refreshHistory()
    if (tab === 'templates') void get().refreshTemplates()
  },

  setThemeMode: async (mode) => {
    const settings = { ...get().settings, themeMode: mode }
    applyTheme(mode, settings.customColors)
    set({ settings })
    try {
      const saved = await window.dataforge.setSettings(settings)
      set({ settings: saved })
      applyTheme(saved.themeMode, saved.customColors)
    } catch {
      /* offline UI still updates */
    }
  },

  setEncryption: async (encryption) => {
    const settings = {
      ...get().settings,
      encryption: { ...DEFAULT_ENCRYPTION, ...encryption }
    }
    set({ settings })
    const saved = await window.dataforge.setSettings(settings)
    set({ settings: saved })
  },

  patchSettings: async (partial) => {
    const settings = { ...get().settings, ...partial }
    set({ settings })
    const saved = await window.dataforge.setSettings(settings)
    set({ settings: saved })
  },

  setCustomColors: async (colors) => {
    const settings: AppSettings = {
      ...get().settings,
      customColors: colors ?? undefined
    }
    if (!colors) {
      delete settings.customColors
    }
    applyTheme(settings.themeMode, colors)
    set({ settings })
    const saved = await window.dataforge.setSettings({
      ...settings,
      customColors: colors || undefined
    })
    set({ settings: saved })
    applyTheme(saved.themeMode, saved.customColors)
  },

  refreshTemplates: async () => {
    try {
      const templates = await window.dataforge.listTemplates()
      set({ templates })
    } catch {
      /* ignore */
    }
  },

  newSchema: () => {
    const doc = createEmptySchema(`Schema ${get().schemas.length + 1}`)
    set({ activeSchema: doc, selectedRowId: doc.root[0]?.id ?? null })
  },

  selectSchema: async (id) => {
    try {
      let doc =
        typeof window.dataforge.touchSchemaOpened === 'function'
          ? await window.dataforge.touchSchemaOpened(id)
          : null
      if (!doc) {
        doc = await window.dataforge.getSchema(id)
      }
      if (doc) {
        const schemas = await window.dataforge.listSchemas()
        set({
          schemas,
          activeSchema: doc,
          selectedRowId: doc.root[0]?.id ?? null
        })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load schema' })
    }
  },

  deleteActiveSchema: async () => {
    const active = get().activeSchema
    if (!active) return
    try {
      // Only delete from DB if it was saved (exists in list)
      const known = get().schemas.some((s) => s.id === active.id)
      if (known) {
        await window.dataforge.deleteSchema(active.id)
      }
      const schemas = await window.dataforge.listSchemas()
      const next = schemas[0] ?? createEmptySchema('My first schema')
      set({
        schemas,
        activeSchema: next,
        selectedRowId: next.root[0]?.id ?? null,
        lastGenerated: null
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to delete schema' })
    }
  },

  importSchemaFromFile: async (fileName, content) => {
    try {
      if (typeof window.dataforge.importSchemaFromContent !== 'function') {
        throw new Error('Import API unavailable — fully restart the app (npm run dev)')
      }
      // Soft client-side size check (main enforces MAX_IMPORT_BYTES too)
      if (typeof content === 'string' && content.length > 30_000_000) {
        throw new Error('Import file is too large (max ~25 MB).')
      }
      const { schema, format, recordHint } = await window.dataforge.importSchemaFromContent(
        fileName,
        content
      )
      // Schema is auto-saved in main process; refresh list
      const schemas = await window.dataforge.listSchemas()
      set({
        schemas,
        activeSchema: schema,
        selectedRowId: schema.root[0]?.id ?? null,
        lastGenerated: null,
        sidebarTab: 'schemas',
        error: null,
        previewFormat: format
      })
      if (recordHint > 0) {
        get().setRecordCount(Math.min(Math.max(recordHint, 1), 10_000))
      }
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Failed to import schema from file'
      })
    }
  },

  importSchemaBrowse: async () => {
    try {
      if (typeof window.dataforge.importSchemaPick !== 'function') {
        throw new Error('Import API unavailable — fully restart the app (npm run dev)')
      }
      const result = await window.dataforge.importSchemaPick()
      if (result.canceled) return
      const schemas = await window.dataforge.listSchemas()
      set({
        schemas,
        activeSchema: result.schema,
        selectedRowId: result.schema.root[0]?.id ?? null,
        lastGenerated: null,
        sidebarTab: 'schemas',
        error: null,
        previewFormat: result.format
      })
      if (result.recordHint > 0) {
        get().setRecordCount(Math.min(result.recordHint, 10_000))
      }
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Failed to import schema from file'
      })
    }
  },

  updateActiveSchema: (patch) => {
    const active = get().activeSchema
    if (!active) return
    set({ activeSchema: { ...active, ...patch } })
  },

  saveActiveSchema: async () => {
    const active = get().activeSchema
    if (!active) return
    const saveId = active.id
    const treeSnapshot = JSON.stringify(active.root)
    try {
      const saved = await window.dataforge.saveSchema({
        ...active,
        lastOpenedAt: new Date().toISOString()
      })
      const [schemas, history, status] = await Promise.all([
        window.dataforge.listSchemas(),
        window.dataforge.listHistory(80),
        window.dataforge.getStatus()
      ])
      const current = get().activeSchema
      // Don't clobber edits made while the save was in flight
      if (!current || current.id !== saveId) {
        set({ schemas, history, status })
        return
      }
      const treeChangedDuringSave = JSON.stringify(current.root) !== treeSnapshot
      set({
        activeSchema: treeChangedDuringSave
          ? {
              ...current,
              updatedAt: saved.updatedAt,
              createdAt: saved.createdAt,
              lastOpenedAt: saved.lastOpenedAt
            }
          : saved,
        schemas,
        history,
        status
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save schema' })
    }
  },

  saveAsTemplate: async (name, description) => {
    const active = get().activeSchema
    if (!active) return
    const now = new Date().toISOString()
    const t: Template = {
      id: newId(),
      name: name?.trim() || `${active.name} template`,
      description,
      schemaJson: JSON.stringify({ name: active.name, root: active.root }),
      createdAt: now,
      updatedAt: now
    }
    await window.dataforge.saveTemplate(t)
    await get().refreshTemplates()
  },

  loadTemplate: async (id) => {
    const t = get().templates.find((x) => x.id === id)
    let template = t
    if (!template) {
      const list = await window.dataforge.listTemplates()
      template = list.find((x) => x.id === id)
      set({ templates: list })
    }
    if (!template) {
      set({ error: 'Template not found' })
      return
    }
    try {
      const parsed = JSON.parse(template.schemaJson) as {
        name?: string
        root?: SchemaRow[]
      }
      const root = remapRowIds(parsed.root ?? [])
      const now = new Date().toISOString()
      const doc: SchemaDoc = {
        id: newId(),
        name: parsed.name || template.name,
        description: template.description,
        root: root.length ? root : [createEmptyRow(0)],
        createdAt: now,
        updatedAt: now
      }
      set({
        activeSchema: doc,
        selectedRowId: doc.root[0]?.id ?? null,
        sidebarTab: 'schemas',
        lastGenerated: null
      })
    } catch {
      set({ error: 'Failed to parse template' })
    }
  },

  duplicateTemplate: async (id) => {
    const list = await window.dataforge.listTemplates()
    const t = list.find((x) => x.id === id)
    if (!t) return
    const now = new Date().toISOString()
    await window.dataforge.saveTemplate({
      ...t,
      id: newId(),
      name: `${t.name} (copy)`,
      createdAt: now,
      updatedAt: now
    })
    await get().refreshTemplates()
  },

  deleteTemplate: async (id) => {
    await window.dataforge.deleteTemplate(id)
    await get().refreshTemplates()
  },

  addRootRow: () => {
    const active = get().activeSchema
    if (!active) return
    const row = createEmptyRow()
    set({
      activeSchema: { ...active, root: addChild(active.root, null, row) },
      selectedRowId: row.id
    })
  },

  addSiblingRow: (siblingId) => {
    const active = get().activeSchema
    if (!active) return
    const row = createEmptyRow()
    const root = insertSiblingAfter(active.root, siblingId, row)
    if (!root) return
    set({
      activeSchema: { ...active, root },
      selectedRowId: row.id
    })
  },

  addChildRow: (parentId) => {
    const active = get().activeSchema
    if (!active) return
    const row = createEmptyRow()
    set({
      activeSchema: { ...active, root: addChild(active.root, parentId, row) },
      selectedRowId: row.id
    })
  },

  addRow: (parentId) => {
    if (parentId) get().addChildRow(parentId)
    else get().addRootRow()
  },

  selectRow: (id) => set({ selectedRowId: id }),

  updateRow: (id, patch) => {
    const active = get().activeSchema
    if (!active) return
    set({
      activeSchema: {
        ...active,
        root: findAndUpdate(active.root, id, patch)
      }
    })
  },

  deleteRow: (id) => {
    const active = get().activeSchema
    if (!active) return
    const root = reindex(findAndDelete(active.root, id))
    set({
      activeSchema: { ...active, root: root.length ? root : [createEmptyRow(0)] },
      selectedRowId: get().selectedRowId === id ? null : get().selectedRowId
    })
  },

  moveRow: (activeId, overId, position) => {
    const active = get().activeSchema
    if (!active) return
    const root = moveRowInTree(active.root, activeId, overId, position)
    set({ activeSchema: { ...active, root } })
  },

  setRecordCount: (n) => {
    const recordCount = Math.min(
      Math.max(Math.floor(n) || MIN_GENERATE_RECORDS, MIN_GENERATE_RECORDS),
      MAX_GENERATE_RECORDS
    )
    set({ recordCount })
  },

  generate: async () => {
    const active = get().activeSchema
    if (!active) return null
    if (get().generating) return null

    const stream = get().streamGenerate
    const streamFormat = get().previewFormat
    if (stream && streamFormat !== 'csv' && streamFormat !== 'json' && streamFormat !== 'txt') {
      set({
        generating: false,
        generateProgress: null,
        error:
          'Stream generate supports CSV, JSON (NDJSON), or TXT only. Switch format or turn off stream.'
      })
      return null
    }

    const seedRaw = get().generateSeed.trim()
    const seedParsed = seedRaw === '' ? undefined : Number(seedRaw)
    const seed =
      seedParsed !== undefined && Number.isFinite(seedParsed) ? seedParsed >>> 0 : undefined
    const ciMode = get().ciMode
    const writeManifest = get().writeManifest
    // CI: skip history by default; optional ciRecordHistory opt-in
    const recordHistory = ciMode ? get().ciRecordHistory : true

    set({
      generating: true,
      error: null,
      lastStreamPath: null,
      generateProgress: {
        phase: 'generating',
        current: 0,
        total: get().recordCount,
        percent: 0,
        message: stream ? 'Choose output file…' : 'Starting…'
      }
    })
    const unsub =
      typeof window.dataforge.onGenerateProgress === 'function'
        ? window.dataforge.onGenerateProgress((p) => {
            if (get().generating) set({ generateProgress: p })
          })
        : () => undefined
    try {
      let result: GenerateResult
      if (stream) {
        if (typeof window.dataforge.generateStream !== 'function') {
          throw new Error(
            'Stream generate API unavailable — fully restart the app (npm run dev)'
          )
        }
        const s = get().settings
        if (s.csvLayoutMode && s.csvLayoutMode !== 'single-header' && streamFormat === 'csv') {
          throw new Error(
            'Stream CSV requires “Single header” layout. Change CSV header layout or turn off stream.'
          )
        }
        result = await window.dataforge.generateStream({
          schema: active,
          recordCount: get().recordCount,
          recordHistory,
          seed,
          ciMode,
          writeManifest,
          format: streamFormat,
          fileName: active.name,
          csvFlattenDelimiter: s.csvFlattenDelimiter,
          csvNestedAsJson: s.csvNestedAsJson,
          csvLayoutMode: 'single-header',
          previewSampleSize: 25
        })
        if (result.canceled) {
          set({
            generating: false,
            generateProgress: null
          })
          return null
        }
      } else {
        result = await window.dataforge.generate({
          schema: active,
          recordCount: get().recordCount,
          recordHistory,
          seed,
          ciMode
        })
      }

      // Only pin seed in the input when lock is on; otherwise leave empty for random next run
      if (typeof result.seed === 'number' && get().lockSeed) {
        set({ generateSeed: String(result.seed) })
      }

      let status = get().status
      try {
        status = await window.dataforge.getStatus()
      } catch {
        /* keep previous */
      }

      const pathMsg = result.filePath
        ? ` → ${result.filePath}${result.encryptedPath ? ` (encrypted)` : ''}`
        : ''
      set({
        lastGenerated: result,
        lastStreamPath: result.filePath ?? null,
        generating: false,
        generateProgress: {
          phase: 'done',
          current: result.recordCount,
          total: result.recordCount,
          percent: 100,
          message: result.streamed
            ? `Streamed ${result.recordCount.toLocaleString()} in ${result.ms}ms${pathMsg}`
            : `Done in ${result.ms}ms`
        },
        status
      })
      if (result.encryptionError) {
        set({
          error: `File written but encryption failed: ${result.encryptionError}`
        })
      }
      return result
    } catch (e) {
      set({
        generating: false,
        generateProgress: null,
        error: e instanceof Error ? e.message : 'Generation failed'
      })
      return null
    } finally {
      try {
        unsub()
      } catch {
        /* ignore */
      }
    }
  },

  exportData: async (format, data, fileName, opts) => {
    if (data === null || data === undefined) {
      throw new Error('Nothing to export')
    }
    if (typeof window.dataforge?.exportFile !== 'function') {
      throw new Error('Export API unavailable — fully restart the app (stop and run npm run dev)')
    }
    const active = get().activeSchema
    const last = get().lastGenerated
    // Full generated batch only exists in memory for non-streamed runs
    if (opts?.source === 'generated' && last?.streamed) {
      throw new Error(
        `This run was streamed to disk${last.filePath ? ` (${last.filePath})` : ''}. ` +
          `Only ${last.records?.length ?? 0} preview row(s) are in memory of ${last.recordCount.toLocaleString()} total. ` +
          `Open the stream file for the full output (Export would write the preview only).`
      )
    }
    const exportingFullGenerated =
      opts?.source === 'generated' && Boolean(last && !last.streamed && last.records?.length)
    const safeData = JSON.parse(JSON.stringify(data)) as unknown
    const s = get().settings
    const result = await window.dataforge.exportFile({
      data: safeData,
      format,
      writeManifest: get().writeManifest && Boolean(active) && exportingFullGenerated,
      manifestSeed: exportingFullGenerated ? last?.seed : undefined,
      manifestCiMode: exportingFullGenerated ? last?.ciMode : undefined,
      manifestRecordCount: exportingFullGenerated ? last?.recordCount : undefined,
      manifestSchema: active ?? undefined,
      manifestRecordHistory: exportingFullGenerated ? !(last?.ciMode ?? false) : undefined,
      manifestReport: exportingFullGenerated ? last?.report : undefined,
      fileName: fileName || active?.name || 'dataforge-export',
      csvFlattenDelimiter: s.csvFlattenDelimiter,
      csvNestedAsJson: s.csvNestedAsJson,
      csvLayoutMode: s.csvLayoutMode,
      csvMultiRow: s.csvMultiRow
      // encrypt flag omitted → uses settings.encryption.encryptOnExport when enabled
    })
    if (result.canceled) return null
    if (result.encryptionError) {
      throw new Error(
        `File saved but encryption failed: ${result.encryptionError}` +
          (result.filePath ? ` (plaintext: ${result.filePath})` : '')
      )
    }
    // Plaintext path; encrypted file name is owned by the custom Python script
    return result.filePath || null
  },

  exportArchive: async (request) => {
    if (typeof window.dataforge?.exportArchive !== 'function') {
      throw new Error(
        'Archive API unavailable — fully restart the app (stop and run npm run dev)'
      )
    }
    const safe: ArchiveExportRequest = {
      ...request,
      data: JSON.parse(JSON.stringify(request.data)) as unknown
    }
    const result = await window.dataforge.exportArchive(safe)
    if (result.canceled) return null
    if (result.encryptionError) {
      throw new Error(
        `Archive saved but encryption failed: ${result.encryptionError}` +
          (result.filePath ? ` (plaintext: ${result.filePath})` : '')
      )
    }
    return result.filePath || null
  },

  exportBackup: async () => {
    const result = await window.dataforge.exportBackup()
    return result.canceled ? null : result.filePath ?? null
  },

  importBackup: async () => {
    const result = await window.dataforge.importBackup()
    if (result.canceled) return null
    await get().init()
    return result.imported ?? 0
  }
}))
