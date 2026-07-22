import YAML from 'yaml'
import type { ExportFormat } from '@shared/types'
import { serializeCsv } from '@shared/csv'

export function extensionForFormat(format: ExportFormat): string {
  return format === 'yaml' ? 'yml' : format
}

/** Serialize payload for embedding as a text file inside an archive. */
export function serializeDataForArchive(data: unknown, format: ExportFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)
    case 'yaml':
      return YAML.stringify(data)
    case 'txt':
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    case 'csv':
      return serializeCsv(data, {
        csvLayoutMode: 'single-header',
        csvMultiRow: true,
        csvFlattenDelimiter: '.',
        csvNestedAsJson: false
      })
    case 'xml':
      return toXml(data, 'root')
    default:
      return JSON.stringify(data, null, 2)
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toXml(data: unknown, tag: string): string {
  const safeTag = tag.replace(/[^\w.-]/g, '_') || 'item'
  if (data === null || data === undefined) return `<${safeTag}/>`
  if (typeof data !== 'object') {
    return `<${safeTag}>${escapeXml(String(data))}</${safeTag}>`
  }
  if (Array.isArray(data)) {
    return data.map((item, i) => toXml(item, `${safeTag}_${i}`)).join('\n')
  }
  const inner = Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => toXml(v, k))
    .join('\n')
  return `<${safeTag}>\n${inner
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n')}\n</${safeTag}>`
}
