import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'

export interface AutocompleteInputProps {
  value: string
  onChange: (value: string) => void
  /** Async suggestion loader */
  loadSuggestions: (query: string) => Promise<string[]>
  placeholder?: string
  className?: string
  disabled?: boolean
  title?: string
  onClick?: (e: MouseEvent) => void
  onFocusExtra?: () => void
}

export function AutocompleteInput({
  value,
  onChange,
  loadSuggestions,
  placeholder,
  className = '',
  disabled,
  title,
  onClick,
  onFocusExtra
}: AutocompleteInputProps): JSX.Element {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [hi, setHi] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onDoc(e: globalThis.MouseEvent): void {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function scheduleLoad(q: string): void {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void loadSuggestions(q)
        .then((list) => {
          const filtered = list.filter((s) => s && s !== q).slice(0, 12)
          setItems(filtered)
          setHi(0)
          setOpen(filtered.length > 0)
        })
        .catch(() => {
          setItems([])
          setOpen(false)
        })
    }, 120)
  }

  function pick(item: string): void {
    onChange(item)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <input
        className={className}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onClick}
        onChange={(e) => {
          onChange(e.target.value)
          scheduleLoad(e.target.value)
        }}
        onFocus={() => {
          onFocusExtra?.()
          scheduleLoad(value)
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHi((h) => Math.min(h + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && items[hi]) {
            e.preventDefault()
            pick(items[hi])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-40 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <li key={`${item}-${i}`} role="option" aria-selected={i === hi}>
              <button
                type="button"
                className={`w-full px-2 py-1 text-left font-mono text-xs ${
                  i === hi ? 'bg-accent/20 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(item)
                }}
                onMouseEnter={() => setHi(i)}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
