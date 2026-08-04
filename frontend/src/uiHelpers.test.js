/**
 * Node test runner: node --test frontend/src/uiHelpers.test.js
 * Drives shipped helpers in uiHelpers.js (no mocks of self).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  TEAM_EXPORT_FORMATS,
  createDebounced,
  normalizeExportFormat,
  removeById,
  shouldShowHeaderGenerate,
  sideNavDensityFromWidth,
  upsertById
} from './uiHelpers.js'
import { formatApiError } from './api.js'
import { createDialogController } from './dialogController.js'

describe('TEAM_EXPORT_FORMATS', () => {
  it('is only xml, csv, txt', () => {
    assert.deepEqual([...TEAM_EXPORT_FORMATS], ['xml', 'csv', 'txt'])
    assert.equal(TEAM_EXPORT_FORMATS.includes('json'), false)
    assert.equal(TEAM_EXPORT_FORMATS.includes('yaml'), false)
  })
})

describe('normalizeExportFormat', () => {
  it('accepts team formats case-insensitively', () => {
    assert.equal(normalizeExportFormat('XML'), 'xml')
    assert.equal(normalizeExportFormat(' Csv '), 'csv')
    assert.equal(normalizeExportFormat('txt'), 'txt')
  })
  it('falls back for unknown formats', () => {
    assert.equal(normalizeExportFormat('json'), 'xml')
    assert.equal(normalizeExportFormat('yaml', 'csv'), 'csv')
    assert.equal(normalizeExportFormat(null), 'xml')
  })
})

describe('upsertById', () => {
  it('prepends new items and replaces existing by id', () => {
    const a = { id: '1', name: 'A' }
    const b = { id: '2', name: 'B' }
    let list = upsertById([], a)
    assert.deepEqual(list, [a])
    list = upsertById(list, b)
    assert.equal(list[0].id, '2')
    list = upsertById(list, { id: '1', name: 'A2' })
    assert.equal(list.find((x) => x.id === '1').name, 'A2')
    assert.equal(list.length, 2)
  })
  it('handles invalid item without throwing', () => {
    assert.deepEqual(upsertById([{ id: '1' }], null), [{ id: '1' }])
    assert.deepEqual(upsertById(null, { id: 'x' }), [{ id: 'x' }])
  })
})

describe('removeById', () => {
  it('removes matching id', () => {
    assert.deepEqual(removeById([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }])
    assert.deepEqual(removeById(null, 'a'), [])
  })
})

describe('sideNavDensityFromWidth', () => {
  it('matches layout density bands', () => {
    assert.equal(sideNavDensityFromWidth(300, true), 'rail')
    assert.equal(sideNavDensityFromWidth(200, false), 'compact')
    assert.equal(sideNavDensityFromWidth(250, false), 'cozy')
    assert.equal(sideNavDensityFromWidth(280, false), 'comfortable')
    assert.equal(sideNavDensityFromWidth(400, false), 'comfortable')
  })
})

describe('formatApiError (shipped api.js)', () => {
  it('normalizes string and validation arrays', () => {
    assert.equal(formatApiError('boom'), 'boom')
    assert.equal(formatApiError(null, 'fallback'), 'fallback')
    const msg = formatApiError([
      { loc: ['body', 'name'], msg: 'required' },
      { loc: ['body', 'count'], msg: 'int' }
    ])
    assert.match(msg, /name: required/)
    assert.match(msg, /count: int/)
  })
})

describe('mergeBootstrapPayload', () => {
  it('merges lists and ignores null boot', async () => {
    const { mergeBootstrapPayload: merge } = await import('./uiHelpers.js')
    assert.equal(merge({}, null), false)
    const t = {}
    assert.equal(
      merge(t, {
        schemas: [{ id: '1' }],
        packages: [],
        themes: [{ id: 't' }],
        customLists: [],
        templates: [],
        deliveryJobs: [],
        themeCategories: ['names'],
        status: { ok: true, schemaCount: 1 },
        settings: { defaultExportFormat: 'xml' }
      }),
      true
    )
    assert.equal(t.schemas[0].id, '1')
    assert.equal(t.themeCategories[0], 'names')
    assert.equal(t.status.ok, true)
    assert.equal(t.settings.defaultExportFormat, 'xml')
  })
})

describe('createDialogController cancel does not side-effect', () => {
  it('cancel confirm is false so delete paths must not proceed', async () => {
    const d = createDialogController()
    const p = d.askConfirm('Delete schema?')
    d.cancel()
    assert.equal(await p, false)
  })
})

describe('createDebounced (uiHelpers re-export path)', () => {
  it('batches keystrokes', async () => {
    let n = 0
    const d = createDebounced(() => {
      n += 1
    }, 40)
    d('a')
    d('ab')
    d('abc')
    assert.equal(n, 0)
    await new Promise((r) => setTimeout(r, 70))
    assert.equal(n, 1)
  })
})

describe('shouldShowHeaderGenerate chrome', () => {
  it('schema tools open hides header Generate', () => {
    assert.equal(shouldShowHeaderGenerate('schema', true), false)
    assert.equal(shouldShowHeaderGenerate('schema', false), true)
  })
})
