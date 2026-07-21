import type { ThemeColors, ThemeMode } from '@shared/types'

export const DEFAULT_DARK: ThemeColors = {
  bg: '#0f1419',
  surface: '#1a2332',
  surface2: '#243044',
  border: '#2d3a4d',
  text: '#e7ecf3',
  muted: '#8b9bb4',
  accent: '#3b82f6',
  accentFg: '#ffffff'
}

export const DEFAULT_LIGHT: ThemeColors = {
  bg: '#f4f6f8',
  surface: '#ffffff',
  surface2: '#eef1f5',
  border: '#d0d7de',
  text: '#1f2328',
  muted: '#656d76',
  accent: '#2563eb',
  accentFg: '#ffffff'
}

export function resolveMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyThemeTokens(mode: ThemeMode, custom?: ThemeColors | null): void {
  const root = document.documentElement
  const resolved = resolveMode(mode)
  root.setAttribute('data-theme', resolved)

  const base = resolved === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK
  const colors = custom ? { ...base, ...custom } : base

  root.style.setProperty('--color-bg', colors.bg)
  root.style.setProperty('--color-surface', colors.surface)
  root.style.setProperty('--color-surface-2', colors.surface2)
  root.style.setProperty('--color-border', colors.border)
  root.style.setProperty('--color-text', colors.text)
  root.style.setProperty('--color-muted', colors.muted)
  root.style.setProperty('--color-accent', colors.accent)
  root.style.setProperty('--color-accent-fg', colors.accentFg)
}

export function clearCustomThemeInline(): void {
  const root = document.documentElement
  ;[
    '--color-bg',
    '--color-surface',
    '--color-surface-2',
    '--color-border',
    '--color-text',
    '--color-muted',
    '--color-accent',
    '--color-accent-fg'
  ].forEach((p) => root.style.removeProperty(p))
}
