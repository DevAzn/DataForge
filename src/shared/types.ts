/** Shared domain types for main + renderer */

export type RelationshipKind =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'

export type RowKind = 'value' | 'object' | 'array'

export type ExportFormat = 'json' | 'xml' | 'csv' | 'txt' | 'yaml'

/** Hard cap for Generate record count (all formats, including multi-row CSV). */
export const MAX_GENERATE_RECORDS = 1_000_000
export const MIN_GENERATE_RECORDS = 1

/** Max bytes for schema import (content or file). ~25 MiB. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

/**
 * How CSV is structured when exporting.
 * - single-header: classic table — one header row, then data rows (union of keys)
 * - entity-sections: nested objects/arrays become separate header+row blocks per entity
 * - per-key-sections: each unique key is its own mini-section (key header, then values)
 */
export type CsvLayoutMode = 'single-header' | 'entity-sections' | 'per-key-sections'

export type ArchiveExt = '.zip' | '.ZIP' | '.tar' | '.TAR'

export type ArchiveMode = 'multi-format' | 'split-records'

export type ThemeMode = 'dark' | 'light' | 'system'

export interface SchemaRow {
  id: string
  key: string
  kind: RowKind
  sampleValue?: string
  categoryId?: string
  /**
   * Optional extra namespace for history (e.g. "Person" → Person/building.name).
   * Does NOT share values across different path keys — use historyPool / historySourceKeys for that.
   */
  categoryOverride?: string
  /**
   * Shared value pool name. Fields with the same pool read/write the same history bank
   * (`pool:{name}`). Use when employee.name and contact.name should share names intentionally.
   * Default isolation remains path-based (building.name ≠ role.name).
   */
  historyPool?: string
  /**
   * Extra history keys to pull values from during generation and autocomplete
   * (e.g. ["building.name", "site.name"]). Own path and pool are always included.
   * Saved with the schema for future sessions.
   */
  historySourceKeys?: string[]
  /** Chance 0–100 that this leaf is null when generating */
  nullRate?: number
  /** If non-empty, generation picks only from these values (unless null) */
  enumValues?: string[]
  minLength?: number
  maxLength?: number
  /** Numeric min/max when value is treated as a number */
  min?: number
  max?: number
  /** Optional regex (source string) generated values should match */
  pattern?: string
  isPrimary: boolean
  isUnique: boolean
  relationship?: RelationshipKind
  children: SchemaRow[]
  sortOrder: number
}

export interface SchemaDoc {
  id: string
  name: string
  description?: string
  root: SchemaRow[]
  /** Original uploaded file name (e.g. orders.json) */
  sourceFileName?: string
  /** Full path when imported via Browse (not always available from drag-drop) */
  sourceFilePath?: string
  /** Detected format of the uploaded file */
  sourceFormat?: ExportFormat
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}

/** Stored shape of schema_meta.tree_json (backward compatible with bare SchemaRow[]). */
export interface SchemaTreePayload {
  root: SchemaRow[]
  sourceFileName?: string
  sourceFilePath?: string
  sourceFormat?: ExportFormat
}

export interface Category {
  id: string
  name: string
  sourceKey?: string
  createdAt: string
}

export interface ValueHistoryEntry {
  id: string
  categoryId: string
  keyName: string
  value: string
  useCount: number
  lastUsedAt: string
  createdAt: string
}

export type HistoryListItem = ValueHistoryEntry & { categoryName: string }

export interface HistoryPageQuery {
  offset?: number
  limit?: number
  /** Filter by key_name or value substring (case-insensitive) */
  search?: string
}

export interface HistoryPageResult {
  items: HistoryListItem[]
  total: number
  offset: number
  limit: number
}

/** How to scope a history clear operation. */
export type ClearHistoryMode = 'all' | 'days' | 'datetime'
/** @deprecated use "days" */
export type ClearHistoryModeLegacy = ClearHistoryMode | 'lastDays' | 'before'

/**
 * For days/datetime modes: wipe newer activity or older activity relative to the cutoff.
 * - newer: last used on/after the cutoff (recent side)
 * - older: last used before/on the cutoff (past side)
 */
export type ClearHistoryAge = 'newer' | 'older'

export interface ClearHistoryRequest {
  /** Prefer all | days | datetime. lastDays/before accepted for compatibility. */
  mode: ClearHistoryModeLegacy
  /**
   * days mode: N calendar days from now used as the cutoff.
   */
  days?: number
  /**
   * datetime mode: ISO-8601 cutoff for last_used_at.
   */
  beforeIso?: string
  /**
   * days/datetime: delete the newer side or the older side of the cutoff.
   * Defaults to "newer" for days and "older" for datetime when omitted.
   */
  age?: ClearHistoryAge
  /** Must be true when mode is "all" (UI confirmation already shown). */
  confirmAll?: boolean
}

export interface ClearHistoryResult {
  deleted: number
  mode: ClearHistoryMode
}

export interface UpdateHistoryEntryRequest {
  id: string
  /** Corrected value text */
  value: string
}

export interface DeleteHistoryResult {
  deleted: number
}

export interface Template {
  id: string
  name: string
  description?: string
  schemaJson: string
  sampleDataJson?: string
  createdAt: string
  updatedAt: string
}

export interface Interaction {
  id: string
  type: string
  payloadJson: string
  createdAt: string
}

export interface ThemeColors {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  accentFg: string
}

/** Custom offline encryption for testing exported files via a user-provided Python script. */
export interface EncryptionSettings {
  /** When true, single-file and archive exports can run the script after write */
  enabled: boolean
  /** Absolute path to stored .py script under userData (set after upload) */
  scriptPath?: string
  /** Original file name of the script for display */
  scriptOriginalName?: string
  /** Absolute path to stored key material */
  keyPath?: string
  /** Original key file name for display */
  keyOriginalName?: string
  /**
   * How to invoke the script. Placeholders:
   * {python} {script} {key} {input}  — required for typical scripts
   * {output} — optional; omit if your custom script names the encrypted file itself
   * Example: python3 "{script}" --key "{key}" --input "{input}"
   */
  invokeCommand: string
  /** Prefer encrypting exports by default when enabled */
  encryptOnExport: boolean
}

export interface AppSettings {
  themeMode: ThemeMode
  customColors?: ThemeColors
  csvFlattenDelimiter: string
  csvNestedAsJson: boolean
  /** Classic multi-row table vs entity blocks vs per-key sections */
  csvLayoutMode: CsvLayoutMode
  /**
   * When true and data is an array of records, emit every record as a row
   * (single-header) or expand all records into sections. When false, only the first record.
   */
  csvMultiRow: boolean
  defaultExportFormat: ExportFormat
  defaultRecordCount: number
  encryption: EncryptionSettings
}

export interface EncryptionAssetInfo {
  scriptPath?: string
  scriptOriginalName?: string
  scriptExists: boolean
  keyPath?: string
  keyOriginalName?: string
  keyExists: boolean
  encryptionDir: string
}

export interface EncryptionUploadResult {
  ok: boolean
  path?: string
  originalName?: string
  error?: string
}

export interface EncryptionRunResult {
  ok: boolean
  command?: string
  stdout?: string
  stderr?: string
  outputPath?: string
  error?: string
  exitCode?: number | null
}

export interface ArchiveFileSpec {
  /** Entry name inside the archive (with or without extension) */
  fileName: string
  format: ExportFormat
}

export interface ArchiveOptions {
  /** Exact archive extension including casing: .zip | .ZIP | .tar | .TAR */
  extension: ArchiveExt
  /** Optional wrapper folder inside the archive */
  topFolderName?: string
  mode: ArchiveMode
  files: ArchiveFileSpec[]
}

export const DEFAULT_ENCRYPTION: EncryptionSettings = {
  enabled: false,
  // Script names the encrypted file itself — no {output} required
  invokeCommand: 'python3 "{script}" --key "{key}" --input "{input}"',
  encryptOnExport: false
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'dark',
  csvFlattenDelimiter: '.',
  csvNestedAsJson: false,
  csvLayoutMode: 'single-header',
  csvMultiRow: true,
  defaultExportFormat: 'json',
  defaultRecordCount: 10,
  encryption: { ...DEFAULT_ENCRYPTION }
}

export interface AppPaths {
  userData: string
  dbPath: string
  cachePath: string
}

export interface AppStatus {
  ok: boolean
  version: string
  paths: AppPaths
  schemaCount: number
  templateCount: number
  valueHistoryCount: number
}

export interface HistorySuggestQuery {
  categoryName?: string
  keyName?: string
  prefix?: string
  limit?: number
}

export interface HistoryRecordInput {
  categoryName: string
  keyName: string
  value: string
  sourceKey?: string
}

export interface GenerateRequest {
  schema: SchemaDoc
  recordCount: number
  /** Persist sample/generated values into history */
  recordHistory?: boolean
  /** Deterministic RNG seed; if omitted a seed is chosen and returned */
  seed?: number
  /**
   * When true, do not sample live value_history — only samples, enums,
   * constraints, and synthesizers (reproducible across machines).
   */
  ciMode?: boolean
}

/** Post-run stats for generation quality / reproducibility. */
export interface GenerationReport {
  leafValues: number
  nullValues: number
  historyHits: number
  enumHits: number
  synthesized: number
  mutatedFromSample: number
  patternRetries: number
  patternFailures: number
  lengthRepairs: number
  numericRepairs: number
  /** Unique fields that ran out of fresh values and reused */
  uniqueExhausted: number
  /** historyHits / (leafValues - nullValues) as 0–100, or 0 if none */
  historyHitRate: number
  /** nullValues / leafValues as 0–100 */
  nullRatePct: number
  ciMode: boolean
  seed: number
  recordCount: number
  ms: number
}

export interface GenerateResult {
  /** Full set, or a small preview sample when streamed: true */
  records: unknown[]
  recordCount: number
  ms: number
  /** Actual seed used for this run */
  seed: number
  /** Whether live history was ignored */
  ciMode: boolean
  /** Quality / source stats for this run */
  report?: GenerationReport
  /** True when rows were written to disk without keeping all records in RAM */
  streamed?: boolean
  filePath?: string
  encryptedPath?: string
  encryptionError?: string
  format?: ExportFormat
  canceled?: boolean
}

/** Sidecar describing a generation/export run for reproducibility. */
export interface RunManifest {
  app: 'DataForge'
  version: string
  createdAt: string
  seed: number
  ciMode: boolean
  recordCount: number
  format?: ExportFormat
  schemaId?: string
  schemaName?: string
  schemaHash: string
  recordHistory: boolean
  /** Optional snapshot of the last run report */
  report?: GenerationReport
}

/** Result of loading a run manifest from disk. */
export interface LoadManifestResult {
  canceled: boolean
  manifest?: RunManifest
  filePath?: string
  error?: string
}

/** Compare a loaded manifest to the currently open schema. */
export interface ManifestApplyPreview {
  manifest: RunManifest
  filePath?: string
  currentSchemaHash: string
  schemaHashMatch: boolean
  schemaIdMatch: boolean | null
  schemaNameMatch: boolean | null
  warnings: string[]
}

export interface GenerateProgress {
  phase: 'generating' | 'history' | 'encrypting' | 'done'
  current: number
  total: number
  percent: number
  message?: string
}

export interface StreamGenerateRequest {
  schema: SchemaDoc
  recordCount: number
  recordHistory?: boolean
  seed?: number
  ciMode?: boolean
  format: ExportFormat
  fileName?: string
  csvFlattenDelimiter?: string
  csvNestedAsJson?: boolean
  csvLayoutMode?: CsvLayoutMode
  encrypt?: boolean
  previewSampleSize?: number
  /** Write a .manifest.json next to the streamed file */
  writeManifest?: boolean
}

export interface ExportRequest {
  data: unknown
  format: ExportFormat
  /** Suggested filename without forcing path */
  fileName?: string
  /** CSV options */
  csvFlattenDelimiter?: string
  csvNestedAsJson?: boolean
  csvLayoutMode?: CsvLayoutMode
  csvMultiRow?: boolean
  /** Override: run custom Python encryption after writing the file */
  encrypt?: boolean
  /** Write run manifest beside the export */
  writeManifest?: boolean
  /** Params for manifest when exporting generated data */
  manifestSeed?: number
  manifestCiMode?: boolean
  manifestRecordCount?: number
  manifestSchema?: SchemaDoc
  manifestRecordHistory?: boolean
  manifestReport?: GenerationReport
}

export interface ExportResult {
  canceled: boolean
  filePath?: string
  /** Present when encryption ran successfully */
  encryptedPath?: string
  encryptionError?: string
}

export interface ArchiveExportRequest {
  /** Generated records (array) or a single sample object */
  data: unknown
  /** Archive file base name (no extension); extension comes from options.extension */
  archiveFileName: string
  options: ArchiveOptions
  csvFlattenDelimiter?: string
  csvNestedAsJson?: boolean
  csvLayoutMode?: CsvLayoutMode
  csvMultiRow?: boolean
  /** Override: run custom Python encryption after writing the archive */
  encrypt?: boolean
}

export interface ArchiveExportResult {
  canceled: boolean
  filePath?: string
  entryCount?: number
  encryptedPath?: string
  encryptionError?: string
}
