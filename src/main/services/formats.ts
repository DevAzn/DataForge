import YAML from 'yaml'
import type { ExportFormat } from '../../shared/types'
import { serializeCsv, type CsvFormatOptions } from '../../shared/csv'

export type FormatOptions = CsvFormatOptions

export function serializeData(
  data: unknown,
  format: ExportFormat,
  options: FormatOptions = {}
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)
    case 'yaml':
      return YAML.stringify(data)
    case 'txt':
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    case 'xml':
      return toXml(data, 'root')
    case 'csv':
      return serializeCsv(data, options)
    default:
      return JSON.stringify(data, null, 2)
  }
}

export function extensionForFormat(format: ExportFormat): string {
  switch (format) {
    case 'yaml':
      return 'yml'
    default:
      return format
  }
}

/** Strip path separators and illegal filename characters for save dialog default. */
export function sanitizeExportFileName(name: string): string {
  const base = name
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim() ?? 'dataforge-export'
  const noExt = base.replace(/\.[^.]+$/, '')
  const cleaned = noExt
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
    .trim()
  return cleaned || 'dataforge-export'
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
  return `<${safeTag}>\n${indent(inner)}\n</${safeTag}>`
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n')
}
