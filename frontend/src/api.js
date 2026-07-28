/** Normalize FastAPI / generic error payloads into a short human message. */
export function formatApiError(detail, fallback = 'Request failed') {
  if (detail == null || detail === '') return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc)
            ? item.loc.filter((p) => p !== 'body').join('.')
            : ''
          const m = item.msg || item.message || JSON.stringify(item)
          return loc ? `${loc}: ${m}` : m
        }
        return String(item)
      })
      .filter(Boolean)
      .join('; ')
  }
  if (typeof detail === 'object') {
    if (detail.msg) return String(detail.msg)
    if (detail.message) return String(detail.message)
    if (detail.detail) return formatApiError(detail.detail, fallback)
    try {
      return JSON.stringify(detail)
    } catch {
      return fallback
    }
  }
  return String(detail)
}

async function req(path, opts = {}) {
  const res = await fetch(path, opts)
  if (!res.ok) {
    let msg = res.statusText || 'Request failed'
    try {
      const j = await res.json()
      msg = formatApiError(j.detail !== undefined ? j.detail : j, msg)
    } catch {
      try {
        msg = await res.text()
      } catch {
        /* ignore */
      }
    }
    throw new Error(typeof msg === 'string' ? msg : formatApiError(msg))
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  if (opts.raw) return res
  return res
}

export const api = {
  health: () => req('/api/health'),
  status: () => req('/api/status'),
  activity: (limit = 40) => req(`/api/activity?limit=${limit}`),
  getSettings: () => req('/api/settings'),
  setSettings: (body) =>
    req('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  listSchemas: () => req('/api/schemas'),
  getSchema: (id) => req(`/api/schemas/${id}`),
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
    if (!res.ok) {
      let msg = res.statusText || 'Stream failed'
      try {
        const j = await res.json()
        msg = formatApiError(j.detail !== undefined ? j.detail : j, msg)
      } catch {
        try {
          msg = await res.text()
        } catch {
          /* ignore */
        }
      }
      throw new Error(msg)
    }
    const text = await res.text()
    // Belt-and-suspenders: older servers yielded ERROR: with HTTP 200
    if (typeof text === 'string' && text.startsWith('ERROR:')) {
      throw new Error(text.slice(6).trim() || 'Stream generate failed')
    }
    return text
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
  listCustomLists: () => req('/api/custom-lists'),
  getCustomList: (id) => req(`/api/custom-lists/${id}`),
  saveCustomList: (body) =>
    req('/api/custom-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  deleteCustomList: (id) =>
    req(`/api/custom-lists/${id}`, { method: 'DELETE' }),
  addCustomValues: (listId, values) =>
    req(`/api/custom-lists/${listId}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    }),
  updateCustomValue: (id, value) =>
    req(`/api/custom-values/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    }),
  deleteCustomValue: (id) =>
    req(`/api/custom-values/${id}`, { method: 'DELETE' }),
  listThemes: () => req('/api/themes'),
  themeCategories: (themeId) =>
    req(
      `/api/themes/categories${themeId ? `?themeId=${encodeURIComponent(themeId)}` : ''}`
    ),
  saveTheme: (body) =>
    req('/api/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  deleteTheme: (id) => req(`/api/themes/${id}`, { method: 'DELETE' }),
  getThemeValues: (id, category) =>
    req(
      `/api/themes/${id}/values${category ? `?category=${encodeURIComponent(category)}` : ''}`
    ),
  addThemeValues: (id, body) =>
    req(`/api/themes/${id}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  listPackages: () => req('/api/packages'),
  getPackage: (id) => req(`/api/packages/${id}`),
  estimatePackage: (id, recordCount = 1) =>
    req(`/api/packages/${id}/estimate?recordCount=${recordCount}`),
  importPackage: async (fileList) => {
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    return req('/api/packages/import', { method: 'POST', body: fd })
  },
  deletePackage: (id) => req(`/api/packages/${id}`, { method: 'DELETE' }),
  verifyPackageMember: (id, memberPath, verified) =>
    req(`/api/packages/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberPath, verified })
    }),
  generatePackage: (id, body) =>
    req(`/api/packages/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  listDeliveryJobs: () => req('/api/delivery-jobs'),
  getDeliveryJob: (id) => req(`/api/delivery-jobs/${id}`),
  createDeliveryJob: (body) =>
    req('/api/delivery-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  runDeliveryChunk: (id) =>
    req(`/api/delivery-jobs/${id}/run-chunk`, { method: 'POST' }),
  deleteDeliveryJob: (id) =>
    req(`/api/delivery-jobs/${id}`, { method: 'DELETE' }),
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
    /** true | false | undefined (undefined = use schema xmlSelfClosing default) */
    selfClosing: undefined,
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

/** Download base64 archive (ZIP or tar.gz). MIME inferred from fileName. */
export function downloadBase64Zip(b64, fileName) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const lower = (fileName || '').toLowerCase()
  const type = lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
    ? 'application/gzip'
    : lower.endsWith('.tar')
      ? 'application/x-tar'
      : 'application/zip'
  downloadBlob(new Blob([bytes], { type }), fileName || 'archive.zip')
}
