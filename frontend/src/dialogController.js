/**
 * Promise-based in-app dialog controller (no npm deps).
 * UI host binds to getPending(); confirm/cancel resolve the promise.
 */

/**
 * @typedef {{
 *   type: 'confirm'|'prompt',
 *   message: string,
 *   title: string,
 *   defaultValue: string,
 *   confirmLabel: string,
 *   cancelLabel: string,
 *   danger: boolean,
 *   inputValue: string,
 *   resolve: (v: any) => void
 * }} DialogPending
 */

/**
 * @returns {{
 *   askConfirm: (message: string, opts?: object) => Promise<boolean>,
 *   askPrompt: (message: string, defaultValue?: string, opts?: object) => Promise<string|null>,
 *   getPending: () => DialogPending|null,
 *   confirm: (value?: string) => void,
 *   cancel: () => void,
 *   subscribe: (fn: (p: DialogPending|null) => void) => () => void
 * }}
 */
export function createDialogController() {
  /** @type {DialogPending|null} */
  let pending = null
  /** @type {Set<(p: DialogPending|null) => void>} */
  const listeners = new Set()

  function notify() {
    for (const fn of listeners) {
      try {
        fn(pending)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  function closeWith(result) {
    if (!pending) return
    const p = pending
    pending = null
    notify()
    p.resolve(result)
  }

  return {
    /**
     * @param {string} message
     * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [opts]
     * @returns {Promise<boolean>}
     */
    askConfirm(message, opts = {}) {
      return new Promise((resolve) => {
        if (pending) {
          // Supersede prior dialog as cancel so callers never hang
          const prev = pending
          pending = null
          prev.resolve(prev.type === 'confirm' ? false : null)
        }
        pending = {
          type: 'confirm',
          message: String(message ?? ''),
          title: opts.title || 'Confirm',
          defaultValue: '',
          confirmLabel: opts.confirmLabel || 'OK',
          cancelLabel: opts.cancelLabel || 'Cancel',
          danger: !!opts.danger,
          inputValue: '',
          resolve
        }
        notify()
      })
    },

    /**
     * @param {string} message
     * @param {string} [defaultValue]
     * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string }} [opts]
     * @returns {Promise<string|null>} null if cancelled
     */
    askPrompt(message, defaultValue = '', opts = {}) {
      return new Promise((resolve) => {
        if (pending) {
          const prev = pending
          pending = null
          prev.resolve(prev.type === 'confirm' ? false : null)
        }
        const def = defaultValue == null ? '' : String(defaultValue)
        pending = {
          type: 'prompt',
          message: String(message ?? ''),
          title: opts.title || 'Input',
          defaultValue: def,
          confirmLabel: opts.confirmLabel || 'OK',
          cancelLabel: opts.cancelLabel || 'Cancel',
          danger: false,
          inputValue: def,
          resolve
        }
        notify()
      })
    },

    getPending() {
      return pending
    },

    /** Confirm: true for confirm dialogs; string (or inputValue) for prompts. */
    confirm(value) {
      if (!pending) return
      if (pending.type === 'confirm') {
        closeWith(true)
        return
      }
      const raw = value !== undefined ? value : pending.inputValue
      closeWith(raw == null ? '' : String(raw))
    },

    /** Cancel: false for confirm; null for prompt. */
    cancel() {
      if (!pending) return
      closeWith(pending.type === 'confirm' ? false : null)
    },

    setInputValue(v) {
      if (!pending || pending.type !== 'prompt') return
      pending.inputValue = v == null ? '' : String(v)
      notify()
    },

    subscribe(fn) {
      listeners.add(fn)
      fn(pending)
      return () => listeners.delete(fn)
    }
  }
}

/** App-wide singleton used by App.vue and AppDialog.vue */
export const appDialog = createDialogController()

export function askConfirm(message, opts) {
  return appDialog.askConfirm(message, opts)
}

export function askPrompt(message, defaultValue, opts) {
  return appDialog.askPrompt(message, defaultValue, opts)
}
