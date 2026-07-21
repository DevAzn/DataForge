import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  ArchiveExt,
  ArchiveFileSpec,
  ArchiveMode,
  ExportFormat
} from '@shared/types'

const FORMATS: ExportFormat[] = ['json', 'yaml', 'xml', 'csv', 'txt']
const EXTENSIONS: ArchiveExt[] = ['.zip', '.ZIP', '.tar', '.TAR']

function extForFormat(format: ExportFormat): string {
  return format === 'yaml' ? 'yml' : format
}

function defaultFiles(
  baseName: string,
  count: number,
  format: ExportFormat,
  mode: ArchiveMode
): ArchiveFileSpec[] {
  const base = baseName.trim() || 'data'
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    if (mode === 'split-records') {
      return {
        fileName: count === 1 ? base : `${base}_part${i + 1}`,
        format
      }
    }
    // multi-format: vary format suggestion for extras
    const fmt = i === 0 ? format : FORMATS[i % FORMATS.length]
    return {
      fileName: count === 1 ? base : `${base}_${fmt}`,
      format: fmt
    }
  })
}

export interface ArchiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Suggested base names from schema */
  defaultBaseName: string
  defaultFormat: ExportFormat
  /** Whether we have a multi-record batch (enables split meaningfully) */
  recordCount: number
  busy?: boolean
  onConfirm: (config: {
    extension: ArchiveExt
    topFolderName: string
    mode: ArchiveMode
    files: ArchiveFileSpec[]
    archiveFileName: string
  }) => void
}

export function ArchiveDialog({
  open,
  onOpenChange,
  defaultBaseName,
  defaultFormat,
  recordCount,
  busy,
  onConfirm
}: ArchiveDialogProps): JSX.Element {
  const [extension, setExtension] = useState<ArchiveExt>('.zip')
  const [topFolderName, setTopFolderName] = useState(defaultBaseName)
  const [useTopFolder, setUseTopFolder] = useState(true)
  const [mode, setMode] = useState<ArchiveMode>('multi-format')
  const [fileCount, setFileCount] = useState(2)
  const [files, setFiles] = useState<ArchiveFileSpec[]>(() =>
    defaultFiles(defaultBaseName, 2, defaultFormat, 'multi-format')
  )
  const [archiveFileName, setArchiveFileName] = useState(defaultBaseName)

  // Reset when opened
  useEffect(() => {
    if (!open) return
    const base = defaultBaseName || 'dataforge'
    setTopFolderName(base)
    setUseTopFolder(true)
    setMode('multi-format')
    setFileCount(2)
    setFiles(defaultFiles(base, 2, defaultFormat, 'multi-format'))
    setArchiveFileName(base)
    setExtension('.zip')
  }, [open, defaultBaseName, defaultFormat])

  function applyFileCount(n: number, nextMode = mode): void {
    const count = Math.min(Math.max(n, 1), 50)
    setFileCount(count)
    setFiles((prev) => {
      const base = defaultBaseName || 'data'
      const next = defaultFiles(base, count, defaultFormat, nextMode)
      // Preserve names/formats user already edited when possible
      return next.map((f, i) => ({
        fileName: prev[i]?.fileName || f.fileName,
        format: prev[i]?.format || f.format
      }))
    })
  }

  function updateFile(index: number, patch: Partial<ArchiveFileSpec>): void {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  const previewEntries = useMemo(() => {
    const folder = useTopFolder && topFolderName.trim() ? topFolderName.trim() : ''
    return files.map((f) => {
      const ext = extForFormat(f.format)
      const name =
        f.fileName.toLowerCase().endsWith(`.${ext}`) || f.fileName.includes('.')
          ? f.fileName
          : `${f.fileName}.${ext}`
      return folder ? `${folder}/${name}` : name
    })
  }, [files, useTopFolder, topFolderName])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-text">
            Package as archive
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted">
            Create a .zip / .tar with optional top folder and multiple nested files.
            {recordCount > 0
              ? ` Current data: ${recordCount} record(s).`
              : ' Using schema sample data.'}
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            <div>
              <label className="label mb-1 block">Archive file name</label>
              <div className="flex items-center gap-1">
                <input
                  className="input font-mono text-xs"
                  value={archiveFileName}
                  onChange={(e) => setArchiveFileName(e.target.value)}
                  spellCheck={false}
                />
                <select
                  className="input w-auto py-1.5 font-mono text-xs"
                  value={extension}
                  onChange={(e) => setExtension(e.target.value as ArchiveExt)}
                >
                  {EXTENSIONS.map((ext) => (
                    <option key={ext} value={ext}>
                      {ext}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[10px] text-muted">
                Extension casing is preserved (e.g. .ZIP vs .zip).
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useTopFolder}
                  onChange={(e) => setUseTopFolder(e.target.checked)}
                />
                Include top-level folder inside archive
              </label>
              {useTopFolder && (
                <input
                  className="input mt-2 font-mono text-xs"
                  value={topFolderName}
                  onChange={(e) => setTopFolderName(e.target.value)}
                  placeholder="folder name"
                  spellCheck={false}
                />
              )}
            </div>

            <div>
              <div className="label mb-2">Mode</div>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="archive-mode"
                    checked={mode === 'multi-format'}
                    onChange={() => {
                      setMode('multi-format')
                      applyFileCount(fileCount, 'multi-format')
                    }}
                  />
                  <span>
                    <span className="font-medium">Multi-format bundle</span>
                    <span className="block text-xs text-muted">
                      Same data in each file; pick format/name per entry (e.g. data.json +
                      data.csv).
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="archive-mode"
                    checked={mode === 'split-records'}
                    onChange={() => {
                      setMode('split-records')
                      applyFileCount(fileCount, 'split-records')
                    }}
                  />
                  <span>
                    <span className="font-medium">Split records</span>
                    <span className="block text-xs text-muted">
                      Partition generated rows across N named files (best after Generate).
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="label mb-1 block">Nested files</label>
              <input
                type="number"
                min={1}
                max={50}
                className="input w-24 py-1"
                value={fileCount}
                onChange={(e) => applyFileCount(Number(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <div className="label">File names & formats</div>
              {files.map((file, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg p-2"
                >
                  <span className="w-5 text-xs text-muted">{i + 1}.</span>
                  <input
                    className="input min-w-0 flex-1 font-mono text-xs"
                    value={file.fileName}
                    onChange={(e) => updateFile(i, { fileName: e.target.value })}
                    placeholder="file name"
                    spellCheck={false}
                  />
                  <select
                    className="input w-auto py-1 text-xs"
                    value={file.format}
                    onChange={(e) =>
                      updateFile(i, { format: e.target.value as ExportFormat })
                    }
                    disabled={mode === 'split-records' && i > 0}
                    title={
                      mode === 'split-records'
                        ? 'Split mode uses the first file’s format for all parts'
                        : undefined
                    }
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {mode === 'split-records' && files.length > 1 && (
                <p className="text-[10px] text-muted">
                  Split mode: all parts use format{' '}
                  <strong className="text-text">{files[0]?.format.toUpperCase()}</strong>{' '}
                  (from file 1).
                </p>
              )}
            </div>

            <div className="rounded-md border border-border bg-bg p-2">
              <div className="label mb-1">Archive preview</div>
              <ul className="font-mono text-[11px] text-muted space-y-0.5">
                <li className="text-text">
                  {archiveFileName || 'archive'}
                  {extension}
                </li>
                {previewEntries.map((p) => (
                  <li key={p} className="pl-3">
                    └ {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="btn-ghost border border-border" disabled={busy}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || files.every((f) => !f.fileName.trim())}
              onClick={() => {
                const normalized =
                  mode === 'split-records'
                    ? files.map((f) => ({
                        ...f,
                        format: files[0]?.format || defaultFormat
                      }))
                    : files
                onConfirm({
                  extension,
                  topFolderName: useTopFolder ? topFolderName.trim() : '',
                  mode,
                  files: normalized,
                  archiveFileName: archiveFileName.trim() || defaultBaseName
                })
              }}
            >
              {busy ? 'Packaging…' : 'Create archive…'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
