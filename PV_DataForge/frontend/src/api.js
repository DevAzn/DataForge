async function req(path, opts = {}) {
  const res = await fetch(path, opts)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = j.detail || JSON.stringify(j)
    } catch {
      /* ignore */
    }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return res.json()
}

export const api = {
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
  exportData: (body) =>
    req('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  history: (limit = 80) => req(`/api/history?limit=${limit}`)
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
