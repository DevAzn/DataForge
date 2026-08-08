<script setup>
/**
 * Drag+drop / file pick for Data pack values + schema rules / AI prompt helper.
 */
import { computed, ref } from 'vue'
import {
  VALUE_UPLOAD_ACCEPT,
  VALUE_UPLOAD_SCHEMA_RULES,
  buildValueAiPrompt,
  parseValueFile
} from '../valueUpload.js'

const props = defineProps({
  /** 'theme' | 'field' */
  mode: { type: String, default: 'theme' },
  disabled: { type: Boolean, default: false },
  themeName: { type: String, default: '' },
  category: { type: String, default: '' },
  listName: { type: String, default: '' },
  fieldKeys: { type: String, default: '' }
})

const emit = defineEmits(['parsed', 'error'])

const fileInput = ref(null)
const dragOver = ref(false)
const busy = ref(false)
const helpOpen = ref(false)
const helpTab = ref('rules') // rules | prompt
const aiFormat = ref('json')
const aiCount = ref(40)
const copyStatus = ref('')

const accept = VALUE_UPLOAD_ACCEPT

const aiPrompt = computed(() =>
  buildValueAiPrompt({
    mode: props.mode === 'field' ? 'field' : 'theme',
    themeName: props.themeName || undefined,
    category: props.category || undefined,
    listName: props.listName || undefined,
    fieldKeys: props.fieldKeys || undefined,
    count: Number(aiCount.value) || 40,
    format: aiFormat.value
  })
)

const hint = computed(() =>
  props.mode === 'field'
    ? 'Drop JSON, XML, CSV, or TXT — flat list of values for this field list'
    : 'Drop JSON, XML, CSV, or TXT — fills the active category, or multi-category packs'
)

async function handleFiles(fileList) {
  if (props.disabled || busy.value) return
  const file = fileList?.[0]
  if (!file) return
  busy.value = true
  try {
    const result = await parseValueFile(file)
    if (!result.values?.length && !Object.keys(result.byCategory || {}).length) {
      emit(
        'error',
        result.warnings?.length
          ? result.warnings.join(' ')
          : `No values found in “${file.name}”. Check format rules.`
      )
      return
    }
    emit('parsed', result)
  } catch (e) {
    emit('error', e?.message || 'Could not read file')
  } finally {
    busy.value = false
    dragOver.value = false
  }
}

function onDrop(ev) {
  ev.preventDefault()
  dragOver.value = false
  if (props.disabled) return
  void handleFiles(ev.dataTransfer?.files)
}

function onDragOver(ev) {
  ev.preventDefault()
  if (!props.disabled) dragOver.value = true
}

function onDragLeave(ev) {
  // only clear when leaving the zone itself
  if (ev.currentTarget === ev.target || !ev.currentTarget.contains(ev.relatedTarget)) {
    dragOver.value = false
  }
}

function onFileInput(ev) {
  const input = ev.target
  void handleFiles(input?.files)
  if (input) input.value = ''
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    copyStatus.value = `${label} copied`
    setTimeout(() => {
      if (copyStatus.value === `${label} copied`) copyStatus.value = ''
    }, 2500)
  } catch {
    copyStatus.value = 'Copy failed — select and copy manually'
  }
}
</script>

<template>
  <div class="value-upload-panel" :class="{ disabled }">
    <div
      class="value-drop"
      :class="{ over: dragOver, busy }"
      role="button"
      tabindex="0"
      :aria-disabled="disabled || busy"
      :aria-label="hint"
      @dragover="onDragOver"
      @dragenter="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @keydown.enter.prevent="fileInput?.click()"
      @keydown.space.prevent="fileInput?.click()"
    >
      <input
        ref="fileInput"
        type="file"
        class="value-drop-input"
        :accept="accept"
        :disabled="disabled || busy"
        @change="onFileInput"
      />
      <div class="value-drop-inner">
        <strong>{{ busy ? 'Reading…' : 'Drop values file here' }}</strong>
        <span class="muted tiny">{{ hint }}</span>
        <span class="muted tiny">or click to browse · JSON · XML · CSV · TXT</span>
      </div>
    </div>

    <div class="value-upload-actions">
      <button
        type="button"
        class="btn btn-ghost pack-action-sm"
        :aria-expanded="helpOpen"
        @click="helpOpen = !helpOpen"
      >
        {{ helpOpen ? 'Hide' : 'Upload rules & AI prompt' }}
      </button>
      <span v-if="copyStatus" class="muted tiny" role="status">{{ copyStatus }}</span>
    </div>

    <div v-if="helpOpen" class="value-upload-help" role="region" aria-label="Upload rules and AI prompt">
      <div class="value-help-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="btn btn-ghost pack-action-sm"
          :class="{ on: helpTab === 'rules' }"
          :aria-selected="helpTab === 'rules'"
          @click="helpTab = 'rules'"
        >
          Format rules
        </button>
        <button
          type="button"
          role="tab"
          class="btn btn-ghost pack-action-sm"
          :class="{ on: helpTab === 'prompt' }"
          :aria-selected="helpTab === 'prompt'"
          @click="helpTab = 'prompt'"
        >
          AI prompt
        </button>
      </div>

      <template v-if="helpTab === 'rules'">
        <p class="muted tiny" style="margin: 0.35rem 0">
          Organize your file like the examples below so drag-and-drop import is seamless.
          Copy the full rules into a chat or doc if needed.
        </p>
        <div class="value-help-toolbar">
          <button
            type="button"
            class="btn btn-outline pack-action-sm"
            @click="copyText(VALUE_UPLOAD_SCHEMA_RULES, 'Format rules')"
          >
            Copy format rules
          </button>
        </div>
        <pre class="value-help-pre mono" tabindex="0">{{ VALUE_UPLOAD_SCHEMA_RULES }}</pre>
      </template>

      <template v-else>
        <p class="muted tiny" style="margin: 0.35rem 0">
          Fill in the bracketed blanks, paste into your AI, then save the reply as a file and
          drop it above. Context from this editor is pre-filled when available.
        </p>
        <div class="value-help-toolbar value-prompt-opts">
          <label class="muted tiny">
            Format
            <select v-model="aiFormat" class="input" style="width: auto; min-width: 5rem">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="txt">TXT</option>
              <option value="xml">XML</option>
            </select>
          </label>
          <label class="muted tiny">
            ~Count
            <input
              v-model.number="aiCount"
              class="input"
              type="number"
              min="5"
              max="100"
              step="5"
              style="width: 4.5rem"
            />
          </label>
          <button
            type="button"
            class="btn btn-primary pack-action-sm"
            @click="copyText(aiPrompt, 'AI prompt')"
          >
            Copy AI prompt
          </button>
        </div>
        <pre class="value-help-pre mono" tabindex="0">{{ aiPrompt }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.value-upload-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.35rem 0 0.65rem;
}
.value-upload-panel.disabled {
  opacity: 0.6;
}
.value-drop {
  position: relative;
  border: 1.5px dashed var(--border);
  border-radius: 10px;
  padding: 0.85rem 0.75rem;
  text-align: center;
  cursor: pointer;
  background: color-mix(in srgb, var(--panel, #1a1d24) 88%, transparent);
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.value-drop:hover,
.value-drop.over {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.value-drop.busy {
  pointer-events: none;
  opacity: 0.75;
}
.value-drop-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
}
.value-drop-inner {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  pointer-events: none;
}
.value-drop-inner strong {
  font-size: 0.92rem;
}
.value-upload-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.value-upload-help {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.55rem 0.65rem 0.7rem;
  background: color-mix(in srgb, var(--panel, #1a1d24) 92%, transparent);
}
.value-help-tabs {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.value-help-tabs .btn.on {
  border-color: var(--accent);
  color: var(--accent);
}
.value-help-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: flex-end;
  margin-bottom: 0.4rem;
}
.value-prompt-opts label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.value-help-pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, #000 25%, transparent);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
