import { useCallback, useEffect, useState } from 'react'
import type { EncryptionAssetInfo, EncryptionSettings } from '@shared/types'
import { DEFAULT_ENCRYPTION } from '@shared/types'
import { useAppStore } from '../store/appStore'

async function fileToBytes(file: File): Promise<number[]> {
  const buf = await file.arrayBuffer()
  return Array.from(new Uint8Array(buf))
}

function DropZone({
  label,
  hint,
  accept,
  currentName,
  onFile,
  onBrowse,
  onClear,
  dragActiveClass = 'border-accent bg-accent/10'
}: {
  label: string
  hint: string
  accept?: string
  currentName?: string
  onFile: (file: File) => void
  onBrowse: () => void
  onClear: () => void
  dragActiveClass?: string
}): JSX.Element {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="space-y-1">
      <div className="label">{label}</div>
      <div
        className={`rounded-md border border-dashed px-3 py-4 text-center transition-colors ${
          dragOver ? dragActiveClass : 'border-border bg-bg'
        }`}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
      >
        <p className="text-xs text-muted">{hint}</p>
        {currentName ? (
          <p className="mt-2 truncate font-mono text-xs text-text" title={currentName}>
            {currentName}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">No file yet</p>
        )}
        <div className="mt-2 flex justify-center gap-2">
          <button type="button" className="btn-ghost border border-border text-xs px-2 py-1" onClick={onBrowse}>
            Browse…
          </button>
          {currentName && (
            <button
              type="button"
              className="btn-ghost text-xs px-2 py-1 text-danger"
              onClick={onClear}
            >
              Remove
            </button>
          )}
          <label className="btn-ghost border border-border text-xs px-2 py-1 cursor-pointer">
            Upload
            <input
              type="file"
              className="hidden"
              accept={accept}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

export function EncryptionSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const setEncryption = useAppStore((s) => s.setEncryption)

  const enc: EncryptionSettings = {
    ...DEFAULT_ENCRYPTION,
    ...settings.encryption
  }

  const [assets, setAssets] = useState<EncryptionAssetInfo | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const info = await window.dataforge.encryptionStatus()
      setAssets(info)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not load encryption status')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, settings.encryption])

  async function patchEnc(partial: Partial<EncryptionSettings>): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      await setEncryption({ ...enc, ...partial })
      await refresh()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setBusy(false)
    }
  }

  async function onScriptFile(file: File): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const data = await fileToBytes(file)
      const res = await window.dataforge.encryptionSaveScript(data, file.name)
      if (!res.ok) throw new Error(res.error || 'Script upload failed')
      setStatus(`Script saved: ${res.originalName}`)
      await refresh()
      // reload settings from main
      const s = await window.dataforge.getSettings()
      useAppStore.setState({ settings: s })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Script upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function onKeyFile(file: File): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const data = await fileToBytes(file)
      const res = await window.dataforge.encryptionSaveKey(data, file.name)
      if (!res.ok) throw new Error(res.error || 'Key upload failed')
      setStatus(`Key saved: ${res.originalName}`)
      await refresh()
      const s = await window.dataforge.getSettings()
      useAppStore.setState({ settings: s })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Key upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <div className="label mb-1">Custom encryption (testing)</div>
        <p className="text-[11px] text-muted leading-relaxed">
          Upload a Python script and key for offline encryption tests. DataForge sets the file{' '}
          <strong className="text-text">base name</strong> (from your export name); your script
          should only change the <strong className="text-text">extension</strong> (e.g.{' '}
          <code className="text-text">Orders.json</code> → <code className="text-text">Orders.enc</code>
          ). Assets live under local userData.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enc.enabled}
          disabled={busy}
          onChange={(e) => void patchEnc({ enabled: e.target.checked })}
        />
        Enable custom encryption
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enc.encryptOnExport}
          disabled={busy || !enc.enabled}
          onChange={(e) => void patchEnc({ encryptOnExport: e.target.checked })}
        />
        Encrypt files after export / archive
      </label>

      <DropZone
        label="Python encryption script"
        hint="Drag & drop a .py file, or browse / upload"
        accept=".py,text/x-python,text/plain"
        currentName={
          assets?.scriptExists
            ? assets.scriptOriginalName || assets.scriptPath
            : enc.scriptOriginalName
        }
        onFile={(f) => void onScriptFile(f)}
        onBrowse={() => {
          void (async () => {
            setBusy(true)
            try {
              const res = await window.dataforge.encryptionPickScript()
              if (res.ok) {
                setStatus(`Script saved: ${res.originalName}`)
                const s = await window.dataforge.getSettings()
                useAppStore.setState({ settings: s })
                await refresh()
              } else if (res.error !== 'Canceled') {
                setStatus(res.error || 'Pick failed')
              }
            } finally {
              setBusy(false)
            }
          })()
        }}
        onClear={() => {
          void (async () => {
            await window.dataforge.encryptionClearScript()
            const s = await window.dataforge.getSettings()
            useAppStore.setState({ settings: s })
            await refresh()
            setStatus('Script removed')
          })()
        }}
      />

      <DropZone
        label="Encryption key"
        hint="Drag & drop a key file, or browse / upload"
        currentName={
          assets?.keyExists ? assets.keyOriginalName || assets.keyPath : enc.keyOriginalName
        }
        onFile={(f) => void onKeyFile(f)}
        onBrowse={() => {
          void (async () => {
            setBusy(true)
            try {
              const res = await window.dataforge.encryptionPickKey()
              if (res.ok) {
                setStatus(`Key saved: ${res.originalName}`)
                const s = await window.dataforge.getSettings()
                useAppStore.setState({ settings: s })
                await refresh()
              } else if (res.error !== 'Canceled') {
                setStatus(res.error || 'Pick failed')
              }
            } finally {
              setBusy(false)
            }
          })()
        }}
        onClear={() => {
          void (async () => {
            await window.dataforge.encryptionClearKey()
            const s = await window.dataforge.getSettings()
            useAppStore.setState({ settings: s })
            await refresh()
            setStatus('Key removed')
          })()
        }}
      />

      <div>
        <label className="label mb-1 block" htmlFor="invoke-cmd">
          Invoke command
        </label>
        <textarea
          id="invoke-cmd"
          className="input min-h-[72px] resize-y font-mono text-[11px] leading-relaxed"
          value={enc.invokeCommand}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => {
            useAppStore.setState({
              settings: {
                ...settings,
                encryption: { ...enc, invokeCommand: e.target.value }
              }
            })
          }}
          onBlur={(e) => void patchEnc({ invokeCommand: e.target.value })}
          placeholder='python3 "{script}" --key "{key}" --input "{input}" --output "{output}"'
        />
        <p className="mt-1 text-[10px] text-muted leading-relaxed">
          Placeholders:{' '}
          <code className="text-text">{'{python}'}</code>{' '}
          <code className="text-text">{'{script}'}</code>{' '}
          <code className="text-text">{'{key}'}</code>{' '}
          <code className="text-text">{'{input}'}</code>
          . Keep the same base name as the input file; only change the extension. Success = exit
          code 0. Optional: print the final path on the last stdout line. Env helpers:{' '}
          <code className="text-text">DATAFORGE_INPUT</code>,{' '}
          <code className="text-text">DATAFORGE_STEM</code>,{' '}
          <code className="text-text">DATAFORGE_DIR</code>,{' '}
          <code className="text-text">DATAFORGE_KEY</code>.
        </p>
        <button
          type="button"
          className="btn-ghost mt-1 px-2 py-0.5 text-[10px]"
          onClick={() =>
            void patchEnc({
              invokeCommand: DEFAULT_ENCRYPTION.invokeCommand
            })
          }
        >
          Reset command to default
        </button>
      </div>

      {assets && (
        <div className="text-[10px] text-muted font-mono break-all space-y-0.5">
          <p>Dir: {assets.encryptionDir}</p>
          {assets.scriptExists && <p>Script: {assets.scriptPath}</p>}
          {assets.keyExists && <p>Key: {assets.keyPath}</p>}
        </div>
      )}

      {status && <p className="text-[11px] text-muted break-all">{status}</p>}
      {busy && <p className="text-[11px] text-muted">Working…</p>}
    </div>
  )
}
