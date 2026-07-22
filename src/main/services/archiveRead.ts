import { createReadStream, existsSync, statSync } from 'fs'
import { createGunzip } from 'zlib'
import { basename } from 'path'
import { BrowserWindow, dialog } from 'electron'
import yauzl from 'yauzl'
import * as tar from 'tar-stream'
import type {
  ArchiveExt,
  ArchiveListEntry,
  ArchiveOpenResult,
  ArchiveReadEntryResult
} from '../../shared/types'
import { ARCHIVE_TEXT_PREVIEW_MAX, isLikelyTextFile, pathToSegments } from '../../shared/archiveTree'
import { logInteraction } from '../db/history'

function normalizeEntryPath(p: string): string {
  return pathToSegments(p.replace(/\\/g, '/')).join('/')
}

function extensionFromPath(filePath: string): ArchiveExt {
  const lower = filePath.replace(/\\/g, '/').toLowerCase()
  if (lower.endsWith('.tar.gz')) return '.tar.gz'
  if (lower.endsWith('.tgz')) return '.tgz'
  if (filePath.endsWith('.ZIP')) return '.ZIP'
  if (filePath.endsWith('.TAR')) return '.TAR'
  if (lower.endsWith('.tar')) return '.tar'
  if (lower.endsWith('.zip')) return '.zip'
  return '.zip'
}

function isGzipTar(ext: ArchiveExt): boolean {
  const l = ext.toLowerCase()
  return l === '.tar.gz' || l === '.tgz'
}

function isTarFamily(ext: ArchiveExt): boolean {
  const l = ext.toLowerCase()
  return l === '.tar' || l === '.tar.gz' || l === '.tgz'
}

function listZip(filePath: string): Promise<ArchiveListEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(err || new Error('Failed to open ZIP'))
        return
      }
      const entries: ArchiveListEntry[] = []
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        const isDirectory = /\/$/.test(name)
        const path = normalizeEntryPath(name)
        if (path || isDirectory) {
          entries.push({
            path: path || normalizeEntryPath(name.replace(/\/$/, '')),
            size: entry.uncompressedSize || 0,
            isDirectory
          })
        }
        zip.readEntry()
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
    })
  })
}

function listTar(filePath: string, gzip: boolean): Promise<ArchiveListEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ArchiveListEntry[] = []
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      const name = (header.name || '').replace(/\\/g, '/')
      const isDirectory = header.type === 'directory' || /\/$/.test(name)
      const path = normalizeEntryPath(name)
      if (path) {
        entries.push({
          path,
          size: typeof header.size === 'number' ? header.size : 0,
          isDirectory
        })
      }
      stream.on('end', next)
      stream.resume()
    })
    extract.on('finish', () => resolve(entries))
    extract.on('error', reject)
    const input = createReadStream(filePath)
    input.on('error', reject)
    if (gzip) {
      const gunzip = createGunzip()
      gunzip.on('error', reject)
      input.pipe(gunzip).pipe(extract)
    } else {
      input.pipe(extract)
    }
  })
}

function readZipEntry(filePath: string, entryPath: string): Promise<ArchiveReadEntryResult> {
  const want = normalizeEntryPath(entryPath).toLowerCase()
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(err || new Error('Failed to open ZIP'))
        return
      }
      let found = false
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = normalizeEntryPath(entry.fileName.replace(/\\/g, '/'))
        if (name.toLowerCase() !== want || /\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        found = true
        const size = entry.uncompressedSize || 0
        const fileName = basename(name)
        if (!isLikelyTextFile(fileName) && size > 256 * 1024) {
          zip.close()
          resolve({ path: name, size, binary: true })
          return
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            reject(e2 || new Error('Failed to read ZIP entry'))
            return
          }
          const chunks: Buffer[] = []
          let total = 0
          let truncated = false
          stream.on('data', (chunk: Buffer) => {
            if (total >= ARCHIVE_TEXT_PREVIEW_MAX) {
              truncated = true
              stream.destroy()
              return
            }
            const take = Math.min(chunk.length, ARCHIVE_TEXT_PREVIEW_MAX - total)
            chunks.push(chunk.subarray(0, take))
            total += take
          })
          stream.on('end', () => {
            const buf = Buffer.concat(chunks)
            // Heuristic binary detect
            const sample = buf.subarray(0, Math.min(buf.length, 8000))
            let nulls = 0
            for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nulls++
            if (nulls > 0 || (!isLikelyTextFile(fileName) && nulls > 0)) {
              resolve({ path: name, size, binary: true })
              return
            }
            if (!isLikelyTextFile(fileName) && size > 64 * 1024) {
              resolve({ path: name, size, binary: true })
              return
            }
            resolve({
              path: name,
              size,
              content: buf.toString('utf8'),
              truncated,
              binary: false
            })
          })
          stream.on('error', reject)
        })
      })
      zip.on('end', () => {
        if (!found) {
          resolve({ path: entryPath, size: 0, error: 'Entry not found in archive' })
        }
      })
      zip.on('error', reject)
    })
  })
}

function readTarEntry(
  filePath: string,
  entryPath: string,
  gzip: boolean
): Promise<ArchiveReadEntryResult> {
  const want = normalizeEntryPath(entryPath).toLowerCase()
  return new Promise((resolve, reject) => {
    let found = false
    let settled = false
    const finish = (result: ArchiveReadEntryResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      const name = normalizeEntryPath((header.name || '').replace(/\\/g, '/'))
      if (found || name.toLowerCase() !== want || header.type === 'directory') {
        stream.resume()
        stream.on('end', next)
        return
      }
      found = true
      const size = typeof header.size === 'number' ? header.size : 0
      const fileName = basename(name)
      if (!isLikelyTextFile(fileName) && size > 256 * 1024) {
        stream.resume()
        stream.on('end', () => {
          finish({ path: name, size, binary: true })
          next()
        })
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      let truncated = false
      stream.on('data', (chunk: Buffer) => {
        if (total >= ARCHIVE_TEXT_PREVIEW_MAX) {
          truncated = true
          return
        }
        const take = Math.min(chunk.length, ARCHIVE_TEXT_PREVIEW_MAX - total)
        chunks.push(chunk.subarray(0, take))
        total += take
      })
      stream.on('end', () => {
        const buf = Buffer.concat(chunks)
        const sample = buf.subarray(0, Math.min(buf.length, 8000))
        let nulls = 0
        for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nulls++
        if (nulls > 0) {
          finish({ path: name, size, binary: true })
        } else {
          finish({
            path: name,
            size,
            content: buf.toString('utf8'),
            truncated,
            binary: false
          })
        }
        next()
      })
      stream.on('error', reject)
    })
    extract.on('finish', () => {
      if (!found) finish({ path: entryPath, size: 0, error: 'Entry not found in archive' })
    })
    extract.on('error', reject)
    const input = createReadStream(filePath)
    input.on('error', reject)
    if (gzip) {
      const gunzip = createGunzip()
      gunzip.on('error', reject)
      input.pipe(gunzip).pipe(extract)
    } else {
      input.pipe(extract)
    }
  })
}

export async function pickAndOpenArchive(
  eventSender?: Electron.WebContents
): Promise<ArchiveOpenResult> {
  const win =
    (eventSender && BrowserWindow.fromWebContents(eventSender)) ||
    BrowserWindow.getFocusedWindow()
  const opts: Electron.OpenDialogOptions = {
    title: 'Open ZIP, TAR, or TAR.GZ archive',
    properties: ['openFile'],
    filters: [
      {
        name: 'Archives',
        extensions: ['zip', 'ZIP', 'tar', 'TAR', 'tar.gz', 'tgz', 'gz']
      },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  const filePath = result.filePaths[0]
  return openArchiveAtPath(filePath)
}

export async function openArchiveAtPath(filePath: string): Promise<ArchiveOpenResult> {
  if (!existsSync(filePath)) {
    return { canceled: false, error: 'File not found' }
  }
  const st = statSync(filePath)
  if (!st.isFile()) {
    return { canceled: false, error: 'Not a file' }
  }

  const extension = extensionFromPath(filePath)
  try {
    const entries = isTarFamily(extension)
      ? await listTar(filePath, isGzipTar(extension))
      : await listZip(filePath)
    // Dedupe paths
    const seen = new Set<string>()
    const unique: ArchiveListEntry[] = []
    for (const e of entries) {
      const key = `${e.isDirectory ? 'd' : 'f'}:${e.path.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(e)
    }
    logInteraction('archive_open', {
      path: filePath,
      extension,
      entryCount: unique.length
    })
    return {
      canceled: false,
      filePath,
      extension,
      archiveFileName: basename(filePath).replace(/\.(zip|tar)$/i, ''),
      entries: unique
    }
  } catch (e) {
    return {
      canceled: false,
      filePath,
      error: e instanceof Error ? e.message : 'Failed to read archive'
    }
  }
}

export async function readArchiveEntry(
  archiveFilePath: string,
  entryPath: string
): Promise<ArchiveReadEntryResult> {
  if (!existsSync(archiveFilePath)) {
    return { path: entryPath, size: 0, error: 'Archive file not found' }
  }
  const extension = extensionFromPath(archiveFilePath)
  try {
    return isTarFamily(extension)
      ? await readTarEntry(archiveFilePath, entryPath, isGzipTar(extension))
      : await readZipEntry(archiveFilePath, entryPath)
  } catch (e) {
    return {
      path: entryPath,
      size: 0,
      error: e instanceof Error ? e.message : 'Failed to read entry'
    }
  }
}
