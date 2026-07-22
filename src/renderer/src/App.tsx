import { useCallback, useEffect, useRef, useState } from 'react'
import logoUrl from './assets/logo.png'
import { Sidebar } from './components/Sidebar'
import { SchemaBuilder } from './components/SchemaBuilder'
import { PreviewPanel, type PreviewPanelHandle } from './components/PreviewPanel'
import { StatusBar } from './components/StatusBar'
import { ResizeHandle } from './components/ResizeHandle'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAppStore } from './store/appStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useResizable } from './hooks/useResizable'

/** Fixed layout caps — avoid ResizeObserver ↔ panel-width feedback loops. */
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 480
const PREVIEW_MIN = 240
const PREVIEW_MAX = 560

export default function App(): JSX.Element {
  const init = useAppStore((s) => s.init)
  const ready = useAppStore((s) => s.ready)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const importMessage = useAppStore((s) => s.importMessage)
  const clearImportMessage = useAppStore((s) => s.clearImportMessage)
  const previewRef = useRef<PreviewPanelHandle>(null)

  useEffect(() => {
    void init()
  }, [init])

  const sidebar = useResizable({
    storageKey: 'dataforge.layout.sidebarWidth',
    initial: 280,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX
  })

  const preview = useResizable({
    storageKey: 'dataforge.layout.previewWidth',
    initial: 320,
    min: PREVIEW_MIN,
    max: PREVIEW_MAX,
    reverse: true
  })

  useEffect(() => {
    if (sidebar.isDragging || preview.isDragging) {
      document.body.classList.add('resizing-panels')
    } else {
      document.body.classList.remove('resizing-panels')
    }
    return () => document.body.classList.remove('resizing-panels')
  }, [sidebar.isDragging, preview.isDragging])

  const onGenerate = useCallback(() => {
    previewRef.current?.generate()
  }, [])
  const onExport = useCallback(() => {
    previewRef.current?.exportCurrent()
  }, [])
  const onArchive = useCallback(() => {
    previewRef.current?.openArchive()
  }, [])

  useKeyboardShortcuts({ onGenerate, onExport, onArchive })

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg text-muted">
        <img
          src={logoUrl}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 rounded-2xl object-cover shadow-lg ring-1 ring-border"
          draggable={false}
        />
        <span className="text-sm">Starting DataForge…</span>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col bg-bg text-text">
        {error && (
          <div className="flex items-center gap-2 bg-danger/15 px-4 py-2 text-sm text-danger border-b border-danger/30">
            <span className="flex-1">{error}</span>
            <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {!error && importMessage && (
          <div className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-200">
            <span className="flex-1">{importMessage}</span>
            <button
              type="button"
              className="btn-ghost px-2 py-0.5 text-xs"
              onClick={clearImportMessage}
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden"
            style={{ width: sidebar.size }}
          >
            <Sidebar fill />
          </div>
          <ResizeHandle
            onPointerDown={sidebar.onPointerDown}
            isDragging={sidebar.isDragging}
            title="Drag to resize sidebar"
          />
          <div className="flex min-h-0 min-w-[280px] flex-1 flex-col overflow-hidden">
            <SchemaBuilder />
          </div>
          <ResizeHandle
            onPointerDown={preview.onPointerDown}
            isDragging={preview.isDragging}
            title="Drag to resize preview panel"
          />
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden"
            style={{ width: preview.size }}
          >
            <PreviewPanel ref={previewRef} fill />
          </div>
        </div>
        <StatusBar />
      </div>
    </ErrorBoundary>
  )
}
