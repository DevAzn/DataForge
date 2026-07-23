import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  AppStatus,
  ArchiveExportRequest,
  ArchiveExportResult,
  ArchiveOpenResult,
  ArchiveReadEntryResult,
  ArchiveTreeExportRequest,
  EncryptionAssetInfo,
  EncryptionRunResult,
  EncryptionUploadResult,
  ExportRequest,
  ExportResult,
  GenerateProgress,
  GenerateRequest,
  GenerateResult,
  StreamGenerateRequest,
  GeneratePerFileRequest,
  ClearHistoryRequest,
  ClearHistoryResult,
  DeleteHistoryResult,
  HistoryPageQuery,
  HistoryPageResult,
  HistoryRecordInput,
  HistorySuggestQuery,
  LoadManifestResult,
  ManifestApplyPreview,
  RunManifest,
  SchemaDoc,
  Template,
  UpdateHistoryEntryRequest,
  ValueHistoryEntry,
  ExportFormat
} from '../shared/types'

const api = {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.APP_GET_STATUS),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings),

  listSchemas: (): Promise<SchemaDoc[]> => ipcRenderer.invoke(IPC.SCHEMAS_LIST),
  getSchema: (id: string): Promise<SchemaDoc | null> =>
    ipcRenderer.invoke(IPC.SCHEMAS_GET, id),
  saveSchema: (doc: SchemaDoc): Promise<SchemaDoc> =>
    ipcRenderer.invoke(IPC.SCHEMAS_SAVE, doc),
  deleteSchema: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.SCHEMAS_DELETE, id),
  touchSchemaOpened: (id: string): Promise<SchemaDoc | null> =>
    ipcRenderer.invoke(IPC.SCHEMAS_TOUCH_OPENED, id),
  importSchemaFromContent: (
    fileName: string,
    content: string
  ): Promise<{
    schema: SchemaDoc
    format: ExportFormat
    recordHint: number
    scannedRecords?: number
    historySamples?: unknown[]
  }> => ipcRenderer.invoke(IPC.SCHEMAS_IMPORT, { fileName, content }),
  importSchemaPick: (): Promise<
    | { canceled: true }
    | {
        canceled: false
        schema: SchemaDoc
        format: ExportFormat
        recordHint: number
        scannedRecords?: number
        historySamples?: unknown[]
      }
  > => ipcRenderer.invoke(IPC.SCHEMAS_IMPORT_PICK),

  listTemplates: (): Promise<Template[]> => ipcRenderer.invoke(IPC.TEMPLATES_LIST),
  saveTemplate: (t: Template): Promise<Template> =>
    ipcRenderer.invoke(IPC.TEMPLATES_SAVE, t),
  deleteTemplate: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.TEMPLATES_DELETE, id),

  listHistory: (
    limit?: number
  ): Promise<Array<ValueHistoryEntry & { categoryName: string }>> =>
    ipcRenderer.invoke(IPC.HISTORY_LIST, limit),
  listHistoryPage: (query: HistoryPageQuery): Promise<HistoryPageResult> =>
    ipcRenderer.invoke(IPC.HISTORY_PAGE, query),
  suggestHistory: (query: HistorySuggestQuery): Promise<ValueHistoryEntry[]> =>
    ipcRenderer.invoke(IPC.HISTORY_SUGGEST, query),
  suggestKeys: (prefix?: string, limit?: number): Promise<string[]> =>
    ipcRenderer.invoke(IPC.HISTORY_KEYS, prefix, limit),
  recordHistory: (input: HistoryRecordInput): Promise<ValueHistoryEntry | null> =>
    ipcRenderer.invoke(IPC.HISTORY_RECORD, input),
  recordHistoryMany: (inputs: HistoryRecordInput[]): Promise<number> =>
    ipcRenderer.invoke(IPC.HISTORY_RECORD_MANY, inputs),
  countHistoryClear: (request: ClearHistoryRequest): Promise<number> =>
    ipcRenderer.invoke(IPC.HISTORY_CLEAR_COUNT, request),
  clearHistory: (request: ClearHistoryRequest): Promise<ClearHistoryResult> =>
    ipcRenderer.invoke(IPC.HISTORY_CLEAR, request),
  deleteHistory: (ids: string[]): Promise<DeleteHistoryResult> =>
    ipcRenderer.invoke(IPC.HISTORY_DELETE, ids),
  updateHistory: (request: UpdateHistoryEntryRequest): Promise<ValueHistoryEntry | null> =>
    ipcRenderer.invoke(IPC.HISTORY_UPDATE, request),
  deleteHistoryMatching: (search: string): Promise<DeleteHistoryResult> =>
    ipcRenderer.invoke(IPC.HISTORY_DELETE_MATCHING, search),

  logInteraction: (type: string, payload?: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.INTERACTION_LOG, type, payload),

  generate: (request: GenerateRequest): Promise<GenerateResult> =>
    ipcRenderer.invoke(IPC.GENERATE, request),
  generateStream: (request: StreamGenerateRequest): Promise<GenerateResult> =>
    ipcRenderer.invoke(IPC.GENERATE_STREAM, request),
  generatePerFile: (request: GeneratePerFileRequest): Promise<GenerateResult> =>
    ipcRenderer.invoke(IPC.GENERATE_PER_FILE, request),
  pickManifest: (): Promise<LoadManifestResult> => ipcRenderer.invoke(IPC.MANIFEST_PICK),
  previewManifest: (payload: {
    manifest: RunManifest
    schema: SchemaDoc | null
    filePath?: string
  }): Promise<ManifestApplyPreview> => ipcRenderer.invoke(IPC.MANIFEST_PREVIEW, payload),
  onGenerateProgress: (cb: (p: GenerateProgress) => void): (() => void) => {
    const handler = (_event: unknown, p: GenerateProgress): void => {
      cb(p)
    }
    ipcRenderer.on(IPC.GENERATE_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.GENERATE_PROGRESS, handler)
    }
  },
  exportFile: (request: ExportRequest): Promise<ExportResult> =>
    ipcRenderer.invoke(IPC.EXPORT_FILE, request),
  exportArchive: (request: ArchiveExportRequest): Promise<ArchiveExportResult> =>
    ipcRenderer.invoke(IPC.EXPORT_ARCHIVE, request),
  openArchive: (): Promise<ArchiveOpenResult> => ipcRenderer.invoke(IPC.ARCHIVE_OPEN),
  readArchiveEntry: (
    archiveFilePath: string,
    entryPath: string
  ): Promise<ArchiveReadEntryResult> =>
    ipcRenderer.invoke(IPC.ARCHIVE_READ_ENTRY, { archiveFilePath, entryPath }),
  exportArchiveTree: (request: ArchiveTreeExportRequest): Promise<ArchiveExportResult> =>
    ipcRenderer.invoke(IPC.ARCHIVE_EXPORT_TREE, request),

  encryptionStatus: (): Promise<EncryptionAssetInfo> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_STATUS),
  encryptionSaveScript: (
    data: number[],
    originalName: string
  ): Promise<EncryptionUploadResult> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_SAVE_SCRIPT, { data, originalName }),
  encryptionSaveKey: (data: number[], originalName: string): Promise<EncryptionUploadResult> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_SAVE_KEY, { data, originalName }),
  encryptionPickScript: (): Promise<EncryptionUploadResult> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_PICK_SCRIPT),
  encryptionPickKey: (): Promise<EncryptionUploadResult> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_PICK_KEY),
  encryptionClearScript: (): Promise<EncryptionAssetInfo> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_CLEAR_SCRIPT),
  encryptionClearKey: (): Promise<EncryptionAssetInfo> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_CLEAR_KEY),
  /** Opens a file dialog in main, then runs the encryption script (no raw path from renderer). */
  encryptionTest: (): Promise<EncryptionRunResult & { canceled?: boolean }> =>
    ipcRenderer.invoke(IPC.ENCRYPTION_TEST),

  refreshCache: (): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke(IPC.CACHE_REFRESH),
  exportBackup: (): Promise<{ canceled: boolean; filePath?: string }> =>
    ipcRenderer.invoke(IPC.BACKUP_EXPORT),
  importBackup: (): Promise<{ canceled: boolean; imported?: number }> =>
    ipcRenderer.invoke(IPC.BACKUP_IMPORT),

  listPackages: (): Promise<import('../shared/types').PackageDoc[]> =>
    ipcRenderer.invoke(IPC.PACKAGE_LIST),
  getPackage: (
    id: string
  ): Promise<import('../shared/types').PackageDocHydrated | null> =>
    ipcRenderer.invoke(IPC.PACKAGE_GET, id),
  importPackage: (): Promise<import('../shared/types').PackageImportResult> =>
    ipcRenderer.invoke(IPC.PACKAGE_IMPORT),
  importPackageFiles: (): Promise<import('../shared/types').PackageImportResult> =>
    ipcRenderer.invoke(IPC.PACKAGE_IMPORT_FILES),
  deletePackage: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.PACKAGE_DELETE, id),
  verifyPackageMember: (payload: {
    packageId: string
    memberPath: string
    verified: boolean
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.PACKAGE_VERIFY_MEMBER, payload),
  savePackageMemberSchema: (payload: {
    packageId: string
    memberPath: string
    schema: import('../shared/types').SchemaDoc
  }): Promise<import('../shared/types').SchemaDoc> =>
    ipcRenderer.invoke(IPC.PACKAGE_SAVE_MEMBER_SCHEMA, payload),
  packageLeafPaths: (packageId: string): Promise<Record<string, string[]>> =>
    ipcRenderer.invoke(IPC.PACKAGE_LEAF_PATHS, packageId),
  generatePackage: (
    request: import('../shared/types').PackageGenerateRequest
  ): Promise<import('../shared/types').PackageGenerateResult> =>
    ipcRenderer.invoke(IPC.PACKAGE_GENERATE, request)
}

export type DataForgeApi = typeof api

contextBridge.exposeInMainWorld('dataforge', api)
