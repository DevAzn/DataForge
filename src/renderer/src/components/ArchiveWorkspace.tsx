import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ArchiveExt, ExportFormat, SchemaRow } from '@shared/types'
import { MIN_GENERATE_RECORDS, MAX_GENERATE_RECORDS } from '@shared/types'
import {
  addFileAt,
  addFolderAt,
  buildTreeFromEntries,
  cloneTree,
  countFiles,
  createEmptyWorkspace,
  flattenTreeToEntries,
  formatFromFileName,
  getFileAtPath,
  listAllDirPaths,
  moveAtPath,
  parentPath,
  pathToSegments,
  remapPathAfterChange,
  removeAtPath,
  renameAtPath,
  setFileContent,
  type ArchiveDirNode,
  type ArchiveFileNode,
  type ArchiveNode,
  type ArchiveWorkspaceDoc
} from '@shared/archiveTree'
import { useAppStore } from '../store/appStore'
import { SchemaBuilder } from './SchemaBuilder'
import { serializeDataForArchive } from './archiveSerialize'

/** Minimal schema sample (avoid circular import with PreviewPanel). */
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

function buildSchemaSample(root: SchemaRow[]): Record<string, unknown> {
  return Object.fromEntries(root.map((r) => [r.key || 'field', sampleFromRow(r)]))
}

const EXTENSIONS: ArchiveExt[] = ['.zip', '.ZIP', '.tar', '.TAR', '.tar.gz', '.tgz']
const FORMATS: ExportFormat[] = ['json', 'yaml', 'xml', 'csv', 'txt']

type WorkspaceView = 'pack' | 'schema'

export interface ArchiveWorkspaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultBaseName: string
  defaultFormat: ExportFormat
  generatedPayload: unknown | null
  schemaSample: unknown | null
  busy?: boolean
  onImportSchema: (fileName: string, content: string) => Promise<void>
  onExported?: (filePath: string) => void
  onError?: (message: string) => void
}

function dirLabel(path: string): string {
  return path ? path : '(root)'
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 4l4 4-4 4V4z" />
    </svg>
  )
}

function FolderIcon({ open }: { open?: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-[#dcb67a]" fill="currentColor" aria-hidden>
      {open ? (
        <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.379a1.5 1.5 0 0 1 1.06.44L8.5 3.5H13A1.5 1.5 0 0 1 14.5 5v.5H1.5v-2zM1.5 6.5h13V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V6.5z" />
      ) : (
        <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.379a1.5 1.5 0 0 1 1.06.44l.621.62H13A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V3z" />
      )}
    </svg>
  )
}

function FileGlyph({ name }: { name: string }): JSX.Element {
  const fmt = formatFromFileName(name)
  const color =
    fmt === 'json'
      ? 'text-[#cbcb41]'
      : fmt === 'csv'
        ? 'text-[#89d185]'
        : fmt === 'xml' || fmt === 'yaml'
          ? 'text-[#519aba]'
          : 'text-muted'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={`shrink-0 ${color}`} fill="currentColor" aria-hidden>
      <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.621a1.5 1.5 0 0 0-.44-1.06L10.44 1.94A1.5 1.5 0 0 0 9.378 1.5H4zm5 1.12L12.38 6H10a1 1 0 0 1-1-1V2.62z" />
    </svg>
  )
}

interface ExplorerRowProps {
  depth: number
  selected: boolean
  onSelect: () => void
  leading: ReactNode
  label: string
  title?: string
  actions?: ReactNode
  onDoubleClick?: () => void
}

function ExplorerRow({
  depth,
  selected,
  onSelect,
  leading,
  label,
  title,
  actions,
  onDoubleClick
}: ExplorerRowProps): JSX.Element {
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      className={`explorer-row group flex h-[22px] cursor-default items-center pr-1 text-[13px] leading-none ${
        selected ? 'bg-list-active text-text' : 'text-text hover:bg-list-hover'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {leading}
        <span className="truncate">{label}</span>
      </span>
      {actions && (
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </span>
      )}
    </div>
  )
}

type ChipTone = 'rename' | 'move' | 'schema' | 'delete'

function ExplorerAction({
  label,
  onClick,
  tone
}: {
  label: string
  onClick: () => void
  tone: ChipTone
}): JSX.Element {
  const toneClass =
    tone === 'rename'
      ? 'chip-rename'
      : tone === 'move'
        ? 'chip-move'
        : tone === 'schema'
          ? 'chip-schema'
          : 'chip-delete'
  return (
    <button type="button" className={toneClass} onClick={onClick} title={label}>
      {label}
    </button>
  )
}

export function ArchiveWorkspace({
  open,
  onOpenChange,
  defaultBaseName,
  defaultFormat,
  generatedPayload,
  schemaSample,
  busy,
  onImportSchema,
  onExported,
  onError
}: ArchiveWorkspaceProps): JSX.Element {
  const activeSchema = useAppStore((s) => s.activeSchema)
  const settings = useAppStore((s) => s.settings)
  const recordCount = useAppStore((s) => s.recordCount)
  const setRecordCount = useAppStore((s) => s.setRecordCount)
  const generate = useAppStore((s) => s.generate)
  const generating = useAppStore((s) => s.generating)
  const lastGenerated = useAppStore((s) => s.lastGenerated)
  const generateSeed = useAppStore((s) => s.generateSeed)
  const setGenerateSeed = useAppStore((s) => s.setGenerateSeed)
  const saveActiveSchema = useAppStore((s) => s.saveActiveSchema)

  const [view, setView] = useState<WorkspaceView>('pack')
  const [doc, setDoc] = useState<ArchiveWorkspaceDoc>(() =>
    createEmptyWorkspace(defaultBaseName || 'dataforge-pack', '.zip')
  )
  /** Expanded folder paths ('' always expanded as root children) */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  /** Selected tree path (file or folder) */
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewDirty, setPreviewDirty] = useState(false)
  const [previewMeta, setPreviewMeta] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [addFolderOpen, setAddFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [addFileOpen, setAddFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileFormat, setNewFileFormat] = useState<ExportFormat>(defaultFormat)
  const [newFileSource, setNewFileSource] = useState<'generated' | 'schema' | 'empty'>('generated')

  const [renamePath, setRenamePath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [movePath, setMovePath] = useState<string | null>(null)
  const [moveDest, setMoveDest] = useState('')

  const liveSchemaSample = useMemo(
    () => (activeSchema ? buildSchemaSample(activeSchema.root) : null),
    [activeSchema]
  )
  const effectiveSchemaSample = liveSchemaSample ?? schemaSample

  const effectiveGenerated = useMemo(() => {
    if (lastGenerated?.records?.length && !lastGenerated.streamed) {
      return lastGenerated.records.length === 1
        ? lastGenerated.records[0]
        : lastGenerated.records
    }
    return generatedPayload
  }, [lastGenerated, generatedPayload])

  useEffect(() => {
    if (!open) return
    setDoc(createEmptyWorkspace(defaultBaseName || 'dataforge-pack', '.zip'))
    setExpanded(new Set(['']))
    setSelectedPath(null)
    setPreview(null)
    setPreviewDirty(false)
    setPreviewMeta(null)
    setStatus(null)
    setView('pack')
    setAddFolderOpen(false)
    setAddFileOpen(false)
    setRenamePath(null)
    setMovePath(null)
    setNewFileFormat(defaultFormat)
  }, [open, defaultBaseName, defaultFormat])

  const fileCount = useMemo(() => countFiles(doc.root), [doc.root])
  const allDirs = useMemo(() => listAllDirPaths(doc.root), [doc.root])

  /** Folder that receives new files/folders: selected dir, or parent of selected file, else root */
  const targetFolderPath = useMemo(() => {
    if (!selectedPath) return ''
    const file = getFileAtPath(doc.root, selectedPath)
    if (file) return parentPath(selectedPath)
    // folder selected
    return selectedPath
  }, [selectedPath, doc.root])

  const updateRoot = useCallback((mutator: (root: ArchiveDirNode) => void) => {
    setDoc((prev) => {
      const nextRoot = cloneTree(prev.root)
      mutator(nextRoot)
      return { ...prev, root: nextRoot }
    })
  }, [])

  function applyPathRemap(oldPath: string, newPath: string): void {
    setSelectedPath((p) => remapPathAfterChange(p, oldPath, newPath))
    setExpanded((prev) => {
      const next = new Set<string>()
      Array.from(prev).forEach((p) => {
        const mapped = remapPathAfterChange(p, oldPath, newPath)
        next.add(mapped ?? p)
      })
      // ensure ancestors of new path expanded
      const segs = pathToSegments(newPath)
      let acc = ''
      next.add('')
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s
        next.add(acc)
      }
      return next
    })
  }

  function toggleExpand(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function ensureExpanded(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.add('')
      const segs = pathToSegments(path)
      let acc = ''
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s
        next.add(acc)
      }
      return next
    })
  }

  async function handleOpenArchive(): Promise<void> {
    if (typeof window.dataforge?.openArchive !== 'function') {
      onError?.('Archive open API unavailable — restart the app')
      return
    }
    setWorking(true)
    setStatus('Opening archive…')
    try {
      const result = await window.dataforge.openArchive()
      if (result.canceled) {
        setStatus(null)
        return
      }
      if (result.error || !result.entries) {
        setStatus(result.error || 'Failed to open archive')
        onError?.(result.error || 'Failed to open archive')
        return
      }
      const treeEntries = result.entries.map((e) => ({
        path: e.isDirectory ? `${e.path}/` : e.path,
        size: e.size,
        pending: !e.isDirectory,
        binary: false
      }))
      const root = buildTreeFromEntries(treeEntries)
      // Expand top-level folders by default
      const top = new Set<string>([''])
      for (const c of root.children) {
        if (c.kind === 'dir') top.add(c.path)
      }
      setDoc({
        extension: result.extension || '.zip',
        archiveFileName: result.archiveFileName || defaultBaseName || 'archive',
        sourceFilePath: result.filePath,
        root
      })
      setExpanded(top)
      setSelectedPath(null)
      setPreview(null)
      setPreviewDirty(false)
      setPreviewMeta(null)
      setView('pack')
      setStatus(
        `Opened ${result.archiveFileName || 'archive'} · ${result.entries.filter((e) => !e.isDirectory).length} files`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Open failed'
      setStatus(msg)
      onError?.(msg)
    } finally {
      setWorking(false)
    }
  }

  function handleNewArchive(): void {
    setDoc(createEmptyWorkspace(defaultBaseName || 'dataforge-pack', doc.extension))
    setExpanded(new Set(['']))
    setSelectedPath(null)
    setPreview(null)
    setPreviewDirty(false)
    setPreviewMeta(null)
    setStatus('New empty archive')
  }

  async function selectFile(file: ArchiveFileNode): Promise<void> {
    if (previewDirty && selectedPath && getFileAtPath(doc.root, selectedPath)) {
      savePreviewContent(selectedPath, preview)
    }
    setSelectedPath(file.path)
    setPreview(null)
    setPreviewDirty(false)
    setPreviewMeta(null)
    try {
      let content = file.content
      if ((file.pending || content == null) && doc.sourceFilePath && !file.binary) {
        if (typeof window.dataforge?.readArchiveEntry === 'function') {
          const result = await window.dataforge.readArchiveEntry(doc.sourceFilePath, file.path)
          if (result.error) {
            setPreviewMeta(result.error)
            return
          }
          if (result.binary || result.content == null) {
            updateRoot((root) => {
              const f = getFileAtPath(root, file.path)
              if (f) {
                f.binary = true
                f.pending = false
                f.size = result.size
              }
            })
            setPreview(null)
            setPreviewMeta('Binary file — cannot preview')
            return
          }
          content = result.content
          updateRoot((root) => {
            setFileContent(root, file.path, result.content!)
          })
          if (result.truncated) {
            setPreviewMeta('Preview truncated (~2 MB)')
          }
        }
      }
      if (file.binary) {
        setPreview(null)
        setPreviewMeta('Binary file — cannot preview')
        return
      }
      setPreview(content ?? '')
    } catch (e) {
      setPreviewMeta(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  function selectFolder(path: string): void {
    if (previewDirty && selectedPath) {
      const f = getFileAtPath(doc.root, selectedPath)
      if (f && preview != null) savePreviewContent(selectedPath, preview)
    }
    setSelectedPath(path)
    setPreview(null)
    setPreviewDirty(false)
    setPreviewMeta(`Folder · new items go here`)
  }

  function savePreviewContent(path?: string | null, text?: string | null): void {
    const p = path ?? selectedPath
    const body = text ?? preview
    if (!p || body == null) return
    updateRoot((root) => {
      setFileContent(root, p, body)
    })
    setPreviewDirty(false)
    setStatus(`Saved ${p}`)
  }

  function confirmAddFolder(): void {
    const name = newFolderName.trim()
    let err: string | null = null
    let newPath = ''
    updateRoot((root) => {
      const res = addFolderAt(root, targetFolderPath, name)
      if ('error' in res) {
        err = res.error
        return
      }
      newPath = res.path
    })
    if (err) {
      setStatus(err)
      return
    }
    ensureExpanded(parentPath(newPath))
    setExpanded((prev) => new Set(prev).add(targetFolderPath).add(newPath))
    setSelectedPath(newPath)
    setStatus(`Folder ${name}`)
    setAddFolderOpen(false)
    setNewFolderName('')
  }

  function confirmAddFile(): void {
    let content = ''
    const xmlOpts = {
      xmlRootTag: settings.xmlRootTag,
      xmlRecordTag: settings.xmlRecordTag,
      xmlSelfClosing: settings.xmlSelfClosing,
      csvLayoutMode: settings.csvLayoutMode,
      csvMultiRow: settings.csvMultiRow,
      csvFlattenDelimiter: settings.csvFlattenDelimiter,
      csvNestedAsJson: settings.csvNestedAsJson
    }
    if (newFileSource === 'generated' && effectiveGenerated != null) {
      content = serializeDataForArchive(effectiveGenerated, newFileFormat, xmlOpts)
    } else if (newFileSource === 'schema' && effectiveSchemaSample != null) {
      content = serializeDataForArchive(effectiveSchemaSample, newFileFormat, xmlOpts)
    }
    let name = newFileName.trim() || defaultBaseName || 'data'
    let addedPath = ''
    let addError: string | null = null
    updateRoot((root) => {
      const res = addFileAt(root, targetFolderPath, name, {
        content,
        format: newFileFormat
      })
      if ('error' in res) {
        addError = res.error
        return
      }
      addedPath = res.path
    })
    if (addError) {
      setStatus(addError)
      return
    }
    ensureExpanded(targetFolderPath)
    setAddFileOpen(false)
    setNewFileName('')
    setStatus(`Added ${addedPath}`)
    void selectFile({
      kind: 'file',
      id: 'tmp',
      name: addedPath.split('/').pop() || name,
      path: addedPath,
      content,
      format: newFileFormat,
      size: content.length
    })
  }

  function handleRemove(path: string): void {
    updateRoot((root) => {
      const res = removeAtPath(root, path)
      if ('error' in res) {
        setStatus(res.error)
        return
      }
      setStatus('Deleted')
    })
    if (selectedPath === path || selectedPath?.startsWith(path + '/')) {
      setSelectedPath(null)
      setPreview(null)
      setPreviewDirty(false)
    }
  }

  function startRename(path: string, currentName: string): void {
    setMovePath(null)
    setRenamePath(path)
    setRenameValue(currentName)
  }

  function confirmRename(): void {
    if (!renamePath) return
    const oldPath = renamePath
    let newPath = ''
    let err: string | null = null
    updateRoot((root) => {
      const res = renameAtPath(root, oldPath, renameValue)
      if ('error' in res) {
        err = res.error
        return
      }
      newPath = res.path
    })
    if (err) {
      setStatus(err)
      return
    }
    if (newPath) {
      applyPathRemap(oldPath, newPath)
      setStatus(`Renamed → ${newPath}`)
      // refresh preview selection for files
      const f = getFileAtPath(doc.root, newPath)
      if (!f) {
        // tree will update; clear dirty preview path
      }
    }
    setRenamePath(null)
    setRenameValue('')
  }

  function startMove(path: string): void {
    setRenamePath(null)
    setMovePath(path)
    setMoveDest(parentPath(path))
  }

  function confirmMove(): void {
    if (!movePath) return
    const oldPath = movePath
    let newPath = ''
    let err: string | null = null
    updateRoot((root) => {
      const res = moveAtPath(root, oldPath, moveDest)
      if ('error' in res) {
        err = res.error
        return
      }
      newPath = res.path
    })
    if (err) {
      setStatus(err)
      return
    }
    if (newPath) {
      applyPathRemap(oldPath, newPath)
      ensureExpanded(parentPath(newPath))
      setStatus(`Moved → ${newPath}`)
    }
    setMovePath(null)
  }

  async function handleGenerate(): Promise<void> {
    setWorking(true)
    setStatus('Generating…')
    try {
      const result = await generate()
      if (!result) {
        setStatus('Generate canceled or failed')
        return
      }
      if (result.streamed) {
        setStatus('Streamed run — turn off stream for in-memory data to pack')
        return
      }
      setStatus(`Generated ${result.recordCount} records`)
      setNewFileSource('generated')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generate failed'
      setStatus(msg)
      onError?.(msg)
    } finally {
      setWorking(false)
    }
  }

  async function handleExport(): Promise<void> {
    if (previewDirty && selectedPath && preview != null) {
      savePreviewContent(selectedPath, preview)
    }
    if (typeof window.dataforge?.exportArchiveTree !== 'function') {
      onError?.('Archive export API unavailable — restart the app')
      return
    }
    setWorking(true)
    setStatus('Preparing archive…')
    try {
      const root = cloneTree(doc.root)
      const sourcePath = doc.sourceFilePath
      const loadPending = async (node: ArchiveDirNode): Promise<void> => {
        for (const c of node.children) {
          if (c.kind === 'dir') {
            await loadPending(c)
            continue
          }
          if (c.content != null || c.binary) continue
          if (!c.pending || !sourcePath) continue
          if (typeof window.dataforge.readArchiveEntry !== 'function') continue
          const result = await window.dataforge.readArchiveEntry(sourcePath, c.path)
          if (result.binary || result.content == null) {
            c.binary = true
            c.pending = false
            c.size = result.size
          } else {
            setFileContent(root, c.path, result.content)
          }
        }
      }
      await loadPending(root)
      setDoc((d) => ({ ...d, root }))
      const entries = flattenTreeToEntries(root)
      if (entries.length === 0) {
        setStatus('No text files to export')
        return
      }
      setStatus('Exporting…')
      const result = await window.dataforge.exportArchiveTree({
        archiveFileName: doc.archiveFileName || defaultBaseName || 'dataforge-pack',
        extension: doc.extension,
        entries
      })
      if (result.canceled) {
        setStatus('Export canceled')
        return
      }
      if (result.filePath) {
        setStatus(`Saved: ${result.filePath}`)
        onExported?.(result.filePath)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      setStatus(msg)
      onError?.(msg)
    } finally {
      setWorking(false)
    }
  }

  async function handleUseAsSchema(file: ArchiveFileNode): Promise<void> {
    setWorking(true)
    try {
      let content = file.content
      if ((content == null || file.pending) && doc.sourceFilePath) {
        const result = await window.dataforge.readArchiveEntry(doc.sourceFilePath, file.path)
        if (result.error || result.binary || result.content == null) {
          setStatus(result.error || 'Cannot import binary as schema')
          return
        }
        content = result.content
        updateRoot((root) => setFileContent(root, file.path, content!))
      }
      if (content == null) {
        setStatus('No content to import')
        return
      }
      await onImportSchema(file.name, content)
      setStatus(`Schema from ${file.name}`)
      setView('schema')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed'
      setStatus(msg)
      onError?.(msg)
    } finally {
      setWorking(false)
    }
  }

  function sortChildren(nodes: ArchiveNode[]): ArchiveNode[] {
    return [...nodes].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }

  function renderTree(nodes: ArchiveNode[], depth: number): ReactNode {
    return sortChildren(nodes).map((node) => {
      if (node.kind === 'dir') {
        const isOpen = expanded.has(node.path)
        const selected = selectedPath === node.path
        return (
          <div key={node.id} role="group">
            <ExplorerRow
              depth={depth}
              selected={selected}
              onSelect={() => {
                selectFolder(node.path)
                if (!isOpen) toggleExpand(node.path)
              }}
              onDoubleClick={() => toggleExpand(node.path)}
              title={node.path}
              leading={
                <>
                  <button
                    type="button"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-surface-2"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(node.path)
                    }}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <Chevron open={isOpen} />
                  </button>
                  <FolderIcon open={isOpen} />
                </>
              }
              label={node.name}
              actions={
                <>
                  <ExplorerAction
                    label="Ren"
                    tone="rename"
                    onClick={() => startRename(node.path, node.name)}
                  />
                  <ExplorerAction label="Mv" tone="move" onClick={() => startMove(node.path)} />
                  <ExplorerAction
                    label="×"
                    tone="delete"
                    onClick={() => handleRemove(node.path)}
                  />
                </>
              }
            />
            {isOpen && node.children.length > 0 && renderTree(node.children, depth + 1)}
          </div>
        )
      }
      // file
      const selected = selectedPath === node.path
      return (
        <ExplorerRow
          key={node.id}
          depth={depth}
          selected={selected}
          onSelect={() => void selectFile(node)}
          onDoubleClick={() => startRename(node.path, node.name)}
          title={node.path}
          leading={
            <>
              <span className="inline-block w-4 shrink-0" />
              <FileGlyph name={node.name} />
            </>
          }
          label={node.name}
          actions={
            <>
              <ExplorerAction
                label="Ren"
                tone="rename"
                onClick={() => startRename(node.path, node.name)}
              />
              <ExplorerAction label="Mv" tone="move" onClick={() => startMove(node.path)} />
              {(node.format || formatFromFileName(node.name)) && (
                <ExplorerAction
                  label="Schema"
                  tone="schema"
                  onClick={() => void handleUseAsSchema(node)}
                />
              )}
              <ExplorerAction
                label="×"
                tone="delete"
                onClick={() => handleRemove(node.path)}
              />
            </>
          }
        />
      )
    })
  }

  const disabled = busy || working || generating
  const moveDestOptions = allDirs.filter((d) => {
    if (!movePath) return true
    if (d === movePath || d.startsWith(movePath + '/')) return false
    return true
  })
  const selectedIsFile = selectedPath ? Boolean(getFileAtPath(doc.root, selectedPath)) : false

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(92vh,840px)] w-[min(98vw,1120px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Title bar */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
            <Dialog.Title className="text-[13px] font-medium text-text">
              Archive Workspace
            </Dialog.Title>
            <div className="flex h-7 items-center gap-1 rounded-md border border-border bg-bg p-0.5">
              <button
                type="button"
                className={`h-full rounded px-2.5 text-[11px] font-medium transition ${
                  view === 'pack'
                    ? 'bg-sky-500/25 text-sky-200 shadow-sm ring-1 ring-sky-400/40'
                    : 'text-muted hover:bg-sky-500/10 hover:text-sky-300'
                }`}
                onClick={() => setView('pack')}
              >
                Explorer
              </button>
              <button
                type="button"
                className={`h-full rounded px-2.5 text-[11px] font-medium transition ${
                  view === 'schema'
                    ? 'bg-fuchsia-500/25 text-fuchsia-200 shadow-sm ring-1 ring-fuchsia-400/40'
                    : 'text-muted hover:bg-fuchsia-500/10 hover:text-fuchsia-300'
                }`}
                onClick={() => setView('schema')}
              >
                Schema
              </button>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {view === 'pack' && (
                <>
                  <button
                    type="button"
                    className="btn-open h-7 px-2.5 text-[11px]"
                    disabled={disabled}
                    onClick={() => void handleOpenArchive()}
                  >
                    Open…
                  </button>
                  <button
                    type="button"
                    className="btn-new h-7 px-2.5 text-[11px]"
                    disabled={disabled}
                    onClick={handleNewArchive}
                  >
                    New
                  </button>
                </>
              )}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="btn-cancel h-7 w-7 px-0 text-base leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Generate strip */}
          <div className="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 text-[11px]">
            <span className="max-w-[10rem] truncate text-muted" title={activeSchema?.name}>
              {activeSchema?.name || 'No schema'}
            </span>
            <button type="button" className="btn-schema h-6 px-2 text-[11px]" onClick={() => setView('schema')}>
              Edit schema
            </button>
            <span className="text-border">|</span>
            <label className="flex items-center gap-1 text-muted">
              Rows
              <input
                type="number"
                className="input h-6 w-14 py-0 text-[11px]"
                min={MIN_GENERATE_RECORDS}
                max={MAX_GENERATE_RECORDS}
                value={recordCount}
                onChange={(e) => setRecordCount(Number(e.target.value) || MIN_GENERATE_RECORDS)}
                disabled={disabled}
              />
            </label>
            <label className="flex items-center gap-1 text-muted">
              Seed
              <input
                className="input h-6 w-20 py-0 font-mono text-[11px]"
                value={generateSeed}
                onChange={(e) => setGenerateSeed(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="rand"
                disabled={disabled}
              />
            </label>
            <button
              type="button"
              className="btn-generate h-6 px-2.5 text-[11px]"
              disabled={disabled || !activeSchema}
              onClick={() => void handleGenerate()}
            >
              {generating ? '…' : 'Generate'}
            </button>
            {lastGenerated && !lastGenerated.streamed && (
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-300">
                {lastGenerated.recordCount} rec
              </span>
            )}
          </div>

          {view === 'schema' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-[11px] text-muted">
                <span>Schema builder — same as main app</span>
                <button
                  type="button"
                  className="btn-save ml-auto h-6 px-2 text-[11px]"
                  disabled={disabled}
                  onClick={() => void saveActiveSchema().then(() => setStatus('Schema saved'))}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn-open h-6 px-2 text-[11px]"
                  onClick={() => setView('pack')}
                >
                  Explorer
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-surface">
                <SchemaBuilder />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              {/* Explorer sidebar — VS Code style */}
              <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface">
                <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Explorer
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      className="chip-icon-file"
                      title="New file"
                      disabled={disabled}
                      onClick={() => {
                        setAddFileOpen(true)
                        setNewFileName(defaultBaseName || 'data')
                        setNewFileFormat(defaultFormat)
                        setNewFileSource(
                          effectiveGenerated != null
                            ? 'generated'
                            : effectiveSchemaSample != null
                              ? 'schema'
                              : 'empty'
                        )
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M9.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6.5L9.5 1.5zM9 2.5l3.5 3.5H10a1 1 0 0 1-1-1V2.5zM8 8v2H6v1h2v2h1v-2h2v-1H9V8H8z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="chip-icon-folder"
                      title="New folder"
                      disabled={disabled}
                      onClick={() => {
                        setAddFolderOpen(true)
                        setNewFolderName('')
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.38a1.5 1.5 0 0 1 1.06.44l.62.62H13A1.5 1.5 0 0 1 14.5 4v1H1.5V3zm0 3h13v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V6zm6.5 1v2H6v1h2v2h1v-2h2v-1H9V7H8z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Archive root header */}
                <div className="flex h-6 shrink-0 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <Chevron open />
                  <span className="truncate">
                    {doc.archiveFileName || 'archive'}
                    {doc.extension}
                  </span>
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-0.5"
                  role="tree"
                  aria-label="Archive explorer"
                >
                  {doc.root.children.length === 0 ? (
                    <p className="px-3 py-4 text-[12px] text-muted">
                      Empty. Use New file / New folder, or Open…
                    </p>
                  ) : (
                    renderTree(doc.root.children, 0)
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1 border-t border-border px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      className="input h-6 min-w-0 flex-1 py-0 text-[11px]"
                      value={doc.archiveFileName}
                      onChange={(e) => setDoc((d) => ({ ...d, archiveFileName: e.target.value }))}
                      disabled={disabled}
                      title="Archive file name"
                    />
                    <select
                      className="input h-6 w-[4.5rem] py-0 text-[11px]"
                      value={doc.extension}
                      onChange={(e) =>
                        setDoc((d) => ({ ...d, extension: e.target.value as ArchiveExt }))
                      }
                      disabled={disabled}
                    >
                      {EXTENSIONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="truncate text-[10px] text-muted">
                    {fileCount} files
                    {targetFolderPath ? ` · add → ${targetFolderPath}` : ' · add → root'}
                  </p>
                </div>
              </aside>

              {/* Editor pane */}
              <main className="flex min-w-0 flex-1 flex-col bg-bg">
                <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
                    {selectedPath
                      ? selectedPath
                      : 'Select a file to edit'}
                    {previewDirty ? ' ●' : ''}
                  </span>
                  {selectedIsFile && preview != null && (
                    <button
                      type="button"
                      className="btn-save h-6 px-2 text-[11px]"
                      disabled={disabled || !previewDirty}
                      onClick={() => savePreviewContent()}
                    >
                      Save
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {previewMeta && !selectedIsFile && (
                    <p className="px-4 py-3 text-[12px] text-muted">{previewMeta}</p>
                  )}
                  {previewMeta && selectedIsFile && preview == null && (
                    <p className="px-4 py-3 text-[12px] text-muted">{previewMeta}</p>
                  )}
                  {selectedIsFile && preview != null ? (
                    <textarea
                      className="h-full min-h-full w-full resize-none border-0 bg-bg px-4 py-3 font-mono text-[13px] leading-relaxed text-text outline-none focus:ring-0"
                      value={preview}
                      disabled={disabled}
                      onChange={(e) => {
                        setPreview(e.target.value)
                        setPreviewDirty(true)
                      }}
                      spellCheck={false}
                    />
                  ) : !selectedIsFile ? (
                    <div className="flex h-full flex-col items-start justify-center gap-2 px-8 text-[13px] text-muted">
                      <p className="text-text">Explorer</p>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>Click folders to select where new files go</li>
                        <li>Click files to open in the editor</li>
                        <li>Double-click a file to rename</li>
                        <li>Hover a row for Rename / Move / Delete</li>
                      </ul>
                    </div>
                  ) : null}
                </div>
              </main>
            </div>
          )}

          {/* Bottom action strips */}
          {view === 'pack' && renamePath && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-1.5">
              <span className="text-[11px] text-muted">Rename</span>
              <input
                className="input h-7 w-52 py-0 font-mono text-[12px]"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename()
                  if (e.key === 'Escape') setRenamePath(null)
                }}
              />
              <button type="button" className="btn-ok h-7 px-2 text-[11px]" onClick={confirmRename}>
                OK
              </button>
              <button type="button" className="btn-cancel h-7 px-2 text-[11px]" onClick={() => setRenamePath(null)}>
                Cancel
              </button>
            </div>
          )}

          {view === 'pack' && movePath && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-amber-500/10 px-3 py-1.5">
              <span className="text-[11px] font-medium text-amber-300">Move to</span>
              <select
                className="input h-7 max-w-xs py-0 font-mono text-[12px]"
                value={moveDest}
                onChange={(e) => setMoveDest(e.target.value)}
              >
                {moveDestOptions.map((d) => (
                  <option key={d || '__root'} value={d}>
                    {dirLabel(d)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-export h-7 px-2 text-[11px]" onClick={confirmMove}>
                Move
              </button>
              <button type="button" className="btn-cancel h-7 px-2 text-[11px]" onClick={() => setMovePath(null)}>
                Cancel
              </button>
            </div>
          )}

          {view === 'pack' && addFolderOpen && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-amber-500/10 px-3 py-1.5">
              <span className="text-[11px] font-medium text-amber-300">
                New folder in {dirLabel(targetFolderPath)}
              </span>
              <input
                className="input h-7 w-40 py-0 text-[12px]"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmAddFolder()
                }}
              />
              <button type="button" className="btn-ok h-7 px-2 text-[11px]" onClick={confirmAddFolder}>
                Create
              </button>
              <button type="button" className="btn-cancel h-7 px-2 text-[11px]" onClick={() => setAddFolderOpen(false)}>
                Cancel
              </button>
            </div>
          )}

          {view === 'pack' && addFileOpen && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-emerald-500/10 px-3 py-1.5">
              <span className="text-[11px] font-medium text-emerald-300">
                New file in {dirLabel(targetFolderPath)}
              </span>
              <input
                className="input h-7 w-32 py-0 text-[12px]"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
              />
              <select
                className="input h-7 w-auto py-0 text-[11px]"
                value={newFileFormat}
                onChange={(e) => setNewFileFormat(e.target.value as ExportFormat)}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                className="input h-7 w-auto py-0 text-[11px]"
                value={newFileSource}
                onChange={(e) =>
                  setNewFileSource(e.target.value as 'generated' | 'schema' | 'empty')
                }
              >
                <option value="generated" disabled={effectiveGenerated == null}>
                  generated
                </option>
                <option value="schema" disabled={effectiveSchemaSample == null}>
                  sample
                </option>
                <option value="empty">empty</option>
              </select>
              <button type="button" className="btn-ok h-7 px-2 text-[11px]" onClick={confirmAddFile}>
                Add
              </button>
              <button type="button" className="btn-cancel h-7 px-2 text-[11px]" onClick={() => setAddFileOpen(false)}>
                Cancel
              </button>
            </div>
          )}

          {/* Status bar */}
          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border bg-surface px-3">
            <p className="min-w-0 flex-1 truncate text-[11px] text-muted" title={status ?? undefined}>
              {status || 'Ready'}
            </p>
            <Dialog.Close asChild>
              <button type="button" className="btn-cancel h-6 px-2 text-[11px]" disabled={working}>
                Close
              </button>
            </Dialog.Close>
            {view === 'pack' && (
              <button
                type="button"
                className="btn-export h-6 px-3 text-[11px]"
                disabled={disabled || fileCount === 0}
                onClick={() => void handleExport()}
              >
                {working ? '…' : 'Export'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
