import { useMemo } from 'react'
import type {
  FileNameCollisionPolicy,
  FileNameSanitizeMode,
  FileNamingSettings
} from '@shared/types'
import { DEFAULT_FILE_NAMING } from '@shared/types'
import { previewFileNames } from '@shared/fileNamePattern'
import { useAppStore } from '../store/appStore'

const TOKENS: Array<{ token: string; hint: string }> = [
  { token: '{schema}', hint: 'Schema name' },
  { token: '{index:04}', hint: '1-based padded index (unique per file)' },
  { token: '{count}', hint: 'Total records' },
  { token: '{ext}', hint: 'Extension' },
  { token: '{format}', hint: 'json/xml/…' },
  { token: '{prefix}', hint: 'Settings prefix' },
  { token: '{suffix}', hint: 'Settings suffix' },
  { token: '{date}', hint: 'Date+time+ms (varies per file)' },
  { token: '{date:yyyy-MM-dd}', hint: 'Day only (same for batch — pair with index)' },
  { token: '{time}', hint: 'Time HHmmss_SSS (varies per file)' },
  { token: '{datetime}', hint: 'Full date+time+ms' },
  { token: '{ts}', hint: 'Unix ms timestamp (unique per file)' },
  { token: '{uuid}', hint: 'UUID v4 (unique)' },
  { token: '{uuid8}', hint: 'Short id (unique)' },
  { token: '{rand:8}', hint: 'Random alnum' },
  { token: '{seed}', hint: 'Generate seed' },
  { token: '{field:id}', hint: 'Value from record' },
  { token: '{field:id|unique}', hint: 'Field value; never duplicate in this batch' },
  { token: '{field:name|rand}', hint: 'Field value + random suffix every file' }
]

export function FileNamingSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const activeSchema = useAppStore((s) => s.activeSchema)
  const lastGenerated = useAppStore((s) => s.lastGenerated)
  const format = useAppStore((s) => s.previewFormat)

  const naming: FileNamingSettings = {
    ...DEFAULT_FILE_NAMING,
    ...settings.fileNaming
  }

  function patchNaming(partial: Partial<FileNamingSettings>): void {
    void patchSettings({
      fileNaming: { ...naming, ...partial }
    })
  }

  const sampleRecord = useMemo(() => {
    const first = lastGenerated?.records?.[0]
    if (first && typeof first === 'object' && first !== null) return first
    return { id: '1001', name: 'Jordan Lee', customer: { id: 'C-42' } }
  }, [lastGenerated])

  const previews = useMemo(
    () =>
      previewFileNames(
        naming.pattern,
        naming,
        {
          schema: activeSchema?.name || 'orders',
          format,
          ext: format === 'yaml' ? 'yml' : format,
          count: 3,
          record: sampleRecord,
          seed: 42
        },
        3
      ),
    [
      naming.pattern,
      naming.prefix,
      naming.suffix,
      naming.defaultIndexPad,
      naming.sanitizeMode,
      naming.ensureUniqueNames,
      activeSchema?.name,
      format,
      sampleRecord
    ]
  )

  function insertToken(token: string): void {
    patchNaming({ pattern: `${naming.pattern}${token}` })
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="label mb-1">Per-file naming</div>
        <p className="text-[10px] text-muted">
          Template for one-file-per-record output. Date/time tokens vary per file (ms offset). Use{' '}
          <span className="font-mono text-text">{'{field:path|unique}'}</span> so a field value is
          never reused as a name fragment in the same run, or{' '}
          <span className="font-mono text-text">{'|rand'}</span> to always randomize. Slashes create
          subfolders.
        </p>
      </div>

      <label className="block">
        <span className="text-[10px] text-muted">Pattern</span>
        <input
          className="input mt-0.5 font-mono text-xs"
          value={naming.pattern}
          onChange={(e) => patchNaming({ pattern: e.target.value })}
          spellCheck={false}
          placeholder="{schema}_{index:04}.{ext}"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        {TOKENS.map((t) => (
          <button
            key={t.token}
            type="button"
            className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-accent hover:border-accent hover:bg-accent/10"
            title={t.hint}
            onClick={() => insertToken(t.token)}
          >
            {t.token}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-muted">Prefix</span>
          <input
            className="input mt-0.5 text-xs"
            value={naming.prefix}
            onChange={(e) => patchNaming({ prefix: e.target.value })}
            placeholder="optional"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-muted">Suffix</span>
          <input
            className="input mt-0.5 text-xs"
            value={naming.suffix}
            onChange={(e) => patchNaming({ suffix: e.target.value })}
            placeholder="optional"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-muted">Index pad</span>
          <input
            type="number"
            min={1}
            max={12}
            className="input mt-0.5 text-xs"
            value={naming.defaultIndexPad}
            onChange={(e) =>
              patchNaming({
                defaultIndexPad: Math.min(12, Math.max(1, Number(e.target.value) || 4))
              })
            }
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-muted">If file exists</span>
          <select
            className="input mt-0.5 text-xs"
            value={naming.collision}
            onChange={(e) =>
              patchNaming({ collision: e.target.value as FileNameCollisionPolicy })
            }
          >
            <option value="suffix">Append _2, _3…</option>
            <option value="overwrite">Overwrite</option>
            <option value="skip">Skip</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] text-muted">Sanitize</span>
        <select
          className="input mt-0.5 text-xs"
          value={naming.sanitizeMode}
          onChange={(e) =>
            patchNaming({ sanitizeMode: e.target.value as FileNameSanitizeMode })
          }
        >
          <option value="windows">Windows-safe</option>
          <option value="ascii">Strict ASCII</option>
        </select>
      </label>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={naming.ensureUniqueNames !== false}
          onChange={(e) => patchNaming({ ensureUniqueNames: e.target.checked })}
        />
        <span>
          <span className="font-medium text-text">Never duplicate file names</span>
          <span className="block text-muted">
            Track every path written this run; auto-suffix (_2, _3…) if a name collides with another
            file in the batch or on disk. Recommended on.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={naming.deterministicRandom}
          onChange={(e) => patchNaming({ deterministicRandom: e.target.checked })}
        />
        <span>
          <span className="font-medium text-text">Deterministic uuid/rand/date</span>
          <span className="block text-muted">
            Derive name tokens from seed + index (always on in CI mode). Still unique per index.
          </span>
        </span>
      </label>

      <div className="rounded-md border border-border bg-bg px-2 py-1.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Preview</div>
        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-text">
          {previews.map((p) => (
            <li key={p} className="truncate" title={p}>
              {p}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="btn-ghost border border-border text-[11px]"
        onClick={() => patchNaming({ ...DEFAULT_FILE_NAMING })}
      >
        Reset to default pattern
      </button>
    </div>
  )
}
