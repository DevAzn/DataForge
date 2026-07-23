import YAML from 'yaml'
import type { ExportFormat } from '../../shared/types'
import { serializeCsv, type CsvFormatOptions } from '../../shared/csv'
import { serializeXml, type XmlFormatOptions } from '../../shared/xml'

export type FormatOptions = CsvFormatOptions & XmlFormatOptions

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
      return serializeXml(data, {
        xmlRootTag: options.xmlRootTag,
        xmlRecordTag: options.xmlRecordTag,
        xmlSelfClosing: options.xmlSelfClosing
      })
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
