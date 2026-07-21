import { useMemo } from 'react'
import type { ThemeColors } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { DEFAULT_DARK, DEFAULT_LIGHT, resolveMode } from '../theme/applyTheme'

const LABELS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surface2', label: 'Surface 2' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentFg', label: 'Accent text' }
]

const PRESETS: { name: string; colors: ThemeColors }[] = [
  {
    name: 'Ocean',
    colors: {
      bg: '#0b1220',
      surface: '#132037',
      surface2: '#1c2d4a',
      border: '#2a4060',
      text: '#e8eef8',
      muted: '#8aa0bf',
      accent: '#38bdf8',
      accentFg: '#0b1220'
    }
  },
  {
    name: 'Forest',
    colors: {
      bg: '#0c1410',
      surface: '#15241c',
      surface2: '#1e3328',
      border: '#2d4a3a',
      text: '#e7f5ec',
      muted: '#8fb89c',
      accent: '#34d399',
      accentFg: '#0c1410'
    }
  },
  {
    name: 'Sunset',
    colors: {
      bg: '#1a1014',
      surface: '#2a1820',
      surface2: '#3a2230',
      border: '#5a3448',
      text: '#fce8f0',
      muted: '#c49aab',
      accent: '#f472b6',
      accentFg: '#1a1014'
    }
  }
]

export function ThemeSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const setThemeMode = useAppStore((s) => s.setThemeMode)
  const setCustomColors = useAppStore((s) => s.setCustomColors)

  const base = useMemo(() => {
    const mode = resolveMode(settings.themeMode)
    return mode === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK
  }, [settings.themeMode])

  const colors: ThemeColors = {
    ...base,
    ...settings.customColors
  }

  function patch(key: keyof ThemeColors, value: string): void {
    void setCustomColors({ ...colors, [key]: value })
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="label mb-2">Theme mode</div>
        <div className="flex flex-col gap-1">
          {(['dark', 'light', 'system'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn-ghost justify-start capitalize ${
                settings.themeMode === mode ? 'bg-surface-2' : ''
              }`}
              onClick={() => void setThemeMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="label mb-2">Custom colors</div>
        <p className="mb-2 text-[11px] text-muted">
          Style DataForge with your palette. Changes save locally and apply immediately.
        </p>
        <div className="space-y-2">
          {LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <input
                type="color"
                className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
                value={normalizeHex(colors[key])}
                onChange={(e) => patch(key, e.target.value)}
              />
              <span className="w-20 text-muted">{label}</span>
              <input
                className="input flex-1 font-mono text-[11px] py-1"
                value={colors[key]}
                onChange={(e) => patch(key, e.target.value)}
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="btn-ghost border border-border px-2 py-0.5 text-[10px]"
              onClick={() => void setCustomColors(p.colors)}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            className="btn-ghost px-2 py-0.5 text-[10px] text-danger"
            onClick={() => void setCustomColors(null)}
          >
            Reset colors
          </button>
        </div>
      </div>
    </div>
  )
}

function normalizeHex(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1]
    const g = c[2]
    const b = c[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#888888'
}
