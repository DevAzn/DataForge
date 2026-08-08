<script setup>
/**
 * Center-panel editor for a custom Field values list (Data packs).
 * Left rail stays list navigation; this is the primary edit surface.
 * Value edits are inline (colored textbox) — no browser prompts.
 */
import { nextTick, ref, watch } from 'vue'
import ValueUploadPanel from './ValueUploadPanel.vue'

const props = defineProps({
  list: { type: Object, default: null },
  listName: { type: String, default: '' },
  listKeys: { type: String, default: '' },
  bulkValues: { type: String, default: '' },
  listCount: { type: Number, default: 0 }
})

const emit = defineEmits([
  'update:listName',
  'update:listKeys',
  'update:bulkValues',
  'save',
  'add-values',
  'commit-value',
  'remove-value',
  'delete-list',
  'close',
  'upload-values',
  'upload-error'
])

/** @type {import('vue').Ref<{ id: string, draft: string } | null>} */
const editing = ref(null)

watch(
  () => props.list?.id,
  () => {
    editing.value = null
  }
)

async function startEdit(v) {
  if (!v?.id) return
  editing.value = { id: v.id, draft: v.value == null ? '' : String(v.value) }
  await nextTick()
  const el = document.getElementById('fvc-edit-' + v.id)
  el?.focus?.()
  el?.select?.()
}

function cancelEdit() {
  editing.value = null
}

function commitEdit() {
  if (!editing.value) return
  const id = editing.value.id
  const draft = String(editing.value.draft ?? '').trim()
  editing.value = null
  if (!draft) return
  emit('commit-value', { id, value: draft })
}

function onEditKeydown(ev) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelEdit()
  } else if (ev.key === 'Enter') {
    ev.preventDefault()
    commitEdit()
  }
}
</script>

<template>
  <div class="field-values-center" role="region" aria-label="Field values editor">
    <template v-if="list">
      <header class="fvc-head">
        <div>
          <h3 class="fvc-title" id="fvc-heading">{{ list.name || 'Field list' }}</h3>
          <p class="muted tiny fvc-sub" id="fvc-desc">
            Curated values for schema tags/columns ·
            {{ (list.values || []).length }} value(s) in this list
          </p>
        </div>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Done</button>
      </header>

      <div class="fvc-grid" role="group" aria-labelledby="fvc-heading">
        <label class="gen-field">
          <span class="gen-field-label">Name</span>
          <input
            class="input"
            :value="listName"
            :aria-describedby="'fvc-desc'"
            @input="emit('update:listName', $event.target.value)"
          />
        </label>
        <label class="gen-field">
          <span class="gen-field-label">Field keys (comma-separated)</span>
          <input
            class="input mono"
            :value="listKeys"
            placeholder="name, person.name, city"
            @input="emit('update:listKeys', $event.target.value)"
          />
        </label>
        <button type="button" class="btn btn-accent pack-action fvc-save" @click="emit('save')">
          Save list
        </button>
      </div>

      <ValueUploadPanel
        mode="field"
        :list-name="listName || list?.name || ''"
        :field-keys="listKeys"
        @parsed="emit('upload-values', $event)"
        @error="emit('upload-error', $event)"
      />

      <label class="gen-field fvc-bulk">
        <span class="gen-field-label">Add values (one per line)</span>
        <textarea
          class="input mono"
          :class="{ 'is-adding': !!(bulkValues && bulkValues.trim()) }"
          rows="5"
          :value="bulkValues"
          placeholder="Alice&#10;Bob&#10;Carol"
          aria-label="New values to add, one per line"
          @input="emit('update:bulkValues', $event.target.value)"
        />
      </label>
      <button type="button" class="btn btn-primary pack-cta" @click="emit('add-values')">
        Add values
      </button>

      <div class="fvc-values">
        <div class="label muted tiny" id="fvc-values-label">Values in pool</div>
        <ul
          v-if="(list.values || []).length"
          class="pack-value-list"
          aria-labelledby="fvc-values-label"
        >
          <li v-for="v in list.values || []" :key="v.id" class="pack-value-row">
            <template v-if="editing && editing.id === v.id">
              <div class="inline-edit-row">
                <label class="visually-hidden" :for="'fvc-edit-' + v.id">Edit value</label>
                <input
                  :id="'fvc-edit-' + v.id"
                  class="input mono is-editing"
                  type="text"
                  :value="editing.draft"
                  aria-label="Editing list value"
                  @input="editing.draft = $event.target.value"
                  @keydown="onEditKeydown"
                />
                <button type="button" class="btn btn-primary pack-action-sm" @click="commitEdit">
                  Save
                </button>
                <button type="button" class="btn btn-ghost pack-action-sm" @click="cancelEdit">
                  Cancel
                </button>
              </div>
            </template>
            <template v-else>
              <span class="v mono">{{ v.value }}</span>
              <div class="pack-value-actions">
                <button
                  type="button"
                  class="btn btn-outline pack-action-sm"
                  :aria-label="`Edit value ${v.value}`"
                  @click="startEdit(v)"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="btn btn-outline-danger pack-action-sm"
                  :aria-label="`Delete value ${v.value}`"
                  @click="emit('remove-value', v.id)"
                >
                  Del
                </button>
              </div>
            </template>
          </li>
        </ul>
        <p v-else class="muted tiny">No values yet — add some above.</p>
      </div>

      <button
        type="button"
        class="btn btn-outline-danger pack-action fvc-delete"
        @click="emit('delete-list')"
      >
        Delete list
      </button>
    </template>

    <template v-else>
      <h3 class="fvc-title" style="margin-top: 0">Field values</h3>
      <p>
        Curated lists keyed to schema tags/columns. Used after theme pools and before learned
        history when filling records.
      </p>
      <p class="muted tiny">
        Create or open a list on the left — the full editor opens here in the center panel.
      </p>
      <p v-if="listCount === 0" class="muted tiny">No lists yet.</p>
    </template>
  </div>
</template>

<style scoped>
.field-values-center {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}
.fvc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}
.fvc-title {
  margin: 0;
  font-size: 1.05rem;
}
.fvc-sub {
  margin: 0.2rem 0 0;
}
.fvc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.5rem 0.65rem;
  align-items: end;
}
@media (max-width: 720px) {
  .fvc-grid {
    grid-template-columns: 1fr;
  }
}
.fvc-bulk {
  width: 100%;
}
.fvc-values {
  margin-top: 0.25rem;
}
.pack-value-list {
  list-style: none;
  margin: 0.35rem 0 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
}
.pack-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.25rem;
  border-bottom: 1px solid var(--border);
}
.pack-value-row .v {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.pack-value-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
.inline-edit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
}
.inline-edit-row .input {
  flex: 1 1 10rem;
  min-width: 0;
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
