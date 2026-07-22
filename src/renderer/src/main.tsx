import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/globals.css'

// Catch uncaught render/update loops that ErrorBoundary may miss (e.g. React #185)
window.addEventListener('error', (ev) => {
  const msg = ev.error instanceof Error ? ev.error.message : String(ev.message || ev.error)
  if (!msg) return
  console.error('[DataForge] window error', ev.error || ev.message)
  const root = document.getElementById('root')
  if (!root || root.dataset.crashShown === '1') return
  // Only hijack the DOM if React left it empty / still on loading shell
  if (root.childElementCount > 0 && !msg.includes('Minified React error #185') && !msg.includes('Maximum update depth')) {
    return
  }
  root.dataset.crashShown = '1'
  root.innerHTML = `<div style="height:100%;overflow:auto;background:#0f1419;color:#e7ecf3;font-family:system-ui,sans-serif;padding:2rem">
    <h1 style="color:#f87171;font-size:1.25rem;margin-bottom:0.75rem">DataForge hit a UI error</h1>
    <p style="color:#8b9bb4;margin-bottom:1rem">The window was blank because React stopped rendering. Details:</p>
    <pre style="white-space:pre-wrap;word-break:break-word;background:#1a2332;border:1px solid #2d3a4d;border-radius:8px;padding:1rem;font-size:12px;color:#fbbf24">${msg.replace(/</g, '&lt;')}</pre>
    <button type="button" onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer">Reload app</button>
  </div>`
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<p style="color:#f87171;font-family:sans-serif;padding:2rem">DataForge: #root missing</p>'
} else {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    rootEl.innerHTML = `<pre style="color:#f87171;font-family:monospace;padding:2rem;white-space:pre-wrap">DataForge failed to start:\n${msg}</pre>`
    console.error(err)
  }
}
