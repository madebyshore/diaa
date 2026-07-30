<script setup lang="ts">
/**
 * DevGrid.client.vue — dev-only column-grid overlay, ported from the old
 * app's `routes/partials/grid.html` + the Ctrl+G branch of
 * `src/app/index.ts`'s globalKeyboardEvents().
 *
 * Renders the `.dev-grid` / `.dev-col` markup whose styles already live in
 * `styles/core/base.module.scss` (the "DEV GRID" block — fixed, full-viewport,
 * `repeat(var(--columns), 1fr)` with the live `--column-gap` /
 * `--container-padding`, hidden until `.is-active`). 24 columns for parity
 * with the old partial — the grid template only lays out `--columns` per row,
 * so the surplus wraps harmlessly below the viewport at narrower breakpoints.
 *
 * Like HomeAnimGui.client.vue, this component owns its own key listener
 * (registered in onMounted, removed in onUnmounted) instead of relying on a
 * global handler. `.client.vue` suffix strips it from the server render;
 * app.vue additionally gates the mount behind `import.meta.dev` so the
 * overlay never ships in a production bundle.
 */
import { onMounted, onUnmounted, ref } from "vue";

/** Whether the overlay is currently shown — toggled by Ctrl+G. */
const active = ref(false);

/** Ctrl+G (no meta/alt) flips the grid. preventDefault mirrors the Ctrl+F
 *  panel's handling so no browser shortcut fires alongside it — dev-only,
 *  acceptable trade. */
function onKeydown(e: KeyboardEvent): void {
  if (!e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key !== "g" && e.key !== "G") return;
  e.preventDefault();
  active.value = !active.value;
  console.debug(`[dev:grid] overlay ${active.value ? "shown" : "hidden"}`);
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  console.debug("[dev:grid] Ctrl+G toggle installed (grid hidden)");
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <section class="dev-grid" :class="{ 'is-active': active }" aria-hidden="true">
    <div v-for="n in 24" :key="n" class="dev-col" />
  </section>
</template>
