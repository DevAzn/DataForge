/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        accent: 'var(--color-accent)',
        'accent-fg': 'var(--color-accent-fg)',
        danger: 'var(--color-danger)',
        success: 'var(--color-success)',
        primary: 'var(--color-primary-flag)',
        relationship: 'var(--color-relationship)'
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
