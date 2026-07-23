import YAML from 'yaml'
import type { AppSettings, ExportFormat } from '@shared/types'
import { serializeCsv } from '@shared/csv'
import { serializeXml, type XmlFormatOptions } from '@shared/xml'

export function extensionForFormat(format: ExportFormat): string {
  return format === 'yaml' ? 'yml' : format
}

export type ArchiveSerializeOptions = XmlFormatOptions & {
  csvLayoutMode?: AppSettings['csvLayoutMode']
  csvMultiRow?: boolean
  csvFlattenDelimiter?: string
  csvNestedAsJson?: boolean
}

/** Serialize payload for embedding as a text file inside an archive. */
export function serializeDataForArchive(
  data: unknown,
  format: ExportFormat,
  options: ArchiveSerializeOptions = {}
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)
    case 'yaml':
      return YAML.stringify(data)
    case 'txt':
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    case 'csv':
      return serializeCsv(data, {
        csvLayoutMode: options.csvLayoutMode ?? 'single-header',
        csvMultiRow: options.csvMultiRow !== false,
        csvFlattenDelimiter: options.csvFlattenDelimiter ?? '.',
        csvNestedAsJson: options.csvNestedAsJson ?? false
      })
    case 'xml':
      return serializeXml(data, {
        xmlRootTag: options.xmlRootTag,
        xmlRecordTag: options.xmlRecordTag,
        xmlSelfClosing: options.xmlSelfClosing
      })
    default:
      return JSON.stringify(data, null, 2)
  }
}
