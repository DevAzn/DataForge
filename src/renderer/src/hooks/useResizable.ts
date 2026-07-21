import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type ResizeAxis = 'horizontal' | 'vertical'

export interface UseResizableOptions {
  /** localStorage key for persistence */
  storageKey: string
  /** Initial size in px */
  initial: number
  min: number
  max: number
  axis?: ResizeAxis
  /** Invert drag direction (e.g. resizing from the left edge of a right panel) */
  reverse?: boolean
}

export interface UseResizableResult {
  size: number
  setSize: (n: number) => void
  /** Bind to the drag handle */
  onPointerDown: (e: ReactPointerEvent) => void
  isDragging: boolean
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * Pointer-based resize with min/max clamp and localStorage persistence.
 */
export function useResizable(options: UseResizableOptions): UseResizableResult {
  const { storageKey, initial, min, max, axis = 'horizontal', reverse = false } = options
  const [size, setSizeState] = useState(() =>
    clamp(readStored(storageKey, initial), min, max)
  )
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null)

  const setSize = useCallback(
    (n: number) => {
      const next = clamp(n, min, max)
      setSizeState(next)
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        /* ignore quota */
      }
    },
    [min, max, storageKey]
  )

  // Re-clamp if min/max change (e.g. window resize updates max)
  useEffect(() => {
    setSizeState((s) => clamp(s, min, max))
  }, [min, max])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startPos = axis === 'horizontal' ? e.clientX : e.clientY
      dragRef.current = { startPos, startSize: size }
      setIsDragging(true)

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent): void => {
        if (!dragRef.current) return
        const pos = axis === 'horizontal' ? ev.clientX : ev.clientY
        const delta = pos - dragRef.current.startPos
        const signed = reverse ? -delta : delta
        setSize(dragRef.current.startSize + signed)
      }

      const onUp = (ev: PointerEvent): void => {
        dragRef.current = null
        setIsDragging(false)
        try {
          target.releasePointerCapture(ev.pointerId)
        } catch {
          /* already released */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [axis, reverse, size, setSize]
  )

  return { size, setSize, onPointerDown, isDragging }
}
