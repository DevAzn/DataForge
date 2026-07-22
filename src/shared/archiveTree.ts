import type { ArchiveExt, ExportFormat } from './types'

export type ArchiveNodeKind = 'dir' | 'file'

export interface ArchiveFileNode {
  kind: 'file'
  id: string
  name: string
  /** Full path inside the archive (posix, no leading slash) */
  path: string
  content?: string
  format?: ExportFormat
  size?: number
  /** True when content was not loaded (binary or too large) */
  binary?: boolean
  /** Content not yet fetched from disk archive */
  pending?: boolean
}

export interface ArchiveDirNode {
  kind: 'dir'
  id: string
  name: string
  /** Full path inside the archive; empty string = root */
  path: string
  children: ArchiveNode[]
}

export type ArchiveNode = ArchiveFileNode | ArchiveDirNode

export interface ArchiveWorkspaceDoc {
  extension: ArchiveExt
  archiveFileName: string
  /** Absolute path of opened archive on disk (import) */
  sourceFilePath?: string
  root: ArchiveDirNode
}

export const ARCHIVE_TEXT_PREVIEW_MAX = 2 * 1024 * 1024

/** UTF-8 byte length that works in both Node and the browser. */
export function utf8ByteLength(s: string): number {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8')
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
  return s.length
}

let idSeq = 0
export function newArchiveNodeId(): string {
  idSeq += 1
  return `an_${Date.now().toString(36)}_${idSeq}`
}

export function createEmptyRoot(): ArchiveDirNode {
  return {
    kind: 'dir',
    id: newArchiveNodeId(),
    name: '',
    path: '',
    children: []
  }
}

export function createEmptyWorkspace(
  archiveFileName = 'dataforge-pack',
  extension: ArchiveExt = '.zip'
): ArchiveWorkspaceDoc {
  return {
    extension,
    archiveFileName,
    root: createEmptyRoot()
  }
}

/** Sanitize one path segment (no slashes). */
export function sanitizeSegment(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .join('')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim()
}

/** Normalize archive path to posix segments (no empty / . / ..). */
export function pathToSegments(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
}

export function joinArchivePath(...parts: string[]): string {
  return parts
    .flatMap((p) => pathToSegments(p))
    .filter(Boolean)
    .join('/')
}

export function parentPath(path: string): string {
  const segs = pathToSegments(path)
  if (segs.length <= 1) return ''
  return segs.slice(0, -1).join('/')
}

export function baseName(path: string): string {
  const segs = pathToSegments(path)
  return segs[segs.length - 1] || ''
}

/** Guess export format from file name. */
export function formatFromFileName(name: string): ExportFormat | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.txt') || lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    return 'txt'
  }
  return undefined
}

export function isLikelyTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    /\.(json|ya?ml|xml|csv|txt|jsonl|ndjson|md|html?|log|tsv|ini|cfg|conf|properties)$/i.test(
      lower
    ) || formatFromFileName(name) !== undefined
  )
}

function ensureDir(root: ArchiveDirNode, dirPath: string): ArchiveDirNode {
  if (!dirPath) return root
  const segs = pathToSegments(dirPath)
  let cur = root
  let acc = ''
  for (const seg of segs) {
    acc = acc ? `${acc}/${seg}` : seg
    let next = cur.children.find(
      (c): c is ArchiveDirNode => c.kind === 'dir' && c.name.toLowerCase() === seg.toLowerCase()
    )
    if (!next) {
      next = {
        kind: 'dir',
        id: newArchiveNodeId(),
        name: seg,
        path: acc,
        children: []
      }
      cur.children.push(next)
    }
    cur = next
  }
  return cur
}

export function getDirAtPath(root: ArchiveDirNode, dirPath: string): ArchiveDirNode | null {
  if (!dirPath) return root
  const segs = pathToSegments(dirPath)
  let cur: ArchiveDirNode = root
  for (const seg of segs) {
    const next = cur.children.find(
      (c): c is ArchiveDirNode => c.kind === 'dir' && c.name.toLowerCase() === seg.toLowerCase()
    )
    if (!next) return null
    cur = next
  }
  return cur
}

export function getFileAtPath(root: ArchiveDirNode, filePath: string): ArchiveFileNode | null {
  const segs = pathToSegments(filePath)
  if (segs.length === 0) return null
  const dir = getDirAtPath(root, segs.slice(0, -1).join('/'))
  if (!dir) return null
  const name = segs[segs.length - 1]
  return (
    dir.children.find(
      (c): c is ArchiveFileNode =>
        c.kind === 'file' && c.name.toLowerCase() === name.toLowerCase()
    ) ?? null
  )
}

export interface DirListing {
  folders: ArchiveDirNode[]
  files: ArchiveFileNode[]
}

/** Direct children of a directory path. */
export function listDir(root: ArchiveDirNode, dirPath: string): DirListing {
  const dir = getDirAtPath(root, dirPath)
  if (!dir) return { folders: [], files: [] }
  const folders: ArchiveDirNode[] = []
  const files: ArchiveFileNode[] = []
  for (const c of dir.children) {
    if (c.kind === 'dir') folders.push(c)
    else files.push(c)
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { folders, files }
}

/** Build tree from flat entry list (import). */
export function buildTreeFromEntries(
  entries: Array<{
    path: string
    content?: string
    size?: number
    binary?: boolean
    pending?: boolean
  }>
): ArchiveDirNode {
  const root = createEmptyRoot()
  for (const e of entries) {
    const segs = pathToSegments(e.path)
    if (segs.length === 0) continue
    // Directory marker (trailing slash paths)
    if (e.path.replace(/\\/g, '/').endsWith('/')) {
      ensureDir(root, segs.join('/'))
      continue
    }
    const fileName = segs[segs.length - 1]
    const parent = ensureDir(root, segs.slice(0, -1).join('/'))
    const full = segs.join('/')
    // Skip duplicates
    if (
      parent.children.some(
        (c) => c.kind === 'file' && c.name.toLowerCase() === fileName.toLowerCase()
      )
    ) {
      continue
    }
    parent.children.push({
      kind: 'file',
      id: newArchiveNodeId(),
      name: fileName,
      path: full,
      content: e.content,
      size: e.size ?? (e.content != null ? utf8ByteLength(e.content) : undefined),
      format: formatFromFileName(fileName),
      binary: e.binary,
      pending: e.pending
    })
  }
  return root
}

export function addFolderAt(
  root: ArchiveDirNode,
  parentPath: string,
  folderName: string
): { root: ArchiveDirNode; path: string } | { error: string } {
  const name = sanitizeSegment(folderName)
  if (!name) return { error: 'Folder name is required' }
  const parent = getDirAtPath(root, parentPath)
  if (!parent) return { error: 'Parent folder not found' }
  if (
    parent.children.some((c) => c.kind === 'dir' && c.name.toLowerCase() === name.toLowerCase())
  ) {
    return { error: `Folder “${name}” already exists here` }
  }
  const full = joinArchivePath(parentPath, name)
  parent.children.push({
    kind: 'dir',
    id: newArchiveNodeId(),
    name,
    path: full,
    children: []
  })
  return { root, path: full }
}

export function addFileAt(
  root: ArchiveDirNode,
  parentPath: string,
  fileName: string,
  opts?: {
    content?: string
    format?: ExportFormat
    binary?: boolean
  }
): { root: ArchiveDirNode; path: string } | { error: string } {
  let name = sanitizeSegment(fileName)
  if (!name) return { error: 'File name is required' }
  const parent = getDirAtPath(root, parentPath)
  if (!parent) return { error: 'Parent folder not found' }
  const fmt = opts?.format ?? formatFromFileName(name)
  // Ensure extension when format known and missing
  if (fmt && !/\.[a-z0-9]+$/i.test(name)) {
    const ext =
      fmt === 'yaml' ? 'yml' : fmt === 'txt' ? 'txt' : fmt
    name = `${name}.${ext}`
  }
  if (
    parent.children.some((c) => c.kind === 'file' && c.name.toLowerCase() === name.toLowerCase())
  ) {
    return { error: `File “${name}” already exists here` }
  }
  const full = joinArchivePath(parentPath, name)
  const content = opts?.content
  parent.children.push({
    kind: 'file',
    id: newArchiveNodeId(),
    name,
    path: full,
    content,
    format: fmt,
    size: content != null ? utf8ByteLength(content) : 0,
    binary: opts?.binary,
    pending: false
  })
  return { root, path: full }
}

export function removeAtPath(
  root: ArchiveDirNode,
  targetPath: string
): { root: ArchiveDirNode } | { error: string } {
  const segs = pathToSegments(targetPath)
  if (segs.length === 0) return { error: 'Cannot remove archive root' }
  const parent = getDirAtPath(root, segs.slice(0, -1).join('/'))
  if (!parent) return { error: 'Path not found' }
  const name = segs[segs.length - 1]
  const idx = parent.children.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
  if (idx < 0) return { error: 'Path not found' }
  parent.children.splice(idx, 1)
  return { root }
}

export function setFileContent(
  root: ArchiveDirNode,
  filePath: string,
  content: string
): ArchiveFileNode | null {
  const file = getFileAtPath(root, filePath)
  if (!file) return null
  file.content = content
  file.size = utf8ByteLength(content)
  file.pending = false
  file.binary = false
  return file
}

/** Rewrite `path` (and name) on a node and all descendants after a rename/move. */
function repathSubtree(node: ArchiveNode, newPath: string): void {
  node.path = newPath
  node.name = baseName(newPath) || node.name
  if (node.kind === 'file') {
    node.format = formatFromFileName(node.name) ?? node.format
    return
  }
  for (const child of node.children) {
    const childPath = joinArchivePath(newPath, child.name)
    repathSubtree(child, childPath)
  }
}

function findChildIndex(parent: ArchiveDirNode, name: string): number {
  return parent.children.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
}

/**
 * Rename a file or folder (last segment only). Updates all descendant paths.
 */
export function renameAtPath(
  root: ArchiveDirNode,
  targetPath: string,
  newNameRaw: string
): { root: ArchiveDirNode; path: string } | { error: string } {
  const segs = pathToSegments(targetPath)
  if (segs.length === 0) return { error: 'Cannot rename archive root' }
  let newName = sanitizeSegment(newNameRaw)
  if (!newName) return { error: 'Name is required' }

  const parent = getDirAtPath(root, segs.slice(0, -1).join('/'))
  if (!parent) return { error: 'Path not found' }
  const oldName = segs[segs.length - 1]
  const idx = findChildIndex(parent, oldName)
  if (idx < 0) return { error: 'Path not found' }

  const node = parent.children[idx]
  // Keep/file extension convenience for files when user drops extension but format known
  if (node.kind === 'file') {
    const fmt = node.format ?? formatFromFileName(node.name)
    if (fmt && !/\.[a-z0-9]+$/i.test(newName)) {
      const ext = fmt === 'yaml' ? 'yml' : fmt
      newName = `${newName}.${ext}`
    }
  }

  if (newName.toLowerCase() === oldName.toLowerCase() && newName === oldName) {
    return { root, path: targetPath }
  }
  if (
    parent.children.some(
      (c, i) => i !== idx && c.name.toLowerCase() === newName.toLowerCase()
    )
  ) {
    return { error: `“${newName}” already exists here` }
  }

  const newPath = joinArchivePath(parent.path, newName)
  repathSubtree(node, newPath)
  return { root, path: newPath }
}

/**
 * Move a file or folder into another directory (same archive).
 * Destination must not be the node itself or a descendant.
 */
export function moveAtPath(
  root: ArchiveDirNode,
  sourcePath: string,
  destParentPath: string
): { root: ArchiveDirNode; path: string } | { error: string } {
  const segs = pathToSegments(sourcePath)
  if (segs.length === 0) return { error: 'Cannot move archive root' }

  const destNorm = pathToSegments(destParentPath).join('/')
  if (destNorm === sourcePath || destNorm.startsWith(sourcePath + '/')) {
    return { error: 'Cannot move a folder into itself' }
  }

  const srcParent = getDirAtPath(root, segs.slice(0, -1).join('/'))
  if (!srcParent) return { error: 'Source not found' }
  const name = segs[segs.length - 1]
  const idx = findChildIndex(srcParent, name)
  if (idx < 0) return { error: 'Source not found' }

  const dest = getDirAtPath(root, destNorm)
  if (!dest) return { error: 'Destination folder not found' }

  // Same parent → no-op
  if (srcParent.path === dest.path) {
    return { root, path: sourcePath }
  }

  if (dest.children.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { error: `“${name}” already exists in destination` }
  }

  const [node] = srcParent.children.splice(idx, 1)
  const newPath = joinArchivePath(dest.path, node.name)
  repathSubtree(node, newPath)
  dest.children.push(node)
  return { root, path: newPath }
}

/** All directory paths in the tree (including root as ''). */
export function listAllDirPaths(root: ArchiveDirNode): string[] {
  const out: string[] = ['']
  function walk(node: ArchiveDirNode): void {
    for (const c of node.children) {
      if (c.kind === 'dir') {
        out.push(c.path)
        walk(c)
      }
    }
  }
  walk(root)
  return out
}

/** Remap UI paths after rename/move (selection, current folder). */
export function remapPathAfterChange(
  path: string | null,
  oldPath: string,
  newPath: string
): string | null {
  if (path == null) return null
  if (path === oldPath) return newPath
  if (path.startsWith(oldPath + '/')) {
    return newPath + path.slice(oldPath.length)
  }
  return path
}

/** Flatten tree to export entries (dirs without files are skipped as empty). */
export function flattenTreeToEntries(
  root: ArchiveDirNode
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []

  function walk(node: ArchiveDirNode): void {
    for (const c of node.children) {
      if (c.kind === 'dir') {
        walk(c)
      } else if (c.content != null && !c.binary) {
        out.push({ path: c.path, content: c.content })
      }
    }
  }

  walk(root)
  return out
}

export function countFiles(root: ArchiveDirNode): number {
  let n = 0
  function walk(node: ArchiveDirNode): void {
    for (const c of node.children) {
      if (c.kind === 'dir') walk(c)
      else n++
    }
  }
  walk(root)
  return n
}

/** Deep clone tree (for immutable-ish UI updates). */
export function cloneTree(root: ArchiveDirNode): ArchiveDirNode {
  return JSON.parse(JSON.stringify(root)) as ArchiveDirNode
}
