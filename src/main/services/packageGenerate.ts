/**
 * Generate N full package variants (each variant = one record = entire package tree).
 * Rebuilds nested archives and outer packaging from SQLite package layout.
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import archiver from 'archiver'
import type {
  ExportFormat,
  FieldGenerateMode,
  NestedArchiveFormat,
  PackageGenerateRequest,
  PackageGenerateResult,
  PackageMember,
  PackageOuterFormat,
  SchemaDoc,
  SchemaRow
} from '../../shared/types'
import { getPackageHydrated } from '../db/packages'
import { getSettings } from '../db/database'
import {
  createGenerationContext,
  flushGenerationHistory,
  generateOneRecord,
  setSuppressHistoryPaths
} from './generator'
import { serializeData } from './formats'
import { logInteraction } from '../db/history'
import { listLeafFieldPaths } from '../../shared/fieldHistory'
import {
  applyTiedFieldPaths,
  buildTiedTemplateFromSchema,
  mergeMissingTiedPaths
} from '../../shared/fieldHistory'
function pad(n: number, w = 4): string {
  return String(n).padStart(w, '0')
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '' : p.slice(0, i)
}

function joinPosix(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`
}

/** Apply same/random/unique modes onto a schema clone for one generation context. */
function applyFieldModes(
  schema: SchemaDoc,
  modes: Record<string, FieldGenerateMode> | undefined,
  defaultMode: FieldGenerateMode
): { schema: SchemaDoc; tiedPaths: string[] } {
  const tied: string[] = []
  const modeOf = (path: string): FieldGenerateMode =>
    modes?.[path] || modes?.[path.toLowerCase()] || defaultMode

  function walk(rows: SchemaRow[], parent: string[]): SchemaRow[] {
    return rows.map((row) => {
      const leaf = (row.key || 'field').trim() || 'field'
      const full = [...parent, leaf]
      const pathKey = full.join('.')
      const kids = row.children?.length ? walk(row.children, full) : row.children
      if (row.kind === 'value' || (!row.children?.length && row.kind !== 'object' && row.kind !== 'array')) {
        const mode = modeOf(pathKey)
        if (mode === 'same') {
          tied.push(pathKey)
          return {
            ...row,
            children: kids,
            isUnique: false,
            isPrimary: false
          }
        }
        if (mode === 'unique') {
          return {
            ...row,
            children: kids,
            isUnique: true
          }
        }
        return {
          ...row,
          children: kids,
          isUnique: false,
          isPrimary: false
        }
      }
      return { ...row, children: kids }
    })
  }

  const root = walk(schema.root, [])
  return {
    schema: {
      ...schema,
      root,
      csvTiedFieldPaths: tied.length ? tied : undefined
    },
    tiedPaths: tied
  }
}

function writeArchiveFile(
  filePath: string,
  format: NestedArchiveFormat | PackageOuterFormat,
  entries: Array<{ path: string; content: string | Buffer }>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath)
    const archive =
      format === 'tar.gz'
        ? archiver('tar', { gzip: true, gzipOptions: { level: 6 } })
        : format === 'tar'
          ? archiver('tar')
          : archiver('zip', { zlib: { level: 6 } })
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    for (const e of entries) {
      archive.append(e.content, { name: e.path.replace(/\\/g, '/') })
    }
    void archive.finalize()
  })
}

function isUnderFolder(filePath: string, folder: string): boolean {
  if (!folder) return true
  return filePath === folder || filePath.startsWith(folder + '/')
}

function relToFolder(filePath: string, folder: string): string {
  if (!folder) return filePath
  if (filePath.startsWith(folder + '/')) return filePath.slice(folder.length + 1)
  return filePath
}

/**
 * Build flat logical text entries for one variant, then pack nested archives outward-in.
 */
async function emitVariant(
  outputPath: string,
  outerFormat: PackageOuterFormat,
  outerExt: string | undefined,
  textEntries: Array<{ path: string; content: string }>,
  nested: Array<{ folderPath: string; originalArchivePath: string; format: NestedArchiveFormat }>,
  packageName: string,
  index: number
): Promise<string> {
  // Sort nested by folder depth descending so inner archives pack first
  const nestedSorted = [...nested].sort(
    (a, b) => b.folderPath.split('/').length - a.folderPath.split('/').length
  )

  // Working map of path -> content (string or we materialize nested as buffers later)
  let files = new Map<string, string | Buffer>()
  for (const t of textEntries) {
    files.set(t.path, t.content)
  }

  for (const nest of nestedSorted) {
    const folder = nest.folderPath
    const children: Array<{ path: string; content: string | Buffer }> = []
    files.forEach((content, p) => {
      if (isUnderFolder(p, folder) && p !== folder) {
        children.push({ path: relToFolder(p, folder), content })
      }
    })
    // Remove children from flat map
    Array.from(files.keys()).forEach((p) => {
      if (isUnderFolder(p, folder) && p !== folder) files.delete(p)
    })
    files.delete(folder)

    // Write nested archive to temp then read as buffer into parent path
    const tmp = `${outputPath}.nest-${index}-${nest.format}`
    await writeArchiveFile(tmp, nest.format, children)
    const { readFileSync, unlinkSync } = await import('fs')
    const buf = readFileSync(tmp)
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    files.set(nest.originalArchivePath, buf)
  }

  const flat = Array.from(files.entries()).map(([path, content]) => ({ path, content }))

  if (outerFormat === 'folder') {
    const dir = join(outputPath, `${packageName}_${pad(index)}`)
    mkdirSync(dir, { recursive: true })
    for (const e of flat) {
      const abs = join(dir, ...e.path.split('/'))
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, e.content)
    }
    return dir
  }

  const packFormat: NestedArchiveFormat =
    outerFormat === 'tar' ? 'tar' : outerFormat === 'tar.gz' ? 'tar.gz' : 'zip'
  const ext =
    outerExt ||
    (packFormat === 'tar.gz' ? '.tar.gz' : packFormat === 'tar' ? '.tar' : '.zip')
  const filePath = join(outputPath, `${packageName}_${pad(index)}${ext}`)
  await writeArchiveFile(filePath, packFormat, flat)
  return filePath
}

export async function generatePackageVariants(
  eventSender: Electron.WebContents,
  request: PackageGenerateRequest,
  onProgress?: (p: { current: number; total: number; message?: string; percent: number }) => void
): Promise<PackageGenerateResult> {
  const started = Date.now()
  const hydrated = getPackageHydrated(request.packageId)
  if (!hydrated) {
    return { canceled: false, written: 0, error: 'Package not found' }
  }

  const textMembers = hydrated.members.filter((m) => m.kind === 'text' && m.schemaId)
  if (textMembers.length === 0) {
    return { canceled: false, written: 0, error: 'Package has no text members with schemas' }
  }

  const count = Math.min(Math.max(request.recordCount || 1, 1), 100_000)
  const defaultMode: FieldGenerateMode = request.defaultFieldMode || 'random'
  const settings = getSettings()

  const win = BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
  const picked = win
    ? await dialog.showOpenDialog(win, {
        title: 'Choose folder for package variants',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: 'Choose folder for package variants',
        properties: ['openDirectory', 'createDirectory']
      })

  if (picked.canceled || !picked.filePaths[0]) {
    return { canceled: true, written: 0 }
  }
  const outDir = picked.filePaths[0]
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  // Prepare per-member schema with modes
  const prepared: Array<{
    member: PackageMember
    schema: SchemaDoc
    tiedPaths: string[]
    format: ExportFormat
  }> = []

  for (const m of textMembers) {
    const schema = hydrated.schemas[m.path]
    if (!schema) continue
    const modes = request.fieldModes?.[m.path] || request.fieldModes?.[m.path.toLowerCase()]
    const { schema: adjusted, tiedPaths } = applyFieldModes(schema, modes, defaultMode)
    prepared.push({
      member: m,
      schema: adjusted,
      tiedPaths,
      format: (m.format || schema.sourceFormat || 'xml') as ExportFormat
    })
  }

  // One generation context per member so unique is per-field across all variants
  const contexts = prepared.map((p) => ({
    ...p,
    scratch: createGenerationContext(count, {
      seed: request.seed,
      ciMode: Boolean(request.ciMode)
    }),
    tieTemplate:
      p.tiedPaths.length > 0
        ? buildTiedTemplateFromSchema(p.schema.root, p.tiedPaths)
        : null
  }))

  const samplePaths: string[] = []
  let written = 0
  const seed = contexts[0]?.scratch.seed

  for (let i = 0; i < count; i++) {
    const textEntries: Array<{ path: string; content: string }> = []
    for (const ctx of contexts) {
      if (ctx.tiedPaths.length) setSuppressHistoryPaths(ctx.scratch, ctx.tiedPaths)
      else setSuppressHistoryPaths(ctx.scratch, null)
      let rec = generateOneRecord(ctx.schema.root, ctx.scratch)
      if (ctx.tieTemplate) {
        if (i === 0) mergeMissingTiedPaths(ctx.tieTemplate, rec, ctx.tiedPaths)
        rec = applyTiedFieldPaths(ctx.tieTemplate, rec, ctx.tiedPaths)
      }
      const content = serializeData(rec, ctx.format, {
        csvMultiRow: false,
        csvLayoutMode: settings.csvLayoutMode,
        csvFlattenDelimiter: settings.csvFlattenDelimiter,
        csvNestedAsJson: settings.csvNestedAsJson,
        xmlRootTag: settings.xmlRootTag,
        xmlRecordTag: settings.xmlRecordTag,
        xmlSelfClosing: settings.xmlSelfClosing
      })
      textEntries.push({ path: ctx.member.path, content })
    }

    const path = await emitVariant(
      outDir,
      hydrated.outerFormat,
      hydrated.outerExtension,
      textEntries,
      hydrated.nestedArchives,
      hydrated.name.replace(/[<>:"/\\|?*]/g, '_') || 'package',
      i + 1
    )
    written++
    if (samplePaths.length < 5) samplePaths.push(path)

    const percent = Math.min(100, Math.round(((i + 1) / count) * 100))
    onProgress?.({
      current: i + 1,
      total: count,
      percent,
      message: `Package variant ${i + 1} of ${count}`
    })
  }

  // Flush history from all contexts
  if (!request.ciMode) {
    for (const ctx of contexts) {
      flushGenerationHistory(ctx.schema.root, ctx.scratch, true)
    }
  }

  logInteraction('package_generate', {
    packageId: request.packageId,
    written,
    seed,
    outerFormat: hydrated.outerFormat
  })

  return {
    canceled: false,
    written,
    outputDir: outDir,
    samplePaths,
    seed,
    ms: Date.now() - started
  }
}

export function listLeafModesForPackage(packageId: string): Record<string, string[]> {
  const hydrated = getPackageHydrated(packageId)
  if (!hydrated) return {}
  const out: Record<string, string[]> = {}
  for (const m of hydrated.members) {
    if (m.kind !== 'text') continue
    const s = hydrated.schemas[m.path]
    if (!s) continue
    out[m.path] = listLeafFieldPaths(s.root)
  }
  return out
}
