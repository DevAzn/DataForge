import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SchemaRow } from '@shared/types'
import {
  fieldHistoryReadKeys,
  fieldHistoryWriteKey,
  fieldPathKey
} from '@shared/fieldHistory'
import { useAppStore, type DropPosition } from '../store/appStore'
import { AutocompleteInput } from './AutocompleteInput'
import { ResizeHandle } from './ResizeHandle'
import { useResizable } from '../hooks/useResizable'

const FieldLayoutContext = createContext({ keyWidth: 160 })

interface FlatRow {
  id: string
  parentId: string | null
  depth: number
  row: SchemaRow
  /** Path of parent keys (not including this row's key) */
  path: string[]
}

function flattenTree(
  rows: SchemaRow[],
  parentId: string | null = null,
  depth = 0,
  path: string[] = []
): FlatRow[] {
  const out: FlatRow[] = []
  for (const row of rows) {
    out.push({ id: row.id, parentId, depth, row, path })
    const seg = (row.key || 'field').trim() || 'field'
    out.push(...flattenTree(row.children, row.id, depth + 1, [...path, seg]))
  }
  return out
}

function findRow(rows: SchemaRow[], id: string | null): SchemaRow | null {
  if (!id) return null
  for (const row of rows) {
    if (row.id === id) return row
    const child = findRow(row.children, id)
    if (child) return child
  }
  return null
}

function DragHandle({
  attributes,
  listeners
}: {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
}): JSX.Element {
  return (
    <button
      type="button"
      className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text active:cursor-grabbing"
      title="Drag to reorder"
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
        <circle cx="3" cy="3" r="1.4" />
        <circle cx="9" cy="3" r="1.4" />
        <circle cx="3" cy="8" r="1.4" />
        <circle cx="9" cy="8" r="1.4" />
        <circle cx="3" cy="13" r="1.4" />
        <circle cx="9" cy="13" r="1.4" />
      </svg>
    </button>
  )
}

function RowActions({
  rowId
}: {
  rowId: string
}): JSX.Element {
  const addSiblingRow = useAppStore((s) => s.addSiblingRow)
  const addChildRow = useAppStore((s) => s.addChildRow)
  const deleteRow = useAppStore((s) => s.deleteRow)

  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-xs"
        title="Add sibling row (same level)"
        onClick={(e) => {
          e.stopPropagation()
          addSiblingRow(rowId)
        }}
      >
        + Row
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-xs"
        title="Add nested child under this row"
        onClick={(e) => {
          e.stopPropagation()
          addChildRow(rowId)
        }}
      >
        + Nest
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-0.5 text-xs text-danger"
        title="Delete row (Del)"
        onClick={(e) => {
          e.stopPropagation()
          deleteRow(rowId)
        }}
      >
        ×
      </button>
    </div>
  )
}

/** Map extra history path keys this field may pull values from (saved on schema). */
function HistorySourceMapper({
  selected,
  selectedPath,
  schemaPathKeys,
  onChange
}: {
  selected: SchemaRow
  selectedPath: string[]
  schemaPathKeys: string[]
  onChange: (keys: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const [historyKeys, setHistoryKeys] = useState<string[]>([])
  const mapped = selected.historySourceKeys ?? []
  const ownPath = fieldPathKey(selectedPath, selected)
  const ownWrite = fieldHistoryWriteKey(selectedPath, selected)

  useEffect(() => {
    void window.dataforge.suggestKeys('', 80).then(setHistoryKeys).catch(() => setHistoryKeys([]))
  }, [])

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const pool = new Set([...schemaPathKeys, ...historyKeys])
    pool.delete(ownPath)
    pool.delete(ownWrite)
    for (const m of mapped) pool.delete(m)
    let list = Array.from(pool)
    if (q) list = list.filter((k) => k.toLowerCase().includes(q))
    return list.slice(0, 24)
  }, [draft, schemaPathKeys, historyKeys, mapped, ownPath, ownWrite])

  function addKey(raw: string): void {
    const k = raw.trim()
    if (!k) return
    if (k === ownPath || k === ownWrite) return
    if (mapped.some((m) => m.toLowerCase() === k.toLowerCase())) return
    onChange([...mapped, k])
    setDraft('')
  }

  function removeKey(k: string): void {
    onChange(mapped.filter((m) => m !== k))
  }

  return (
    <div>
      <label className="label mb-1 block">Also pull values from</label>
      {mapped.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {mapped.map((k) => (
            <span
              key={k}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text"
              title={k}
            >
              <span className="truncate">{k}</span>
              <button
                type="button"
                className="shrink-0 text-muted hover:text-text"
                onClick={() => removeKey(k)}
                aria-label={`Remove ${k}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          className="input min-w-0 flex-1 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addKey(draft || suggestions[0] || '')
            }
          }}
          placeholder="building.name or pool:…"
          list={`hist-src-${selected.id}`}
          title="History keys from other parent.child paths or pools"
        />
        <button
          type="button"
          className="btn-ghost shrink-0 text-xs"
          onClick={() => addKey(draft || suggestions[0] || '')}
        >
          Add
        </button>
      </div>
      <datalist id={`hist-src-${selected.id}`}>
        {suggestions.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      {suggestions.length > 0 && draft.trim() && (
        <ul className="mt-1 max-h-24 overflow-y-auto rounded border border-border bg-bg text-[10px]">
          {suggestions.slice(0, 8).map((k) => (
            <li key={k}>
              <button
                type="button"
                className="w-full truncate px-2 py-1 text-left font-mono text-muted hover:bg-surface-2 hover:text-text"
                onClick={() => addKey(k)}
              >
                {k}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-muted">
        Example: map <span className="font-mono">building.name</span> onto another field that
        should reuse building names. Saved with the schema.
      </p>
    </div>
  )
}

function RowContent({
  row,
  depth,
  fieldPath,
  dragHandle,
  isOverlay,
  dropIndicator,
  flashSelected
}: {
  row: SchemaRow
  depth: number
  /** Parent path segments (for history-scoped suggestions) */
  fieldPath?: string[]
  dragHandle?: JSX.Element
  isOverlay?: boolean
  dropIndicator?: DropPosition | null
  /** Brief flash when this row becomes the shortcut target */
  flashSelected?: boolean
}): JSX.Element {
  const selectedRowId = useAppStore((s) => s.selectedRowId)
  const selectRow = useAppStore((s) => s.selectRow)
  const updateRow = useAppStore((s) => s.updateRow)
  const { keyWidth } = useContext(FieldLayoutContext)
  const selected = selectedRowId === row.id && !isOverlay
  const path = fieldPath ?? []
  const readKeys = fieldHistoryReadKeys(path, row)
  const pathLabel = fieldPathKey(path, row)

  function activateRow(): void {
    if (!isOverlay) selectRow(row.id)
  }

  return (
    <div
      className="relative"
      style={{ marginLeft: depth * 16 }}
      data-schema-row-id={isOverlay ? undefined : row.id}
    >
      {dropIndicator === 'before' && (
        <div className="absolute left-0 right-0 top-0 z-10 h-0.5 -translate-y-0.5 rounded bg-accent" />
      )}
      {dropIndicator === 'inside' && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-relationship" />
      )}
      <div
        className={`group flex items-center gap-1 rounded-md border px-1.5 py-1.5 transition-colors ${
          isOverlay
            ? 'border-accent bg-surface shadow-lg'
            : selected
              ? `schema-row-active ${flashSelected ? 'schema-row-active-flash' : ''}`
              : 'border-transparent hover:border-border hover:bg-surface-2'
        }`}
        onClick={activateRow}
        onFocusCapture={activateRow}
        role="option"
        aria-selected={selected}
        title={
          selected
            ? `Active for shortcuts (A sibling · N child · Del delete) — ${pathLabel}`
            : `Click to target shortcuts — ${pathLabel}`
        }
      >
        {dragHandle}
        <span
          className={`w-4 shrink-0 text-center text-xs ${selected ? 'text-accent' : 'text-muted'}`}
          title={row.kind}
        >
          {row.kind === 'object' ? '{}' : row.kind === 'array' ? '[]' : '·'}
        </span>
        <div className="shrink-0" style={{ width: keyWidth, minWidth: 80 }}>
          <AutocompleteInput
            className={`input w-full font-mono text-xs ${selected ? 'border-accent/50' : ''}`}
            value={row.key}
            onChange={(v) => updateRow(row.id, { key: v })}
            placeholder="key"
            disabled={isOverlay}
            title="Field key — drag the column handle in the header to resize"
            loadSuggestions={async (q) => {
              const keys = await window.dataforge.suggestKeys(q, 20)
              return keys
            }}
          />
        </div>
        {row.kind === 'value' && (
          <div className="min-w-0 flex-1">
            <AutocompleteInput
              className={`input w-full font-mono text-xs ${selected ? 'border-accent/50' : ''}`}
              value={row.sampleValue ?? ''}
              onChange={(v) => updateRow(row.id, { sampleValue: v })}
              placeholder="sample value"
              disabled={isOverlay}
              title={`Sample value — suggestions from: ${readKeys.join(', ')}`}
              loadSuggestions={async (q) => {
                const batches = await Promise.all(
                  readKeys.map((k) =>
                    window.dataforge.suggestHistory({
                      categoryName: k,
                      keyName: k,
                      prefix: q,
                      limit: 20
                    })
                  )
                )
                return Array.from(new Set(batches.flat().map((e) => e.value)))
              }}
            />
          </div>
        )}
        {selected && (
          <span
            className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-fg"
            title="Keyboard shortcuts apply to this row"
          >
            Active
          </span>
        )}
        {row.isPrimary && (
          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            PK
          </span>
        )}
        {row.relationship && (
          <span className="rounded bg-relationship/20 px-1.5 py-0.5 text-[10px] text-relationship">
            {row.relationship}
          </span>
        )}
        {!isOverlay && <RowActions rowId={row.id} />}
      </div>
      {dropIndicator === 'after' && (
        <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 translate-y-0.5 rounded bg-accent" />
      )}
    </div>
  )
}

function SortableRow({
  flat,
  dropIndicator,
  flashSelected
}: {
  flat: FlatRow
  dropIndicator: DropPosition | null
  flashSelected?: boolean
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: flat.id
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1
  }

  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      <RowContent
        row={flat.row}
        depth={flat.depth}
        fieldPath={flat.path}
        dropIndicator={isDragging ? null : dropIndicator}
        flashSelected={flashSelected}
        dragHandle={<DragHandle attributes={attributes} listeners={listeners} />}
      />
    </div>
  )
}

export function SchemaBuilder(): JSX.Element {
  const activeSchema = useAppStore((s) => s.activeSchema)
  const updateActiveSchema = useAppStore((s) => s.updateActiveSchema)
  const addRootRow = useAppStore((s) => s.addRootRow)
  const addSiblingRow = useAppStore((s) => s.addSiblingRow)
  const addChildRow = useAppStore((s) => s.addChildRow)
  const saveActiveSchema = useAppStore((s) => s.saveActiveSchema)
  const saveAsTemplate = useAppStore((s) => s.saveAsTemplate)
  const selectedRowId = useAppStore((s) => s.selectedRowId)
  const updateRow = useAppStore((s) => s.updateRow)
  const moveRow = useAppStore((s) => s.moveRow)

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [overState, setOverState] = useState<{
    id: string
    position: DropPosition
  } | null>(null)
  const [flashRowId, setFlashRowId] = useState<string | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const prevSelectedRef = useRef<string | null>(null)

  const propsPanel = useResizable({
    storageKey: 'dataforge.layout.propsPanelWidth',
    initial: 288,
    min: 200,
    max: 480,
    reverse: true
  })

  const keyCol = useResizable({
    storageKey: 'dataforge.layout.keyColWidth',
    initial: 160,
    min: 96,
    max: 420
  })

  useEffect(() => {
    if (propsPanel.isDragging || keyCol.isDragging) {
      document.body.classList.add('resizing-panels')
    } else {
      document.body.classList.remove('resizing-panels')
    }
    return () => document.body.classList.remove('resizing-panels')
  }, [propsPanel.isDragging, keyCol.isDragging])

  const fieldLayout = useMemo(() => ({ keyWidth: keyCol.size }), [keyCol.size])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  )

  const flatRows = useMemo(
    () => (activeSchema ? flattenTree(activeSchema.root) : []),
    [activeSchema]
  )
  const ids = useMemo(() => flatRows.map((r) => r.id), [flatRows])
  const activeDragRow = activeDragId
    ? flatRows.find((r) => r.id === activeDragId) ?? null
    : null
  const schemaPathKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const f of flatRows) {
      if (f.row.kind === 'value') {
        keys.add(fieldPathKey(f.path, f.row))
        keys.add(fieldHistoryWriteKey(f.path, f.row))
      }
    }
    return Array.from(keys).sort()
  }, [flatRows])

  if (!activeSchema) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Create or select a schema to begin.
      </div>
    )
  }

  const selected = findRow(activeSchema.root, selectedRowId)
  const selectedFlat = selectedRowId
    ? flatRows.find((r) => r.id === selectedRowId) ?? null
    : null
  const selectedPath = selectedFlat?.path ?? []
  const selectedPathLabel = selected
    ? fieldPathKey(selectedPath, selected)
    : null

  // Flash + scroll into view when the shortcut target changes
  useEffect(() => {
    if (!selectedRowId) {
      prevSelectedRef.current = null
      return
    }
    if (prevSelectedRef.current === selectedRowId) return
    prevSelectedRef.current = selectedRowId
    setFlashRowId(selectedRowId)
    const t = window.setTimeout(() => setFlashRowId(null), 600)
    const root = listScrollRef.current
    if (root) {
      const nodes = root.querySelectorAll('[data-schema-row-id]')
      for (const node of Array.from(nodes)) {
        if (node.getAttribute('data-schema-row-id') === selectedRowId) {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          break
        }
      }
    }
    return () => window.clearTimeout(t)
  }, [selectedRowId])

  function resolvePosition(
    event: DragMoveEvent | DragEndEvent,
    overId: string
  ): DropPosition {
    const overNode = event.over?.rect
    const translated = event.active.rect.current.translated
    if (!overNode || !translated) return 'after'

    const pointerY =
      translated.top + translated.height / 2
    const third = overNode.height / 3
    const y = pointerY - overNode.top

    // Top third = before, middle = nest inside, bottom = after
    if (y < third) return 'before'
    if (y > overNode.height - third) return 'after'
    return 'inside'
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveDragId(String(event.active.id))
    setOverState(null)
  }

  function handleDragMove(event: DragMoveEvent): void {
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId || overId === event.active.id) {
      setOverState(null)
      return
    }
    setOverState({ id: overId, position: resolvePosition(event, overId) })
  }

  function handleDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    const position =
      overState && overState.id === overId
        ? overState.position
        : overId
          ? resolvePosition(event, overId)
          : null

    setActiveDragId(null)
    setOverState(null)

    if (!overId || !position || activeId === overId) return
    moveRow(activeId, overId, position)
  }

  function handleDragCancel(): void {
    setActiveDragId(null)
    setOverState(null)
  }

  return (
    <FieldLayoutContext.Provider value={fieldLayout}>
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <input
          className="input max-w-xs text-base font-semibold"
          value={activeSchema.name}
          onChange={(e) => updateActiveSchema({ name: e.target.value })}
        />
        {activeSchema.sourceFileName && (
          <span
            className="max-w-[14rem] truncate text-[10px] text-muted"
            title={
              activeSchema.sourceFilePath ||
              activeSchema.sourceFileName
            }
          >
            from {activeSchema.sourceFileName}
          </span>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => addRootRow()}
          title="Add root-level row (R)"
        >
          + Root row
        </button>
        {selectedRowId && (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => addSiblingRow(selectedRowId)}
              title="Add a row next to the selected one"
            >
              + Sibling
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => addChildRow(selectedRowId)}
              title="Add a nested child under the selected row"
            >
              + Child
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-ghost border border-border"
          onClick={() => {
            const name = window.prompt('Template name', `${activeSchema.name} template`)
            if (name === null) return
            void saveAsTemplate(name || undefined)
          }}
          title="Save current schema as a reusable template"
        >
          Save as template
        </button>
        <button type="button" className="btn-primary" onClick={() => saveActiveSchema()}>
          Save
        </button>
        <div
          className={`ml-auto max-w-full truncate rounded-md border px-2 py-1 text-[11px] ${
            selectedPathLabel
              ? 'border-accent/50 bg-accent/10 text-text'
              : 'border-border bg-surface-2 text-muted'
          }`}
          title={
            selectedPathLabel
              ? `Shortcuts A / N / Del apply to: ${selectedPathLabel}`
              : 'Click a row to set the shortcut target (A sibling · N child · Del)'
          }
        >
          {selectedPathLabel ? (
            <>
              <span className="mr-1.5 rounded bg-accent px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-fg">
                Active
              </span>
              <span className="font-mono">{selectedPathLabel}</span>
              <span className="ml-1.5 text-muted">· A N Del</span>
            </>
          ) : (
            <>No row selected · R = root · click a row for A / N / Del</>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Column header: resize key vs value */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface/80 px-4 py-1.5 text-[10px] text-muted">
            <span className="w-4 shrink-0" />
            <span className="w-6 shrink-0" />
            <div
              className="flex shrink-0 items-center gap-1"
              style={{ width: keyCol.size }}
            >
              <span className="font-medium uppercase tracking-wide">Key</span>
            </div>
            <div className="h-4">
              <ResizeHandle
                onPointerDown={keyCol.onPointerDown}
                isDragging={keyCol.isDragging}
                title="Drag to resize key / value columns"
              />
            </div>
            <span className="min-w-0 flex-1 font-medium uppercase tracking-wide">Value</span>
            <span className="w-24 shrink-0 text-right">Actions</span>
          </div>
          <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
            <p className="mb-3 text-[11px] text-muted">
              Drag the grip to reorder rows. Highlighted <span className="text-accent font-medium">Active</span>{' '}
              row is the shortcut target (A sibling · N child · Del). Click or focus a field to
              target it. Drop on top/bottom to place before/after, or middle to nest.
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {flatRows.map((flat) => (
                  <SortableRow
                    key={flat.id}
                    flat={flat}
                    flashSelected={flashRowId === flat.id}
                    dropIndicator={
                      overState?.id === flat.id && activeDragId !== flat.id
                        ? overState.position
                        : null
                    }
                  />
                ))}
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {activeDragRow ? (
                  <RowContent
                    row={activeDragRow.row}
                    depth={0}
                    isOverlay
                    dragHandle={
                      <span className="flex h-7 w-6 items-center justify-center text-muted">⋮⋮</span>
                    }
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>

        <ResizeHandle
          onPointerDown={propsPanel.onPointerDown}
          isDragging={propsPanel.isDragging}
          title="Drag to resize properties panel"
        />
        <aside
          className="shrink-0 overflow-y-auto border-l border-border bg-surface p-4"
          style={{ width: propsPanel.size }}
        >
          <div className="label mb-3">Properties</div>
          {!selected ? (
            <p className="text-xs text-muted">Select a row to edit properties.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => addSiblingRow(selected.id)}
                >
                  + Sibling row
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => addChildRow(selected.id)}
                >
                  + Nested child
                </button>
              </div>
              <div>
                <label className="label mb-1 block">Kind</label>
                <select
                  className="input"
                  value={selected.kind}
                  onChange={(e) =>
                    updateRow(selected.id, {
                      kind: e.target.value as SchemaRow['kind']
                    })
                  }
                >
                  <option value="value">Value</option>
                  <option value="object">Object</option>
                  <option value="array">Array</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.isPrimary}
                  onChange={(e) => updateRow(selected.id, { isPrimary: e.target.checked })}
                />
                Primary / unique identifier
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.isUnique}
                  onChange={(e) => updateRow(selected.id, { isUnique: e.target.checked })}
                />
                Unique within generation
              </label>

              {selected.kind === 'value' && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="label">Constraints</div>
                  <p className="text-[10px] leading-relaxed text-muted">
                    Applied during generate. CI mode ignores history and relies on samples + these
                    rules for reproducibility.
                  </p>
                  <div>
                    <label className="label mb-1 block">Null rate %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="input text-xs"
                      value={selected.nullRate ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        updateRow(selected.id, {
                          nullRate: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
                        })
                      }}
                    />
                  </div>
                  <div>
                    <label className="label mb-1 block">Enum values (one per line)</label>
                    <textarea
                      className="input min-h-[64px] font-mono text-xs"
                      value={(selected.enumValues ?? []).join('\n')}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split(/\r?\n/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                        updateRow(selected.id, {
                          enumValues: lines.length ? lines : undefined
                        })
                      }}
                      placeholder="active&#10;pending&#10;closed"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label mb-1 block">Min length</label>
                      <input
                        type="number"
                        min={0}
                        className="input text-xs"
                        value={selected.minLength ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRow(selected.id, {
                            minLength: v === '' ? undefined : Math.max(0, Number(v) || 0)
                          })
                        }}
                      />
                    </div>
                    <div>
                      <label className="label mb-1 block">Max length</label>
                      <input
                        type="number"
                        min={0}
                        className="input text-xs"
                        value={selected.maxLength ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRow(selected.id, {
                            maxLength: v === '' ? undefined : Math.max(0, Number(v) || 0)
                          })
                        }}
                      />
                    </div>
                    <div>
                      <label className="label mb-1 block">Min (number)</label>
                      <input
                        type="number"
                        className="input text-xs"
                        value={selected.min ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRow(selected.id, {
                            min: v === '' ? undefined : Number(v)
                          })
                        }}
                      />
                    </div>
                    <div>
                      <label className="label mb-1 block">Max (number)</label>
                      <input
                        type="number"
                        className="input text-xs"
                        value={selected.max ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRow(selected.id, {
                            max: v === '' ? undefined : Number(v)
                          })
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label mb-1 block">Pattern (regex)</label>
                    <input
                      className="input font-mono text-xs"
                      value={selected.pattern ?? ''}
                      onChange={(e) =>
                        updateRow(selected.id, {
                          pattern: e.target.value.trim() || undefined
                        })
                      }
                      placeholder="^[A-Z]{2}-\\d{4}$"
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label mb-1 block">Relationship</label>
                <select
                  className="input"
                  value={selected.relationship ?? ''}
                  onChange={(e) =>
                    updateRow(selected.id, {
                      relationship: (e.target.value || undefined) as SchemaRow['relationship']
                    })
                  }
                >
                  <option value="">None</option>
                  <option value="one-to-one">One-to-One</option>
                  <option value="one-to-many">One-to-Many</option>
                  <option value="many-to-one">Many-to-One</option>
                  <option value="many-to-many">Many-to-Many</option>
                </select>
              </div>

              {selected.kind === 'value' && (
                <div className="space-y-3 border-t border-border pt-3">
                  <div className="label">Value history &amp; context</div>
                  <p className="text-[11px] leading-relaxed text-muted">
                    By default each field only uses its own path (
                    <span className="font-mono text-text/80">building.name</span> ≠{' '}
                    <span className="font-mono text-text/80">role.name</span>
                    ). Map sources or a shared pool when values should cross fields.
                  </p>

                  <div>
                    <label className="label mb-1 block">This field&apos;s path</label>
                    <div
                      className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-text"
                      title="Natural history key from parent → child tags"
                    >
                      {fieldPathKey(selectedPath, selected)}
                    </div>
                  </div>

                  <div>
                    <label className="label mb-1 block">Writes history as</label>
                    <div
                      className="rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-muted"
                      title="Where new generated/sample values are stored"
                    >
                      {fieldHistoryWriteKey(selectedPath, selected)}
                    </div>
                  </div>

                  <div>
                    <label className="label mb-1 block">Shared value pool</label>
                    <input
                      className="input font-mono text-xs"
                      value={selected.historyPool ?? ''}
                      onChange={(e) =>
                        updateRow(selected.id, {
                          historyPool: e.target.value.trim() || undefined
                        })
                      }
                      placeholder="e.g. person_name (optional)"
                      title="Fields with the same pool name share one value bank"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      Same pool on multiple fields → they share generation history.
                    </p>
                  </div>

                  <HistorySourceMapper
                    selected={selected}
                    selectedPath={selectedPath}
                    schemaPathKeys={schemaPathKeys}
                    onChange={(keys) =>
                      updateRow(selected.id, {
                        historySourceKeys: keys.length ? keys : undefined
                      })
                    }
                  />

                  <div>
                    <label className="label mb-1 block">History namespace</label>
                    <input
                      className="input text-xs"
                      value={selected.categoryOverride ?? ''}
                      onChange={(e) =>
                        updateRow(selected.id, {
                          categoryOverride: e.target.value.trim() || undefined
                        })
                      }
                      placeholder="optional extra prefix"
                      title="Namespaces this field further (does not share with other paths)"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      Extra prefix only — use pool/sources to share values.
                    </p>
                  </div>

                  <div>
                    <label className="label mb-1 block">Active read keys</label>
                    <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-border bg-surface-2 p-1.5 font-mono text-[10px] text-muted">
                      {fieldHistoryReadKeys(selectedPath, selected).map((k) => (
                        <li key={k} className="truncate" title={k}>
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
    </FieldLayoutContext.Provider>
  )
}
