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
  if (!Number.isFinite(n)) return min
  if (!Number.isFinite(min) || !Number.isFinite(max)) return n
  if (max < min) return min
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
 * Never schedules a state update when the clamped size is unchanged
 * (critical for avoiding ResizeObserver / max-bound feedback loops).
 */
export function useResizable(options: UseResizableOptions): UseResizableResult {
  const { storageKey, initial, min, max, axis = 'horizontal', reverse = false } = options
  // Keep latest bounds in a ref so drag handlers stay stable without rebinding every max change
  const boundsRef = useRef({ min, max, storageKey })
  boundsRef.current = { min, max, storageKey }

  const [size, setSizeState] = useState(() =>
    clamp(readStored(storageKey, initial), min, max)
  )
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null)

  const setSize = useCallback((n: number) => {
    const { min: lo, max: hi, storageKey: key } = boundsRef.current
    const next = clamp(n, lo, hi)
    setSizeState((prev) => {
      if (prev === next) return prev
      try {
        localStorage.setItem(key, String(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }, [])

  // Re-clamp only when bounds change AND the current size is out of range
  useEffect(() => {
    setSizeState((s) => {
      const next = clamp(s, min, max)
      if (next === s) return s
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [min, max, storageKey])

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
