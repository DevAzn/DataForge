import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

export function ResizeHandle({
  onPointerDown,
  isDragging,
  axis = 'horizontal',
  title = 'Drag to resize'
}: {
  onPointerDown: (e: ReactPointerEvent) => void
  isDragging?: boolean
  axis?: 'horizontal' | 'vertical'
  title?: string
}): JSX.Element {
  const horizontal = axis === 'horizontal'

  const style: CSSProperties = horizontal
    ? {
        width: 5,
        cursor: 'col-resize',
        touchAction: 'none'
      }
    : {
        height: 5,
        cursor: 'row-resize',
        touchAction: 'none'
      }

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      title={title}
      onPointerDown={onPointerDown}
      className={`group relative z-20 shrink-0 select-none ${
        isDragging ? 'bg-accent/50' : 'bg-border hover:bg-accent/40'
      } ${horizontal ? 'h-full' : 'w-full'}`}
      style={style}
    >
      {/* Larger hit area */}
      <div
        className={`absolute ${
          horizontal
            ? 'inset-y-0 -left-1 -right-1'
            : 'inset-x-0 -top-1 -bottom-1'
        }`}
      />
      <div
        className={`pointer-events-none absolute rounded-full bg-muted/80 opacity-0 transition-opacity group-hover:opacity-100 ${
          isDragging ? 'opacity-100 bg-accent' : ''
        } ${
          horizontal
            ? 'left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2'
            : 'left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2'
        }`}
      />
    </div>
  )
}
