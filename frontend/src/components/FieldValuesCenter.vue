<script setup>
/**
 * Center-panel editor for a custom Field values list (Data packs).
 * Left rail stays list navigation; this is the primary edit surface.
 */
defineProps({
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
  'edit-value',
  'remove-value',
  'delete-list',
  'close'
])
</script>

<template>
  <div class="field-values-center">
    <template v-if="list">
      <header class="fvc-head">
        <div>
          <h3 class="fvc-title">{{ list.name || 'Field list' }}</h3>
          <p class="muted tiny fvc-sub">
            Curated values for schema tags/columns ·
            {{ (list.values || []).length }} value(s) in this list
          </p>
        </div>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Done</button>
      </header>

      <div class="fvc-grid">
        <label class="gen-field">
          <span class="gen-field-label">Name</span>
          <input
            class="input"
            :value="listName"
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

      <label class="gen-field fvc-bulk">
        <span class="gen-field-label">Add values (one per line)</span>
        <textarea
          class="input mono"
          rows="5"
          :value="bulkValues"
          placeholder="Alice&#10;Bob&#10;Carol"
          @input="emit('update:bulkValues', $event.target.value)"
        />
      </label>
      <button type="button" class="btn btn-primary pack-cta" @click="emit('add-values')">
        Add values
      </button>

      <div class="fvc-values">
        <div class="label muted tiny">Values in pool</div>
        <ul v-if="(list.values || []).length" class="pack-value-list">
          <li v-for="v in list.values || []" :key="v.id" class="pack-value-row">
            <span class="v mono">{{ v.value }}</span>
            <div class="pack-value-actions">
              <button
                type="button"
                class="btn btn-outline pack-action-sm"
                @click="emit('edit-value', v)"
              >
                Edit
              </button>
              <button
                type="button"
                class="btn btn-outline-danger pack-action-sm"
                @click="emit('remove-value', v.id)"
              >
                Del
              </button>
            </div>
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
      <p class="muted tiny">
        {{ listCount ? listCount + ' list(s) available.' : 'No field lists yet.' }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.field-values-center {
  padding: 1rem;
  max-width: 720px;
}
.fvc-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}
.fvc-title {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
}
.fvc-sub {
  margin: 0;
}
.fvc-grid {
  display: grid;
  gap: 0.55rem;
  margin-bottom: 0.75rem;
}
.fvc-save {
  justify-self: start;
}
.fvc-bulk {
  display: block;
  margin-bottom: 0.45rem;
}
.fvc-values {
  margin: 1rem 0 0.85rem;
}
.fvc-delete {
  margin-top: 0.5rem;
}
.gen-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.gen-field-label {
  font-size: 0.75rem;
  color: var(--muted);
  font-weight: 600;
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
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border);
}
.pack-value-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
</style>
