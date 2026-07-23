/**
 * XML serialization options (shared main + renderer).
 * Matches PV_DataForge export behavior.
 */

export interface XmlFormatOptions {
  /** Outer wrapper element name (default: root) */
  xmlRootTag?: string
  /** Element name for each item when data is a list of records (default: record) */
  xmlRecordTag?: string
  /**
   * When true, null/empty values emit self-closing tags: <tag/>
   * When false: <tag></tag>
   */
  xmlSelfClosing?: boolean
}

export function sanitizeXmlTag(tag: string, fallback = 'item'): string {
  const raw = (tag || '').trim() || fallback
  const safe = raw.replace(/[^\w.-]/g, '_') || fallback
  if (!safe || !/^[A-Za-z_]/.test(safe)) {
    return safe ? `_${safe}` : fallback
  }
  return safe
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n')
}

function emptyXml(tag: string, selfClosing: boolean): string {
  return selfClosing ? `<${tag}/>` : `<${tag}></${tag}>`
}

function xmlNode(tag: string, value: unknown, selfClosing: boolean): string {
  const safe = sanitizeXmlTag(tag)
  if (value === null || value === undefined) {
    return emptyXml(safe, selfClosing)
  }
  if (typeof value === 'boolean') {
    return `<${safe}>${value ? 'true' : 'false'}</${safe}>`
  }
  if (typeof value === 'number') {
    return `<${safe}>${value}</${safe}>`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return emptyXml(safe, selfClosing)
    const inner = value
      .map((v, i) => xmlNode(`${safe}_${i}`, v, selfClosing))
      .join('\n')
    return `<${safe}>\n${indent(inner)}\n</${safe}>`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return emptyXml(safe, selfClosing)
    const inner = entries.map(([k, v]) => xmlNode(k, v, selfClosing)).join('\n')
    return `<${safe}>\n${indent(inner)}\n</${safe}>`
  }
  const text = String(value)
  if (text === '') return emptyXml(safe, selfClosing)
  return `<${safe}>${escapeXml(text)}</${safe}>`
}

/**
 * Serialize data as XML with controllable root / record tags and empty-element style.
 */
export function serializeXml(data: unknown, options: XmlFormatOptions = {}): string {
  const root = sanitizeXmlTag(options.xmlRootTag ?? 'root', 'root')
  const record = sanitizeXmlTag(options.xmlRecordTag ?? 'record', 'record')
  const selfClosing = options.xmlSelfClosing !== false

  if (Array.isArray(data)) {
    if (data.length === 0) return emptyXml(root, selfClosing)
    const body = data.map((r) => xmlNode(record, r, selfClosing)).join('\n')
    return `<${root}>\n${indent(body)}\n</${root}>`
  }

  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return emptyXml(root, selfClosing)
    const inner = entries.map(([k, v]) => xmlNode(k, v, selfClosing)).join('\n')
    return `<${root}>\n${indent(inner)}\n</${root}>`
  }

  return xmlNode(root, data, selfClosing)
}
