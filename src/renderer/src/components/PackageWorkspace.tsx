import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  FieldGenerateMode,
  PackageDocHydrated,
  PackageMember,
  SchemaDoc
} from '@shared/types'
import { MAX_GENERATE_RECORDS, MIN_GENERATE_RECORDS } from '@shared/types'

export interface PackageWorkspaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onError?: (message: string) => void
  onStatus?: (message: string) => void
  /** Called after a package import so the main schema list can refresh */
  onImported?: () => void
}

type Step = 'list' | 'verify' | 'generate'

const MODES: { id: FieldGenerateMode; label: string; hint: string }[] = [
  { id: 'same', label: 'Same', hint: 'Lock to sample on every variant' },
  { id: 'random', label: 'Random', hint: 'History + pattern generation' },
  { id: 'unique', label: 'Unique', hint: 'Unique across package variants' }
]

export function PackageWorkspace({
  open,
  onOpenChange,
  onError,
  onStatus,
  onImported
}: PackageWorkspaceProps): JSX.Element {
  const [step, setStep] = useState<Step>('list')
  const [packages, setPackages] = useState<PackageDocHydrated[]>([])
  const [active, setActive] = useState<PackageDocHydrated | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [recordCount, setRecordCount] = useState(10)
  const [defaultMode, setDefaultMode] = useState<FieldGenerateMode>('random')
  const [fieldModes, setFieldModes] = useState<
    Record<string, Record<string, FieldGenerateMode>>
  >({})
  const [leafPaths, setLeafPaths] = useState<Record<string, string[]>>({})
  const [ciMode, setCiMode] = useState(false)
  const [seed, setSeed] = useState('')

  const textMembers = useMemo(
    () => active?.members.filter((m) => m.kind === 'text') ?? [],
    [active]
  )

  const selectedMember: PackageMember | null = useMemo(() => {
    if (!active || !selectedPath) return null
    return active.members.find((m) => m.path === selectedPath) ?? null
  }, [active, selectedPath])

  const selectedSchema: SchemaDoc | null = useMemo(() => {
    if (!active || !selectedPath) return null
    return active.schemas[selectedPath] ?? null
  }, [active, selectedPath])

  const refreshList = useCallback(async () => {
    if (typeof window.dataforge?.listPackages !== 'function') return
    const list = await window.dataforge.listPackages()
    const hydrated: PackageDocHydrated[] = []
    for (const p of list) {
      const h = await window.dataforge.getPackage(p.id)
      if (h) hydrated.push(h)
    }
    setPackages(hydrated)
  }, [])

  useEffect(() => {
    if (!open) return
    setStep('list')
    setActive(null)
    setSelectedPath(null)
    setPreview('')
    setStatus(null)
    void refreshList()
  }, [open, refreshList])

  async function importArchiveOrFolder(): Promise<void> {
    if (typeof window.dataforge?.importPackage !== 'function') {
      onError?.('Package API unavailable — restart the app')
      return
    }
    setWorking(true)
    setStatus('Importing package…')
    try {
      const res = await window.dataforge.importPackage()
      if (res.canceled) {
        setStatus(null)
        return
      }
      if (res.error || !res.package) {
        onError?.(res.error || 'Import failed')
        setStatus(res.error || 'Import failed')
        return
      }
      setActive(res.package)
      setStep('verify')
      const first = res.package.members.find((m) => m.kind === 'text')
      setSelectedPath(first?.path ?? null)
      if (first?.content) setPreview(first.content.slice(0, 50_000))
      const skipped = res.package.skipped?.length
        ? ` · skipped ${res.package.skipped.length} unsupported`
        : ''
      const nested = res.package.nestedArchives?.length
        ? ` · expanded ${res.package.nestedArchives.length} nested archive(s)`
        : ''
      const nText = res.package.members.filter((m) => m.kind === 'text').length
      const multi =
        nText > 1 || res.package.multifileSchemaId
          ? ' · saved as Multifile schema'
          : ''
      const msg = `Imported “${res.package.name}” · ${nText} text file(s)${nested}${skipped}${multi}`
      setStatus(msg)
      onStatus?.(msg)
      onImported?.()
      await refreshList()
      if (res.package.id) {
        const leaves = await window.dataforge.packageLeafPaths(res.package.id)
        setLeafPaths(leaves)
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function importMultiFiles(): Promise<void> {
    if (typeof window.dataforge?.importPackageFiles !== 'function') {
      onError?.('Package API unavailable — restart the app')
      return
    }
    setWorking(true)
    try {
      const res = await window.dataforge.importPackageFiles()
      if (res.canceled) return
      if (res.error || !res.package) {
        onError?.(res.error || 'Import failed')
        return
      }
      setActive(res.package)
      setStep('verify')
      const first = res.package.members.find((m) => m.kind === 'text')
      setSelectedPath(first?.path ?? null)
      if (first?.content) setPreview(first.content.slice(0, 50_000))
      onImported?.()
      await refreshList()
      const leaves = await window.dataforge.packageLeafPaths(res.package.id)
      setLeafPaths(leaves)
      const multi =
        res.package.members.filter((m) => m.kind === 'text').length > 1
          ? ' (saved as Multifile schema)'
          : ''
      onStatus?.(`Imported “${res.package.name}”${multi}`)
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function openPackage(id: string): Promise<void> {
    setWorking(true)
    try {
      const h = await window.dataforge.getPackage(id)
      if (!h) {
        onError?.('Package not found')
        return
      }
      setActive(h)
      setStep('verify')
      const first = h.members.find((m) => m.kind === 'text')
      setSelectedPath(first?.path ?? null)
      if (first?.content) setPreview(first.content.slice(0, 50_000))
      const leaves = await window.dataforge.packageLeafPaths(id)
      setLeafPaths(leaves)
    } finally {
      setWorking(false)
    }
  }

  function selectMember(m: PackageMember): void {
    setSelectedPath(m.path)
    if (m.kind === 'text' && m.content) setPreview(m.content.slice(0, 50_000))
    else if (m.kind === 'nested_archive_folder') {
      setPreview(
        `// Nested archive folder\n// Re-packs to: ${m.nestedArchivePath}\n// Format: ${m.nestedArchiveFormat}`
      )
    } else setPreview('')
  }

  async function markVerified(verified: boolean): Promise<void> {
    if (!active || !selectedPath) return
    await window.dataforge.verifyPackageMember({
      packageId: active.id,
      memberPath: selectedPath,
      verified
    })
    setActive((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.path === selectedPath ? { ...m, verified } : m
        )
      }
    })
  }

  async function markAllVerified(): Promise<void> {
    if (!active) return
    for (const m of textMembers) {
      await window.dataforge.verifyPackageMember({
        packageId: active.id,
        memberPath: m.path,
        verified: true
      })
    }
    setActive((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.kind === 'text' ? { ...m, verified: true } : m
        )
      }
    })
    setStatus('All text members marked verified')
  }

  function setModeForField(
    memberPath: string,
    fieldPath: string,
    mode: FieldGenerateMode
  ): void {
    setFieldModes((prev) => ({
      ...prev,
      [memberPath]: {
        ...(prev[memberPath] || {}),
        [fieldPath]: mode
      }
    }))
  }

  async function runGenerate(): Promise<void> {
    if (!active) return
    if (typeof window.dataforge?.generatePackage !== 'function') {
      onError?.('Package generate API unavailable — restart the app')
      return
    }
    setWorking(true)
    setStatus('Generating package variants…')
    try {
      const seedNum = seed.trim() === '' ? undefined : Number(seed)
      const res = await window.dataforge.generatePackage({
        packageId: active.id,
        recordCount: Math.min(
          Math.max(recordCount, MIN_GENERATE_RECORDS),
          MAX_GENERATE_RECORDS
        ),
        seed: Number.isFinite(seedNum) ? (seedNum as number) >>> 0 : undefined,
        ciMode,
        defaultFieldMode: defaultMode,
        fieldModes,
        repack: true
      })
      if (res.canceled) {
        setStatus('Canceled')
        return
      }
      if (res.error) {
        onError?.(res.error)
        setStatus(res.error)
        return
      }
      const msg = `Wrote ${res.written} package variant(s) → ${res.outputDir}${res.seed != null ? ` · seed ${res.seed}` : ''}${res.ms != null ? ` · ${res.ms}ms` : ''}`
      setStatus(msg)
      onStatus?.(msg)
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function removePackage(id: string): Promise<void> {
    if (!confirm('Delete this package import from SQLite?')) return
    await window.dataforge.deletePackage(id)
    if (active?.id === id) {
      setActive(null)
      setStep('list')
    }
    await refreshList()
  }

  const unverified = textMembers.filter((m) => !m.verified).length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,820px)] w-[min(96vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-text">
              Package variation
            </Dialog.Title>
            <span className="text-[11px] text-muted">
              Whole upload = one record · nested archives expand & re-pack
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs ${step === 'list' ? 'bg-surface-2 text-text' : 'text-muted'}`}
                onClick={() => setStep('list')}
              >
                Packages
              </button>
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs ${step === 'verify' ? 'bg-surface-2 text-text' : 'text-muted'}`}
                disabled={!active}
                onClick={() => setStep('verify')}
              >
                Verify
              </button>
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs ${step === 'generate' ? 'bg-surface-2 text-text' : 'text-muted'}`}
                disabled={!active}
                onClick={() => setStep('generate')}
              >
                Generate
              </button>
              <Dialog.Close className="btn btn-ghost text-xs">Close</Dialog.Close>
            </div>
          </div>

          {status && (
            <div className="border-b border-border bg-accent/10 px-4 py-1.5 text-xs text-text">
              {status}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            {step === 'list' && (
              <div className="flex w-full flex-col gap-3 p-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary text-xs"
                    disabled={working}
                    onClick={() => void importArchiveOrFolder()}
                  >
                    Import archive or folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={working}
                    onClick={() => void importMultiFiles()}
                  >
                    Import multi-select files
                  </button>
                </div>
                <p className="text-xs text-muted">
                  Nested <span className="font-mono">.tar.gz</span> /{' '}
                  <span className="font-mono">.zip</span> /{' '}
                  <span className="font-mono">.tar</span> expand into a child folder named
                  after the archive (extensions stripped). Unsupported extensions are skipped.
                  The entire package is one generation record.
                </p>
                <ul className="flex-1 space-y-1 overflow-auto rounded border border-border p-2">
                  {packages.length === 0 && (
                    <li className="text-xs text-muted">No packages yet — import one.</li>
                  )}
                  {packages.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => void openPackage(p.id)}
                      >
                        <div className="truncate text-sm font-medium text-text">{p.name}</div>
                        <div className="text-[10px] text-muted">
                          {p.outerFormat} ·{' '}
                          {p.members.filter((m) => m.kind === 'text').length} text ·{' '}
                          {p.nestedArchives?.length || 0} nested · skipped{' '}
                          {p.skipped?.length || 0}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-danger"
                        onClick={() => void removePackage(p.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === 'verify' && active && (
              <>
                <aside className="flex w-64 shrink-0 flex-col border-r border-border">
                  <div className="border-b border-border px-3 py-2 text-xs font-semibold">
                    {active.name}
                  </div>
                  <ul className="flex-1 overflow-auto p-2 text-xs">
                    {active.members.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className={`mb-0.5 w-full rounded px-2 py-1.5 text-left ${
                            selectedPath === m.path ? 'bg-accent/20 text-text' : 'hover:bg-surface-2'
                          }`}
                          onClick={() => selectMember(m)}
                        >
                          <div className="truncate font-mono text-[11px]">{m.path}</div>
                          <div className="text-[10px] text-muted">
                            {m.kind === 'nested_archive_folder'
                              ? `folder → ${m.nestedArchiveFormat}`
                              : `${m.format || 'text'}${m.verified ? ' · verified' : ' · review'}`}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {active.skipped?.length > 0 && (
                    <div className="border-t border-border p-2 text-[10px] text-muted">
                      Skipped: {active.skipped.slice(0, 5).join(', ')}
                      {active.skipped.length > 5 ? '…' : ''}
                    </div>
                  )}
                  <div className="flex gap-1 border-t border-border p-2">
                    <button
                      type="button"
                      className="btn btn-ghost flex-1 text-[10px]"
                      onClick={() => void markAllVerified()}
                    >
                      Verify all
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary flex-1 text-[10px]"
                      onClick={() => setStep('generate')}
                    >
                      Generate →
                    </button>
                  </div>
                </aside>
                <section className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <span className="text-xs font-medium text-text">
                      {selectedMember?.path || 'Select a file'}
                    </span>
                    {selectedMember?.kind === 'text' && (
                      <label className="ml-auto flex items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedMember.verified)}
                          onChange={(e) => void markVerified(e.target.checked)}
                        />
                        Verified
                      </label>
                    )}
                  </div>
                  {selectedSchema && (
                    <div className="border-b border-border px-3 py-2 text-[11px] text-muted">
                      Schema: <span className="text-text">{selectedSchema.name}</span> ·{' '}
                      {selectedSchema.root.length} root field(s) · format{' '}
                      {selectedSchema.sourceFormat || selectedMember?.format}
                    </div>
                  )}
                  <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] text-muted whitespace-pre-wrap">
                    {preview || '// Select a text member to preview original content'}
                  </pre>
                </section>
              </>
            )}

            {step === 'generate' && active && (
              <div className="flex w-full flex-col gap-3 overflow-auto p-4">
                <p className="text-xs text-muted">
                  Each generated unit is a <strong className="text-text">full package</strong>{' '}
                  (all members + re-packed nested archives). Outer format:{' '}
                  <span className="font-mono text-text">{active.outerFormat}</span>
                  {unverified > 0 && (
                    <span className="text-[#d4a017]">
                      {' '}
                      · {unverified} member(s) not marked verified
                    </span>
                  )}
                </p>
                <div className="grid max-w-xl grid-cols-2 gap-3">
                  <label className="text-xs text-muted">
                    Variants (records)
                    <input
                      type="number"
                      className="input mt-0.5"
                      min={MIN_GENERATE_RECORDS}
                      max={MAX_GENERATE_RECORDS}
                      value={recordCount}
                      onChange={(e) => setRecordCount(Number(e.target.value) || 1)}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Seed (optional)
                    <input
                      className="input mt-0.5"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      placeholder="random"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Default field mode
                    <select
                      className="input mt-0.5"
                      value={defaultMode}
                      onChange={(e) =>
                        setDefaultMode(e.target.value as FieldGenerateMode)
                      }
                    >
                      {MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} — {m.hint}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 self-end text-xs text-text">
                    <input
                      type="checkbox"
                      checked={ciMode}
                      onChange={(e) => setCiMode(e.target.checked)}
                    />
                    CI mode (no live history)
                  </label>
                </div>

                <div className="space-y-3">
                  <div className="label">Per-field modes (optional overrides)</div>
                  {textMembers.map((m) => {
                    const leaves = leafPaths[m.path] || []
                    if (!leaves.length) return null
                    return (
                      <div
                        key={m.path}
                        className="rounded border border-border p-2"
                      >
                        <div className="mb-1 font-mono text-[11px] text-accent">{m.path}</div>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {leaves.map((fp) => (
                            <label
                              key={fp}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="truncate font-mono text-muted">{fp}</span>
                              <select
                                className="input w-auto py-0.5 text-[11px]"
                                value={
                                  fieldModes[m.path]?.[fp] || defaultMode
                                }
                                onChange={(e) =>
                                  setModeForField(
                                    m.path,
                                    fp,
                                    e.target.value as FieldGenerateMode
                                  )
                                }
                              >
                                {MODES.map((mode) => (
                                  <option key={mode.id} value={mode.id}>
                                    {mode.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary text-xs"
                    disabled={working}
                    onClick={() => void runGenerate()}
                  >
                    {working ? 'Working…' : 'Generate & re-pack variants'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => setStep('verify')}
                  >
                    ← Back to verify
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
