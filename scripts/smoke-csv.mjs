// Quick smoke test for CSV layouts (run: node scripts/smoke-csv.mjs)
// Uses dynamic import of compiled path — inline the serializer instead.

function csvEscape(value) {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function flattenObject(obj, delim, nestedAsJson, keySet, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}${delim}${k}` : k
    if (v !== null && typeof v === 'object') {
      if (nestedAsJson) {
        keySet.add(key)
        out[key] = JSON.stringify(v)
      } else if (Array.isArray(v)) {
        if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0])) {
          v.forEach((item, i) => {
            Object.assign(out, flattenObject(item, delim, nestedAsJson, keySet, `${key}${delim}${i}`))
          })
        } else {
          keySet.add(key)
          out[key] = JSON.stringify(v)
        }
      } else {
        Object.assign(out, flattenObject(v, delim, nestedAsJson, keySet, key))
      }
    } else {
      keySet.add(key)
      out[key] = v === null || v === undefined ? '' : String(v)
    }
  }
  return out
}

function singleHeader(records) {
  const keySet = new Set()
  const flat = records.map((r) => flattenObject(r, '.', false, keySet))
  const headers = [...keySet]
  return [headers.join(','), ...flat.map((row) => headers.map((h) => csvEscape(row[h] ?? '')).join(','))].join(
    '\n'
  )
}

const multi = [
  { id: 1, name: 'Alice', items: [{ sku: 'A', qty: 2 }] },
  { id: 2, name: 'Bob', items: [{ sku: 'C', qty: 3 }] }
]

console.log('--- multi-row ---')
console.log(singleHeader(multi))
console.log('--- first only ---')
console.log(singleHeader([multi[0]]))
console.log('--- escape ---')
console.log(singleHeader([{ a: 'x,y', b: 'he said "hi"' }]))
console.log('OK')
