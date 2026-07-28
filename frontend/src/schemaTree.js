/**
 * Immutable schema tree helpers for drag/reorder/nest.
 * Tree model is source of truth; closing tags are display-only.
 */

export function cloneTree(root) {
  return JSON.parse(JSON.stringify(root || []))
}

/** Clipboard envelope for field subtrees (system + in-memory). */
export const FIELD_CLIP_TYPE = 'dataforge/field-v1'

/**
 * Deep-clone a field node and assign new ids throughout the subtree.
 * @param {object} node
 * @param {() => string} newId
 */
export function rekeyNode(node, newId) {
  if (!node || typeof node !== 'object') return null
  const n = cloneTree([node])[0]
  function walk(r) {
    r.id = newId()
    if (Array.isArray(r.children)) {
      r.children.forEach(walk)
    }
  }
  walk(n)
  return n
}

/** Serialize field for clipboard. */
export function serializeFieldClip(node) {
  return JSON.stringify({ type: FIELD_CLIP_TYPE, node: cloneTree([node])[0] })
}

/** Parse clipboard text; returns node or null. */
export function parseFieldClip(text) {
  if (!text || typeof text !== 'string') return null
  try {
    const data = JSON.parse(text)
    if (data?.type !== FIELD_CLIP_TYPE || !data.node || typeof data.node !== 'object') {
      return null
    }
    return data.node
  } catch {
    return null
  }
}

/** Walk display items: { type:'node'|'close', row, depth, path } */
export function walkDisplay(rows, depth = 0, path = []) {
  const out = []
  for (const row of rows || []) {
    if (!row || !row.id) continue
    const key = (row.key || 'field').trim() || 'field'
    const childPath = [...path, key]
    out.push({ type: 'node', row, depth, path: childPath })
    const kids = row.children || []
    const isContainer =
      (row.kind === 'object' || row.kind === 'array' || kids.length > 0)
    if (isContainer && kids.length) {
      out.push(...walkDisplay(kids, depth + 1, childPath))
      out.push({
        type: 'close',
        row,
        depth,
        path: childPath,
        closeKey: key
      })
    } else if (isContainer) {
      // empty container still shows close for encapsulation cue
      out.push({
        type: 'close',
        row,
        depth,
        path: childPath,
        closeKey: key
      })
    }
  }
  return out
}

export function findParentAndIndex(root, id, parent = null) {
  const rows = parent ? parent.children || [] : root
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) {
      return { parent, index: i, list: rows, node: rows[i] }
    }
  }
  for (const r of rows) {
    const kids = r.children || []
    if (!kids.length) continue
    const hit = findParentAndIndex(kids, id, r)
    if (hit) return hit
  }
  return null
}

export function isDescendant(root, ancestorId, maybeChildId) {
  if (ancestorId === maybeChildId) return true
  const loc = findParentAndIndex(root, ancestorId)
  if (!loc?.node) return false
  function walk(n) {
    if (n.id === maybeChildId) return true
    for (const c of n.children || []) {
      if (walk(c)) return true
    }
    return false
  }
  return walk(loc.node)
}

/**
 * Remove node by id. Returns { root, node } or null.
 */
export function removeNode(root, id) {
  const tree = cloneTree(root)
  const loc = findParentAndIndex(tree, id)
  if (!loc) return null
  const list = loc.parent ? loc.parent.children : tree
  const [node] = list.splice(loc.index, 1)
  renumber(list)
  return { root: tree, node }
}

function renumber(list) {
  list.forEach((r, i) => {
    r.sortOrder = i
  })
}

/**
 * Insert node as child of parentId at index (default append).
 * parentId null => root list.
 */
export function insertAsChild(root, parentId, node, index = -1) {
  const tree = cloneTree(root)
  const n = cloneTree([node])[0]
  if (!parentId) {
    const i = index < 0 ? tree.length : Math.min(index, tree.length)
    tree.splice(i, 0, n)
    renumber(tree)
    return tree
  }
  const loc = findParentAndIndex(tree, parentId)
  if (!loc?.node) return root
  const parent = loc.node
  if (parent.kind === 'value') parent.kind = 'object'
  if (!parent.children) parent.children = []
  const i = index < 0 ? parent.children.length : Math.min(index, parent.children.length)
  parent.children.splice(i, 0, n)
  renumber(parent.children)
  return tree
}

/**
 * Insert node before/after siblingId within the same parent list.
 */
export function insertAsSibling(root, siblingId, node, where = 'after') {
  const tree = cloneTree(root)
  const n = cloneTree([node])[0]
  const loc = findParentAndIndex(tree, siblingId)
  if (!loc) return root
  const list = loc.parent ? loc.parent.children : tree
  const idx = where === 'before' ? loc.index : loc.index + 1
  list.splice(idx, 0, n)
  renumber(list)
  return tree
}

/**
 * Move draggedId relative to targetId.
 * mode: 'before' | 'after' | 'into'
 */
export function moveNode(root, draggedId, targetId, mode) {
  if (!draggedId || !targetId || draggedId === targetId) {
    return { root, error: 'Invalid drop' }
  }
  if (mode === 'into' && isDescendant(root, draggedId, targetId)) {
    return { root, error: 'Cannot nest a group inside its own child' }
  }
  if (mode !== 'into' && isDescendant(root, draggedId, targetId)) {
    // reordering under own subtree via sibling of descendant — block cycles
    // (sibling moves shouldn't use descendant as sibling of ancestor's content incorrectly)
  }
  // Prevent moving parent into its descendant for into only — already handled.
  // For before/after: if target is inside dragged, remove would detach target first — block.
  if (isDescendant(root, draggedId, targetId) && mode !== 'into') {
    return { root, error: 'Cannot reorder relative to a nested child' }
  }

  const removed = removeNode(root, draggedId)
  if (!removed) return { root, error: 'Field not found' }

  let next
  if (mode === 'into') {
    next = insertAsChild(removed.root, targetId, removed.node, -1)
  } else {
    next = insertAsSibling(removed.root, targetId, removed.node, mode)
  }
  return { root: next, error: null }
}

/** path list -> "a.b.c" */
export function pathKey(path) {
  return (path || []).join('.')
}

/**
 * Build map of dotted field paths -> selfClosing bool for leaves with explicit setting.
 */
export function buildSelfClosingMap(rows, path = [], out = {}) {
  for (const row of rows || []) {
    const key = (row.key || 'field').trim() || 'field'
    const p = [...path, key]
    const kids = row.children || []
    if (kids.length) {
      buildSelfClosingMap(kids, p, out)
    } else if (typeof row.selfClosing === 'boolean') {
      out[pathKey(p)] = row.selfClosing
      // also allow leaf tag name fallback for flat records
      out[key] = row.selfClosing
    }
  }
  return out
}
