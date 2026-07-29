<script setup lang="ts">
/**
 * SliceImageWithText.vue — three stacked rows (title, image, rich-text body),
 * DOM-structure port of
 * `apps/fe/src/routes/partials/slices/sliceImageWithText.html`.
 *
 * `stylizedTitle` renders `inline` (no `<p>` wrap, `<br>`-joined blocks) —
 * the old build-time resolver rendered it via bare `renderPortableText(x)`
 * with no `wrap` option (see `apps/fe/scripts/slices/sliceImageWithText.ts`).
 * `text` (the body) renders with the default paragraph mode — the old
 * resolver called `renderPortableText(x, { wrap: "p" })` for it.
 */
import type { ResolvedSliceImageWithText } from "~/data/slices/sliceImageWithText";

defineProps<{ data: ResolvedSliceImageWithText }>();
</script>

<template>
  <section class="slice-image-with-text" data-slice="sliceImageWithText">
    <h2 v-if="data.hasTitle" class="slice-image-with-text__title">
      <RichText inline :blocks="data.stylizedTitle" />
    </h2>
    <div
      v-if="data.image"
      :class="['slice-image-with-text__media', `slice-image-with-text__media--ar-${data.aspect}`]"
    >
      <FigureBase v-bind="data.image" />
    </div>
    <div v-if="data.hasText" class="slice-image-with-text__text">
      <RichText :blocks="data.text" />
    </div>
  </section>
</template>
