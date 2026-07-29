<script setup lang="ts">
/**
 * SliceImage.vue — a single centered image (or full-bleed video/image),
 * DOM-structure port of `apps/fe/src/routes/partials/slices/sliceImage.html`.
 *
 * All layout (aspect ratio, column span) is CSS-driven off the `aspect`/`cols`
 * modifier classes computed server-side by `data/slices/sliceImage.ts` — this
 * component just reproduces the old partial's markup + class names exactly
 * and hands the resolved `image` (poster + optional video) to `FigureBase`.
 */
import type { ResolvedSliceImage } from "~/data/slices/sliceImage";

defineProps<{ data: ResolvedSliceImage }>();
</script>

<template>
  <section :class="['slice-image', { 'slice-image--full': data.full }]" data-slice="sliceImage">
    <div
      v-if="data.image"
      :class="[
        'slice-image__media',
        `slice-image__media--ar-${data.aspect}`,
        `slice-image__media--c${data.cols}`,
      ]"
    >
      <FigureBase v-bind="data.image" />
    </div>
  </section>
</template>
