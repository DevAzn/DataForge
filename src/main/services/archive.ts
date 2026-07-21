import { createWriteStream } from 'fs'
import { basename } from 'path'
import archiver from 'archiver'
import { BrowserWindow, dialog } from 'electron'
import type {
  ArchiveExportRequest,
  ArchiveExportResult,
  ArchiveExt,
  ArchiveFileSpec,
  ExportFormat
} from '../../shared/types'
import { getSettings } from '../db/database'
import { logInteraction } from '../db/history'
import { extensionForFormat, sanitizeExportFileName, serializeData } from './formats'

function archiveFormat(ext: ArchiveExt): 'zip' | 'tar' {
  const lower = ext.toLowerCase()
  return lower === '.tar' ? 'tar' : 'zip'
}

function sanitizeEntrySegment(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').trim())
    .filter(Boolean)
    .join('/')
}

function ensureFileExtension(fileName: string, format: ExportFormat): string {
  const base = fileName.trim() || 'data'
  const ext = extensionForFormat(format)
  const lower = base.toLowerCase()
  if (
    lower.endsWith(`.${ext}`) ||
    lower.endsWith('.json') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml')
  ) {
    return sanitizeEntrySegment(base)
  }
  return sanitizeEntrySegment(`${base}.${ext}`)
}

function entryPath(topFolder: string | undefined, fileName: string): string {
  const file = sanitizeEntrySegment(fileName)
  const folder = topFolder?.trim() ? sanitizeEntrySegment(topFolder.trim()) : ''
  return folder ? `${folder}/${file}` : file
}

function asRecordArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data === null || data === undefined) return []
  return [data]
}

/** Partition records into N contiguous batches (last batch may be smaller). */
function splitRecords(records: unknown[], fileCount: number): unknown[][] {
  const n = Math.max(1, fileCount)
  if (records.length === 0) {
    return Array.from({ length: n }, () => [])
  }
  const size = Math.ceil(records.length / n)
  return Array.from({ length: n }, (_, i) =>
    records.slice(i * size, Math.min((i + 1) * size, records.length))
  )
}

interface BuiltEntry {
  path: string
  content: string
}

function buildEntries(request: ArchiveExportRequest): BuiltEntry[] {
  const settings = getSettings()
  const formatOpts = {
    csvFlattenDelimiter: request.csvFlattenDelimiter ?? settings.csvFlattenDelimiter,
    csvNestedAsJson: request.csvNestedAsJson ?? settings.csvNestedAsJson,
    csvLayoutMode: request.csvLayoutMode ?? settings.csvLayoutMode,
    csvMultiRow: request.csvMultiRow ?? settings.csvMultiRow
  }
  const files = request.options.files.filter((f) => f.fileName?.trim())
  if (files.length === 0) {
    throw new Error('Add at least one nested file to the archive')
  }

  const top = request.options.topFolderName
  const records = asRecordArray(request.data)
  const entries: BuiltEntry[] = []

  if (request.options.mode === 'multi-format') {
    // Same dataset, each file can be a different format / name
    const payload = records.length === 1 ? records[0] : records
    for (const file of files) {
      const name = ensureFileExtension(file.fileName, file.format)
      const content = serializeData(payload, file.format, formatOpts)
      entries.push({ path: entryPath(top, name), content })
    }
  } else {
    // split-records: one format family; partition rows across named files
    const chunks = splitRecords(records, files.length)
    files.forEach((file, i) => {
      const chunk = chunks[i] ?? []
      const name = ensureFileExtension(file.fileName, file.format)
      const payload = chunk.length === 1 ? chunk[0] : chunk
      const content = serializeData(payload, file.format, formatOpts)
      entries.push({ path: entryPath(top, name), content })
    })
  }

  return entries
}

function writeArchive(
  filePath: string,
  ext: ArchiveExt,
  entries: BuiltEntry[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath)
    const archive = archiver(archiveFormat(ext), {
      zlib: { level: 9 }
    })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[archive]', err)
      }
    })

    archive.pipe(output)
    for (const entry of entries) {
      archive.append(entry.content, { name: entry.path })
    }
    void archive.finalize()
  })
}

export async function exportArchive(
  eventSender: Electron.WebContents,
  request: ArchiveExportRequest
): Promise<ArchiveExportResult> {
  const ext = request.options.extension
  if (!['.zip', '.ZIP', '.tar', '.TAR'].includes(ext)) {
    throw new Error(`Unsupported archive extension: ${ext}`)
  }

  const entries = buildEntries(request)
  const base = sanitizeExportFileName(request.archiveFileName || 'dataforge-archive')
  // Preserve exact casing of extension (e.g. .ZIP vs .zip)
  const defaultPath = `${base}${ext}`

  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const filters =
    archiveFormat(ext) === 'tar'
      ? [
          { name: 'TAR archive', extensions: ['tar', 'TAR'] },
          { name: 'All files', extensions: ['*'] }
        ]
      : [
          { name: 'ZIP archive', extensions: ['zip', 'ZIP'] },
          { name: 'All files', extensions: ['*'] }
        ]

  const result = win
    ? await dialog.showSaveDialog(win, {
        title: 'Export archive',
        defaultPath,
        filters
      })
    : await dialog.showSaveDialog({
        title: 'Export archive',
        defaultPath,
        filters
      })

  if (result.canceled || !result.filePath) {
    return { canceled: true }
  }

  // Force the user-chosen extension casing on the saved path when possible
  let filePath = result.filePath
  const lower = filePath.toLowerCase()
  if (!lower.endsWith('.zip') && !lower.endsWith('.tar')) {
    filePath = `${filePath}${ext}`
  } else {
    // Replace extension with exact casing from options
    filePath = filePath.replace(/\.(zip|tar)$/i, ext)
  }

  await writeArchive(filePath, ext, entries)

  logInteraction('export_archive', {
    path: filePath,
    extension: ext,
    mode: request.options.mode,
    entryCount: entries.length,
    topFolder: request.options.topFolderName ?? null
  })

  return {
    canceled: false,
    filePath,
    entryCount: entries.length
  }
}

export function defaultArchiveFiles(
  baseName: string,
  format: ExportFormat,
  count: number
): ArchiveFileSpec[] {
  const safe = sanitizeExportFileName(baseName) || 'data'
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    fileName: count === 1 ? safe : `${safe}_${i + 1}`,
    format
  }))
}

export function archiveBaseNameFromPath(filePath: string): string {
  return basename(filePath).replace(/\.(zip|tar)$/i, '')
}
