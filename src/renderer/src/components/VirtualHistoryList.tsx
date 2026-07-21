import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ClearHistoryAge,
  ClearHistoryMode,
  ClearHistoryRequest,
  HistoryListItem,
  HistoryPageResult
} from '@shared/types'

const ROW_HEIGHT = 80
const OVERSCAN = 8
const PAGE_SIZE = 80
/** Browsers choke on extreme element heights (~16–33M px). Cap spacer and scale scroll. */
const MAX_SCROLL_HEIGHT = 12_000_000
const MAX_CACHED_PAGES = 24

interface CachePage {
  offset: number
  items: HistoryListItem[]
}

/**
 * Windowed virtual list backed by paged SQLite history.
 * Only DOM-renders visible rows; pages are fetched on demand by scroll position.
 */
export function VirtualHistoryList({
  totalHint,
  onTotalChange
}: {
  totalHint?: number
  onTotalChange?: (total: number) => void
}): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(320)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [total, setTotal] = useState(totalHint ?? 0)
  const [pages, setPages] = useState<Map<number, CachePage>>(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearMode, setClearMode] = useState<ClearHistoryMode>('days')
  const [clearAge, setClearAge] = useState<ClearHistoryAge>('newer')
  const [clearDays, setClearDays] = useState(7)
  const [clearBeforeLocal, setClearBeforeLocal] = useState(() => toLocalDatetimeValue(new Date()))
  const [clearBusy, setClearBusy] = useState(false)
  const [clearMessage, setClearMessage] = useState<string | null>(null)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [editTarget, setEditTarget] = useState<HistoryListItem | null>(null)
  const [editValue, setEditValue] = useState('')
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [confirmMatchOpen, setConfirmMatchOpen] = useState(false)

  const fetchGen = useRef(0)
  const inflight = useRef(new Set<number>())
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  // Stable callback — avoid re-creating loadPage every parent render
  const onTotalChangeRef = useRef(onTotalChange)
  onTotalChangeRef.current = onTotalChange

  const clearCache = useCallback(() => {
    const empty = new Map<number, CachePage>()
    pagesRef.current = empty
    setPages(empty)
    inflight.current.clear()
    fetchGen.current += 1
  }, [])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset cache + scroll when search changes
  useEffect(() => {
    clearCache()
    setScrollTop(0)
    setSelectedIds(new Set())
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [search, clearCache])

  // Measure viewport
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 320)
    })
    ro.observe(el)
    setViewportH(el.clientHeight || 320)
    return () => ro.disconnect()
  }, [])

  const loadPage = useCallback(
    async (offset: number, force = false) => {
      const pageOffset = Math.floor(Math.max(0, offset) / PAGE_SIZE) * PAGE_SIZE
      if (!force) {
        if (pagesRef.current.has(pageOffset) || inflight.current.has(pageOffset)) {
          return
        }
      } else {
        inflight.current.delete(pageOffset)
      }

      inflight.current.add(pageOffset)
      const gen = fetchGen.current
      setLoading(true)
      setError(null)

      try {
        if (typeof window.dataforge?.listHistoryPage !== 'function') {
          throw new Error(
            'History API unavailable — fully restart the app (npm run dev)'
          )
        }

        const result: HistoryPageResult = await window.dataforge.listHistoryPage({
          offset: pageOffset,
          limit: PAGE_SIZE,
          search: search || undefined
        })

        // Stale response (search/refresh changed while in flight)
        if (gen !== fetchGen.current) return

        setTotal(result.total)
        onTotalChangeRef.current?.(result.total)

        setPages((prev) => {
          // If cache was cleared under us, start fresh
          const base = gen === fetchGen.current ? prev : new Map<number, CachePage>()
          const next = new Map(base)
          next.set(pageOffset, { offset: pageOffset, items: result.items })

          if (next.size > MAX_CACHED_PAGES) {
            const keys = Array.from(next.keys())
            keys.sort(
              (a, b) => Math.abs(a - pageOffset) - Math.abs(b - pageOffset)
            )
            const keep = new Set(keys.slice(0, MAX_CACHED_PAGES))
            for (const k of Array.from(next.keys())) {
              if (!keep.has(k)) next.delete(k)
            }
          }
          pagesRef.current = next
          return next
        })
      } catch (e) {
        if (gen !== fetchGen.current) return
        setError(e instanceof Error ? e.message : 'Failed to load history')
      } finally {
        inflight.current.delete(pageOffset)
        if (gen === fetchGen.current) {
          // Only clear loading if nothing else in flight
          if (inflight.current.size === 0) setLoading(false)
        }
      }
    },
    [search]
  )

  // Full pixel height vs capped scroll height
  const fullContentHeight = total * ROW_HEIGHT
  const scrollHeight = Math.min(
    Math.max(fullContentHeight, 0),
    MAX_SCROLL_HEIGHT
  )
  const scrollScale =
    fullContentHeight > MAX_SCROLL_HEIGHT && scrollHeight > 0
      ? fullContentHeight / scrollHeight
      : 1

  // Map DOM scrollTop → virtual index space
  const virtualScrollTop = scrollTop * scrollScale

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    if (total <= 0) {
      return { startIndex: 0, endIndex: 0, offsetY: 0 }
    }
    const start = Math.max(0, Math.floor(virtualScrollTop / ROW_HEIGHT) - OVERSCAN)
    const visible = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2
    const end = Math.min(total, start + visible)
    return {
      startIndex: start,
      endIndex: Math.max(start, end),
      offsetY: start * ROW_HEIGHT
    }
  }, [virtualScrollTop, viewportH, total])

  // Initial load + whenever search/loadPage identity changes
  useEffect(() => {
    void loadPage(0, true)
  }, [search, loadPage])

  // Fetch pages covering the visible range
  useEffect(() => {
    if (total <= 0) return
    const needed = new Set<number>()
    for (let i = startIndex; i < endIndex; i++) {
      needed.add(Math.floor(i / PAGE_SIZE) * PAGE_SIZE)
    }
    // Prefetch one page ahead
    if (endIndex < total) {
      needed.add(Math.floor(endIndex / PAGE_SIZE) * PAGE_SIZE)
    }
    Array.from(needed).forEach((off) => {
      void loadPage(off, false)
    })
  }, [startIndex, endIndex, total, loadPage])

  function itemAt(index: number): HistoryListItem | null {
    if (index < 0 || index >= total) return null
    const pageOffset = Math.floor(index / PAGE_SIZE) * PAGE_SIZE
    const page = pages.get(pageOffset)
    if (!page) return null
    return page.items[index - pageOffset] ?? null
  }

  // Visual offset: when height is capped, pin window to scrollTop so rows track the thumb
  const translateY = scrollScale > 1 ? Math.max(0, scrollTop) : offsetY

  function buildClearRequest(confirmAll = false): ClearHistoryRequest {
    if (clearMode === 'all') {
      return { mode: 'all', confirmAll }
    }
    if (clearMode === 'days') {
      return {
        mode: 'days',
        days: Math.max(1, Math.floor(clearDays) || 1),
        age: clearAge
      }
    }
    return {
      mode: 'datetime',
      beforeIso: localDatetimeToIso(clearBeforeLocal),
      age: clearAge
    }
  }

  function refreshList(): void {
    clearCache()
    setSelectedIds(new Set())
    setScrollTop(0)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    void loadPage(0, true)
  }

  function toggleSelected(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteIds(ids: string[]): Promise<void> {
    if (!ids.length) return
    if (typeof window.dataforge?.deleteHistory !== 'function') {
      setError('Delete history API unavailable — fully restart the app (npm run dev)')
      return
    }
    setRowBusyId(ids[0] ?? 'bulk')
    setError(null)
    try {
      const result = await window.dataforge.deleteHistory(ids)
      setClearMessage(
        result.deleted === 0
          ? 'No entries deleted.'
          : `Deleted ${result.deleted.toLocaleString()} entr${result.deleted === 1 ? 'y' : 'ies'}.`
      )
      refreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete history entries')
    } finally {
      setRowBusyId(null)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editTarget) return
    if (typeof window.dataforge?.updateHistory !== 'function') {
      setError('Update history API unavailable — fully restart the app (npm run dev)')
      return
    }
    const next = editValue.trim()
    if (!next) {
      setError('Corrected value cannot be empty.')
      return
    }
    setRowBusyId(editTarget.id)
    setError(null)
    try {
      await window.dataforge.updateHistory({ id: editTarget.id, value: next })
      setClearMessage('Value corrected.')
      setEditTarget(null)
      refreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update history entry')
    } finally {
      setRowBusyId(null)
    }
  }

  async function deleteMatchingSearch(): Promise<void> {
    if (!search) return
    if (typeof window.dataforge?.deleteHistoryMatching !== 'function') {
      setError('Delete matching API unavailable — fully restart the app (npm run dev)')
      return
    }
    setClearBusy(true)
    setError(null)
    try {
      const result = await window.dataforge.deleteHistoryMatching(search)
      setClearMessage(
        result.deleted === 0
          ? 'No matching entries to delete.'
          : `Deleted ${result.deleted.toLocaleString()} matching entr${result.deleted === 1 ? 'y' : 'ies'}.`
      )
      setConfirmMatchOpen(false)
      refreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete matching history')
    } finally {
      setClearBusy(false)
    }
  }

  async function runClear(confirmAll = false): Promise<void> {
    if (typeof window.dataforge?.clearHistory !== 'function') {
      setError('Clear history API unavailable — fully restart the app (npm run dev)')
      return
    }
    setClearBusy(true)
    setClearMessage(null)
    setError(null)
    try {
      const request = buildClearRequest(confirmAll)
      const result = await window.dataforge.clearHistory(request)
      setClearMessage(
        result.deleted === 0
          ? 'No matching history entries to delete.'
          : `Deleted ${result.deleted.toLocaleString()} entr${result.deleted === 1 ? 'y' : 'ies'}.`
      )
      setConfirmAllOpen(false)
      refreshList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear history')
    } finally {
      setClearBusy(false)
    }
  }

  function onClearClick(): void {
    if (clearMode === 'all') {
      setConfirmAllOpen(true)
      return
    }
    void runClear(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 py-1 text-xs"
          placeholder="Search key or value…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => {
            clearCache()
            setScrollTop(0)
            if (scrollerRef.current) scrollerRef.current.scrollTop = 0
            void loadPage(0, true)
          }}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="rounded-md border border-border bg-surface-2/60 p-2 space-y-2">
        <div className="label text-[10px]">Clear history by time</div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-xs text-text">
            <input
              type="radio"
              className="mt-0.5"
              name="clear-history-mode"
              checked={clearMode === 'all'}
              onChange={() => setClearMode('all')}
            />
            <span>
              <span className="font-medium">All-time</span>
              <span className="block text-[10px] text-muted">Delete every history entry</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-text">
            <input
              type="radio"
              className="mt-0.5"
              name="clear-history-mode"
              checked={clearMode === 'days'}
              onChange={() => setClearMode('days')}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">By days</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={36500}
                  className="input w-20 py-0.5 text-xs"
                  value={clearDays}
                  disabled={clearMode !== 'days'}
                  onChange={(e) => setClearDays(Math.max(1, Number(e.target.value) || 1))}
                  onFocus={() => setClearMode('days')}
                />
                <span className="text-[10px] text-muted">day cutoff from now</span>
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-text">
            <input
              type="radio"
              className="mt-0.5"
              name="clear-history-mode"
              checked={clearMode === 'datetime'}
              onChange={() => setClearMode('datetime')}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">By date/time</span>
              <span className="mt-1 block">
                <input
                  type="datetime-local"
                  className="input w-full py-0.5 text-xs"
                  value={clearBeforeLocal}
                  disabled={clearMode !== 'datetime'}
                  onChange={(e) => setClearBeforeLocal(e.target.value)}
                  onFocus={() => setClearMode('datetime')}
                />
              </span>
            </span>
          </label>
        </div>

        {clearMode !== 'all' && (
          <div className="rounded border border-border/80 bg-bg/50 p-1.5">
            <div className="label mb-1 text-[10px]">Delete which side?</div>
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-xs text-text">
                <input
                  type="radio"
                  className="mt-0.5"
                  name="clear-history-age"
                  checked={clearAge === 'newer'}
                  onChange={() => setClearAge('newer')}
                />
                <span>
                  <span className="font-medium">Newer</span>
                  <span className="block text-[10px] text-muted">
                    {clearMode === 'days'
                      ? `Last used within the past ${clearDays} day${clearDays === 1 ? '' : 's'}`
                      : 'Last used on or after the chosen date/time'}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-text">
                <input
                  type="radio"
                  className="mt-0.5"
                  name="clear-history-age"
                  checked={clearAge === 'older'}
                  onChange={() => setClearAge('older')}
                />
                <span>
                  <span className="font-medium">Older</span>
                  <span className="block text-[10px] text-muted">
                    {clearMode === 'days'
                      ? `Last used strictly more than ${clearDays} day${clearDays === 1 ? '' : 's'} ago`
                      : 'Last used strictly before the chosen date/time'}
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
            disabled={clearBusy}
            onClick={onClearClick}
          >
            {clearBusy ? 'Clearing…' : 'Clear history'}
          </button>
          {clearMessage && (
            <span className="text-[10px] text-success truncate" title={clearMessage}>
              {clearMessage}
            </span>
          )}
        </div>
      </div>

      {confirmAllOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-all-title"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h2 id="clear-all-title" className="text-sm font-semibold text-text">
              Clear all history?
            </h2>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              Are you sure you want to do this? This permanently deletes every value history entry
              used for generation and autocomplete. Schemas and templates are not affected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={clearBusy}
                onClick={() => setConfirmAllOpen(false)}
              >
                No
              </button>
              <button
                type="button"
                className="btn-primary bg-danger px-3 py-1.5 text-xs hover:opacity-90"
                disabled={clearBusy}
                onClick={() => void runClear(true)}
              >
                {clearBusy ? 'Deleting…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmMatchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-match-title"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h2 id="clear-match-title" className="text-sm font-semibold text-text">
              Delete all search matches?
            </h2>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              This will permanently remove all{' '}
              <span className="font-medium text-text">{total.toLocaleString()}</span> history
              entries matching “{search}”. Schemas are not affected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={clearBusy}
                onClick={() => setConfirmMatchOpen(false)}
              >
                No
              </button>
              <button
                type="button"
                className="btn-primary bg-danger px-3 py-1.5 text-xs hover:opacity-90"
                disabled={clearBusy}
                onClick={() => void deleteMatchingSearch()}
              >
                {clearBusy ? 'Deleting…' : 'Yes, delete matches'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-history-title"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl">
            <h2 id="edit-history-title" className="text-sm font-semibold text-text">
              Correct history value
            </h2>
            <p className="mt-1 font-mono text-[10px] text-muted truncate" title={editTarget.keyName}>
              {editTarget.keyName}
              {editTarget.categoryName ? ` · ${editTarget.categoryName}` : ''}
            </p>
            <label className="label mt-3 mb-1 block">Value</label>
            <textarea
              className="input min-h-[72px] w-full font-mono text-xs"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <p className="mt-1 text-[10px] text-muted">
              Fixes bad import data so generation and autocomplete use the corrected text.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={rowBusyId === editTarget.id}
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                disabled={rowBusyId === editTarget.id}
                onClick={() => void saveEdit()}
              >
                {rowBusyId === editTarget.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-muted">
        <span>
          {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
          {search ? ` matching “${search}”` : ''}
          {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
          {scrollScale > 1 ? ' · large list mode' : ''}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {loading && <span>Loading…</span>}
          {selectedIds.size > 0 && (
            <>
              <button
                type="button"
                className="btn-ghost px-1.5 py-0.5 text-[10px] text-danger"
                disabled={rowBusyId !== null}
                onClick={() => void deleteIds(Array.from(selectedIds))}
              >
                Delete selected
              </button>
              <button
                type="button"
                className="btn-ghost px-1.5 py-0.5 text-[10px]"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </button>
            </>
          )}
          {search && total > 0 && (
            <button
              type="button"
              className="btn-ghost px-1.5 py-0.5 text-[10px] text-danger"
              disabled={clearBusy}
              onClick={() => setConfirmMatchOpen(true)}
              title="Delete every entry matching the current search"
            >
              Delete all matches
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-[11px] text-danger break-all">{error}</p>}

      {total === 0 && !loading ? (
        <p className="text-xs text-muted">
          {search
            ? 'No matches.'
            : 'No history yet. Save samples or Generate to fill SQLite history.'}
        </p>
      ) : (
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-bg"
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop)
          }}
        >
          <div style={{ height: Math.max(scrollHeight, viewportH), position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${translateY}px)`
              }}
            >
              {Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, i) => {
                const index = startIndex + i
                const item = itemAt(index)
                return (
                  <div
                    key={item?.id ?? `ph-${index}`}
                    className="border-b border-border/60 px-2 py-1.5"
                    style={{ height: ROW_HEIGHT, boxSizing: 'border-box' }}
                  >
                    {item ? (
                      <div className="flex h-full gap-1.5">
                        <label className="flex shrink-0 items-start pt-0.5" title="Select">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelected(item.id)}
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2 text-[10px] text-muted">
                            <span className="truncate font-medium text-text" title={item.keyName}>
                              {item.keyName}
                            </span>
                            <span className="shrink-0">×{item.useCount}</span>
                          </div>
                          <div
                            className="truncate font-mono text-xs text-text"
                            title={item.value}
                          >
                            {item.value}
                          </div>
                          <div className="truncate text-[10px] text-muted">
                            {item.categoryName}
                            <span className="opacity-60">
                              {' '}
                              · {formatTime(item.lastUsedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-0 text-[10px]"
                            disabled={rowBusyId === item.id}
                            title="Correct this value"
                            onClick={() => {
                              setEditTarget(item)
                              setEditValue(item.value)
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-0 text-[10px] text-danger"
                            disabled={rowBusyId === item.id}
                            title="Remove this value from history"
                            onClick={() => void deleteIds([item.id])}
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center text-[10px] text-muted">
                        Loading…
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

/** Value for <input type="datetime-local" /> from a Date (local wall clock). */
function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Convert datetime-local value to ISO for SQLite comparison. */
function localDatetimeToIso(localValue: string): string {
  const d = new Date(localValue)
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date/time for “delete up to”.')
  }
  return d.toISOString()
}
