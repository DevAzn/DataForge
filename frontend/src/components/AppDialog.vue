<script setup>
/**
 * In-app confirm / prompt host bound to dialogController (no browser prompt/confirm).
 * 508: focus trap, restore focus, labelled dialog.
 */
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { appDialog } from '../dialogController.js'

const pending = ref(null)
const inputEl = ref(null)
const dialogEl = ref(null)
let unsub = null
/** @type {HTMLElement | null} */
let previousFocus = null

onMounted(() => {
  unsub = appDialog.subscribe((p) => {
    pending.value = p
  })
})

onUnmounted(() => {
  if (unsub) unsub()
})

watch(pending, async (p, prev) => {
  if (p && !prev) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  if (p) {
    await nextTick()
    if (p.type === 'prompt') {
      inputEl.value?.focus?.()
      inputEl.value?.select?.()
    } else {
      const primary = dialogEl.value?.querySelector?.('.app-dialog-actions .btn-primary, .app-dialog-actions .btn-danger')
      primary?.focus?.()
    }
  } else if (prev && previousFocus) {
    try {
      previousFocus.focus()
    } catch {
      /* ignore */
    }
    previousFocus = null
  }
})

function onOverlayClick(ev) {
  if (ev.target === ev.currentTarget) appDialog.cancel()
}

function onKeydown(ev) {
  if (!pending.value) return
  if (ev.key === 'Escape') {
    ev.preventDefault()
    appDialog.cancel()
    return
  }
  if (ev.key === 'Enter' && pending.value.type === 'prompt' && !ev.shiftKey) {
    ev.preventDefault()
    appDialog.confirm(pending.value.inputValue)
    return
  }
  if (ev.key === 'Enter' && pending.value.type === 'confirm' && !ev.shiftKey) {
    // Let primary button handle if focused; otherwise confirm
    if (ev.target?.tagName === 'BUTTON') return
    ev.preventDefault()
    appDialog.confirm()
    return
  }
  // Focus trap
  if (ev.key === 'Tab' && dialogEl.value) {
    const focusables = dialogEl.value.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const list = [...focusables].filter((el) => el.offsetParent != null || el === document.activeElement)
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
  }
}

function onInput(ev) {
  appDialog.setInputValue(ev.target.value)
}
</script>

<template>
  <div
    v-if="pending"
    class="app-dialog-overlay"
    role="presentation"
    @click="onOverlayClick"
    @keydown="onKeydown"
  >
    <div
      ref="dialogEl"
      class="app-dialog panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      aria-describedby="app-dialog-msg"
    >
      <h3 id="app-dialog-title" class="app-dialog-title">{{ pending.title }}</h3>
      <p id="app-dialog-msg" class="app-dialog-msg">{{ pending.message }}</p>
      <label v-if="pending.type === 'prompt'" class="app-dialog-field" for="app-dialog-input">
        <span class="visually-hidden">Value</span>
        <input
          id="app-dialog-input"
          ref="inputEl"
          class="input is-editing"
          type="text"
          :value="pending.inputValue"
          autocomplete="off"
          @input="onInput"
        />
      </label>
      <div class="app-dialog-actions">
        <button type="button" class="btn btn-ghost" @click="appDialog.cancel()">
          {{ pending.cancelLabel }}
        </button>
        <button
          type="button"
          class="btn"
          :class="pending.danger ? 'btn-danger' : 'btn-primary'"
          @click="
            pending.type === 'prompt'
              ? appDialog.confirm(pending.inputValue)
              : appDialog.confirm()
          "
        >
          {{ pending.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
}
.app-dialog {
  width: min(420px, 100%);
  padding: 1rem 1.1rem 0.9rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.app-dialog-title {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  font-weight: 650;
}
.app-dialog-msg {
  margin: 0 0 0.75rem;
  color: var(--text);
  font-size: 0.92rem;
  line-height: 1.4;
  white-space: pre-wrap;
}
.app-dialog-field {
  display: block;
  margin-bottom: 0.85rem;
}
.app-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}
.btn-danger {
  background: var(--danger);
  color: #fff;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
