import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState
} from 'react'
import type {
  CsvLayoutMode,
  ExportFormat,
  SchemaDoc,
  SchemaRow
} from '@shared/types'
import { MAX_GENERATE_RECORDS, MIN_GENERATE_RECORDS } from '@shared/types'
import { serializeCsv } from '@shared/csv'
import { useAppStore } from '../store/appStore'
import { ArchiveWorkspace } from './ArchiveWorkspace'

export interface PreviewPanelHandle {
  generate: () => void
  exportCurrent: () => void
  openArchive: () => void
}

export interface PreviewPanelProps {
  /** Fill parent width (used when outer shell controls width) */
  fill?: boolean
}

/** Safe file base name (no path/extension). Keeps spaces; strips illegal chars. */
function sanitizeFileBaseName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
  return cleaned || 'dataforge-export'
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '')
}

function sampleFromRow(row: SchemaRow): unknown {
  if (row.kind === 'array') {
    return row.children.length
      ? [Object.fromEntries(row.children.map((c) => [c.key, sampleFromRow(c)]))]
      : []
  }
  if (row.kind === 'object' || row.children.length > 0) {
    return Object.fromEntries(row.children.map((c) => [c.key, sampleFromRow(c)]))
  }
  if (row.sampleValue !== undefined && row.sampleValue !== '') {
    const n = Number(row.sampleValue)
    if (!Number.isNaN(n) && row.sampleValue.trim() !== '') return n
    if (row.sampleValue === 'true') return true
    if (row.sampleValue === 'false') return false
    return row.sampleValue
  }
  return null
}

/** One sample object from the current schema field values. */
export function buildSchemaSample(root: SchemaRow[]): Record<string, unknown> {
  return Object.fromEntries(root.map((r) => [r.key || 'field', sampleFromRow(r)]))
}

/** Exportable schema definition (what you designed), not generated rows. */
export function buildSchemaDefinition(doc: SchemaDoc): Record<string, unknown> {
  return {
    name: doc.name,
    description: doc.description ?? null,
    fields: doc.root
  }
}

function toPreviewString(
  data: unknown,
  format: ExportFormat,
  csvOpts?: {
    csvLayoutMode?: CsvLayoutMode
    csvMultiRow?: boolean
    csvFlattenDelimiter?: string
    csvNestedAsJson?: boolean
  }
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)
    case 'yaml':
      return jsonToSimpleYaml(data)
    case 'csv':
      return serializeCsv(data, {
        csvLayoutMode: csvOpts?.csvLayoutMode ?? 'single-header',
        csvMultiRow: csvOpts?.csvMultiRow !== false,
        csvFlattenDelimiter: csvOpts?.csvFlattenDelimiter ?? '.',
        csvNestedAsJson: csvOpts?.csvNestedAsJson ?? false
      })
    case 'xml':
      return objectToXmlPreview(data)
    case 'txt':
      return JSON.stringify(data, null, 2)
    default:
      return JSON.stringify(data, null, 2)
  }
}

function jsonToSimpleYaml(data: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null || data === undefined) return 'null'
  if (typeof data !== 'object') return String(data)
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]'
    return data
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const body = jsonToSimpleYaml(item, indent + 1)
          return `${pad}-\n${body
            .split('\n')
            .map((l) => (l ? `  ${l}` : l))
            .join('\n')}`
        }
        return `${pad}- ${jsonToSimpleYaml(item)}`
      })
      .join('\n')
  }
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return `${pad}${k}:\n${jsonToSimpleYaml(v, indent + 1)}`
      }
      return `${pad}${k}: ${jsonToSimpleYaml(v)}`
    })
    .join('\n')
}

function objectToXmlPreview(data: unknown, tag = 'root'): string {
  if (data === null || data === undefined) return `<${tag}/>`
  if (typeof data !== 'object') return `<${tag}>${escapeXml(String(data))}</${tag}>`
  if (Array.isArray(data)) {
    return `<${tag}>\n${data
      .map((item, i) => indentBlock(objectToXmlPreview(item, `item_${i}`)))
      .join('\n')}\n</${tag}>`
  }
  const inner = Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => objectToXmlPreview(v, k))
    .join('\n')
  return `<${tag}>\n${indentBlock(inner)}\n</${tag}>`
}

function indentBlock(s: string): string {
  return s
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const FORMATS: ExportFormat[] = ['json', 'yaml', 'xml', 'csv', 'txt']

/** Stable empty array for optional schema path lists (avoid fresh `[]` each render). */
const EMPTY_TIED_PATHS: string[] = []

type PreviewSource = 'schema' | 'generated'
/** Main panel tab: preview content or full Generate & export controls */
type PanelTab = 'schema' | 'generated' | 'generate'

export const PreviewPanel = forwardRef<PreviewPanelHandle, PreviewPanelProps>(function PreviewPanel(
  { fill = false },
  ref
): JSX.Element {
  const activeSchema = useAppStore((s) => s.activeSchema)
  const settings = useAppStore((s) => s.settings)
  const lastGenerated = useAppStore((s) => s.lastGenerated)
  const generating = useAppStore((s) => s.generating)
  const generateProgress = useAppStore((s) => s.generateProgress)
  const generate = useAppStore((s) => s.generate)
  const exportData = useAppStore((s) => s.exportData)
  const setRecordCount = useAppStore((s) => s.setRecordCount)
  const importSchemaFromFile = useAppStore((s) => s.importSchemaFromFile)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const streamGenerate = useAppStore((s) => s.streamGenerate)
  const setStreamGenerate = useAppStore((s) => s.setStreamGenerate)
  const perFileOutput = useAppStore((s) => s.perFileOutput)
  const setPerFileOutput = useAppStore((s) => s.setPerFileOutput)
  const setPreviewFormat = useAppStore((s) => s.setPreviewFormat)
  const lastStreamPath = useAppStore((s) => s.lastStreamPath)
  const recordCount = useAppStore((s) => s.recordCount)
  const generateSeed = useAppStore((s) => s.generateSeed)
  const setGenerateSeed = useAppStore((s) => s.setGenerateSeed)
  const lockSeed = useAppStore((s) => s.lockSeed)
  const setLockSeed = useAppStore((s) => s.setLockSeed)
  const ciMode = useAppStore((s) => s.ciMode)
  const setCiMode = useAppStore((s) => s.setCiMode)
  const ciRecordHistory = useAppStore((s) => s.ciRecordHistory)
  const setCiRecordHistory = useAppStore((s) => s.setCiRecordHistory)
  const writeManifest = useAppStore((s) => s.writeManifest)
  const setWriteManifest = useAppStore((s) => s.setWriteManifest)
  const csvTieKeysEnabled = useAppStore((s) => s.csvTieKeysEnabled)
  const setCsvTieKeysEnabled = useAppStore((s) => s.setCsvTieKeysEnabled)
  const loadManifestForReplay = useAppStore((s) => s.loadManifestForReplay)
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const [manifestNote, setManifestNote] = useState<string | null>(null)

  const csvLayoutMode = settings.csvLayoutMode ?? 'single-header'
  const csvMultiRow = settings.csvMultiRow !== false
  const tiedPaths = activeSchema?.csvTiedFieldPaths ?? EMPTY_TIED_PATHS

  const [format, setFormat] = useState<ExportFormat>(
    () => settings.defaultExportFormat || 'xml'
  )

  // Restore last chosen format from settings (e.g. after init / reload)
  useEffect(() => {
    const saved = settings.defaultExportFormat
    if (saved && saved !== format) {
      setFormat(saved)
    }
    // Only react to settings persistence, not local format loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.defaultExportFormat])

  useEffect(() => {
    setPreviewFormat(format)
  }, [format, setPreviewFormat])

  function selectFormat(next: ExportFormat): void {
    setFormat(next)
    setPreviewFormat(next)
    // Persist so the same format is used next launch
    void patchSettings({ defaultExportFormat: next })
  }
  const [tab, setTab] = useState<PanelTab>('schema')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  /** Editable export base name (no extension). Defaults to schema name. */
  const [exportFileName, setExportFileName] = useState('dataforge-export')
  const [fileNameTouched, setFileNameTouched] = useState(false)

  // Keep file name in sync with schema name until the user edits it
  useEffect(() => {
    if (!activeSchema) return
    if (!fileNameTouched) {
      setExportFileName(sanitizeFileBaseName(activeSchema.name || 'dataforge-export'))
    }
  }, [activeSchema?.id, activeSchema?.name, fileNameTouched, activeSchema])

  // When switching to a different schema, reset to that schema's name
  useEffect(() => {
    if (!activeSchema) return
    setFileNameTouched(false)
    setExportFileName(sanitizeFileBaseName(activeSchema.name || 'dataforge-export'))
  }, [activeSchema?.id])

  const schemaSample = useMemo(() => {
    if (!activeSchema) return null
    return buildSchemaSample(activeSchema.root)
  }, [activeSchema])

  const schemaDefinition = useMemo(() => {
    if (!activeSchema) return null
    return buildSchemaDefinition(activeSchema)
  }, [activeSchema])

  const generatedData = useMemo(() => {
    if (!lastGenerated?.records?.length) return null
    return lastGenerated.records.length === 1
      ? lastGenerated.records[0]
      : lastGenerated.records
  }, [lastGenerated])

  /** Which data the preview text and export-from-preview use */
  const previewSource: PreviewSource =
    tab === 'generated' && generatedData
      ? 'generated'
      : tab === 'schema'
        ? 'schema'
        : generatedData
          ? 'generated'
          : 'schema'

  const csvOpts = useMemo(
    () => ({
      csvLayoutMode,
      csvMultiRow,
      csvFlattenDelimiter: settings.csvFlattenDelimiter,
      csvNestedAsJson: settings.csvNestedAsJson
    }),
    [csvLayoutMode, csvMultiRow, settings.csvFlattenDelimiter, settings.csvNestedAsJson]
  )

  const text = useMemo(() => {
    if (previewSource === 'generated' && generatedData) {
      // For CSV multi-row, show real rows (cap for UI only)
      let data: unknown = generatedData
      if (
        format === 'csv' &&
        Array.isArray(generatedData) &&
        generatedData.length > 50
      ) {
        data = generatedData.slice(0, 50)
      } else if (
        format !== 'csv' &&
        Array.isArray(generatedData) &&
        generatedData.length > 50
      ) {
        data = [
          ...generatedData.slice(0, 50),
          { _note: `… ${generatedData.length - 50} more records not shown` }
        ]
      }
      return toPreviewString(data, format, csvOpts)
    }
    if (!schemaSample) return '// No schema — add fields in the builder'
    return toPreviewString(schemaSample, format, csvOpts)
  }, [previewSource, generatedData, schemaSample, format, csvOpts])

  async function onGenerate(): Promise<void> {
    setStatusMsg(null)
    try {
      const result = await generate()
      if (result) {
        setTab('generated')
        const seedBit =
          typeof result.seed === 'number'
            ? ` · seed ${result.seed}${result.ciMode ? ' · CI' : ''}`
            : ''
        if (result.streamed && result.filePath) {
          setStatusMsg(
            `Streamed ${result.recordCount.toLocaleString()} record(s) in ${result.ms}ms${seedBit} → ${result.filePath}` +
              (result.encryptedPath ? ` (encrypted)` : '') +
              ` (preview shows first ${result.records.length} sample rows)`
          )
        } else {
          setStatusMsg(
            `Generated ${result.recordCount} record(s) in ${result.ms}ms${seedBit}`
          )
        }
        await refreshStatus()
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Generate failed')
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      generate: () => {
        void onGenerate()
      },
      exportCurrent: () => {
        void onExport('preview')
      },
      openArchive: () => {
        setArchiveOpen(true)
      }
    }),
    // Keep handle fresh for keyboard shortcuts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeSchema,
      format,
      exportFileName,
      generatedData,
      schemaSample,
      lastGenerated,
      settings,
      generating,
      exporting
    ]
  )

  function resolvedExportBaseName(): string {
    const fromField = sanitizeFileBaseName(stripExtension(exportFileName))
    if (fromField) return fromField
    return sanitizeFileBaseName(activeSchema?.name || 'dataforge-export')
  }

  function currentPayload(
    kind: 'preview' | 'definition' = 'preview',
    as?: PreviewSource
  ): unknown | null {
    if (kind === 'definition' && schemaDefinition) return schemaDefinition
    const wantGenerated = (as ?? (tab === 'generated' ? 'generated' : 'schema')) === 'generated'
    if (wantGenerated && generatedData) return generatedData
    if (schemaSample) return schemaSample
    return null
  }

  async function onExport(
    kind: 'preview' | 'definition' = 'preview',
    as?: PreviewSource
  ): Promise<void> {
    setStatusMsg('Opening save dialog…')
    setExporting(true)
    try {
      if (!activeSchema) {
        setStatusMsg('No active schema to export')
        return
      }

      const payload = currentPayload(kind, as)
      if (payload === null) {
        setStatusMsg('Nothing to export — add fields first')
        return
      }

      const exportAs: 'generated' | 'schema' | 'definition' =
        kind === 'definition'
          ? 'definition'
          : as === 'generated' || (as !== 'schema' && tab === 'generated')
            ? 'generated'
            : 'schema'

      const fileName = resolvedExportBaseName()
      const path = await exportData(format, payload, fileName, {
        source: exportAs
      })
      if (path) {
        const encOn =
          settings.encryption?.enabled && settings.encryption?.encryptOnExport
        setStatusMsg(
          encOn
            ? `Saved: ${path} (encryption ran; script changes extension only, base name kept)`
            : `Saved: ${path}`
        )
      } else {
        setStatusMsg('Export canceled')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      setStatusMsg(msg)
      console.error('[DataForge export]', e)
    } finally {
      setExporting(false)
    }
  }

  const hasSchema = Boolean(activeSchema?.root)
  const canExportGenerated = Boolean(generatedData)
  const canExportSchema = hasSchema
  const canArchive = true
  const archiveGeneratedPayload =
    lastGenerated?.streamed
      ? null
      : lastGenerated?.records?.length
        ? lastGenerated.records
        : null

  return (
    <section
      className={`flex h-full flex-col border-l border-border bg-surface ${
        fill ? 'w-full' : 'w-80 shrink-0'
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Preview</span>
        <select
          className="input ml-auto w-auto py-1 text-xs"
          value={format}
          onChange={(e) => selectFormat(e.target.value as ExportFormat)}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          className={`btn-ghost flex-1 text-xs ${tab === 'schema' ? 'bg-surface-2' : ''}`}
          onClick={() => setTab('schema')}
          title="Preview schema sample data"
        >
          Schema
        </button>
        <button
          type="button"
          className={`btn-ghost flex-1 text-xs ${tab === 'generated' ? 'bg-surface-2' : ''}`}
          onClick={() => setTab('generated')}
          disabled={!lastGenerated}
          title={
            lastGenerated
              ? 'Preview auto-generated data from the last run'
              : 'Generate data first to enable this tab'
          }
        >
          Auto-Gen Schema{lastGenerated ? ` (${lastGenerated.recordCount})` : ''}
        </button>
        <button
          type="button"
          className={`btn-ghost flex-1 text-xs ${tab === 'generate' ? 'bg-surface-2' : ''}`}
          onClick={() => setTab('generate')}
          title="Generate, seed/CI options, export and package"
        >
          Generate
        </button>
      </div>

      {tab !== 'generate' && statusMsg && (
        <p
          className={`shrink-0 border-b border-border px-3 py-1.5 text-[11px] break-all ${
            statusMsg.toLowerCase().includes('fail') ||
            statusMsg.toLowerCase().includes('unavailable') ||
            statusMsg.toLowerCase().includes('nothing')
              ? 'text-danger'
              : 'text-muted'
          }`}
        >
          {statusMsg}
        </p>
      )}

      {tab !== 'generate' ? (
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-muted whitespace-pre-wrap">
        {text || '// No preview content'}
      </pre>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Generate & export</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            Records
            <input
              type="number"
              min={MIN_GENERATE_RECORDS}
              max={MAX_GENERATE_RECORDS}
              step={1}
              className="input w-20 py-0.5 font-mono text-xs"
              value={recordCount}
              onChange={(e) => setRecordCount(Number(e.target.value) || MIN_GENERATE_RECORDS)}
              title={`1 – ${MAX_GENERATE_RECORDS.toLocaleString()}`}
            />
          </label>
        </div>
        <p className="text-[10px] text-muted -mt-1">
          Max {MAX_GENERATE_RECORDS.toLocaleString()} records. Switch to Schema / Auto-Gen Schema to
          preview file contents.
        </p>

        <div className="space-y-1.5 rounded-md border border-border bg-bg p-2">
          <div className="label">Reproducibility</div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            <span className="flex flex-wrap items-center gap-2">
              Seed
              <input
                type="text"
                inputMode="numeric"
                className="input w-32 py-1 font-mono text-xs"
                value={generateSeed}
                onChange={(e) => setGenerateSeed(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="random"
                title="Leave empty for a new random seed each run"
              />
              <button
                type="button"
                className="btn-ghost px-2 py-0.5 text-[10px]"
                onClick={() =>
                  setGenerateSeed(String((Math.random() * 0xffffffff) >>> 0))
                }
                title="Pick a new random seed"
              >
                Randomize
              </button>
            </span>
            <label className="flex items-center gap-2 text-[10px] text-muted">
              <input
                type="checkbox"
                checked={lockSeed}
                onChange={(e) => setLockSeed(e.target.checked)}
              />
              <span>
                <span className="font-medium text-text">Lock seed</span>
                {' — '}
                keep seed after generate (off = empty field → new random each run)
              </span>
            </label>
            <span className="text-[10px]">
              Same seed + CI mode + same schema → identical output. Last seed always shows in the
              report below.
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ciMode}
              onChange={(e) => setCiMode(e.target.checked)}
            />
            <span>
              <span className="font-medium text-text">CI mode</span>
              <span className="block text-muted">
                Ignore live history — use samples, enums, and constraints only (portable / CI).
              </span>
            </span>
          </label>
          {ciMode && (
            <label className="flex items-start gap-2 text-xs pl-5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={ciRecordHistory}
                onChange={(e) => setCiRecordHistory(e.target.checked)}
              />
              <span>
                <span className="font-medium text-text">Still record history in CI</span>
                <span className="block text-muted">
                  Optional — keeps generation deterministic for reads, but writes new samples into
                  SQLite.
                </span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={writeManifest}
              onChange={(e) => setWriteManifest(e.target.checked)}
            />
            <span>
              <span className="font-medium text-text">Write run manifest</span>
              <span className="block text-muted">
                On export / stream, also write <span className="font-mono">*.manifest.json</span>{' '}
                (seed, CI flag, schema hash, report).
              </span>
            </span>
          </label>
          <button
            type="button"
            className="btn-ghost w-full border border-border px-2 py-1 text-xs"
            onClick={() => {
              void (async () => {
                setManifestNote(null)
                const preview = await loadManifestForReplay()
                if (!preview) return
                const bits = [
                  `Loaded seed ${preview.manifest.seed}`,
                  `${preview.manifest.recordCount} records`,
                  preview.manifest.ciMode ? 'CI on' : 'CI off'
                ]
                if (preview.schemaHashMatch) bits.push('schema hash match')
                else bits.push('schema hash MISMATCH')
                setManifestNote(bits.join(' · '))
                if (preview.warnings.length) {
                  setStatusMsg(preview.warnings.join(' '))
                } else {
                  setStatusMsg(
                    'Manifest applied. Press Generate to replay (use CI mode for bit-identical output).'
                  )
                }
              })()
            }}
            title="Load seed, CI mode, and record count from a previous *.manifest.json"
          >
            Load from manifest…
          </button>
          {manifestNote && (
            <p className="text-[10px] text-muted break-words">{manifestNote}</p>
          )}
          {lastGenerated && typeof lastGenerated.seed === 'number' && (
            <p className="text-[10px] text-muted">
              Last run: seed <span className="font-mono text-text">{lastGenerated.seed}</span>
              {' · '}
              CI {lastGenerated.ciMode ? 'on' : 'off'}
              {' · '}
              {lastGenerated.ms}ms
            </p>
          )}
          {lastGenerated?.report && (
            <div className="rounded border border-border/80 bg-surface-2/50 p-2 text-[10px] text-muted space-y-0.5">
              <div className="label text-[10px] text-text">Generation report</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
                <span>Leaves</span>
                <span className="text-right text-text">
                  {lastGenerated.report.leafValues.toLocaleString()}
                </span>
                <span>Nulls</span>
                <span className="text-right text-text">
                  {lastGenerated.report.nullValues.toLocaleString()} (
                  {lastGenerated.report.nullRatePct}%)
                </span>
                <span>History hits</span>
                <span className="text-right text-text">
                  {lastGenerated.report.historyHits.toLocaleString()} (
                  {lastGenerated.report.historyHitRate}%)
                </span>
                <span>Enum hits</span>
                <span className="text-right text-text">
                  {lastGenerated.report.enumHits.toLocaleString()}
                </span>
                <span>Synthesized</span>
                <span className="text-right text-text">
                  {lastGenerated.report.synthesized.toLocaleString()}
                </span>
                <span>Mutated sample</span>
                <span className="text-right text-text">
                  {lastGenerated.report.mutatedFromSample.toLocaleString()}
                </span>
                <span>Pattern retries</span>
                <span className="text-right text-text">
                  {lastGenerated.report.patternRetries.toLocaleString()}
                </span>
                <span>Pattern fails</span>
                <span className="text-right text-text">
                  {lastGenerated.report.patternFailures.toLocaleString()}
                </span>
                <span>Length repairs</span>
                <span className="text-right text-text">
                  {lastGenerated.report.lengthRepairs.toLocaleString()}
                </span>
                <span>Numeric repairs</span>
                <span className="text-right text-text">
                  {lastGenerated.report.numericRepairs.toLocaleString()}
                </span>
                <span>Unique exhausted</span>
                <span className="text-right text-text">
                  {lastGenerated.report.uniqueExhausted.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5 rounded-md border border-border bg-bg p-2">
          <div className="label">Output mode</div>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={streamGenerate}
            onChange={(e) => setStreamGenerate(e.target.checked)}
          />
          <span>
            <span className="font-medium text-text">Stream generate to one file</span>
            <span className="block text-muted">
              Low memory: one output file (CSV single-header, JSON as NDJSON/.jsonl, or TXT). Opens
              a save dialog. Counts above 10,000 auto-enable this for CSV/JSON/TXT.
              {streamGenerate &&
                format === 'csv' &&
                csvLayoutMode !== 'single-header' &&
                ' Requires “Single header” CSV layout.'}
              {streamGenerate &&
                (format === 'yaml' || format === 'xml') &&
                ' YAML/XML are not streamable — use per-file output instead.'}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={perFileOutput}
            onChange={(e) => setPerFileOutput(e.target.checked)}
          />
          <span>
            <span className="font-medium text-text">One file per record</span>
            <span className="block text-muted">
              Writes each record as its own file into a folder you choose. Names follow{' '}
              <span className="text-text font-medium">Settings → Per-file naming</span> (tokens like{' '}
              <span className="font-mono">{'{schema}_{index:04}.{ext}'}</span> or{' '}
              <span className="font-mono">{'{field:id}'}</span>). Works for all formats. Only a small
              preview stays in memory.
            </span>
          </span>
        </label>
        {perFileOutput && (
          <p className="rounded border border-border bg-bg px-2 py-1 font-mono text-[10px] text-muted">
            Pattern:{' '}
            <span className="text-text">
              {settings.fileNaming?.pattern || '{schema}_{index:04}.{ext}'}
            </span>
          </p>
        )}
        {lastGenerated?.perFile && (
          <p className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-text">
            Per-file run: wrote {lastGenerated.filesWritten?.toLocaleString() ?? lastGenerated.recordCount}{' '}
            files
            {lastGenerated.filePath ? (
              <>
                {' '}
                under <span className="font-mono break-all">{lastGenerated.filePath}</span>
              </>
            ) : null}
            . Preview shows {lastGenerated.records?.length ?? 0} of{' '}
            {lastGenerated.recordCount.toLocaleString()} records.
          </p>
        )}
        {lastGenerated?.streamed && !lastGenerated?.perFile && (
          <p className="rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] text-text">
            Streamed run: full data is on disk
            {lastGenerated.filePath ? (
              <>
                {' '}
                (<span className="font-mono break-all">{lastGenerated.filePath}</span>)
              </>
            ) : null}
            . Preview shows {lastGenerated.records?.length ?? 0} of{' '}
            {lastGenerated.recordCount.toLocaleString()} records.
          </p>
        )}
        {lastStreamPath && !lastGenerated?.streamed && (
          <p className="text-[10px] text-muted break-all">Last output path: {lastStreamPath}</p>
        )}
        </div>

        {format === 'csv' && (
          <div className="space-y-2 rounded-md border border-border bg-bg p-2">
            <div className="label">CSV options</div>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={csvMultiRow}
                onChange={(e) => void patchSettings({ csvMultiRow: e.target.checked })}
              />
              <span>
                <span className="font-medium text-text">Multiple data rows</span>
                <span className="block text-muted">
                  One header (or section), many data rows from generated records. Off = first
                  record only.
                </span>
              </span>
            </label>

            {csvMultiRow && (
              <div className="space-y-1.5 rounded-md border border-[#d4a017] bg-[rgba(255,215,0,0.1)] p-2">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={csvTieKeysEnabled}
                    onChange={(e) => setCsvTieKeysEnabled(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-text">Tie keys across rows</span>
                    <span className="block text-muted">
                      When on, checkboxes appear left of each key in the schema builder. Checked
                      fields use the <span className="text-text font-medium">exact sample value</span>{' '}
                      you entered (e.g. Joe / Toe) on every generated CSV row — shown in{' '}
                      <span className="font-medium text-[#b8860b]">gold</span>. Other fields still
                      vary.
                    </span>
                  </span>
                </label>
                {csvTieKeysEnabled && (
                  <p className="pl-6 text-[10px] text-[#b8860b]">
                    {tiedPaths.length > 0
                      ? `Locked to schema samples: ${tiedPaths.join(', ')}`
                      : 'No fields tied yet — set sample values, then check boxes next to keys.'}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Header layout
              </span>
              {(
                [
                  {
                    id: 'single-header' as const,
                    title: 'Single header (union of keys)',
                    desc: 'Classic CSV: one header row, then rows.'
                  },
                  {
                    id: 'entity-sections' as const,
                    title: 'Entity sections',
                    desc: 'Nested arrays/objects → separate # entity blocks, each with its own header.'
                  },
                  {
                    id: 'per-key-sections' as const,
                    title: 'Per-key sections',
                    desc: 'Each unique key is a header line, then its values as following lines.'
                  }
                ] as const
              ).map((opt) => (
                <label key={opt.id} className="flex items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="csv-layout"
                    className="mt-0.5"
                    checked={csvLayoutMode === opt.id}
                    onChange={() => void patchSettings({ csvLayoutMode: opt.id })}
                  />
                  <span>
                    <span className="font-medium text-text">{opt.title}</span>
                    <span className="block text-muted">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={settings.csvNestedAsJson}
                onChange={(e) =>
                  void patchSettings({ csvNestedAsJson: e.target.checked })
                }
              />
              Nested objects as JSON strings in cells
            </label>
          </div>
        )}

        <div>
          <label className="label mb-1 block" htmlFor="export-file-name">
            File name
          </label>
          <div className="flex items-center gap-1">
            <input
              id="export-file-name"
              className="input min-w-0 flex-1 font-mono text-xs"
              value={exportFileName}
              onChange={(e) => {
                setFileNameTouched(true)
                setExportFileName(e.target.value)
              }}
              placeholder={activeSchema?.name || 'dataforge-export'}
              spellCheck={false}
              title="Export file name (defaults to schema name)"
            />
            <span className="shrink-0 text-xs text-muted">
              .{format === 'yaml' ? 'yml' : format}
            </span>
          </div>
          <button
            type="button"
            className="btn-ghost mt-1 px-2 py-0.5 text-[10px]"
            onClick={() => {
              setFileNameTouched(false)
              setExportFileName(
                sanitizeFileBaseName(activeSchema?.name || 'dataforge-export')
              )
            }}
            title="Reset file name to current schema name"
          >
            Use schema name
          </button>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          disabled={!activeSchema || generating}
          onClick={() => void onGenerate()}
          title="Ctrl+G"
        >
          {generating
            ? generateProgress?.message ||
              `Generating… ${generateProgress?.percent ?? 0}%`
            : 'Generate'}
        </button>
        {generating && generateProgress && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-100"
              style={{ width: `${generateProgress.percent}%` }}
            />
          </div>
        )}

        {canExportGenerated && (
          <button
            type="button"
            className="btn-primary w-full !bg-surface-2 !text-text border border-border"
            disabled={exporting}
            onClick={() => void onExport('preview', 'generated')}
            title="Export the last generated batch"
          >
            {exporting
              ? 'Exporting…'
              : `Export generated .${format === 'yaml' ? 'yml' : format}…`}
          </button>
        )}
        <button
          type="button"
          className="btn-primary w-full !bg-surface-2 !text-text border border-border"
          disabled={!canExportSchema || exporting}
          onClick={() => void onExport('preview', 'schema')}
        >
          {exporting ? 'Exporting…' : `Export sample .${format === 'yaml' ? 'yml' : format}…`}
        </button>
        <button
          type="button"
          className="btn-ghost w-full border border-border text-xs"
          disabled={!canExportSchema || exporting}
          onClick={() => void onExport('definition')}
          title="Export the schema design (keys, kinds, nesting) for reuse"
        >
          {exporting ? 'Exporting…' : 'Export schema definition…'}
        </button>
        <button
          type="button"
          className="btn-ghost w-full border border-border"
          disabled={!canArchive || exporting}
          onClick={() => setArchiveOpen(true)}
          title="Open or build ZIP/TAR — folder tabs, preview, import as schema"
        >
          Archive Workspace…
        </button>

        {statusMsg && (
          <p
            className={`text-[11px] break-all ${
              statusMsg.toLowerCase().includes('fail') ||
              statusMsg.toLowerCase().includes('unavailable') ||
              statusMsg.toLowerCase().includes('nothing')
                ? 'text-danger'
                : 'text-muted'
            }`}
          >
            {statusMsg}
          </p>
        )}
        <p className="text-[10px] text-muted">
          Shortcuts: Ctrl+G generate · Ctrl+E export · Ctrl+Shift+A archive. Use Schema / Auto-Gen
          Schema tabs to preview content.
        </p>
        </div>
      </div>
      )}

      <ArchiveWorkspace
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        defaultBaseName={resolvedExportBaseName()}
        defaultFormat={format}
        generatedPayload={archiveGeneratedPayload}
        schemaSample={schemaSample}
        busy={exporting}
        onImportSchema={async (fileName, content) => {
          await importSchemaFromFile(fileName, content)
          setArchiveOpen(false)
          setStatusMsg(`Schema imported from archive entry: ${fileName}`)
        }}
        onExported={(path) => {
          setArchiveOpen(false)
          setStatusMsg(`Archive saved: ${path}`)
        }}
        onError={(msg) => setStatusMsg(msg)}
      />
    </section>
  )
})
