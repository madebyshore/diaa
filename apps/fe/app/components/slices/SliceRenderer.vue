<script setup lang="ts">
/**
 * SliceRenderer.vue — dispatches an already-resolved `slices[]` array (a
 * Detail document's authored slice list) to each slice's Vue component by
 * `_type`.
 *
 * Resolve-seam decision: the raw-Sanity → component-props transform
 * (`SliceDefinition.resolve()`) already runs EXACTLY ONCE, server-side, in
 * `data/slices/registry.ts`'s `resolveSlices()` — called from
 * `loadDetailContent()` in `data/content.ts`. `[slug].vue` passes that
 * already-resolved array straight through as this component's `slices` prop.
 * This component NEVER touches raw Sanity fields and never calls `resolve()`
 * itself — it only maps `{ _type, _key, data }` entries to a Vue component
 * and hands `data` through as that component's `data` prop. This keeps slice
 * components "dumb" (pure props-in, DOM-out) and matches the OLD pipeline's
 * build-time resolution model (`scripts/sanity-content.ts` resolved every
 * slice once, at build time, before any template ever rendered).
 *
 * Unknown-type handling: `resolveSlices()` already drops slice entries whose
 * `_type` has no registered `SliceDefinition` (a schema landed before the
 * data layer caught up), logging its own warning — those never reach this
 * component at all. The guard below covers the OTHER failure mode: a
 * `_type` that DID resolve server-side (it has a `SliceDefinition`) but has
 * no matching entry in `sliceComponents` below (a Phase 3 registration
 * gap) — skipped + warned here, mirroring the old build-time renderer's
 * "skip, don't crash the whole page" behavior for unrecognized types.
 */
import type { Component } from "vue";
import SliceImage from "./SliceImage.vue";
import SliceImageWithText from "./SliceImageWithText.vue";
import SliceImageSlideshow from "./SliceImageSlideshow.vue";
import Slice2Up from "./Slice2Up.vue";
import Slice3Up from "./Slice3Up.vue";
import SliceText from "./SliceText.vue";

/** One already-resolved slice entry, as produced by `resolveSlices()`
 *  (`data/slices/registry.ts`) and threaded through `DetailRouteContent.slices`. */
interface ResolvedSliceEntry {
  _type: string;
  _key: string;
  data: unknown;
}

const props = defineProps<{ slices: ResolvedSliceEntry[] }>();

/** `_type` → Vue component registry. Add a new slice here alongside its
 *  `data/slices/<name>.ts` resolver and `apps/be` schema — same recipe
 *  documented in `data/slices/types.ts`'s file header. */
const sliceComponents: Record<string, Component> = {
  sliceImage: SliceImage,
  sliceImageWithText: SliceImageWithText,
  sliceImageSlideshow: SliceImageSlideshow,
  slice2Up: Slice2Up,
  slice3Up: Slice3Up,
  sliceText: SliceText,
};

// Warn once per unregistered slice type at setup time (mirrors the old
// build-time renderer logging once per page render, not per re-render —
// this component remounts fresh per route navigation).
for (const slice of props.slices) {
  if (!sliceComponents[slice._type]) {
    console.warn(`[slice:renderer] no Vue component registered for slice type "${slice._type}" — skipping`);
  }
}
</script>

<template>
  <template v-for="slice in slices" :key="slice._key">
    <component :is="sliceComponents[slice._type]" v-if="sliceComponents[slice._type]" :data="slice.data" />
  </template>
</template>
