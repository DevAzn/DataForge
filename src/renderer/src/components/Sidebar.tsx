import { useState } from 'react'
import logoUrl from '../assets/logo.png'
import { useAppStore } from '../store/appStore'
import { EncryptionSettingsPanel } from './EncryptionSettings'
import { FileNamingSettingsPanel } from './FileNamingSettings'
import { ThemeSettingsPanel } from './ThemeSettings'
import { VirtualHistoryList } from './VirtualHistoryList'

const tabs = [
  { id: 'schemas' as const, label: 'Schemas' },
  { id: 'templates' as const, label: 'Templates' },
  { id: 'history' as const, label: 'History' },
  { id: 'settings' as const, label: 'Settings' }
]

export function Sidebar({ fill = false }: { fill?: boolean }): JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const schemas = useAppStore((s) => s.schemas)
  const templates = useAppStore((s) => s.templates)
  const status = useAppStore((s) => s.status)
  const [historyTotal, setHistoryTotal] = useState<number | null>(null)
  const activeSchema = useAppStore((s) => s.activeSchema)
  const newSchema = useAppStore((s) => s.newSchema)
  const selectSchema = useAppStore((s) => s.selectSchema)
  const deleteActiveSchema = useAppStore((s) => s.deleteActiveSchema)
  const importSchemaFromFile = useAppStore((s) => s.importSchemaFromFile)
  const importSchemaBrowse = useAppStore((s) => s.importSchemaBrowse)
  const [importBusy, setImportBusy] = useState(false)
  const [importDrag, setImportDrag] = useState(false)
  const exportBackup = useAppStore((s) => s.exportBackup)
  const importBackup = useAppStore((s) => s.importBackup)
  const loadTemplate = useAppStore((s) => s.loadTemplate)
  const duplicateTemplate = useAppStore((s) => s.duplicateTemplate)
  const deleteTemplate = useAppStore((s) => s.deleteTemplate)
  const saveAsTemplate = useAppStore((s) => s.saveAsTemplate)
  const activeHasSchema = Boolean(activeSchema)

  return (
    <aside
      className={`flex h-full flex-col border-r border-border bg-surface ${
        fill ? 'w-full' : 'w-64 shrink-0'
      }`}
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img
            src={logoUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-border"
            draggable={false}
          />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-text">
              Data<span className="text-accent">Forge</span>
            </h1>
            <p className="text-xs text-muted">Forging past the BS</p>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 border-b border-border p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              sidebarTab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
            onClick={() => setSidebarTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div
        className={`flex min-h-0 flex-1 flex-col p-3 ${
          sidebarTab === 'history' ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        {sidebarTab === 'schemas' && (
          <div className="space-y-2">
            <button type="button" className="btn-primary w-full" onClick={newSchema} title="Ctrl+N">
              + New schema
            </button>

            <div
              className={`rounded-md border border-dashed px-2 py-3 text-center transition-colors ${
                importDrag ? 'border-accent bg-accent/10' : 'border-border bg-bg'
              }`}
              onDragEnter={(e) => {
                e.preventDefault()
                setImportDrag(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setImportDrag(true)
              }}
              onDragLeave={() => setImportDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setImportDrag(false)
                const file = e.dataTransfer.files?.[0]
                if (!file) return
                setImportBusy(true)
                void file
                  .text()
                  .then((text) => importSchemaFromFile(file.name, text))
                  .finally(() => setImportBusy(false))
              }}
            >
              <p className="text-[11px] text-muted">
                Drop a JSON / CSV / XML / YAML / TXT file to import its schema
              </p>
              <div className="mt-2 flex justify-center gap-1">
                <button
                  type="button"
                  className="btn-ghost border border-border px-2 py-0.5 text-[10px]"
                  disabled={importBusy}
                  onClick={() => {
                    setImportBusy(true)
                    void importSchemaBrowse().finally(() => setImportBusy(false))
                  }}
                >
                  Browse…
                </button>
                <label className="btn-ghost border border-border px-2 py-0.5 text-[10px] cursor-pointer">
                  Upload
                  <input
                    type="file"
                    className="hidden"
                    accept=".json,.jsonl,.ndjson,.csv,.xml,.yml,.yaml,.txt,application/json,text/csv,text/xml,application/xml,text/plain"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      setImportBusy(true)
                      void file
                        .text()
                        .then((text) => importSchemaFromFile(file.name, text))
                        .finally(() => setImportBusy(false))
                    }}
                  />
                </label>
              </div>
              {importBusy && <p className="mt-1 text-[10px] text-muted">Importing…</p>}
            </div>

            {schemas.length === 0 && (
              <p className="text-xs text-muted">
                No saved schemas yet. Design fields, import a file, or load a template — then Save
                (Ctrl+S).
              </p>
            )}
            <ul className="space-y-1">
              {schemas.map((s) => (
                <li key={s.id} className="group flex items-stretch gap-0.5">
                  <button
                    type="button"
                    className={`min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      activeSchema?.id === s.id
                        ? 'bg-surface-2 text-text'
                        : 'text-muted hover:bg-surface-2 hover:text-text'
                    }`}
                    onClick={() => selectSchema(s.id)}
                  >
                    <div className="flex items-center gap-1.5 font-medium truncate">
                      <span className="truncate">{s.name}</span>
                      {s.isMultifile && (
                        <span
                          className="shrink-0 rounded bg-[#d4a017]/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#d4a017]"
                          title="Multi-file package schema"
                        >
                          multi
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {s.isMultifile
                        ? `${s.root.length} file${s.root.length === 1 ? '' : 's'}`
                        : `${s.root.length} field${s.root.length === 1 ? '' : 's'}`}
                      {s.sourceFileName && !s.isMultifile ? ` · ${s.sourceFileName}` : ''}
                      {s.isMultifile && s.packageId ? ' · package' : ''}
                    </div>
                  </button>
                  {activeSchema?.id === s.id && (
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-1.5 text-xs text-danger opacity-0 group-hover:opacity-100"
                      title="Delete schema"
                      onClick={() => {
                        if (window.confirm(`Delete schema “${s.name}”?`)) {
                          void deleteActiveSchema()
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {activeSchema && !schemas.some((s) => s.id === activeSchema.id) && (
              <p className="text-[10px] text-muted">
                Unsaved draft “{activeSchema.name}”
                {activeSchema.sourceFileName
                  ? ` (from ${activeSchema.sourceFileName})`
                  : ''}{' '}
                — press Save to keep it.
              </p>
            )}
            {activeSchema?.sourceFileName && (
              <div className="text-[10px] text-muted space-y-0.5 break-all">
                <p>
                  Source file: <span className="text-text">{activeSchema.sourceFileName}</span>
                  {activeSchema.sourceFormat ? ` · ${activeSchema.sourceFormat}` : ''}
                </p>
                {activeSchema.sourceFilePath && (
                  <p className="font-mono opacity-80" title={activeSchema.sourceFilePath}>
                    Path: {activeSchema.sourceFilePath}
                  </p>
                )}
                <p className="opacity-70">
                  Saved in SQLite (schema + file name/path + learned values in History).
                </p>
              </div>
            )}
          </div>
        )}

        {sidebarTab === 'templates' && (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Reusable schemas. Sample templates ship on first run.
            </p>
            {activeHasSchema && (
              <button
                type="button"
                className="btn-primary w-full text-xs"
                onClick={() => {
                  const name = window.prompt(
                    'Template name',
                    `${activeSchema?.name || 'Schema'} template`
                  )
                  if (name === null) return
                  void saveAsTemplate(name || undefined)
                }}
              >
                Save current as template
              </button>
            )}
            {templates.length === 0 && (
              <p className="text-xs text-muted">No templates yet.</p>
            )}
            <ul className="space-y-2">
              {templates.map((t) => (
                <li key={t.id} className="panel px-2 py-2">
                  <div className="text-sm font-medium text-text truncate">{t.name}</div>
                  {t.description && (
                    <div className="text-[10px] text-muted line-clamp-2">{t.description}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="btn-ghost border border-border px-2 py-0.5 text-[10px]"
                      onClick={() => void loadTemplate(t.id)}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-0.5 text-[10px]"
                      onClick={() => void duplicateTemplate(t.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-0.5 text-[10px] text-danger"
                      onClick={() => {
                        if (window.confirm(`Delete template “${t.name}”?`)) {
                          void deleteTemplate(t.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sidebarTab === 'history' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div>
              <div className="label mb-0.5">Value history</div>
              <p className="text-[10px] text-muted">
                Virtualized list — only visible rows render. DB total:{' '}
                {(historyTotal ?? status?.valueHistoryCount ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <VirtualHistoryList
                totalHint={status?.valueHistoryCount}
                onTotalChange={setHistoryTotal}
              />
            </div>
          </div>
        )}

        {sidebarTab === 'settings' && (
          <div className="space-y-4">
            <ThemeSettingsPanel />

            <FileNamingSettingsPanel />

            <EncryptionSettingsPanel />

            <div>
              <div className="label mb-2">Backup</div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="btn-ghost justify-start text-sm"
                  onClick={() => void exportBackup()}
                >
                  Export backup…
                </button>
                <button
                  type="button"
                  className="btn-ghost justify-start text-sm"
                  onClick={() => void importBackup()}
                >
                  Import backup…
                </button>
              </div>
            </div>
            <div className="text-xs text-muted space-y-1">
              {status && (
                <>
                  <p className="font-mono break-all">DB: {status.paths.dbPath}</p>
                  <p className="font-mono break-all">Cache: {status.paths.cachePath}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
