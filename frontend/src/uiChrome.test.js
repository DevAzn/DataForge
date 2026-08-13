/**
 * Chrome visibility / layout: drives shipped App.vue + styles.css + uiHelpers.
 * Run: node --test frontend/src/uiChrome.test.js
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CHROME_ACTION_GROUPS,
  TEAM_EXPORT_FORMATS,
  chromeButtonClass,
  requireControlName
} from './uiHelpers.js'

const root = dirname(fileURLToPath(import.meta.url))
const appVue = readFileSync(join(root, 'App.vue'), 'utf8')
const styles = readFileSync(join(root, 'styles.css'), 'utf8')

describe('primary Generate CTA', () => {
  it('binds shipped chromeButtonClass generate and labels the control Generate', () => {
    assert.match(appVue, /chromeButtonClass\('generate'/)
    assert.match(appVue, /\{\{\s*generateButtonLabel\s*\}\}/)
    assert.match(appVue, /packageWorking \? 'Working…' : 'Generate'/)
    assert.equal(chromeButtonClass('generate').includes('btn-primary'), true)
    const generateBinds = (appVue.match(/chromeButtonClass\('generate'/g) || []).length
    assert.ok(generateBinds >= 2, 'header-or-rail + package rail')
  })
  it('Map fields is secondary, not a second primary', () => {
    assert.match(appVue, /chromeButtonClass\('map'/)
    assert.equal(appVue.includes("class=\"btn btn-primary schema-map-btn\""), false)
    assert.equal(chromeButtonClass('map').includes('btn-primary'), false)
  })
})

describe('labeled action groups', () => {
  it('schema/package chrome binds shipped CHROME_ACTION_GROUPS', () => {
    for (const key of ['file', 'structure', 'edit', 'generate', 'danger', 'identity']) {
      assert.ok(CHROME_ACTION_GROUPS[key], key)
      assert.match(appVue, new RegExp(`CHROME_ACTION_GROUPS\\.${key}`))
    }
    assert.match(appVue, /role="group"/)
    assert.match(appVue, /schema-btn-group/)
    assert.match(appVue, /action-group-danger/)
  })
})

describe('empty/create path CTAs', () => {
  it('keeps create and folder import on empty schema and package paths', () => {
    const schemaEmpty = appVue.split('No schema open')[1].split('center-head schema-head')[0]
    assert.match(schemaEmpty, /New schema/)
    assert.match(schemaEmpty, /Import sample file/)
    assert.match(schemaEmpty, /webkitdirectory/)
    const pkgEmpty = appVue.split('No package selected')[1].split('pkg-layout')[0]
    assert.match(pkgEmpty, /Import package/)
    assert.match(pkgEmpty, /webkitdirectory/)
    assert.match(pkgEmpty, /Import folder/)
  })
})

describe('accessible names and 508 chrome', () => {
  it('layout / hide controls call requireControlName', () => {
    assert.match(appVue, /requireControlName\(/)
    assert.equal(
      requireControlName({ visibleText: 'List', ariaLabel: 'Hide list panel' }),
      'Hide list panel'
    )
    assert.match(appVue, /Hide list panel/)
    assert.match(appVue, /Show tools panel/)
    assert.match(appVue, /Reset panel sizes/)
    assert.match(appVue, /Hide Generate panel/)
  })
  it('skip-link and focus-visible remain', () => {
    assert.match(appVue, /class="skip-link"/)
    assert.match(appVue, /href="#main-workspace"/)
    assert.match(styles, /:focus-visible/)
  })
})

describe('team export formats unchanged', () => {
  it('header format options stay xml csv txt xlsx', () => {
    assert.deepEqual([...TEAM_EXPORT_FORMATS], ['xml', 'csv', 'txt', 'xlsx'])
    assert.match(appVue, /<option value="xml">XML<\/option>/)
    assert.match(appVue, /<option value="csv">CSV<\/option>/)
    assert.match(appVue, /<option value="txt">TXT<\/option>/)
    assert.match(appVue, /<option value="xlsx">XLSX<\/option>/)
    const headerFmt = appVue.split('v-if="showFormatSelector"')[1].split('</select>')[0]
    assert.match(headerFmt, /value="xml"/)
    assert.match(headerFmt, /value="xlsx"/)
    assert.equal(/value="json"/.test(headerFmt), false)
    assert.equal(/value="yaml"/.test(headerFmt), false)
  })
})
