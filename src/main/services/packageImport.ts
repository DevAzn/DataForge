/**
 * Import a multi-file package (archive or folder).
 * Whole package = one record unit for variation generation.
 * Nested zip/tar/tar.gz are expanded into a folder named after the archive (extensions stripped).
 * Unsupported extensions are skipped.
 */
import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  rmSync
} from 'fs'
import { basename, join, relative } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { createGunzip } from 'zlib'
import { Readable } from 'stream'
import yauzl from 'yauzl'
import * as tar from 'tar-stream'
import type {
  ExportFormat,
  NestedArchiveFormat,
  PackageDoc,
  PackageDocHydrated,
  PackageImportResult,
  PackageMember,
  PackageNestedArchiveMeta,
  PackageOuterFormat,
  SchemaDoc,
  SchemaRow
} from '../../shared/types'
import { formatFromFileName, isLikelyTextFile, pathToSegments } from '../../shared/archiveTree'
import { getPaths, listSchemas, saveSchema } from '../db/database'
import { savePackage } from '../db/packages'
import { harvestSchemaSamples, logInteraction, recordMany } from '../db/history'
import { inferSchemaFromFile } from './schemaInfer'

const MAX_TEXT = 25 * 1024 * 1024
const MAX_NEST_DEPTH = 6

function nowIso(): string {
  return new Date().toISOString()
}

function normalizePath(p: string): string {
  return pathToSegments(p.replace(/\\/g, '/')).join('/')
}

/** Strip .tar.gz / .tgz / .zip / .tar (case-insensitive compound). */
export function stripArchiveExtensions(fileName: string): string {
  let base = fileName.replace(/\\/g, '/').split('/').pop() || fileName
  const lower = base.toLowerCase()
  if (lower.endsWith('.tar.gz')) base = base.slice(0, -7)
  else if (lower.endsWith('.tgz')) base = base.slice(0, -4)
  else if (lower.endsWith('.zip')) base = base.slice(0, -4)
  else if (lower.endsWith('.tar')) base = base.slice(0, -4)
  else {
    // single extension
    base = base.replace(/\.[^.]+$/, '')
  }
  return base || 'archive'
}

function detectNestedFormat(name: string): NestedArchiveFormat | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.zip')) return 'zip'
  return null
}

function outerFromExt(filePath: string): { format: PackageOuterFormat; ext: string } {
  const lower = filePath.replace(/\\/g, '/').toLowerCase()
  const name = basename(filePath)
  if (lower.endsWith('.tar.gz')) return { format: 'tar.gz', ext: name.slice(name.toLowerCase().lastIndexOf('.tar.gz')) }
  // preserve actual casing of extension
  if (/\.tar\.gz$/i.test(name)) {
    const m = name.match(/(\.tar\.gz)$/i)
    return { format: 'tar.gz', ext: m ? m[1] : '.tar.gz' }
  }
  if (/\.tgz$/i.test(name)) return { format: 'tar.gz', ext: name.match(/(\.tgz)$/i)?.[1] || '.tgz' }
  if (/\.tar$/i.test(name)) return { format: 'tar', ext: name.match(/(\.tar)$/i)?.[1] || '.tar' }
  if (/\.zip$/i.test(name)) return { format: 'zip', ext: name.match(/(\.zip)$/i)?.[1] || '.zip' }
  return { format: 'folder', ext: '' }
}

interface RawFile {
  path: string
  content: Buffer
}

function readZipBuffer(buf: Buffer): Promise<RawFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err || new Error('Failed to open ZIP'))
        return
      }
      const out: RawFile[] = []
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = normalizePath(entry.fileName.replace(/\\/g, '/'))
        if (!name || /\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            zip.readEntry()
            return
          }
          const chunks: Buffer[] = []
          stream.on('data', (c) => chunks.push(c as Buffer))
          stream.on('end', () => {
            out.push({ path: name, content: Buffer.concat(chunks) })
            zip.readEntry()
          })
          stream.on('error', () => zip.readEntry())
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
    })
  })
}

function readTarBuffer(buf: Buffer, gzip: boolean): Promise<RawFile[]> {
  return new Promise((resolve, reject) => {
    const out: RawFile[] = []
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      const name = normalizePath((header.name || '').replace(/\\/g, '/'))
      if (!name || header.type === 'directory' || /\/$/.test(header.name || '')) {
        stream.resume()
        stream.on('end', next)
        return
      }
      const chunks: Buffer[] = []
      stream.on('data', (c) => chunks.push(c as Buffer))
      stream.on('end', () => {
        out.push({ path: name, content: Buffer.concat(chunks) })
        next()
      })
      stream.on('error', next)
    })
    extract.on('finish', () => resolve(out))
    extract.on('error', reject)
    const input = Readable.from(buf)
    if (gzip) {
      const gunzip = createGunzip()
      gunzip.on('error', reject)
      input.pipe(gunzip).pipe(extract)
    } else {
      input.pipe(extract)
    }
  })
}

async function readArchiveBytes(
  buf: Buffer,
  format: NestedArchiveFormat
): Promise<RawFile[]> {
  if (format === 'zip') return readZipBuffer(buf)
  return readTarBuffer(buf, format === 'tar.gz')
}

interface ExpandResult {
  files: RawFile[]
  nested: PackageNestedArchiveMeta[]
  skipped: string[]
}

/**
 * Expand archives recursively. Nested archives become folderPrefix/basenameWithoutExt/...
 */
async function expandFiles(
  files: RawFile[],
  pathPrefix: string,
  depth: number,
  nested: PackageNestedArchiveMeta[],
  skipped: string[]
): Promise<RawFile[]> {
  if (depth > MAX_NEST_DEPTH) {
    for (const f of files) skipped.push(joinPath(pathPrefix, f.path))
    return []
  }
  const result: RawFile[] = []
  for (const f of files) {
    const fullPath = joinPath(pathPrefix, f.path)
    const name = basename(f.path)
    const nestFmt = detectNestedFormat(name)
    if (nestFmt) {
      const folderName = stripArchiveExtensions(name)
      const folderPath = joinPath(pathPrefix, joinPath(dirnamePosix(f.path), folderName))
      nested.push({
        folderPath,
        originalArchivePath: fullPath,
        format: nestFmt
      })
      try {
        const inner = await readArchiveBytes(f.content, nestFmt)
        const expanded = await expandFiles(inner, folderPath, depth + 1, nested, skipped)
        result.push(...expanded)
      } catch {
        skipped.push(fullPath)
      }
      continue
    }
    if (!isLikelyTextFile(name) && !formatFromFileName(name)) {
      skipped.push(fullPath)
      continue
    }
    if (f.content.length > MAX_TEXT) {
      skipped.push(`${fullPath} (too large)`)
      continue
    }
    result.push({ path: fullPath, content: f.content })
  }
  return result
}

function joinPath(a: string, b: string): string {
  if (!a) return normalizePath(b)
  if (!b) return normalizePath(a)
  return normalizePath(`${a}/${b}`)
}

function dirnamePosix(p: string): string {
  const segs = pathToSegments(p)
  if (segs.length <= 1) return ''
  return segs.slice(0, -1).join('/')
}

function walkFolder(dir: string, base: string): RawFile[] {
  const out: RawFile[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...walkFolder(abs, base))
    } else if (ent.isFile()) {
      const rel = normalizePath(relative(base, abs))
      out.push({ path: rel, content: readFileSync(abs) })
    }
  }
  return out
}

function uniqueMultifileName(baseName: string): string {
  const preferred = baseName.trim() || 'Multifile schema'
  const existing = new Set(listSchemas().map((s) => s.name.toLowerCase()))
  if (!existing.has(preferred.toLowerCase())) return preferred
  let n = 2
  while (existing.has(`${preferred} (${n})`.toLowerCase())) n++
  return `${preferred} (${n})`
}

function cloneRowsWithNewIds(rows: SchemaRow[]): SchemaRow[] {
  return rows.map((r, i) => ({
    ...r,
    id: randomUUID(),
    sortOrder: r.sortOrder ?? i,
    children: r.children?.length ? cloneRowsWithNewIds(r.children) : []
  }))
}

/** Safe object key for a file path inside the multifile umbrella schema. */
function pathAsSchemaKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\//, '') || 'file'
}

async function buildPackageFromFiles(
  name: string,
  sourceKind: PackageDoc['sourceKind'],
  outerFormat: PackageOuterFormat,
  outerExtension: string | undefined,
  rawFiles: RawFile[]
): Promise<PackageDocHydrated> {
  const nested: PackageNestedArchiveMeta[] = []
  const skipped: string[] = []
  const expanded = await expandFiles(rawFiles, '', 0, nested, skipped)

  const packageId = randomUUID()
  const members: PackageMember[] = []
  const schemas: Record<string, SchemaDoc> = {}
  const pendingText: Array<{
    path: string
    fileName: string
    text: string
    format: ExportFormat
    inferredRoot: SchemaRow[]
    historySamples: ReturnType<typeof inferSchemaFromFile>['historySamples']
  }> = []

  // Folder markers for nested archives (so generate knows to re-pack)
  for (const n of nested) {
    members.push({
      id: randomUUID(),
      path: n.folderPath,
      name: basename(n.folderPath),
      kind: 'nested_archive_folder',
      nestedArchivePath: n.originalArchivePath,
      nestedArchiveFormat: n.format,
      verified: true
    })
  }

  for (const f of expanded) {
    const fileName = basename(f.path)
    const format = formatFromFileName(fileName) || detectTextFormat(f.content)
    if (!format) {
      skipped.push(f.path)
      continue
    }
    let text: string
    try {
      text = f.content.toString('utf-8')
    } catch {
      skipped.push(f.path)
      continue
    }
    try {
      const inferred = inferSchemaFromFile(fileName, text, {
        maxScanRecords: 200
      })
      pendingText.push({
        path: f.path,
        fileName,
        text,
        format: inferred.format,
        inferredRoot: inferred.schema.root,
        historySamples: inferred.historySamples
      })
    } catch {
      skipped.push(f.path)
    }
  }

  const isMultifile = pendingText.length > 1
  const displayName = isMultifile
    ? uniqueMultifileName(
        name && name !== 'package' ? `Multifile schema — ${name}` : 'Multifile schema'
      )
    : name

  for (const item of pendingText) {
    const memberSchemaName = isMultifile
      ? `${displayName} › ${item.path}`
      : item.fileName.replace(/\.[^.]+$/, '') || item.fileName

    const schema: SchemaDoc = {
      id: randomUUID(),
      name: memberSchemaName,
      root: item.inferredRoot,
      sourceFileName: item.fileName,
      sourceFormat: item.format,
      isPackageMember: isMultifile || undefined,
      packageId: isMultifile ? packageId : undefined,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    const saved = saveSchema(schema)
    const samples = harvestSchemaSamples(saved.root)
    if (samples.length) recordMany([...samples, ...item.historySamples], 'ensure')
    else if (item.historySamples.length) recordMany(item.historySamples, 'ensure')

    members.push({
      id: randomUUID(),
      path: item.path,
      name: item.fileName,
      kind: 'text',
      format: item.format,
      content: item.text,
      schemaId: saved.id,
      verified: false
    })
    schemas[item.path] = saved
  }

  // Sort: folders first then text by path
  members.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'nested_archive_folder' ? -1 : 1
    return a.path.localeCompare(b.path)
  })

  let multifileSchemaId: string | undefined
  if (isMultifile) {
    // Umbrella schema: one object node per text file, children = that file's schema tree
    const multifileRoot: SchemaRow[] = pendingText.map((item, i) => {
      const memberSchema = schemas[item.path]
      return {
        id: randomUUID(),
        key: pathAsSchemaKey(item.path),
        kind: 'object' as const,
        isPrimary: false,
        isUnique: false,
        sampleValue: undefined,
        children: memberSchema
          ? cloneRowsWithNewIds(memberSchema.root)
          : cloneRowsWithNewIds(item.inferredRoot),
        sortOrder: i
      }
    })
    const multifile: SchemaDoc = {
      id: randomUUID(),
      name: displayName,
      description: `Multifile package (${pendingText.length} files): ${pendingText.map((p) => p.path).join(', ')}`,
      root: multifileRoot,
      sourceFileName: name,
      isMultifile: true,
      packageId,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    const savedMulti = saveSchema(multifile)
    multifileSchemaId = savedMulti.id
    schemas['__multifile__'] = savedMulti
  }

  const doc: PackageDoc = {
    id: packageId,
    name: displayName,
    sourceKind,
    outerFormat,
    outerExtension,
    members,
    nestedArchives: nested,
    skipped,
    multifileSchemaId,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
  const saved = savePackage(doc)
  logInteraction('package_import', {
    id: saved.id,
    members: saved.members.length,
    skipped: saved.skipped.length,
    nested: saved.nestedArchives.length,
    multifile: isMultifile,
    multifileSchemaId
  })
  return { ...saved, schemas }
}

function detectTextFormat(buf: Buffer): ExportFormat | undefined {
  const t = buf.slice(0, 256).toString('utf-8').trim()
  if (t.startsWith('<')) return 'xml'
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  return undefined
}

export async function pickAndImportPackage(
  eventSender: Electron.WebContents
): Promise<PackageImportResult> {
  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Import package (archive or folder)',
        properties: ['openFile', 'openDirectory'],
        filters: [
          { name: 'Archives', extensions: ['zip', 'ZIP', 'tar', 'TAR', 'gz', 'tgz'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    : await dialog.showOpenDialog({
        title: 'Import package (archive or folder)',
        properties: ['openFile', 'openDirectory'],
        filters: [
          { name: 'Archives', extensions: ['zip', 'ZIP', 'tar', 'TAR', 'gz', 'tgz'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }

  const picked = result.filePaths[0]
  try {
    const st = statSync(picked)
    if (st.isDirectory()) {
      const raw = walkFolder(picked, picked)
      // Treat as flat file list; also expand any nested archives found on disk as files
      const pkg = await buildPackageFromFiles(
        basename(picked),
        'folder',
        'folder',
        undefined,
        raw
      )
      return { canceled: false, package: pkg }
    }

    const outer = outerFromExt(picked)
    if (outer.format === 'folder') {
      // Single non-archive file — treat as 1-file package
      const buf = readFileSync(picked)
      const name = basename(picked)
      if (!isLikelyTextFile(name)) {
        return { canceled: false, error: 'Unsupported file type (not a handled text format or archive)' }
      }
      const pkg = await buildPackageFromFiles(
        stripArchiveExtensions(name) || name,
        'files',
        'folder',
        undefined,
        [{ path: name, content: buf }]
      )
      return { canceled: false, package: pkg }
    }

    const buf = readFileSync(picked)
    const nestFmt: NestedArchiveFormat =
      outer.format === 'zip' ? 'zip' : outer.format === 'tar' ? 'tar' : 'tar.gz'
    const raw = await readArchiveBytes(buf, nestFmt)
    const pkg = await buildPackageFromFiles(
      stripArchiveExtensions(basename(picked)),
      'archive',
      outer.format,
      outer.ext,
      raw
    )
    return { canceled: false, package: pkg }
  } catch (e) {
    return {
      canceled: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function pickAndImportPackageFiles(
  eventSender: Electron.WebContents
): Promise<PackageImportResult> {
  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Import package files (multi-select)',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Data & archives', extensions: ['xml', 'json', 'csv', 'yml', 'yaml', 'txt', 'zip', 'tar', 'gz', 'tgz'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    : await dialog.showOpenDialog({
        title: 'Import package files (multi-select)',
        properties: ['openFile', 'multiSelections']
      })

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true }
  }

  try {
    const raw: RawFile[] = result.filePaths.map((p) => ({
      path: basename(p),
      content: readFileSync(p)
    }))
    const name =
      result.filePaths.length === 1
        ? stripArchiveExtensions(basename(result.filePaths[0]))
        : `package-${nowIso().slice(0, 10)}`
    // If single archive selected, expand as archive package
    if (result.filePaths.length === 1) {
      const outer = outerFromExt(result.filePaths[0])
      if (outer.format !== 'folder') {
        const nestFmt: NestedArchiveFormat =
          outer.format === 'zip' ? 'zip' : outer.format === 'tar' ? 'tar' : 'tar.gz'
        const archiveRaw = await readArchiveBytes(raw[0].content, nestFmt)
        const pkg = await buildPackageFromFiles(
          stripArchiveExtensions(basename(result.filePaths[0])),
          'archive',
          outer.format,
          outer.ext,
          archiveRaw
        )
        return { canceled: false, package: pkg }
      }
    }
    const pkg = await buildPackageFromFiles(name, 'files', 'folder', undefined, raw)
    return { canceled: false, package: pkg }
  } catch (e) {
    return { canceled: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Temp dir under userData for package generate output staging. */
export function packageWorkDir(packageId: string): string {
  const dir = join(getPaths().userData, 'packages', packageId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function clearPackageWorkDir(packageId: string): void {
  const dir = join(getPaths().userData, 'packages', packageId, 'gen')
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
