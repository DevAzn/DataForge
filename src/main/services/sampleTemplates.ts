import { randomUUID } from 'crypto'
import type { SchemaRow, Template } from '../../shared/types'
import { countTable, listTemplates, saveTemplate } from '../db/database'

function row(
  key: string,
  opts: Partial<SchemaRow> & { sampleValue?: string; children?: SchemaRow[] } = {}
): SchemaRow {
  return {
    id: randomUUID(),
    key,
    kind: opts.kind ?? (opts.children?.length ? 'object' : 'value'),
    sampleValue: opts.sampleValue,
    isPrimary: opts.isPrimary ?? false,
    isUnique: opts.isUnique ?? false,
    relationship: opts.relationship,
    categoryOverride: opts.categoryOverride,
    children: opts.children ?? [],
    sortOrder: opts.sortOrder ?? 0
  }
}

function template(name: string, description: string, root: SchemaRow[]): Template {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    name,
    description,
    schemaJson: JSON.stringify({ name, root }),
    createdAt: now,
    updatedAt: now
  }
}

/** Built-in starter templates seeded once when the template table is empty. */
export function getBuiltinTemplates(): Template[] {
  return [
    template('Flat CSV customer', 'Simple flat fields for CSV-style ETL', [
      row('customer_id', { sampleValue: '1001', isPrimary: true, isUnique: true }),
      row('full_name', { sampleValue: 'Jordan Lee' }),
      row('email', { sampleValue: 'jordan.lee@example.com' }),
      row('signup_date', { sampleValue: '2024-06-15' }),
      row('balance', { sampleValue: '19.99' })
    ]),
    template('Nested JSON order', 'Order header with nested line items array', [
      row('order_id', { sampleValue: 'ORD-10042', isPrimary: true, isUnique: true }),
      row('order_date', { sampleValue: '2024-03-01' }),
      row('customer', {
        kind: 'object',
        children: [
          row('id', { sampleValue: 'C-88', isPrimary: true }),
          row('name', { sampleValue: 'Acme Corp' }),
          row('email', { sampleValue: 'orders@acme.example' })
        ]
      }),
      row('items', {
        kind: 'array',
        relationship: 'one-to-many',
        children: [
          row('sku', { sampleValue: 'SKU-100' }),
          row('qty', { sampleValue: '2' }),
          row('price', { sampleValue: '12.50' })
        ]
      }),
      row('total', { sampleValue: '25.00' })
    ]),
    template('XML invoice style', 'Invoice-like hierarchy for XML pipelines', [
      row('invoice_number', { sampleValue: 'INV-2024-001', isPrimary: true }),
      row('issue_date', { sampleValue: '03/15/2024' }),
      row('bill_to', {
        kind: 'object',
        children: [
          row('name', { sampleValue: 'Northwind Traders' }),
          row('address', { sampleValue: '123 Market St' }),
          row('city', { sampleValue: 'Seattle' })
        ]
      }),
      row('lines', {
        kind: 'array',
        relationship: 'one-to-many',
        children: [
          row('description', { sampleValue: 'Consulting hours' }),
          row('amount', { sampleValue: '$1,200.00' })
        ]
      })
    ])
  ]
}

/** Seed sample templates if none exist yet. */
export function seedSampleTemplatesIfEmpty(): number {
  if (countTable('templates') > 0) return 0
  // Double-check via list in case of race
  if (listTemplates().length > 0) return 0
  let n = 0
  for (const t of getBuiltinTemplates()) {
    saveTemplate(t)
    n++
  }
  return n
}
