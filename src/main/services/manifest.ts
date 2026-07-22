import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import type {
  ExportFormat,
  GenerationReport,
  LoadManifestResult,
  ManifestApplyPreview,
  RunManifest,
  SchemaDoc
} from '../../shared/types'

/** Stable hash of schema structure (keys, kinds, constraints — not timestamps). */
export function hashSchema(schema: SchemaDoc): string {
  const canonical = {
    name: schema.name,
    csvTiedFieldPaths: schema.csvTiedFieldPaths ?? [],
    root: stripIds(schema.root)
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

function stripIds(rows: SchemaDoc['root']): unknown[] {
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    sampleValue: r.sampleValue,
    nullRate: r.nullRate,
    enumValues: r.enumValues,
    minLength: r.minLength,
    maxLength: r.maxLength,
    min: r.min,
    max: r.max,
    pattern: r.pattern,
    isPrimary: r.isPrimary,
    isUnique: r.isUnique,
    relationship: r.relationship,
    categoryOverride: r.categoryOverride,
    historyPool: r.historyPool,
    historySourceKeys: r.historySourceKeys,
    children: stripIds(r.children ?? [])
  }))
}

// Note: schema-level csvTiedFieldPaths is hashed separately via name/root only;
// include in hashSchema canonical if determinism for CSV ties is required.

export function buildRunManifest(opts: {
  seed: number
  ciMode: boolean
  recordCount: number
  format?: ExportFormat
  schema?: SchemaDoc
  recordHistory?: boolean
  report?: GenerationReport
}): RunManifest {
  const schema = opts.schema
  return {
    app: 'DataForge',
    version: app.getVersion?.() || '1.0.0',
    createdAt: new Date().toISOString(),
    seed: opts.seed,
    ciMode: opts.ciMode,
    recordCount: opts.recordCount,
    format: opts.format,
    schemaId: schema?.id,
    schemaName: schema?.name,
    schemaHash: schema ? hashSchema(schema) : 'none',
    recordHistory: opts.recordHistory ?? false,
    report: opts.report
  }
}

/** Write manifest next to an export path: foo.json → foo.manifest.json */
export function writeManifestBeside(
  exportFilePath: string,
  manifest: RunManifest
): string {
  const dir = dirname(exportFilePath)
  const base = exportFilePath.replace(/\\/g, '/').split('/').pop() || 'export'
  const stem = base.includes('.') ? base.replace(/\.[^.]+$/, '') : base
  const outPath = join(dir, `${stem}.manifest.json`)
  writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8')
  return outPath
}

export function parseManifestJson(text: string): RunManifest {
  const parsed = JSON.parse(text) as Partial<RunManifest>
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Manifest is not a JSON object.')
  }
  if (typeof parsed.seed !== 'number' || !Number.isFinite(parsed.seed)) {
    throw new Error('Manifest is missing a numeric seed.')
  }
  if (typeof parsed.recordCount !== 'number' || parsed.recordCount < 1) {
    throw new Error('Manifest is missing a valid recordCount.')
  }
  if (typeof parsed.schemaHash !== 'string' || !parsed.schemaHash) {
    throw new Error('Manifest is missing schemaHash.')
  }
  return {
    app: 'DataForge',
    version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
    createdAt:
      typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    seed: parsed.seed >>> 0,
    ciMode: Boolean(parsed.ciMode),
    recordCount: Math.floor(parsed.recordCount),
    format: parsed.format,
    schemaId: parsed.schemaId,
    schemaName: parsed.schemaName,
    schemaHash: parsed.schemaHash,
    recordHistory: Boolean(parsed.recordHistory),
    report: parsed.report
  }
}

export async function pickAndLoadManifest(
  eventSender?: Electron.WebContents
): Promise<LoadManifestResult> {
  const win = eventSender
    ? BrowserWindow.fromWebContents(eventSender) ?? BrowserWindow.getFocusedWindow()
    : BrowserWindow.getFocusedWindow()
  const picked = win
    ? await dialog.showOpenDialog(win, {
        title: 'Open run manifest',
        filters: [
          { name: 'DataForge manifest', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })
    : await dialog.showOpenDialog({
        title: 'Open run manifest',
        filters: [
          { name: 'DataForge manifest', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

  if (picked.canceled || !picked.filePaths[0]) {
    return { canceled: true }
  }
  const filePath = picked.filePaths[0]
  try {
    const text = readFileSync(filePath, 'utf8')
    const manifest = parseManifestJson(text)
    return { canceled: false, manifest, filePath }
  } catch (e) {
    return {
      canceled: false,
      filePath,
      error: e instanceof Error ? e.message : 'Failed to read manifest'
    }
  }
}

export function previewManifestAgainstSchema(
  manifest: RunManifest,
  schema: SchemaDoc | null | undefined,
  filePath?: string
): ManifestApplyPreview {
  const warnings: string[] = []
  if (!schema) {
    warnings.push('No schema is open. Load the matching schema first, then re-apply the manifest.')
    return {
      manifest,
      filePath,
      currentSchemaHash: 'none',
      schemaHashMatch: false,
      schemaIdMatch: null,
      schemaNameMatch: null,
      warnings
    }
  }
  const currentSchemaHash = hashSchema(schema)
  const schemaHashMatch = currentSchemaHash === manifest.schemaHash
  const schemaIdMatch =
    manifest.schemaId != null && manifest.schemaId !== ''
      ? schema.id === manifest.schemaId
      : null
  const schemaNameMatch =
    manifest.schemaName != null && manifest.schemaName !== ''
      ? schema.name === manifest.schemaName
      : null

  if (!schemaHashMatch) {
    warnings.push(
      `Schema structure hash differs (manifest ${manifest.schemaHash}, current ${currentSchemaHash}). Output may not match the original run.`
    )
  }
  if (schemaIdMatch === false) {
    warnings.push(
      `Schema id differs (manifest “${manifest.schemaId}”, current “${schema.id}”).`
    )
  }
  if (schemaNameMatch === false) {
    warnings.push(
      `Schema name differs (manifest “${manifest.schemaName}”, current “${schema.name}”).`
    )
  }
  if (manifest.ciMode === false) {
    warnings.push(
      'Original run used live history (CI off). Replay with CI off may still differ if history changed; prefer CI mode for bit-identical runs.'
    )
  }

  return {
    manifest,
    filePath,
    currentSchemaHash,
    schemaHashMatch,
    schemaIdMatch,
    schemaNameMatch,
    warnings
  }
}
