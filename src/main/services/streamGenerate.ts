import { createWriteStream, renameSync, unlinkSync, existsSync } from 'fs'
import { BrowserWindow, dialog } from 'electron'
import type {
  ExportFormat,
  GenerateProgress,
  GenerateResult,
  SchemaDoc,
  StreamGenerateRequest
} from '../../shared/types'
import {
  MAX_GENERATE_RECORDS,
  MIN_GENERATE_RECORDS
} from '../../shared/types'
import {
  flattenRecord,
  formatCsvDataLine,
  formatCsvHeaderLine,
  headersFromSchema
} from '../../shared/csv'

export type { StreamGenerateRequest }
import { getSettings } from '../db/database'
import { logInteraction } from '../db/history'
import { extensionForFormat, sanitizeExportFileName } from './formats'
import {
  createGenerationContext,
  finalizeGenerationReport,
  flushGenerationHistory,
  generateOneRecord
} from './generator'
import { runEncryptionOnFile, shouldEncryptExport } from './encryption'
import { buildRunManifest, writeManifestBeside } from './manifest'

export interface StreamGenerateResult extends GenerateResult {
  /** Path written on disk */
  filePath?: string
  encryptedPath?: string
  encryptionError?: string
  streamed: true
  format: ExportFormat
  canceled?: boolean
}

function resolveCount(n: number): number {
  return Math.min(Math.max(n || 1, MIN_GENERATE_RECORDS), MAX_GENERATE_RECORDS)
}

/**
 * Stream-generate records to a file without holding all rows in RAM.
 * - CSV: single-header layout only
 * - JSON: NDJSON (.jsonl)
 * Writes to temp file first, renames on success; respects write backpressure.
 */
export async function streamGenerateToFile(
  eventSender: Electron.WebContents,
  request: StreamGenerateRequest,
  onProgress?: (p: GenerateProgress) => void
): Promise<StreamGenerateResult> {
  const settings = getSettings()
  const format = request.format
  const layout = request.csvLayoutMode ?? settings.csvLayoutMode ?? 'single-header'
  const nestedAsJson = request.csvNestedAsJson ?? settings.csvNestedAsJson
  const delim = request.csvFlattenDelimiter ?? settings.csvFlattenDelimiter ?? '.'
  const count = resolveCount(request.recordCount)
  const sampleSize = Math.min(Math.max(request.previewSampleSize ?? 25, 0), 100)

  if (format === 'csv' && layout !== 'single-header') {
    throw new Error(
      'Stream generate for CSV currently supports “Single header” layout only. Switch header layout or turn off stream.'
    )
  }
  if (format !== 'csv' && format !== 'json' && format !== 'txt') {
    throw new Error(
      `Stream generate supports CSV, JSON (NDJSON), or TXT. Use normal Generate for ${format.toUpperCase()}.`
    )
  }

  const ext =
    format === 'json' || format === 'txt'
      ? format === 'json'
        ? 'jsonl'
        : 'txt'
      : extensionForFormat(format)
  const defaultName = sanitizeExportFileName(
    request.fileName || request.schema.name || 'dataforge-export'
  )

  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showSaveDialog(win, {
        title: 'Stream generate to file',
        defaultPath: `${defaultName}.${ext}`,
        filters: [
          {
            name: format === 'csv' ? 'CSV' : format === 'json' ? 'NDJSON' : 'Text',
            extensions: [ext]
          },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    : await dialog.showSaveDialog({
        title: 'Stream generate to file',
        defaultPath: `${defaultName}.${ext}`,
        filters: [
          {
            name: format === 'csv' ? 'CSV' : format === 'json' ? 'NDJSON' : 'Text',
            extensions: [ext]
          },
          { name: 'All files', extensions: ['*'] }
        ]
      })

  if (result.canceled || !result.filePath) {
    return {
      records: [],
      recordCount: 0,
      ms: 0,
      seed: 0,
      ciMode: Boolean(request.ciMode),
      streamed: true,
      format,
      canceled: true
    }
  }

  const filePath = result.filePath
  const tmpPath = `${filePath}.df-tmp`
  const started = Date.now()
  const ciMode = Boolean(request.ciMode)
  const scratch = createGenerationContext(count, {
    seed: request.seed,
    ciMode
  })
  const preview: unknown[] = []

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
    message: 'Opening file…'
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(tmpPath, { encoding: 'utf8' })
      let settled = false
      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        stream.destroy()
        reject(err)
      }
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      stream.on('error', fail)

      let headers: string[] = []
      if (format === 'csv') {
        headers = headersFromSchema(request.schema.root, delim, nestedAsJson, 4)
        if (headers.length === 0) headers = ['value']
      }

      const step = Math.max(1, Math.min(500, Math.floor(count / 100) || 1))
      let i = 0
      let headerWritten = format !== 'csv'

      const writeNext = (): void => {
        if (settled) return
        try {
          if (!headerWritten) {
            const ok = stream.write(formatCsvHeaderLine(headers) + '\n')
            headerWritten = true
            if (!ok) {
              stream.once('drain', writeNext)
              return
            }
          }

          let canWrite = true
          const chunkEnd = Math.min(i + step, count)
          while (i < chunkEnd && canWrite) {
            const rec = generateOneRecord(request.schema.root, scratch)
            if (preview.length < sampleSize) preview.push(rec)
            const line =
              format === 'csv'
                ? formatCsvDataLine(flattenRecord(rec, delim, nestedAsJson), headers) + '\n'
                : JSON.stringify(rec) + '\n'
            canWrite = stream.write(line)
            i++
          }

          if (i === 0 || i % step === 0 || i >= count) {
            report({
              phase: 'generating',
              current: i,
              total: count,
              message: `Streaming record ${i.toLocaleString()} of ${count.toLocaleString()}…`
            })
          }

          if (i >= count) {
            stream.end(done)
            return
          }

          if (!canWrite) {
            stream.once('drain', writeNext)
          } else {
            setImmediate(writeNext)
          }
        } catch (err) {
          fail(err)
        }
      }

      writeNext()
    })
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
    throw err
  }

  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
    throw err
  }

  const shouldRecordHistory = ciMode
    ? request.recordHistory === true
    : request.recordHistory !== false

  let historyWritten = 0
  if (shouldRecordHistory) {
    report({
      phase: 'history',
      current: count,
      total: count,
      message: 'Saving sample values to local history…'
    })
    historyWritten = flushGenerationHistory(request.schema.root, scratch, true)
  }

  const ms = Date.now() - started
  const genReport = finalizeGenerationReport(scratch, count, ms)

  const out: StreamGenerateResult = {
    records: preview,
    recordCount: count,
    ms,
    seed: scratch.seed,
    ciMode,
    report: genReport,
    filePath,
    streamed: true,
    format
  }

  if (request.writeManifest) {
    try {
      writeManifestBeside(
        filePath,
        buildRunManifest({
          seed: scratch.seed,
          ciMode,
          recordCount: count,
          format,
          schema: request.schema,
          recordHistory: shouldRecordHistory,
          report: genReport
        })
      )
    } catch {
      /* non-fatal */
    }
  }

  if (shouldEncryptExport(request.encrypt)) {
    report({
      phase: 'encrypting',
      current: count,
      total: count,
      message: 'Running encryption script…'
    })
    const enc = await runEncryptionOnFile(filePath)
    if (enc.ok) {
      out.encryptedPath = enc.outputPath
    } else {
      out.encryptionError = enc.error || enc.stderr || 'Encryption failed'
    }
  }

  logInteraction('generate_stream', {
    schemaId: request.schema.id,
    schemaName: request.schema.name,
    recordCount: count,
    format,
    filePath,
    historyWritten,
    ms: out.ms,
    seed: scratch.seed,
    ciMode
  })

  report({
    phase: 'done',
    current: count,
    total: count,
    message: `Streamed ${count.toLocaleString()} records → ${filePath}`
  })

  return out
}

export function assertStreamableSchema(_schema: SchemaDoc): void {
  // Reserved for future validation
}
