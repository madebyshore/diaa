<script setup lang="ts">
/**
 * SliceImage.vue — a single centered image (or full-bleed video/image),
 * DOM-structure port of `apps/fe/src/routes/partials/slices/sliceImage.html`.
 *
 * All layout (aspect ratio, column span) is CSS-driven off the `aspect`/`cols`
 * modifier classes computed server-side by `data/slices/sliceImage.ts` — this
 * component just reproduces the old partial's markup + class names exactly
 * and hands the resolved `image` (poster + optional video) to `FigureBase`.
 *
 * Two additions on top of the port:
 *   - Open aspect (`data.open`): the box has no fixed ratio class to lean
 *     on, so the image's own width/height ratio is handed to CSS as the
 *     `--slice-ratio` custom property (consumed by `--ar-open`).
 *   - Optional caption: same out-of-flow `.slice-caption` the 2Up/3Up use,
 *     rendered `inline` like theirs. The `--captioned` modifier makes the
 *     media box the caption's positioning context and lets it overflow
 *     (the inner `._g` figure still clips the image itself).
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
        { 'slice-image__media--open': data.open, 'slice-image__media--captioned': data.hasCaption },
      ]"
      :style="data.open ? { '--slice-ratio': data.ratio } : undefined"
    >
      <FigureBase v-bind="data.image" />
      <div v-if="data.hasCaption" class="slice-caption">
        <RichText inline :blocks="data.caption" />
      </div>
    </div>
  </section>
</template>
