import { useCallback, useEffect, useRef, useState } from 'react'
import logoUrl from './assets/logo.png'
import { Sidebar } from './components/Sidebar'
import { SchemaBuilder } from './components/SchemaBuilder'
import { PreviewPanel, type PreviewPanelHandle } from './components/PreviewPanel'
import { StatusBar } from './components/StatusBar'
import { ResizeHandle } from './components/ResizeHandle'
import { useAppStore } from './store/appStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useResizable } from './hooks/useResizable'

export default function App(): JSX.Element {
  const init = useAppStore((s) => s.init)
  const ready = useAppStore((s) => s.ready)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const previewRef = useRef<PreviewPanelHandle>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const [mainWidth, setMainWidth] = useState(1200)

  useEffect(() => {
    void init()
  }, [init])

  // Track main row width so panel max sizes stay in range
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setMainWidth(el.clientWidth || 1200)
    })
    ro.observe(el)
    setMainWidth(el.clientWidth || 1200)
    return () => ro.disconnect()
  }, [ready])

  const sidebar = useResizable({
    storageKey: 'dataforge.layout.sidebarWidth',
    initial: 280,
    min: 200,
    max: Math.max(280, Math.floor(mainWidth * 0.4))
  })

  const preview = useResizable({
    storageKey: 'dataforge.layout.previewWidth',
    initial: 320,
    min: 240,
    max: Math.max(280, Math.floor(mainWidth * 0.5)),
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
    <div className="flex h-full flex-col bg-bg text-text">
      {error && (
        <div className="flex items-center gap-2 bg-danger/15 px-4 py-2 text-sm text-danger border-b border-danger/30">
          <span className="flex-1">{error}</span>
          <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <div ref={mainRef} className="flex min-h-0 flex-1">
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
  )
}
