<script setup>
/**
 * In-app confirm / prompt host bound to dialogController (no browser prompt/confirm).
 */
import { onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { appDialog } from '../dialogController.js'

const pending = ref(null)
const inputEl = ref(null)
let unsub = null

onMounted(() => {
  unsub = appDialog.subscribe((p) => {
    pending.value = p
  })
})

onUnmounted(() => {
  if (unsub) unsub()
})

watch(pending, async (p) => {
  if (p?.type === 'prompt') {
    await nextTick()
    inputEl.value?.focus?.()
    inputEl.value?.select?.()
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
  } else if (ev.key === 'Enter' && pending.value.type === 'prompt') {
    ev.preventDefault()
    appDialog.confirm(pending.value.inputValue)
  } else if (ev.key === 'Enter' && pending.value.type === 'confirm' && !ev.shiftKey) {
    ev.preventDefault()
    appDialog.confirm()
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
      class="app-dialog panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'app-dialog-title'"
      :aria-describedby="'app-dialog-msg'"
    >
      <h3 id="app-dialog-title" class="app-dialog-title">{{ pending.title }}</h3>
      <p id="app-dialog-msg" class="app-dialog-msg">{{ pending.message }}</p>
      <label v-if="pending.type === 'prompt'" class="app-dialog-field">
        <span class="visually-hidden">Value</span>
        <input
          ref="inputEl"
          class="input"
          type="text"
          :value="pending.inputValue"
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
  background: rgba(0, 0, 0, 0.45);
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
