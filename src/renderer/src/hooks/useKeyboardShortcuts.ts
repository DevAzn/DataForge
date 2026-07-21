import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

/**
 * Global keyboard shortcuts for DataForge.
 * When focus is in an input, only Ctrl/Cmd combos fire (not bare keys).
 */
export function useKeyboardShortcuts(handlers: {
  onExport?: () => void
  onGenerate?: () => void
  onArchive?: () => void
}): void {
  const addRootRow = useAppStore((s) => s.addRootRow)
  const addSiblingRow = useAppStore((s) => s.addSiblingRow)
  const addChildRow = useAppStore((s) => s.addChildRow)
  const deleteRow = useAppStore((s) => s.deleteRow)
  const selectedRowId = useAppStore((s) => s.selectedRowId)
  const saveActiveSchema = useAppStore((s) => s.saveActiveSchema)
  const newSchema = useAppStore((s) => s.newSchema)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)

  const { onExport, onGenerate, onArchive } = handlers

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey
      const typing = isTypingTarget(e.target)

      // Ctrl/Cmd shortcuts work even while typing
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActiveSchema()
        return
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        onGenerate?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        onExport?.()
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        onArchive?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newSchema()
        return
      }

      // Bare keys only when not typing in a field
      if (typing || mod || e.altKey) return

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        addRootRow()
        return
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        if (selectedRowId) addSiblingRow(selectedRowId)
        else addRootRow()
        return
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        if (selectedRowId) addChildRow(selectedRowId)
        else addRootRow()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRowId) {
          e.preventDefault()
          deleteRow(selectedRowId)
        }
        return
      }
      if (e.key === '1') {
        setSidebarTab('schemas')
        return
      }
      if (e.key === '2') {
        setSidebarTab('templates')
        return
      }
      if (e.key === '3') {
        setSidebarTab('history')
        return
      }
      if (e.key === '4') {
        setSidebarTab('settings')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    addRootRow,
    addSiblingRow,
    addChildRow,
    deleteRow,
    selectedRowId,
    saveActiveSchema,
    newSchema,
    setSidebarTab,
    onExport,
    onGenerate,
    onArchive
  ])
}
