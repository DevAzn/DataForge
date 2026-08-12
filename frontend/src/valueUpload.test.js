/**
 * Unit tests for Data pack value upload parsers.
 * Run: node --test frontend/src/valueUpload.test.js
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  VALUE_UPLOAD_MAX,
  VALUE_UPLOAD_MAX_BYTES,
  VALUE_UPLOAD_MAX_PER_CATEGORY,
  buildValueAiPrompt,
  capByCategory,
  detectValueFormat,
  parseCsvValues,
  parseJsonValues,
  parseTxtValues,
  parseValueUpload,
  uniqueValues
} from './valueUpload.js'

describe('uniqueValues', () => {
  it('dedupes and trims', () => {
    assert.deepEqual(uniqueValues([' a ', 'a', 'b', '', null]), ['a', 'b'])
  })
})

describe('detectValueFormat', () => {
  it('uses extension first', () => {
    assert.equal(detectValueFormat('x.json', 'a,b'), 'json')
    assert.equal(detectValueFormat('x.xml', '{}'), 'xml')
    assert.equal(detectValueFormat('x.csv', 'a'), 'csv')
    assert.equal(detectValueFormat('x.txt', '{}'), 'txt')
  })
  it('sniffs content when extension missing', () => {
    assert.equal(detectValueFormat('', '{"values":[]}'), 'json')
    assert.equal(detectValueFormat('', '<values/>'), 'xml')
    assert.equal(detectValueFormat('', 'value\nA'), 'csv')
    assert.equal(detectValueFormat('', 'hello\nworld'), 'txt')
  })
})

describe('parseTxtValues', () => {
  it('one per line', () => {
    const r = parseTxtValues('Alice\nBob\n\nCarol')
    assert.deepEqual(r.values, ['Alice', 'Bob', 'Carol'])
    assert.equal(r.format, 'txt')
  })
  it('builds byCategory from category: value lines', () => {
    const r = parseTxtValues('names: Luke\nnames: Leia\nships: X-Wing')
    assert.ok(r.byCategory)
    assert.deepEqual(r.byCategory.names, ['Luke', 'Leia'])
    assert.deepEqual(r.byCategory.ships, ['X-Wing'])
    // Flat list still available for single-list consumers
    assert.ok(r.values.includes('Luke') && r.values.includes('X-Wing'))
  })
})

describe('parseCsvValues', () => {
  it('single column with header', () => {
    const r = parseCsvValues('value\nAlice\nBob')
    assert.deepEqual(r.values, ['Alice', 'Bob'])
  })
  it('category,value', () => {
    const r = parseCsvValues('category,value\nnames,Luke\nnames,Leia\nships,X-Wing')
    assert.ok(r.byCategory)
    assert.deepEqual(r.byCategory.names, ['Luke', 'Leia'])
    assert.deepEqual(r.byCategory.ships, ['X-Wing'])
  })
  it('handles quoted commas', () => {
    const r = parseCsvValues('value\n"Smith, John"\nJane')
    assert.deepEqual(r.values, ['Smith, John', 'Jane'])
  })
})

describe('parseJsonValues', () => {
  it('bare array', () => {
    const r = parseJsonValues('["A","B"]')
    assert.deepEqual(r.values, ['A', 'B'])
  })
  it('values key', () => {
    const r = parseJsonValues(JSON.stringify({ values: ['A', 'B'] }))
    assert.deepEqual(r.values, ['A', 'B'])
  })
  it('categories object', () => {
    const r = parseJsonValues(
      JSON.stringify({
        categories: { names: ['Luke', 'Leia'], ships: ['X-Wing'] }
      })
    )
    assert.deepEqual(r.byCategory.names, ['Luke', 'Leia'])
    assert.deepEqual(r.byCategory.ships, ['X-Wing'])
  })
  it('categories array', () => {
    const r = parseJsonValues(
      JSON.stringify({
        categories: [{ name: 'names', values: ['Luke'] }]
      })
    )
    assert.deepEqual(r.byCategory.names, ['Luke'])
  })
  it('invalid json warns', () => {
    const r = parseJsonValues('{nope')
    assert.equal(r.values.length, 0)
    assert.ok(r.warnings.length)
  })
  it('truncates per-category over cap', () => {
    const big = Array.from({ length: VALUE_UPLOAD_MAX_PER_CATEGORY + 20 }, (_, i) => `v${i}`)
    const r = parseJsonValues(JSON.stringify({ categories: { names: big } }))
    assert.equal(r.byCategory.names.length, VALUE_UPLOAD_MAX_PER_CATEGORY)
    assert.ok(r.warnings.some((w) => /truncat/i.test(w)))
  })
  it('truncates flat list over VALUE_UPLOAD_MAX', () => {
    const big = Array.from({ length: VALUE_UPLOAD_MAX + 50 }, (_, i) => `x${i}`)
    const r = parseJsonValues(JSON.stringify({ values: big }))
    assert.equal(r.values.length, VALUE_UPLOAD_MAX)
    assert.ok(r.warnings.some((w) => /Truncated/i.test(w)))
  })
})

describe('capByCategory', () => {
  it('enforces per-category max', () => {
    const warnings = []
    const big = Array.from({ length: 150 }, (_, i) => `a${i}`)
    const r = capByCategory({ names: big, ships: ['X'] }, warnings)
    assert.equal(r.byCategory.names.length, VALUE_UPLOAD_MAX_PER_CATEGORY)
    assert.deepEqual(r.byCategory.ships, ['X'])
    assert.ok(warnings.length)
  })
})

describe('VALUE_UPLOAD_MAX_BYTES', () => {
  it('is 2 MiB', () => {
    assert.equal(VALUE_UPLOAD_MAX_BYTES, 2 * 1024 * 1024)
  })
})

describe('parseValueUpload', () => {
  it('routes by extension', () => {
    const r = parseValueUpload('Alice\nBob', 'pack.txt')
    assert.deepEqual(r.values, ['Alice', 'Bob'])
    assert.equal(r.format, 'txt')
  })
})

describe('buildValueAiPrompt', () => {
  it('includes theme context', () => {
    const p = buildValueAiPrompt({
      mode: 'theme',
      themeName: 'Star Wars',
      category: 'names',
      format: 'json',
      count: 20
    })
    assert.match(p, /Star Wars/)
    assert.match(p, /names/)
    assert.match(p, /JSON/)
    assert.match(p, /categories/)
  })
  it('includes field list context', () => {
    const p = buildValueAiPrompt({
      mode: 'field',
      listName: 'Cities',
      fieldKeys: 'city',
      format: 'csv'
    })
    assert.match(p, /Cities/)
    assert.match(p, /city/)
    assert.match(p, /CSV/)
  })
})
