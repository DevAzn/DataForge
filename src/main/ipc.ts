import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  AppStatus,
  ArchiveExportRequest,
  ArchiveTreeExportRequest,
  ExportRequest,
  ExportResult,
  GenerateRequest,
  ClearHistoryRequest,
  HistoryRecordInput,
  HistorySuggestQuery,
  SchemaDoc,
  StreamGenerateRequest,
  GeneratePerFileRequest,
  Template,
  UpdateHistoryEntryRequest,
  RunManifest
} from '../shared/types'
import { MAX_IMPORT_BYTES } from '../shared/types'
import {
  countTable,
  deleteSchema,
  deleteTemplate,
  getPaths,
  getSchema,
  getSettings,
  listSchemas,
  listTemplates,
  saveSchema,
  saveTemplate,
  setSettings,
  touchSchemaOpened,
  flushUserCache,
  writeUserCache
} from './db/database'
import {
  clearHistory,
  countHistoryClear,
  deleteHistoryEntries,
  deleteHistoryMatching,
  harvestSchemaSamples,
  listDistinctKeys,
  listHistoryPage,
  listRecentHistory,
  logInteraction,
  recordMany,
  recordValue,
  suggestValues,
  updateHistoryEntry
} from './db/history'
import type { HistoryPageQuery } from './db/history'
import { exportBackup, importBackup } from './services/backup'
import { exportArchive, exportArchiveFromTree } from './services/archive'
import { pickAndOpenArchive, readArchiveEntry } from './services/archiveRead'
import {
  buildRunManifest,
  pickAndLoadManifest,
  previewManifestAgainstSchema,
  writeManifestBeside
} from './services/manifest'
import {
  clearEncryptionKey,
  clearEncryptionScript,
  getEncryptionAssetInfo,
  pickEncryptionKey,
  pickEncryptionScript,
  runEncryptionOnFile,
  saveEncryptionKey,
  saveEncryptionScript,
  shouldEncryptExport
} from './services/encryption'
import { extensionForFormat, sanitizeExportFileName, serializeData } from './services/formats'
import { generateData } from './services/generator'
import { streamGenerateToFile } from './services/streamGenerate'
import { generatePerFileToDirectory } from './services/generatePerFile'
import { inferSchemaFromFile } from './services/schemaInfer'
import {
  deletePackage,
  getPackageHydrated,
  listPackages,
  setMemberVerified,
  updateMemberSchema
} from './db/packages'
import {
  pickAndImportPackage,
  pickAndImportPackageFiles
} from './services/packageImport'
import {
  generatePackageVariants,
  listLeafModesForPackage
} from './services/packageGenerate'
import type { PackageGenerateRequest } from '../shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.APP_GET_STATUS, (): AppStatus => {
    const paths = getPaths()
    return {
      ok: true,
      version: app.getVersion(),
      paths,
      schemaCount: countTable('schema_meta'),
      templateCount: countTable('templates'),
      valueHistoryCount: countTable('value_history')
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_e, settings: AppSettings) => setSettings(settings))

  ipcMain.handle(IPC.SCHEMAS_LIST, () => listSchemas())
  ipcMain.handle(IPC.SCHEMAS_GET, (_e, id: string) => getSchema(id))
  ipcMain.handle(IPC.SCHEMAS_SAVE, (_e, doc: SchemaDoc) => {
    const saved = saveSchema(doc)
    // Upsert sample values without bumping use_count (save is not “use”)
    const samples = harvestSchemaSamples(saved.root)
    if (samples.length) recordMany(samples, 'ensure')
    logInteraction('schema_save', { id: saved.id, name: saved.name })
    return saved
  })
  ipcMain.handle(IPC.SCHEMAS_DELETE, (_e, id: string) => deleteSchema(id))
  ipcMain.handle(IPC.SCHEMAS_TOUCH_OPENED, (_e, id: string) => touchSchemaOpened(id))

  ipcMain.handle(
    IPC.SCHEMAS_IMPORT,
    (_e, payload: { fileName: string; content: string; sourceFilePath?: string }) => {
      const content = payload.content ?? ''
      if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
        throw new Error(
          `Import file is too large (max ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`
        )
      }
      const result = inferSchemaFromFile(payload.fileName, content, {
        sourceFilePath: payload.sourceFilePath
      })
      const saved = saveSchema(result.schema)
      // Multi-record harvest is the primary history source; ensure-only for tree samples
      if (result.historySamples.length) recordMany(result.historySamples, 'ensure')
      const treeSamples = harvestSchemaSamples(saved.root)
      if (treeSamples.length) recordMany(treeSamples, 'ensure')
      logInteraction('schema_import', {
        id: saved.id,
        fileName: saved.sourceFileName,
        path: saved.sourceFilePath,
        format: result.format,
        fields: saved.root.length,
        recordHint: result.recordHint,
        scannedRecords: result.scannedRecords,
        historyValues: result.historySamples.length
      })
      return { ...result, schema: saved }
    }
  )

  ipcMain.handle(IPC.SCHEMAS_IMPORT_PICK, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const picked = win
      ? await dialog.showOpenDialog(win, {
          title: 'Import schema from file',
          filters: [
            {
              name: 'Data files',
              extensions: ['json', 'jsonl', 'ndjson', 'csv', 'xml', 'yml', 'yaml', 'txt']
            },
            { name: 'All files', extensions: ['*'] }
          ],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: 'Import schema from file',
          filters: [
            {
              name: 'Data files',
              extensions: ['json', 'jsonl', 'ndjson', 'csv', 'xml', 'yml', 'yaml', 'txt']
            },
            { name: 'All files', extensions: ['*'] }
          ],
          properties: ['openFile']
        })
    if (picked.canceled || !picked.filePaths[0]) {
      return { canceled: true as const }
    }
    const filePath = picked.filePaths[0]
    let size = 0
    try {
      size = statSync(filePath).size
    } catch {
      throw new Error('Could not read selected file.')
    }
    if (size > MAX_IMPORT_BYTES) {
      throw new Error(
        `Import file is too large (${Math.round(size / (1024 * 1024))} MB; max ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`
      )
    }
    const content = readFileSync(filePath, 'utf8')
    const fileName = basename(filePath)
    const result = inferSchemaFromFile(fileName, content, { sourceFilePath: filePath })
    const saved = saveSchema(result.schema)
    if (result.historySamples.length) recordMany(result.historySamples, 'ensure')
    const treeSamples = harvestSchemaSamples(saved.root)
    if (treeSamples.length) recordMany(treeSamples, 'ensure')
    logInteraction('schema_import', {
      id: saved.id,
      fileName: saved.sourceFileName,
      path: saved.sourceFilePath,
      format: result.format,
      fields: saved.root.length,
      recordHint: result.recordHint,
      scannedRecords: result.scannedRecords,
      historyValues: result.historySamples.length
    })
    return { canceled: false as const, ...result, schema: saved }
  })

  ipcMain.handle(IPC.TEMPLATES_LIST, () => listTemplates())
  ipcMain.handle(IPC.TEMPLATES_SAVE, (_e, t: Template) => saveTemplate(t))
  ipcMain.handle(IPC.TEMPLATES_DELETE, (_e, id: string) => deleteTemplate(id))

  ipcMain.handle(IPC.HISTORY_LIST, (_e, limit?: number) => listRecentHistory(limit ?? 50))
  ipcMain.handle(IPC.HISTORY_PAGE, (_e, query: HistoryPageQuery) => listHistoryPage(query ?? {}))
  ipcMain.handle(IPC.HISTORY_SUGGEST, (_e, query: HistorySuggestQuery) => suggestValues(query))
  ipcMain.handle(IPC.HISTORY_KEYS, (_e, prefix?: string, limit?: number) =>
    listDistinctKeys(prefix ?? '', limit ?? 30)
  )
  ipcMain.handle(IPC.HISTORY_RECORD, (_e, input: HistoryRecordInput) => {
    const entry = recordValue(input)
    writeUserCache()
    return entry
  })
  ipcMain.handle(IPC.HISTORY_RECORD_MANY, (_e, inputs: HistoryRecordInput[]) =>
    recordMany(inputs)
  )
  ipcMain.handle(IPC.HISTORY_CLEAR_COUNT, (_e, request: ClearHistoryRequest) =>
    countHistoryClear(request ?? { mode: 'all' })
  )
  ipcMain.handle(IPC.HISTORY_CLEAR, (_e, request: ClearHistoryRequest) =>
    clearHistory(request)
  )
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, ids: string[]) => deleteHistoryEntries(ids ?? []))
  ipcMain.handle(IPC.HISTORY_UPDATE, (_e, request: UpdateHistoryEntryRequest) =>
    updateHistoryEntry(request)
  )
  ipcMain.handle(IPC.HISTORY_DELETE_MATCHING, (_e, search: string) =>
    deleteHistoryMatching(search ?? '')
  )

  ipcMain.handle(IPC.INTERACTION_LOG, (_e, type: string, payload: unknown) => {
    logInteraction(type, payload)
    return { ok: true }
  })

  ipcMain.handle(IPC.GENERATE, async (event, request: GenerateRequest) => {
    try {
      return await generateData(request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.GENERATE_PROGRESS, progress)
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Generate failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.GENERATE_STREAM, async (event, request: StreamGenerateRequest) => {
    try {
      return await streamGenerateToFile(event.sender, request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.GENERATE_PROGRESS, progress)
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Stream generate failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.GENERATE_PER_FILE, async (event, request: GeneratePerFileRequest) => {
    try {
      return await generatePerFileToDirectory(event.sender, request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.GENERATE_PROGRESS, progress)
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Per-file generate failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.MANIFEST_PICK, async (event) => pickAndLoadManifest(event.sender))
  ipcMain.handle(
    IPC.MANIFEST_PREVIEW,
    (_e, payload: { manifest: RunManifest; schema: SchemaDoc | null; filePath?: string }) =>
      previewManifestAgainstSchema(payload.manifest, payload.schema, payload.filePath)
  )

  ipcMain.handle(IPC.EXPORT_FILE, async (event, request: ExportRequest): Promise<ExportResult> => {
    try {
      const settings = getSettings()
      const ext = extensionForFormat(request.format)
      const defaultName = sanitizeExportFileName(request.fileName || 'dataforge-export')

      // Parent to the sender window so the dialog is modal and not hidden behind the app
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
      const result = win
        ? await dialog.showSaveDialog(win, {
            title: 'Export data',
            defaultPath: `${defaultName}.${ext}`,
            filters: [
              { name: request.format.toUpperCase(), extensions: [ext] },
              { name: 'All files', extensions: ['*'] }
            ]
          })
        : await dialog.showSaveDialog({
            title: 'Export data',
            defaultPath: `${defaultName}.${ext}`,
            filters: [
              { name: request.format.toUpperCase(), extensions: [ext] },
              { name: 'All files', extensions: ['*'] }
            ]
          })

      if (result.canceled || !result.filePath) return { canceled: true }

      // Clone for safety (IPC / unexpected prototypes)
      const payload = JSON.parse(JSON.stringify(request.data ?? null)) as unknown
      const text = serializeData(payload, request.format, {
        csvFlattenDelimiter: request.csvFlattenDelimiter ?? settings.csvFlattenDelimiter,
        csvNestedAsJson: request.csvNestedAsJson ?? settings.csvNestedAsJson,
        csvLayoutMode: request.csvLayoutMode ?? settings.csvLayoutMode,
        csvMultiRow: request.csvMultiRow ?? settings.csvMultiRow,
        xmlRootTag: request.xmlRootTag ?? settings.xmlRootTag,
        xmlRecordTag: request.xmlRecordTag ?? settings.xmlRecordTag,
        xmlSelfClosing: request.xmlSelfClosing ?? settings.xmlSelfClosing
      })

      writeFileSync(result.filePath, text, 'utf-8')
      logInteraction('export', { format: request.format, path: result.filePath })

      if (request.writeManifest && request.manifestSchema) {
        writeManifestBeside(
          result.filePath,
          buildRunManifest({
            seed: request.manifestSeed ?? 0,
            ciMode: Boolean(request.manifestCiMode),
            recordCount: request.manifestRecordCount ?? 0,
            format: request.format,
            schema: request.manifestSchema,
            recordHistory: request.manifestRecordHistory,
            report: request.manifestReport
          })
        )
      }

      const out: ExportResult = { canceled: false, filePath: result.filePath }
      if (shouldEncryptExport(request.encrypt)) {
        const enc = await runEncryptionOnFile(result.filePath)
        if (enc.ok) {
          // Script owns the encrypted file name; path only if script reported it
          out.encryptedPath = enc.outputPath
        } else {
          out.encryptionError = enc.error || enc.stderr || 'Encryption failed'
        }
      }
      return out
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Export failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.EXPORT_ARCHIVE, async (event, request: ArchiveExportRequest) => {
    try {
      const result = await exportArchive(event.sender, request)
      if (result.canceled || !result.filePath) return result
      if (shouldEncryptExport(request.encrypt)) {
        const enc = await runEncryptionOnFile(result.filePath)
        if (enc.ok) {
          return { ...result, encryptedPath: enc.outputPath }
        }
        return {
          ...result,
          encryptionError: enc.error || enc.stderr || 'Encryption failed'
        }
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Archive export failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.ARCHIVE_OPEN, async (event) => pickAndOpenArchive(event.sender))

  ipcMain.handle(
    IPC.ARCHIVE_READ_ENTRY,
    async (_e, payload: { archiveFilePath: string; entryPath: string }) =>
      readArchiveEntry(payload.archiveFilePath, payload.entryPath)
  )

  ipcMain.handle(IPC.ARCHIVE_EXPORT_TREE, async (event, request: ArchiveTreeExportRequest) => {
    try {
      const result = await exportArchiveFromTree(event.sender, request)
      if (result.canceled || !result.filePath) return result
      if (shouldEncryptExport(request.encrypt)) {
        const enc = await runEncryptionOnFile(result.filePath)
        if (enc.ok) {
          return { ...result, encryptedPath: enc.outputPath }
        }
        return {
          ...result,
          encryptionError: enc.error || enc.stderr || 'Encryption failed'
        }
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Archive export failed: ${message}`)
    }
  })

  ipcMain.handle(IPC.ENCRYPTION_STATUS, () => getEncryptionAssetInfo())

  ipcMain.handle(
    IPC.ENCRYPTION_SAVE_SCRIPT,
    (_e, payload: { data: number[]; originalName: string }) =>
      saveEncryptionScript(payload.data, payload.originalName)
  )

  ipcMain.handle(
    IPC.ENCRYPTION_SAVE_KEY,
    (_e, payload: { data: number[]; originalName: string }) =>
      saveEncryptionKey(payload.data, payload.originalName)
  )

  ipcMain.handle(IPC.ENCRYPTION_PICK_SCRIPT, (e) => pickEncryptionScript(e.sender))
  ipcMain.handle(IPC.ENCRYPTION_PICK_KEY, (e) => pickEncryptionKey(e.sender))
  ipcMain.handle(IPC.ENCRYPTION_CLEAR_SCRIPT, () => {
    clearEncryptionScript()
    return getEncryptionAssetInfo()
  })
  ipcMain.handle(IPC.ENCRYPTION_CLEAR_KEY, () => {
    clearEncryptionKey()
    return getEncryptionAssetInfo()
  })

  ipcMain.handle(IPC.ENCRYPTION_TEST, async (event) => {
    // Pick file in main — do not accept arbitrary renderer paths
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const picked = win
      ? await dialog.showOpenDialog(win, {
          title: 'Choose a file to test encryption',
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: 'Choose a file to test encryption',
          properties: ['openFile']
        })
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false as const, error: 'Canceled', canceled: true as const }
    }
    return runEncryptionOnFile(picked.filePaths[0])
  })

  ipcMain.handle(IPC.CACHE_REFRESH, () => {
    flushUserCache()
    return { ok: true, path: getPaths().cachePath }
  })

  ipcMain.handle(IPC.BACKUP_EXPORT, () => exportBackup())
  ipcMain.handle(IPC.BACKUP_IMPORT, () => importBackup())

  // ── Package variation (whole multi-file upload = one record) ─────
  ipcMain.handle(IPC.PACKAGE_LIST, () => listPackages())
  ipcMain.handle(IPC.PACKAGE_GET, (_e, id: string) => getPackageHydrated(id))
  ipcMain.handle(IPC.PACKAGE_IMPORT, (e) => pickAndImportPackage(e.sender))
  ipcMain.handle(IPC.PACKAGE_IMPORT_FILES, (e) => pickAndImportPackageFiles(e.sender))
  ipcMain.handle(IPC.PACKAGE_DELETE, (_e, id: string) => ({ ok: deletePackage(id) }))
  ipcMain.handle(
    IPC.PACKAGE_VERIFY_MEMBER,
    (_e, payload: { packageId: string; memberPath: string; verified: boolean }) => {
      setMemberVerified(payload.packageId, payload.memberPath, payload.verified)
      return { ok: true }
    }
  )
  ipcMain.handle(
    IPC.PACKAGE_SAVE_MEMBER_SCHEMA,
    (
      _e,
      payload: { packageId: string; memberPath: string; schema: SchemaDoc }
    ) => updateMemberSchema(payload.packageId, payload.memberPath, payload.schema)
  )
  ipcMain.handle(IPC.PACKAGE_LEAF_PATHS, (_e, packageId: string) =>
    listLeafModesForPackage(packageId)
  )
  ipcMain.handle(
    IPC.PACKAGE_GENERATE,
    async (event, request: PackageGenerateRequest) => {
      const sendProgress = (p: {
        current: number
        total: number
        percent: number
        message?: string
      }): void => {
        event.sender.send(IPC.GENERATE_PROGRESS, {
          phase: 'generating' as const,
          current: p.current,
          total: p.total,
          percent: p.percent,
          message: p.message
        })
      }
      return generatePackageVariants(event.sender, request, sendProgress)
    }
  )
}
