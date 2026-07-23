async function req(path, opts = {}) {
  const res = await fetch(path, opts)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = j.detail || JSON.stringify(j)
    } catch {
      try {
        msg = await res.text()
      } catch {
        /* ignore */
      }
    }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  if (opts.raw) return res
  return res
}

export const api = {
  health: () => req('/api/health'),
  status: () => req('/api/status'),
  getSettings: () => req('/api/settings'),
  setSettings: (body) =>
    req('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  listSchemas: () => req('/api/schemas'),
  saveSchema: (schema) =>
    req('/api/schemas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schema)
    }),
  deleteSchema: (id) => req(`/api/schemas/${id}`, { method: 'DELETE' }),
  touchSchema: (id) => req(`/api/schemas/${id}/touch`, { method: 'POST' }),
  importFile: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/api/schemas/import', { method: 'POST', body: fd })
  },
  generate: (body) =>
    req('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  generatePerFile: (body) =>
    req('/api/generate/per-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  generateStream: async (body) => {
    const res = await fetch('/api/generate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(await res.text())
    return res.text()
  },
  exportData: (body) =>
    req('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  exportArchive: async (body) => {
    const res = await fetch('/api/export/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(await res.text())
    return res.blob()
  },
  history: (limit = 80) => req(`/api/history?limit=${limit}`),
  historyPage: (offset = 0, limit = 50, search = '') =>
    req(
      `/api/history/page?offset=${offset}&limit=${limit}&search=${encodeURIComponent(search || '')}`
    ),
  historySuggest: (q) => {
    const p = new URLSearchParams(q)
    return req(`/api/history/suggest?${p}`)
  },
  historyKeys: (prefix = '') =>
    req(`/api/history/keys?prefix=${encodeURIComponent(prefix)}`),
  historyClear: (body) =>
    req('/api/history/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  historyClearCount: (body) =>
    req('/api/history/clear-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  historyDelete: (ids) =>
    req('/api/history/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids)
    }),
  historyUpdate: (id, value) =>
    req('/api/history/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value })
    }),
  historyDeleteMatching: (search) =>
    req('/api/history/delete-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search })
    }),
  listTemplates: () => req('/api/templates'),
  saveTemplate: (t) =>
    req('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t)
    }),
  deleteTemplate: (id) => req(`/api/templates/${id}`, { method: 'DELETE' }),
  backupExport: async () => {
    const res = await fetch('/api/backup/export')
    if (!res.ok) throw new Error(await res.text())
    return res.blob()
  },
  backupImport: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/api/backup/import', { method: 'POST', body: fd })
  },
  archiveList: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/api/archive/list', { method: 'POST', body: fd })
  },
  archiveRead: async (file, entryPath) => {
    const fd = new FormData()
    fd.append('file', file)
    return req(
      `/api/archive/read?entryPath=${encodeURIComponent(entryPath)}`,
      { method: 'POST', body: fd }
    )
  }
}

export function newId() {
  return crypto.randomUUID()
}

export function emptyRow(sortOrder = 0) {
  return {
    id: newId(),
    key: 'field',
    kind: 'value',
    sampleValue: '',
    isPrimary: false,
    isUnique: false,
    nullRate: 0,
    enumValues: undefined,
    minLength: undefined,
    maxLength: undefined,
    min: undefined,
    max: undefined,
    pattern: undefined,
    historyPool: undefined,
    categoryOverride: undefined,
    historySourceKeys: undefined,
    children: [],
    sortOrder
  }
}

export function emptySchema(name = 'Untitled schema') {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name,
    root: [emptyRow(0)],
    createdAt: now,
    updatedAt: now
  }
}

export function downloadBlob(blob, fileName) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadText(text, fileName) {
  downloadBlob(new Blob([text], { type: 'text/plain' }), fileName)
}

export function downloadBase64Zip(b64, fileName) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  downloadBlob(new Blob([bytes], { type: 'application/zip' }), fileName)
}
