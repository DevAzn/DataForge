import { useState } from 'react'
import { useAppStore } from '../store/appStore'

const SHORTCUTS = [
  { keys: 'Ctrl+S', action: 'Save schema' },
  { keys: 'Ctrl+G', action: 'Generate' },
  { keys: 'Ctrl+E', action: 'Export' },
  { keys: 'Ctrl+Shift+A', action: 'Package ZIP/TAR' },
  { keys: 'Ctrl+N', action: 'New schema' },
  { keys: 'R', action: 'Add root-level row' },
  { keys: 'A', action: 'Add sibling row' },
  { keys: 'N', action: 'Add nested child' },
  { keys: 'Del', action: 'Delete selected row' },
  { keys: '1–4', action: 'Sidebar tabs' }
]

export function StatusBar(): JSX.Element {
  const generating = useAppStore((s) => s.generating)
  const progress = useAppStore((s) => s.generateProgress)
  const activeSchema = useAppStore((s) => s.activeSchema)
  const recordCount = useAppStore((s) => s.recordCount)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <footer className="relative flex shrink-0 items-center gap-3 border-t border-border bg-surface px-3 py-1.5 text-[11px] text-muted">
      <span className="truncate font-medium text-text">
        {activeSchema?.name || 'No schema'}
      </span>
      <span className="hidden sm:inline">·</span>
      <span className="hidden sm:inline">{recordCount} rec</span>

      {generating && progress && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-1.5 min-w-[80px] max-w-[200px] flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-150"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="truncate text-text">
            {progress.message || `${progress.percent}%`}
          </span>
        </div>
      )}

      {!generating && <div className="flex-1" />}

      <button
        type="button"
        className="btn-ghost px-2 py-0.5 text-[11px]"
        onClick={() => setShowHelp((v) => !v)}
        title="Keyboard shortcuts"
      >
        Shortcuts
      </button>

      {showHelp && (
        <div className="absolute bottom-full right-2 z-40 mb-1 w-64 rounded-md border border-border bg-surface p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Keyboard shortcuts</span>
            <button
              type="button"
              className="text-muted hover:text-text"
              onClick={() => setShowHelp(false)}
            >
              ×
            </button>
          </div>
          <ul className="space-y-1">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex justify-between gap-2 text-xs">
                <kbd className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
                  {s.keys}
                </kbd>
                <span className="text-muted">{s.action}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted">
            Bare keys (R, A, N, Del) work when focus is not in an input field.
          </p>
        </div>
      )}
    </footer>
  )
}
