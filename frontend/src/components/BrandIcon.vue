<script setup>
/**
 * Shared DataForge mark — same artwork as /favicon.svg (browser tab).
 * Uses the public favicon URL so header, tab, and install icons stay in sync.
 */
defineProps({
  size: { type: [Number, String], default: 30 },
  label: { type: String, default: 'DataForge' }
})
</script>

<template>
  <img
    class="brand-icon-img"
    src="/favicon.svg"
    :width="size"
    :height="size"
    :alt="label"
    decoding="async"
  />
</template>

<style scoped>
.brand-icon-img {
  display: block;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
</style>
