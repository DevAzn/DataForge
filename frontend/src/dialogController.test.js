/**
 * node --test frontend/src/dialogController.test.js
 * Drives shipped createDialogController (open / cancel / confirm).
 */
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createDialogController } from './dialogController.js'
import { createDebounced, shouldShowHeaderGenerate } from './uiHelpers.js'

describe('createDialogController confirm', () => {
  it('confirm resolves true; cancel resolves false; no hang', async () => {
    const d = createDialogController()
    const p = d.askConfirm('Delete me?', { danger: true, title: 'Delete' })
    const pend = d.getPending()
    assert.equal(pend.type, 'confirm')
    assert.equal(pend.message, 'Delete me?')
    assert.equal(pend.danger, true)
    d.confirm()
    assert.equal(await p, true)
    assert.equal(d.getPending(), null)

    const p2 = d.askConfirm('Sure?')
    d.cancel()
    assert.equal(await p2, false)
  })
})

describe('createDialogController prompt', () => {
  it('confirm returns string; cancel returns null; Cancel leaves no pending', async () => {
    const d = createDialogController()
    const p = d.askPrompt('Name', 'default', { title: 'Template' })
    assert.equal(d.getPending().type, 'prompt')
    assert.equal(d.getPending().defaultValue, 'default')
    d.setInputValue('My name')
    d.confirm()
    assert.equal(await p, 'My name')

    const p2 = d.askPrompt('Name', 'x')
    d.cancel()
    assert.equal(await p2, null)
    assert.equal(d.getPending(), null)
  })

  it('confirm() without arg uses inputValue', async () => {
    const d = createDialogController()
    const p = d.askPrompt('V', 'seed')
    d.setInputValue('edited')
    d.confirm()
    assert.equal(await p, 'edited')
  })

  it('superseding dialog cancels prior as null/false', async () => {
    const d = createDialogController()
    const first = d.askConfirm('first')
    const second = d.askPrompt('second', 'a')
    assert.equal(await first, false)
    d.cancel()
    assert.equal(await second, null)
  })
})

describe('createDebounced', () => {
  it('does not invoke synchronously; fires after delay', async () => {
    let n = 0
    const d = createDebounced(() => {
      n += 1
    }, 50)
    d()
    d()
    d()
    assert.equal(n, 0)
    assert.equal(d.pending(), true)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(n, 1)
    assert.equal(d.pending(), false)
  })

  it('flush invokes immediately; cancel prevents fire', async () => {
    let n = 0
    const d = createDebounced(() => {
      n += 1
    }, 200)
    d()
    d.flush()
    assert.equal(n, 1)
    d()
    d.cancel()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(n, 1)
  })
})

describe('shouldShowHeaderGenerate', () => {
  it('hides header Generate when tools rail visible for schema/package', () => {
    assert.equal(shouldShowHeaderGenerate('schema', true), false)
    assert.equal(shouldShowHeaderGenerate('schema', false), true)
    assert.equal(shouldShowHeaderGenerate('package', true), false)
    assert.equal(shouldShowHeaderGenerate('package', false), true)
    assert.equal(shouldShowHeaderGenerate('history', false), false)
  })
})
