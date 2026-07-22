<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api, emptyRow, emptySchema, newId } from './api'

const schemas = ref([])
const active = ref(null)
const selectedId = ref(null)
const format = ref('xml')
const recordCount = ref(10)
const seed = ref('')
const ciMode = ref(false)
const csvMultiRow = ref(true)
const csvTieOn = ref(false)
const generating = ref(false)
const lastGenerated = ref(null)
const previewText = ref('')
const history = ref([])
const statusMsg = ref('')
const errorMsg = ref('')
const tab = ref('schema')
const sidebar = ref('schemas')
const status = ref(null)

const selected = computed(() => {
  if (!active.value || !selectedId.value) return null
  return findRow(active.value.root, selectedId.value)
})

const tiedPaths = computed(() => active.value?.csvTiedFieldPaths || [])

function findRow(rows, id) {
  for (const r of rows) {
    if (r.id === id) return r
    const c = findRow(r.children || [], id)
    if (c) return c
  }
  return null
}

function flatten(rows, depth = 0, path = []) {
  const out = []
  for (const r of rows) {
    out.push({ row: r, depth, path })
    const seg = (r.key || 'field').trim() || 'field'
    out.push(...flatten(r.children || [], depth + 1, [...path, seg]))
  }
  return out
}

const flatRows = computed(() =>
  active.value ? flatten(active.value.root) : []
)

function pathLabel(path, row) {
  const leaf = (row.key || 'field').trim() || 'field'
  return [...path, leaf].join('.')
}

function isTied(path, row) {
  const p = pathLabel(path, row).toLowerCase()
  return tiedPaths.value.some((t) => t.toLowerCase() === p)
}

function toggleTie(path, row) {
  if (!active.value || row.kind !== 'value') return
  const p = pathLabel(path, row)
  const cur = [...(active.value.csvTiedFieldPaths || [])]
  const i = cur.findIndex((x) => x.toLowerCase() === p.toLowerCase())
  if (i >= 0) cur.splice(i, 1)
  else cur.push(p)
  active.value = {
    ...active.value,
    csvTiedFieldPaths: cur.length ? cur : undefined
  }
}

async function refresh() {
  schemas.value = await api.listSchemas()
  status.value = await api.status()
  history.value = await api.history(60)
  const s = await api.getSettings()
  if (s.defaultExportFormat) format.value = s.defaultExportFormat
  if (s.defaultRecordCount) recordCount.value = s.defaultRecordCount
  if (typeof s.csvMultiRow === 'boolean') csvMultiRow.value = s.csvMultiRow
}

onMounted(async () => {
  try {
    await refresh()
    if (schemas.value.length) {
      active.value = schemas.value[0]
      selectedId.value = active.value.root[0]?.id || null
    } else {
      active.value = emptySchema('My first schema')
      selectedId.value = active.value.root[0].id
    }
  } catch (e) {
    errorMsg.value =
      e.message + ' — is the API running? (uvicorn on port 8765)'
  }
})

async function saveSchema() {
  if (!active.value) return
  try {
    const saved = await api.saveSchema(active.value)
    active.value = saved
    statusMsg.value = `Saved “${saved.name}”`
    errorMsg.value = ''
    await refresh()
  } catch (e) {
    errorMsg.value = e.message
  }
}

function newSchema() {
  active.value = emptySchema()
  selectedId.value = active.value.root[0].id
  lastGenerated.value = null
  previewText.value = ''
}

async function selectSchema(id) {
  const s = schemas.value.find((x) => x.id === id)
  if (!s) return
  active.value = JSON.parse(JSON.stringify(s))
  selectedId.value = active.value.root[0]?.id || null
  lastGenerated.value = null
}

async function deleteSchema() {
  if (!active.value?.id) return
  if (!confirm(`Delete schema “${active.value.name}”?`)) return
  await api.deleteSchema(active.value.id)
  await refresh()
  if (schemas.value.length) selectSchema(schemas.value[0].id)
  else newSchema()
}

async function onImport(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  try {
    const res = await api.importFile(file)
    active.value = res.schema
    selectedId.value = active.value.root[0]?.id || null
    format.value = res.format || format.value
    if (res.recordHint) {
      recordCount.value = Math.min(Math.max(res.recordHint, 1), 10000)
    }
    statusMsg.value = `Imported “${res.schema.name}” (${String(res.format).toUpperCase()}) · scanned ${res.scannedRecords} · history ${res.historyValues}`
    errorMsg.value = ''
    await refresh()
    await api.setSettings({ defaultExportFormat: format.value })
  } catch (e) {
    errorMsg.value = e.message
  }
}

function addRoot() {
  if (!active.value) return
  const row = emptyRow(active.value.root.length)
  active.value = {
    ...active.value,
    root: [...active.value.root, row]
  }
  selectedId.value = row.id
}

function addChild() {
  if (!active.value || !selectedId.value) return
  const parentId = selectedId.value
  const row = emptyRow()
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === parentId) {
        const children = [...(r.children || []), row]
        return {
          ...r,
          kind: r.kind === 'value' ? 'object' : r.kind,
          children
        }
      }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
  selectedId.value = row.id
}

function updateSelected(patch) {
  if (!active.value || !selectedId.value) return
  const id = selectedId.value
  function walk(rows) {
    return rows.map((r) => {
      if (r.id === id) return { ...r, ...patch }
      return { ...r, children: walk(r.children || []) }
    })
  }
  active.value = { ...active.value, root: walk(active.value.root) }
}

function deleteSelected() {
  if (!active.value || !selectedId.value) return
  const id = selectedId.value
  function walk(rows) {
    return rows
      .filter((r) => r.id !== id)
      .map((r) => ({ ...r, children: walk(r.children || []) }))
  }
  const root = walk(active.value.root)
  active.value = {
    ...active.value,
    root: root.length ? root : [emptyRow(0)]
  }
  selectedId.value = active.value.root[0]?.id || null
}

async function generate() {
  if (!active.value) return
  generating.value = true
  errorMsg.value = ''
  try {
    const seedNum = seed.value.trim() === '' ? null : Number(seed.value)
    const body = {
      schema: {
        ...active.value,
        csvTiedFieldPaths: csvTieOn.value
          ? active.value.csvTiedFieldPaths
          : undefined
      },
      recordCount: recordCount.value,
      seed: Number.isFinite(seedNum) ? seedNum >>> 0 : null,
      ciMode: ciMode.value,
      recordHistory: !ciMode.value
    }
    const res = await api.generate(body)
    lastGenerated.value = res
    tab.value = 'generated'
    const payload =
      res.records?.length === 1 ? res.records[0] : res.records
    const exp = await api.exportData({
      data: payload,
      format: format.value,
      multiRow: csvMultiRow.value
    })
    previewText.value = exp.content
    statusMsg.value = `Generated ${res.recordCount} record(s) · seed ${res.seed}`
    if (seed.value !== '' || res.seed != null) {
      /* keep seed field optional */
    }
    await refresh()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    generating.value = false
  }
}

async function refreshPreview() {
  const data = lastGenerated.value?.records
  if (!data?.length) {
    // schema sample
    if (!active.value) return
    const sample = buildSample(active.value.root)
    const exp = await api.exportData({
      data: sample,
      format: format.value,
      multiRow: false
    })
    previewText.value = exp.content
    return
  }
  const payload = data.length === 1 ? data[0] : data
  const exp = await api.exportData({
    data: payload,
    format: format.value,
    multiRow: csvMultiRow.value
  })
  previewText.value = exp.content
}

function buildSample(rows) {
  const o = {}
  for (const r of rows) {
    const k = r.key || 'field'
    if (r.kind === 'array') {
      o[k] = r.children?.length
        ? [buildSample(r.children)]
        : []
    } else if (r.kind === 'object' || (r.children || []).length) {
      o[k] = buildSample(r.children || [])
    } else {
      o[k] = r.sampleValue ?? null
    }
  }
  return o
}

watch(format, () => {
  void refreshPreview()
  void api.setSettings({ defaultExportFormat: format.value })
})

watch(tab, () => {
  void refreshPreview()
})

function downloadPreview() {
  if (!previewText.value) return
  const ext = format.value === 'yaml' ? 'yml' : format.value
  const blob = new Blob([previewText.value], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${active.value?.name || 'data'}.${ext}`
  a.click()
  URL.revokeObjectURL(a.href)
}

const kindOptions = computed(() => {
  const f = (active.value?.sourceFormat || format.value || 'json').toLowerCase()
  if (f === 'csv' || f === 'txt') return [{ v: 'value', l: 'Value' }]
  if (f === 'xml')
    return [
      { v: 'value', l: 'Value / element' },
      { v: 'array', l: 'Repeated' }
    ]
  return [
    { v: 'value', l: 'Value' },
    { v: 'object', l: 'Object' },
    { v: 'array', l: 'Array' }
  ]
})
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <strong>PV_<span class="accent">DataForge</span></strong>
        <span class="muted">Python · Vue · SQLite</span>
      </div>
      <div class="top-actions">
        <select v-model="format" class="input fmt">
          <option value="json">JSON</option>
          <option value="xml">XML</option>
          <option value="csv">CSV</option>
          <option value="yaml">YAML</option>
          <option value="txt">TXT</option>
        </select>
        <button class="btn btn-primary" :disabled="generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate' }}
        </button>
      </div>
    </header>

    <div v-if="errorMsg" class="banner err">
      {{ errorMsg }}
      <button class="btn btn-ghost" @click="errorMsg = ''">Dismiss</button>
    </div>
    <div v-else-if="statusMsg" class="banner ok">
      {{ statusMsg }}
      <button class="btn btn-ghost" @click="statusMsg = ''">Dismiss</button>
    </div>

    <div class="main">
      <!-- Sidebar -->
      <aside class="side panel">
        <nav class="tabs">
          <button
            :class="{ on: sidebar === 'schemas' }"
            @click="sidebar = 'schemas'"
          >
            Schemas
          </button>
          <button
            :class="{ on: sidebar === 'history' }"
            @click="sidebar = 'history'"
          >
            History
          </button>
        </nav>

        <div v-if="sidebar === 'schemas'" class="side-body">
          <button class="btn btn-primary full" @click="newSchema">+ New schema</button>
          <label class="drop">
            Import sample (JSON/CSV/XML/YAML)
            <input type="file" accept=".json,.csv,.xml,.yml,.yaml,.txt,.jsonl" hidden @change="onImport" />
          </label>
          <ul class="schema-list">
            <li
              v-for="s in schemas"
              :key="s.id"
              :class="{ active: active?.id === s.id }"
              @click="selectSchema(s.id)"
            >
              <div class="name">{{ s.name }}</div>
              <div class="meta">{{ s.root?.length || 0 }} fields · {{ s.sourceFormat || '—' }}</div>
            </li>
          </ul>
          <p v-if="status" class="muted tiny">
            DB: {{ status.schemaCount }} schemas · {{ status.valueHistoryCount }} history
          </p>
        </div>

        <div v-else class="side-body hist">
          <p class="muted tiny">Path-scoped value history</p>
          <ul class="hist-list">
            <li v-for="h in history" :key="h.id">
              <span class="k">{{ h.keyName }}</span>
              <span class="v">{{ h.value }}</span>
            </li>
          </ul>
        </div>
      </aside>

      <!-- Schema builder -->
      <section class="center panel">
        <div class="center-head">
          <input
            v-if="active"
            v-model="active.name"
            class="input title"
            @change="saveSchema"
          />
          <button class="btn btn-ghost" @click="saveSchema">Save</button>
          <button class="btn btn-ghost" @click="addRoot">+ Root</button>
          <button class="btn btn-ghost" :disabled="!selectedId" @click="addChild">
            + Child
          </button>
          <button class="btn btn-ghost" :disabled="!selectedId" @click="deleteSelected">
            Delete
          </button>
          <button
            v-if="active?.id && schemas.some((s) => s.id === active.id)"
            class="btn btn-ghost danger"
            @click="deleteSchema"
          >
            Delete schema
          </button>
        </div>

        <div class="rows">
          <div
            v-for="f in flatRows"
            :key="f.row.id"
            class="row"
            :class="{
              sel: selectedId === f.row.id,
              tied: csvTieOn && isTied(f.path, f.row)
            }"
            :style="{ marginLeft: f.depth * 14 + 'px' }"
            @click="selectedId = f.row.id"
          >
            <input
              v-if="csvTieOn && f.row.kind === 'value'"
              type="checkbox"
              :checked="isTied(f.path, f.row)"
              title="Tie sample value across rows"
              @click.stop
              @change="toggleTie(f.path, f.row)"
            />
            <span class="kind">{{ f.row.kind === 'object' ? '{}' : f.row.kind === 'array' ? '[]' : '·' }}</span>
            <input
              class="input key"
              :value="f.row.key"
              @click.stop
              @change="
                (e) => {
                  selectedId = f.row.id
                  updateSelected({ key: e.target.value })
                }
              "
            />
            <input
              v-if="f.row.kind === 'value'"
              class="input sample"
              :value="f.row.sampleValue || ''"
              placeholder="sample"
              @click.stop
              @change="
                (e) => {
                  selectedId = f.row.id
                  updateSelected({ sampleValue: e.target.value })
                }
              "
            />
          </div>
        </div>

        <div v-if="selected" class="props">
          <div class="label">Properties</div>
          <div class="props-grid">
            <label>
              Kind
              <select
                class="input"
                :value="selected.kind"
                @change="updateSelected({ kind: $event.target.value })"
              >
                <option v-for="o in kindOptions" :key="o.v" :value="o.v">{{ o.l }}</option>
              </select>
            </label>
            <label class="chk">
              <input
                type="checkbox"
                :checked="selected.isPrimary"
                @change="
                  updateSelected({
                    isPrimary: $event.target.checked,
                    isUnique: $event.target.checked ? true : selected.isUnique
                  })
                "
              />
              Primary key
            </label>
            <label class="chk">
              <input
                type="checkbox"
                :checked="selected.isUnique || selected.isPrimary"
                :disabled="selected.isPrimary"
                @change="updateSelected({ isUnique: $event.target.checked })"
              />
              Unique in run
            </label>
            <label v-if="selected.kind === 'value'">
              Null %
              <input
                type="number"
                min="0"
                max="100"
                class="input"
                :value="selected.nullRate ?? 0"
                @change="updateSelected({ nullRate: Number($event.target.value) || 0 })"
              />
            </label>
          </div>
        </div>
      </section>

      <!-- Preview / generate -->
      <aside class="preview panel">
        <div class="ptabs">
          <button :class="{ on: tab === 'schema' }" @click="tab = 'schema'">Schema</button>
          <button :class="{ on: tab === 'generated' }" @click="tab = 'generated'">
            Auto-Gen
          </button>
          <button :class="{ on: tab === 'generate' }" @click="tab = 'generate'">Generate</button>
        </div>

        <div v-if="tab === 'generate'" class="gen">
          <label>
            Records
            <input v-model.number="recordCount" type="number" min="1" max="100000" class="input" />
          </label>
          <label>
            Seed (empty = random)
            <input v-model="seed" class="input" placeholder="random" />
          </label>
          <label class="chk">
            <input v-model="ciMode" type="checkbox" />
            CI mode (ignore live history)
          </label>
          <label v-if="format === 'csv'" class="chk">
            <input v-model="csvMultiRow" type="checkbox" />
            Multiple CSV data rows
          </label>
          <label v-if="format === 'csv' && csvMultiRow" class="chk gold">
            <input v-model="csvTieOn" type="checkbox" />
            Tie keys across rows (lock schema samples)
          </label>
          <button class="btn btn-primary full" :disabled="generating" @click="generate">
            {{ generating ? 'Working…' : 'Run generate' }}
          </button>
          <button class="btn btn-ghost full" :disabled="!previewText" @click="downloadPreview">
            Download preview
          </button>
        </div>

        <pre v-else class="code">{{ previewText || '// Generate or switch tabs to preview' }}</pre>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.top {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.brand .accent {
  color: var(--accent);
}
.muted {
  color: var(--muted);
}
.tiny {
  font-size: 11px;
}
.top-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.fmt {
  width: auto;
}
.banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  font-size: 13px;
}
.banner.err {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger);
}
.banner.ok {
  background: rgba(74, 222, 128, 0.12);
  color: var(--success);
}
.main {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  flex: 1;
  min-height: 0;
}
.side,
.center,
.preview {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: none;
  border-right: 1px solid var(--border);
}
.preview {
  border-right: none;
  border-left: 1px solid var(--border);
}
.tabs,
.ptabs {
  display: flex;
  gap: 2px;
  padding: 0.4rem;
  border-bottom: 1px solid var(--border);
}
.tabs button,
.ptabs button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--muted);
  padding: 0.35rem;
  border-radius: 6px;
  cursor: pointer;
}
.tabs button.on,
.ptabs button.on {
  background: var(--surface-2);
  color: var(--text);
}
.side-body {
  padding: 0.5rem;
  overflow: auto;
  flex: 1;
}
.full {
  width: 100%;
  margin-bottom: 0.4rem;
}
.drop {
  display: block;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 0.6rem;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 0.5rem;
  cursor: pointer;
}
.drop:hover {
  border-color: var(--accent);
  color: var(--text);
}
.schema-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.schema-list li {
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}
.schema-list li:hover,
.schema-list li.active {
  background: var(--surface-2);
}
.schema-list .name {
  font-size: 13px;
  font-weight: 600;
}
.schema-list .meta {
  font-size: 10px;
  color: var(--muted);
}
.center-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.center-head .title {
  max-width: 220px;
  font-weight: 600;
}
.danger {
  color: var(--danger);
}
.rows {
  flex: 1;
  overflow: auto;
  padding: 0.5rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem;
  border-radius: 6px;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.row:hover {
  background: var(--surface-2);
}
.row.sel {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.row.tied {
  border-color: var(--gold);
  background: rgba(255, 215, 0, 0.12);
}
.row .kind {
  width: 1.2rem;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.row .key {
  width: 140px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.row .sample {
  flex: 1;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.props {
  border-top: 1px solid var(--border);
  padding: 0.6rem 0.75rem;
  max-height: 28%;
  overflow: auto;
}
.props-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  margin-top: 0.35rem;
}
.props-grid label {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 7rem;
}
.chk {
  flex-direction: row !important;
  align-items: center;
  gap: 0.4rem !important;
  color: var(--text) !important;
}
.chk.gold {
  color: var(--gold) !important;
}
.gen {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow: auto;
}
.gen label {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.code {
  flex: 1;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  font-size: 11px;
  font-family: ui-monospace, Consolas, monospace;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.hist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 11px;
}
.hist-list li {
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border);
}
.hist-list .k {
  display: block;
  font-family: ui-monospace, monospace;
  color: var(--accent);
}
.hist-list .v {
  color: var(--text);
  word-break: break-all;
}
</style>
