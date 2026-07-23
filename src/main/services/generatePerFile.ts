import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import type {
  GeneratePerFileRequest,
  GenerateProgress,
  GenerateResult
} from '../../shared/types'
import {
  DEFAULT_FILE_NAMING,
  MAX_GENERATE_RECORDS,
  MIN_GENERATE_RECORDS
} from '../../shared/types'
import { claimUniqueFileName, renderFileName } from '../../shared/fileNamePattern'
import { getSettings } from '../db/database'
import { logInteraction } from '../db/history'
import {
  applyTiedFieldPaths,
  buildTiedTemplateFromSchema,
  mergeMissingTiedPaths
} from '../../shared/fieldHistory'
import {
  createGenerationContext,
  finalizeGenerationReport,
  flushGenerationHistory,
  generateOneRecord,
  setSuppressHistoryPaths
} from './generator'
import { extensionForFormat, sanitizeExportFileName, serializeData } from './formats'
import { buildRunManifest } from './manifest'

function resolveCount(n: number): number {
  return Math.min(Math.max(n || 1, MIN_GENERATE_RECORDS), MAX_GENERATE_RECORDS)
}

/**
 * Generate records and write each as its own file under a folder the user picks.
 * File names follow Settings → fileNaming pattern (tokens, field values, subfolders).
 */
export async function generatePerFileToDirectory(
  eventSender: Electron.WebContents,
  request: GeneratePerFileRequest,
  onProgress?: (p: GenerateProgress) => void
): Promise<GenerateResult> {
  const settings = getSettings()
  const naming = { ...DEFAULT_FILE_NAMING, ...settings.fileNaming }
  const format = request.format
  const count = resolveCount(request.recordCount)
  const sampleSize = Math.min(Math.max(request.previewSampleSize ?? 25, 0), 100)
  const delim = request.csvFlattenDelimiter ?? settings.csvFlattenDelimiter ?? '.'
  const nestedAsJson = request.csvNestedAsJson ?? settings.csvNestedAsJson
  const layout = request.csvLayoutMode ?? settings.csvLayoutMode ?? 'single-header'

  const schemaName = sanitizeExportFileName(
    request.fileName || request.schema.name || 'dataforge-record'
  )
  const ext = extensionForFormat(format)

  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const picked = win
    ? await dialog.showOpenDialog(win, {
        title: 'Choose folder for per-record files',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: 'Choose folder for per-record files',
        properties: ['openDirectory', 'createDirectory']
      })

  if (picked.canceled || !picked.filePaths[0]) {
    return {
      records: [],
      recordCount: 0,
      ms: 0,
      seed: 0,
      ciMode: Boolean(request.ciMode),
      streamed: true,
      perFile: true,
      format,
      canceled: true
    }
  }

  const dir = picked.filePaths[0]
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const started = Date.now()
  const ciMode = Boolean(request.ciMode)
  const scratch = createGenerationContext(count, {
    seed: request.seed,
    ciMode
  })

  // In CI mode, prefer deterministic name tokens when user left default false
  const deterministicNames = naming.deterministicRandom || ciMode

  const report = (partial: Omit<GenerateProgress, 'percent'>): void => {
    const percent =
      partial.total <= 0
        ? 0
        : Math.min(100, Math.round((partial.current / partial.total) * 100))
    onProgress?.({ ...partial, percent })
  }

  report({
    phase: 'generating',
    current: 0,
    total: count,
    message: `Writing files to ${dir}…`
  })

  const tiedPaths = (request.schema.csvTiedFieldPaths ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
  const tieTemplate: Record<string, unknown> | null =
    tiedPaths.length > 0
      ? buildTiedTemplateFromSchema(request.schema.root, tiedPaths)
      : null

  const preview: unknown[] = []
  let filesWritten = 0
  let filesSkipped = 0
  /** Relative paths already claimed this run (case-insensitive) */
  const usedNames = new Set<string>()
  /** Field-path fragments already used for `{field:…|unique}` */
  const usedFieldValues = new Map<string, Set<string>>()
  /** Single wall-clock base so each index gets base+offset ms (unique time tokens) */
  const batchStartedAt = new Date()
  const formatOpts = {
    csvFlattenDelimiter: delim,
    csvNestedAsJson: nestedAsJson,
    csvLayoutMode: layout,
    csvMultiRow: false,
    xmlRootTag: request.xmlRootTag ?? settings.xmlRootTag,
    xmlRecordTag: request.xmlRecordTag ?? settings.xmlRecordTag,
    xmlSelfClosing: request.xmlSelfClosing ?? settings.xmlSelfClosing
  }
  const forceUnique = naming.ensureUniqueNames !== false
  // When ensure-unique is on, never skip — always suffix to keep every record on disk
  const collisionPolicy = forceUnique
    ? naming.collision === 'overwrite'
      ? 'suffix'
      : naming.collision === 'skip'
        ? 'suffix'
        : naming.collision
    : naming.collision

  const step = Math.max(1, Math.min(100, Math.floor(count / 50) || 1))
  for (let i = 0; i < count; ) {
    const chunkEnd = Math.min(i + step, count)
    for (; i < chunkEnd; i++) {
      if (tiedPaths.length > 0) {
        setSuppressHistoryPaths(scratch, tiedPaths)
      } else {
        setSuppressHistoryPaths(scratch, null)
      }
      let rec = generateOneRecord(request.schema.root, scratch)
      if (tiedPaths.length > 0 && tieTemplate) {
        if (i === 0) {
          mergeMissingTiedPaths(tieTemplate, rec, tiedPaths)
        }
        rec = applyTiedFieldPaths(tieTemplate, rec, tiedPaths)
      }

      const rel = renderFileName(naming.pattern, {
        schema: schemaName,
        index: i + 1,
        count,
        format,
        ext,
        prefix: naming.prefix,
        suffix: naming.suffix,
        seed: scratch.seed,
        record: rec,
        now: batchStartedAt,
        defaultIndexPad: naming.defaultIndexPad,
        sanitizeMode: naming.sanitizeMode,
        deterministicRandom: deterministicNames,
        usedFieldValues
      })

      const resolvedRel = forceUnique
        ? claimUniqueFileName(
            rel,
            usedNames,
            (r) => existsSync(join(dir, r)),
            collisionPolicy
          )
        : claimUniqueFileName(
            rel,
            usedNames,
            (r) => existsSync(join(dir, r)),
            naming.collision
          )

      if (resolvedRel == null) {
        filesSkipped++
        if (preview.length < sampleSize) preview.push(rec)
        continue
      }

      const absolute = join(dir, resolvedRel)
      const parent = dirname(absolute)
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true })
      }
      const content = serializeData(rec, format, formatOpts)
      writeFileSync(absolute, content, 'utf8')
      filesWritten++

      if (preview.length < sampleSize) preview.push(rec)
    }
    report({
      phase: 'generating',
      current: i,
      total: count,
      message: `Wrote ${filesWritten.toLocaleString()} files…`
    })
    if (i < count) {
      await new Promise<void>((r) => setImmediate(r))
    }
  }

  const shouldRecordHistory = ciMode
    ? request.recordHistory === true
    : request.recordHistory !== false

  if (shouldRecordHistory) {
    report({
      phase: 'history',
      current: count,
      total: count,
      message: 'Saving values to local history…'
    })
    flushGenerationHistory(request.schema.root, scratch, true)
  }

  const ms = Date.now() - started
  const genReport = finalizeGenerationReport(scratch, count, ms)

  if (request.writeManifest) {
    try {
      const manifestPath = join(dir, `${schemaName}.manifest.json`)
      writeFileSync(
        manifestPath,
        JSON.stringify(
          buildRunManifest({
            seed: scratch.seed,
            ciMode,
            recordCount: count,
            format,
            schema: request.schema,
            recordHistory: shouldRecordHistory,
            report: genReport
          }),
          null,
          2
        ),
        'utf8'
      )
    } catch {
      /* non-fatal */
    }
  }

  logInteraction('generate_per_file', {
    schemaId: request.schema.id,
    schemaName: request.schema.name,
    recordCount: count,
    filesWritten,
    filesSkipped,
    directory: dir,
    pattern: naming.pattern,
    format,
    seed: scratch.seed,
    ciMode
  })

  report({
    phase: 'done',
    current: count,
    total: count,
    message:
      filesSkipped > 0
        ? `Done — ${filesWritten} files (${filesSkipped} skipped) in ${dir}`
        : `Done — ${filesWritten} files in ${dir}`
  })

  return {
    records: preview,
    recordCount: count,
    ms,
    seed: scratch.seed,
    ciMode,
    report: genReport,
    streamed: true,
    perFile: true,
    filePath: dir,
    filesWritten,
    format
  }
}
