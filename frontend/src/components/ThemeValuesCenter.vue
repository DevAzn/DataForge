<script setup>
/**
 * Theme pack values browser: categories rail + values for the active category.
 * Inline edit owned by parent (same pattern as FieldValuesCenter).
 */
import { computed, nextTick, ref, watch } from 'vue'
import ValueUploadPanel from './ValueUploadPanel.vue'

const props = defineProps({
  themeName: { type: String, default: '' },
  category: { type: String, default: '' },
  /** Category stats chips: { category, count, limit, nearLimit, full, local? } */
  categories: { type: Array, default: () => [] },
  /** All theme values (or at least active-category values): { id, category, value } */
  values: { type: Array, default: () => [] },
  bulk: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  catCount: { type: Number, default: 0 },
  catLimit: { type: Number, default: 100 },
  catWarnAt: { type: Number, default: 95 },
  catFull: { type: Boolean, default: false },
  catNearLimit: { type: Boolean, default: false },
  /** Parent inline-edit state: { scope, id, draft } or null */
  inlineEdit: { type: Object, default: null },
  commonCats: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'update:category',
  'update:bulk',
  'select-category',
  'add-category',
  'delete-category',
  'category-commit',
  'add-values',
  'edit-value',
  'commit-value',
  'cancel-edit',
  'remove-value',
  'upload-values',
  'upload-error',
  'close',
  'update:inline-draft'
])

const catFilter = ref('')
const valueFilter = ref('')
const valueSort = ref('az') // az | za
const valueView = ref('list') // list | chips
const addOpen = ref(false)
const overview = ref(false)

watch(
  () => props.category,
  (cat) => {
    valueFilter.value = ''
    overview.value = !cat
    // Empty pool → open add panel so next action is obvious
    if (cat && !props.loading && !activeCategoryValues.value.length) {
      addOpen.value = true
    }
  }
)

watch(
  () => [props.loading, props.values, props.category],
  () => {
    if (
      props.category &&
      !props.loading &&
      !activeCategoryValues.value.length &&
      !valueFilter.value
    ) {
      addOpen.value = true
    }
  }
)

const totalValues = computed(() =>
  (props.categories || []).reduce((n, c) => n + (Number(c.count) || 0), 0)
)

const filteredCategories = computed(() => {
  const q = catFilter.value.trim().toLowerCase()
  let list = [...(props.categories || [])]
  if (q) {
    list = list.filter((c) => String(c.category || '').toLowerCase().includes(q))
  }
  list.sort((a, b) =>
    String(a.category || '').localeCompare(String(b.category || ''), undefined, {
      sensitivity: 'base'
    })
  )
  return list
})

const activeCategoryValues = computed(() => {
  const cat = String(props.category || '').trim().toLowerCase()
  if (!cat) return []
  return (props.values || []).filter(
    (v) => String(v.category || '').toLowerCase() === cat
  )
})

const displayValues = computed(() => {
  const q = valueFilter.value.trim().toLowerCase()
  let list = activeCategoryValues.value.slice()
  if (q) {
    list = list.filter((v) => String(v.value || '').toLowerCase().includes(q))
  }
  list.sort((a, b) => {
    const cmp = String(a.value || '').localeCompare(String(b.value || ''), undefined, {
      sensitivity: 'base'
    })
    return valueSort.value === 'za' ? -cmp : cmp
  })
  return list
})

const fillPct = computed(() => {
  const lim = props.catLimit || 100
  return Math.min(100, Math.round(((props.catCount || 0) / lim) * 100))
})

function samplesFor(cat, n = 5) {
  const key = String(cat || '').toLowerCase()
  return (props.values || [])
    .filter((v) => String(v.category || '').toLowerCase() === key)
    .slice(0, n)
    .map((v) => v.value)
}

function isEditing(id) {
  return props.inlineEdit?.scope === 'theme' && props.inlineEdit?.id === id
}

function selectCat(name) {
  overview.value = false
  emit('select-category', name)
}

function showOverview() {
  overview.value = true
  emit('update:category', '')
}

function onCatInput(ev) {
  emit('update:category', ev.target.value)
}

function onDraftInput(ev) {
  emit('update:inline-draft', ev.target.value)
}

async function focusAdd() {
  addOpen.value = true
  await nextTick()
  document.getElementById('tvc-bulk')?.focus?.()
}
</script>

<template>
  <div class="tvc" role="region" :aria-label="`Theme values for ${themeName || 'pack'}`">
    <header class="tvc-head">
      <div class="tvc-head-text">
        <h3 class="tvc-title" id="tvc-heading">
          {{ themeName || 'Theme' }}
          <span class="muted tiny">· theme values</span>
        </h3>
        <p class="muted tiny tvc-sub">
          {{ categories.length }} categor{{ categories.length === 1 ? 'y' : 'ies' }}
          · {{ totalValues }} value{{ totalValues === 1 ? '' : 's' }} total · cap
          {{ catLimit }}/category
        </p>
      </div>
      <div class="tvc-head-actions">
        <button
          type="button"
          class="btn btn-ghost pack-action-sm"
          :class="{ on: overview || !category }"
          :title="'Browse all categories as cards'"
          @click="showOverview"
        >
          Overview
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Done</button>
      </div>
    </header>

    <div class="tvc-layout">
      <!-- Categories rail -->
      <aside class="tvc-cats" aria-labelledby="tvc-cats-label">
        <div class="tvc-cats-head">
          <span class="label" id="tvc-cats-label">Categories</span>
          <button
            type="button"
            class="btn btn-primary pack-action-sm"
            title="Create a new category"
            @click="emit('add-category')"
          >
            + Add
          </button>
        </div>
        <label class="tvc-search">
          <span class="visually-hidden">Filter categories</span>
          <input
            v-model="catFilter"
            class="input"
            type="search"
            placeholder="Filter categories…"
            autocomplete="off"
          />
        </label>
        <ul class="tvc-cat-list" role="listbox" aria-label="Theme categories">
          <li v-for="s in filteredCategories" :key="'cat-' + s.category">
            <div
              class="tvc-cat-row"
              :class="{
                on:
                  !overview &&
                  String(category || '').toLowerCase() === String(s.category).toLowerCase(),
                warn: s.nearLimit,
                full: s.full
              }"
            >
              <button
                type="button"
                class="tvc-cat-btn"
                role="option"
                :aria-selected="
                  !overview &&
                  String(category || '').toLowerCase() === String(s.category).toLowerCase()
                "
                :title="`${s.category}: ${s.count}/${s.limit ?? catLimit} values`"
                @click="selectCat(s.category)"
              >
                <span class="tvc-cat-name mono">{{ s.category }}</span>
                <span class="tvc-cat-meta muted tiny">
                  {{ s.count }}/{{ s.limit ?? catLimit }}
                </span>
                <span
                  class="tvc-cat-meter"
                  aria-hidden="true"
                  :style="{
                    '--fill':
                      Math.min(100, Math.round(((s.count || 0) / (s.limit || catLimit)) * 100)) +
                      '%'
                  }"
                />
              </button>
              <button
                type="button"
                class="btn btn-outline-danger pack-action-sm tvc-cat-del"
                :aria-label="`Delete category ${s.category}`"
                :title="`Delete “${s.category}” and all values`"
                @click.stop="emit('delete-category', s.category)"
              >
                ×
              </button>
            </div>
          </li>
          <li v-if="!filteredCategories.length" class="muted tiny tvc-empty-cat">
            {{ catFilter ? 'No matching categories' : 'No categories yet — add one' }}
          </li>
        </ul>
      </aside>

      <!-- Values panel -->
      <div class="tvc-main">
        <!-- Overview: cards per category -->
        <template v-if="overview || !category">
          <div class="tvc-panel-head">
            <h4 class="tvc-panel-title">All categories</h4>
            <p class="muted tiny">
              Click a card to open that pool. Map fields to
              <strong>Theme pack + Category</strong> in Field settings.
            </p>
          </div>
          <div v-if="categories.length" class="tvc-cards" role="list">
            <button
              v-for="s in filteredCategories"
              :key="'card-' + s.category"
              type="button"
              class="tvc-card"
              role="listitem"
              :class="{ warn: s.nearLimit, full: s.full }"
              @click="selectCat(s.category)"
            >
              <div class="tvc-card-top">
                <span class="tvc-card-name mono">{{ s.category }}</span>
                <span class="tvc-card-count muted tiny"
                  >{{ s.count }}/{{ s.limit ?? catLimit }}</span
                >
              </div>
              <div
                class="tvc-card-meter"
                aria-hidden="true"
                :style="{
                  '--fill':
                    Math.min(100, Math.round(((s.count || 0) / (s.limit || catLimit)) * 100)) +
                    '%'
                }"
              />
              <div class="tvc-card-samples">
                <template v-if="samplesFor(s.category).length">
                  <span
                    v-for="(sample, i) in samplesFor(s.category)"
                    :key="i"
                    class="tvc-sample mono"
                    >{{ sample }}</span
                  >
                  <span v-if="s.count > 5" class="muted tiny">+{{ s.count - 5 }} more</span>
                </template>
                <span v-else class="muted tiny">Empty — add values</span>
              </div>
            </button>
          </div>
          <p v-else class="muted tiny">No categories yet. Use <strong>+ Add</strong> on the left.</p>
        </template>

        <!-- Active category values -->
        <template v-else>
          <div class="tvc-panel-head">
            <div class="tvc-panel-title-row">
              <h4 class="tvc-panel-title mono">{{ category }}</h4>
              <span
                class="tvc-fill-badge"
                :class="{ warn: catNearLimit, full: catFull }"
                :title="`${catCount} of ${catLimit} values`"
              >
                {{ catCount }}/{{ catLimit }}
              </span>
            </div>
            <div class="tvc-fill-bar" aria-hidden="true">
              <span
                class="tvc-fill-bar-inner"
                :class="{ warn: catNearLimit, full: catFull }"
                :style="{ width: fillPct + '%' }"
              />
            </div>
            <p
              v-if="catFull || catNearLimit"
              class="banner err tvc-banner"
              role="status"
            >
              <template v-if="catFull">
                Category is full ({{ catCount }}/{{ catLimit }}). Remove values before adding more.
              </template>
              <template v-else>
                Nearly full ({{ catCount }}/{{ catLimit }} — warn at {{ catWarnAt }}+).
              </template>
            </p>
          </div>

          <div class="tvc-toolbar">
            <label class="tvc-search tvc-search-grow">
              <span class="visually-hidden">Filter values</span>
              <input
                v-model="valueFilter"
                class="input"
                type="search"
                placeholder="Search values…"
                autocomplete="off"
                :disabled="loading"
              />
            </label>
            <label class="muted tiny tvc-sort">
              Sort
              <select v-model="valueSort" class="input" aria-label="Sort values">
                <option value="az">A → Z</option>
                <option value="za">Z → A</option>
              </select>
            </label>
            <div class="tvc-view-toggle" role="group" aria-label="Value layout">
              <button
                type="button"
                class="btn btn-ghost pack-action-sm"
                :class="{ on: valueView === 'list' }"
                :aria-pressed="valueView === 'list'"
                @click="valueView = 'list'"
              >
                List
              </button>
              <button
                type="button"
                class="btn btn-ghost pack-action-sm"
                :class="{ on: valueView === 'chips' }"
                :aria-pressed="valueView === 'chips'"
                @click="valueView = 'chips'"
              >
                Chips
              </button>
            </div>
            <button
              type="button"
              class="btn btn-outline pack-action-sm"
              :disabled="catFull"
              @click="focusAdd"
            >
              + Values
            </button>
          </div>

          <p v-if="loading" class="muted tiny">Loading values…</p>

          <!-- List view -->
          <ul
            v-else-if="displayValues.length && valueView === 'list'"
            class="tvc-value-list"
            aria-label="Values in category"
          >
            <li v-for="row in displayValues" :key="row.id" class="tvc-value-row">
              <template v-if="isEditing(row.id)">
                <div class="inline-edit-row">
                  <label class="visually-hidden" :for="'tvc-edit-' + row.id">Edit value</label>
                  <input
                    :id="'tvc-edit-' + row.id"
                    class="input mono is-editing"
                    type="text"
                    :value="inlineEdit?.draft"
                    aria-label="Editing theme value"
                    @input="onDraftInput"
                    @keydown.enter.prevent="emit('commit-value')"
                    @keydown.escape.prevent="emit('cancel-edit')"
                  />
                  <button
                    type="button"
                    class="btn btn-primary pack-action-sm"
                    @click="emit('commit-value')"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost pack-action-sm"
                    @click="emit('cancel-edit')"
                  >
                    Cancel
                  </button>
                </div>
              </template>
              <template v-else>
                <span class="v mono">{{ row.value }}</span>
                <div class="tvc-value-actions">
                  <button
                    type="button"
                    class="btn btn-outline pack-action-sm"
                    :aria-label="`Edit ${row.value}`"
                    @click="emit('edit-value', row)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline-danger pack-action-sm"
                    :aria-label="`Remove ${row.value}`"
                    @click="emit('remove-value', row)"
                  >
                    Remove
                  </button>
                </div>
              </template>
            </li>
          </ul>

          <!-- Chips view -->
          <div
            v-else-if="displayValues.length && valueView === 'chips'"
            class="tvc-chips"
            role="list"
            aria-label="Values in category"
          >
            <div
              v-for="row in displayValues"
              :key="'chip-' + row.id"
              class="tvc-chip"
              role="listitem"
            >
              <template v-if="isEditing(row.id)">
                <input
                  class="input mono is-editing tvc-chip-edit"
                  type="text"
                  :value="inlineEdit?.draft"
                  aria-label="Editing theme value"
                  @input="onDraftInput"
                  @keydown.enter.prevent="emit('commit-value')"
                  @keydown.escape.prevent="emit('cancel-edit')"
                />
                <button
                  type="button"
                  class="btn btn-primary pack-action-sm"
                  @click="emit('commit-value')"
                >
                  Save
                </button>
              </template>
              <template v-else>
                <span class="mono tvc-chip-text" :title="row.value">{{ row.value }}</span>
                <button
                  type="button"
                  class="btn btn-ghost pack-action-sm tvc-chip-act"
                  :aria-label="`Edit ${row.value}`"
                  @click="emit('edit-value', row)"
                >
                  ✎
                </button>
                <button
                  type="button"
                  class="btn btn-ghost pack-action-sm tvc-chip-act danger"
                  :aria-label="`Remove ${row.value}`"
                  @click="emit('remove-value', row)"
                >
                  ×
                </button>
              </template>
            </div>
          </div>

          <p v-else-if="!loading" class="muted tiny tvc-empty-vals">
            <template v-if="valueFilter">No values match “{{ valueFilter }}”.</template>
            <template v-else>No values in this category yet — add some below.</template>
          </p>

          <p v-if="valueFilter && displayValues.length" class="muted tiny">
            Showing {{ displayValues.length }} of {{ activeCategoryValues.length }}
          </p>

          <!-- Add / upload (collapsible) -->
          <div class="tvc-add" :class="{ open: addOpen }">
            <button
              type="button"
              class="btn btn-ghost pack-action-sm tvc-add-toggle"
              :aria-expanded="addOpen"
              @click="addOpen = !addOpen"
            >
              {{ addOpen ? 'Hide add / upload' : 'Add or upload values' }}
            </button>
            <div v-show="addOpen" class="tvc-add-body">
              <ValueUploadPanel
                mode="theme"
                :theme-name="themeName"
                :category="category"
                :disabled="catFull"
                @parsed="emit('upload-values', $event)"
                @error="emit('upload-error', $event)"
              />
              <label class="gen-field">
                <span class="gen-field-label">Add values (one per line or comma-separated)</span>
                <textarea
                  id="tvc-bulk"
                  class="input mono"
                  :class="{ 'is-adding': !!(bulk && bulk.trim()) }"
                  rows="4"
                  :value="bulk"
                  placeholder="Luke Skywalker&#10;Leia Organa&#10;Han Solo"
                  :disabled="catFull"
                  @input="emit('update:bulk', $event.target.value)"
                />
              </label>
              <div class="tvc-add-actions">
                <button
                  type="button"
                  class="btn btn-primary pack-cta"
                  :disabled="catFull || !(bulk && bulk.trim())"
                  @click="emit('add-values')"
                >
                  Add to pool
                </button>
              </div>
            </div>
          </div>

          <!-- Quick rename / jump active category (power users) -->
          <details class="tvc-advanced">
            <summary class="muted tiny">Category name / jump</summary>
            <div class="tvc-advanced-body">
              <label class="gen-field">
                <span class="gen-field-label">Active category</span>
                <input
                  class="input mono"
                  list="tvc-cat-list"
                  :value="category"
                  placeholder="names, ships…"
                  @input="onCatInput"
                  @change="emit('category-commit')"
                  @keydown.enter.prevent="emit('category-commit')"
                />
                <datalist id="tvc-cat-list">
                  <option v-for="c in commonCats" :key="'cm-' + c" :value="c" />
                  <option
                    v-for="s in categories"
                    :key="'dl-' + s.category"
                    :value="s.category"
                  />
                </datalist>
              </label>
              <button
                type="button"
                class="btn btn-outline-danger pack-action-sm"
                :disabled="!category"
                @click="emit('delete-category', category)"
              >
                Delete this category
              </button>
            </div>
          </details>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tvc {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
  width: 100%;
}
.tvc-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.tvc-title {
  margin: 0;
  font-size: 1.1rem;
}
.tvc-sub {
  margin: 0.2rem 0 0;
}
.tvc-head-actions {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  flex-shrink: 0;
}
.tvc-head-actions .btn.on {
  border-color: var(--accent);
  color: var(--accent);
}

.tvc-layout {
  display: grid;
  grid-template-columns: minmax(150px, 200px) minmax(0, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  min-height: 320px;
  background: var(--surface);
}
@media (max-width: 720px) {
  .tvc-layout {
    grid-template-columns: 1fr;
  }
  .tvc-cats {
    border-right: none !important;
    border-bottom: 1px solid var(--border);
    max-height: 200px;
  }
}

.tvc-cats {
  border-right: 1px solid var(--border);
  background: var(--surface-2, var(--surface));
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(70vh, 560px);
}
.tvc-cats-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.55rem 0.35rem;
  gap: 0.35rem;
}
.tvc-search {
  display: block;
  padding: 0 0.5rem 0.4rem;
}
.tvc-search .input {
  width: 100%;
  font-size: 12px;
}
.tvc-cat-list {
  list-style: none;
  margin: 0;
  padding: 0 0.35rem 0.5rem;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.tvc-cat-row {
  display: flex;
  align-items: stretch;
  gap: 0.15rem;
  margin-bottom: 0.2rem;
  border-radius: 8px;
}
.tvc-cat-row.on {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.tvc-cat-row.warn:not(.on) {
  box-shadow: inset 3px 0 0 var(--gold, #d4a017);
}
.tvc-cat-row.full:not(.on) {
  box-shadow: inset 3px 0 0 var(--danger);
}
.tvc-cat-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.15rem;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  cursor: pointer;
}
.tvc-cat-btn:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.tvc-cat-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.tvc-cat-name {
  font-size: 0.88rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tvc-cat-meta {
  font-size: 10px;
}
.tvc-cat-meter,
.tvc-card-meter {
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
  position: relative;
}
.tvc-cat-meter::after,
.tvc-card-meter::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--fill, 0%);
  background: var(--accent);
  border-radius: 2px;
}
.tvc-cat-row.full .tvc-cat-meter::after,
.tvc-card.full .tvc-card-meter::after {
  background: var(--danger);
}
.tvc-cat-row.warn .tvc-cat-meter::after,
.tvc-card.warn .tvc-card-meter::after {
  background: var(--gold, #d4a017);
}
.tvc-cat-del {
  align-self: center;
  opacity: 0.55;
  margin-right: 0.15rem;
  flex-shrink: 0;
}
.tvc-cat-row:hover .tvc-cat-del,
.tvc-cat-row:focus-within .tvc-cat-del {
  opacity: 1;
}
.tvc-empty-cat {
  padding: 0.5rem 0.35rem;
}

.tvc-main {
  padding: 0.65rem 0.75rem 0.85rem;
  min-width: 0;
  overflow: auto;
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tvc-panel-title {
  margin: 0;
  font-size: 1rem;
}
.tvc-panel-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.tvc-fill-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2, var(--surface));
}
.tvc-fill-badge.warn {
  border-color: var(--gold, #d4a017);
  color: var(--gold, #d4a017);
}
.tvc-fill-badge.full {
  border-color: var(--danger);
  color: var(--danger);
}
.tvc-fill-bar {
  height: 6px;
  border-radius: 4px;
  background: var(--border);
  overflow: hidden;
  margin-top: 0.35rem;
}
.tvc-fill-bar-inner {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.15s ease;
}
.tvc-fill-bar-inner.warn {
  background: var(--gold, #d4a017);
}
.tvc-fill-bar-inner.full {
  background: var(--danger);
}
.tvc-banner {
  margin: 0.35rem 0 0;
}

.tvc-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: flex-end;
}
.tvc-search-grow {
  flex: 1 1 8rem;
  min-width: 0;
  padding: 0;
}
.tvc-sort {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.tvc-sort .input {
  width: auto;
  min-width: 5.5rem;
  font-size: 12px;
}
.tvc-view-toggle {
  display: flex;
  gap: 0.15rem;
}
.tvc-view-toggle .btn.on {
  border-color: var(--accent);
  color: var(--accent);
}

.tvc-value-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.tvc-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-bottom: 1px solid var(--border);
}
.tvc-value-row:last-child {
  border-bottom: none;
}
.tvc-value-row:nth-child(even) {
  background: color-mix(in srgb, var(--surface-2, #243044) 45%, transparent);
}
.tvc-value-row .v {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.tvc-value-actions {
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

.tvc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 280px;
  overflow: auto;
  padding: 0.15rem;
}
.tvc-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  max-width: 100%;
  padding: 0.25rem 0.2rem 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2, var(--surface));
  font-size: 12px;
}
.tvc-chip-text {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tvc-chip-act {
  padding: 0.05rem 0.35rem !important;
  min-width: 1.35rem;
  opacity: 0.7;
}
.tvc-chip:hover .tvc-chip-act,
.tvc-chip:focus-within .tvc-chip-act {
  opacity: 1;
}
.tvc-chip-act.danger {
  color: var(--danger);
}
.tvc-chip-edit {
  min-width: 8rem;
  border-radius: 6px;
}

.tvc-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.55rem;
}
.tvc-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  text-align: left;
  padding: 0.65rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2, var(--surface));
  color: var(--text);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.tvc-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
}
.tvc-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.tvc-card-top {
  display: flex;
  justify-content: space-between;
  gap: 0.35rem;
  align-items: baseline;
}
.tvc-card-name {
  font-weight: 600;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tvc-card-samples {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 2.5rem;
}
.tvc-sample {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tvc-add {
  border-top: 1px solid var(--border);
  padding-top: 0.45rem;
  margin-top: 0.25rem;
}
.tvc-add-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
.tvc-add-actions {
  display: flex;
  gap: 0.4rem;
}
.tvc-advanced {
  margin-top: 0.25rem;
}
.tvc-advanced-body {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin-top: 0.35rem;
}
.tvc-advanced-body .gen-field {
  flex: 1 1 12rem;
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
