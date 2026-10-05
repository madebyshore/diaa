<script setup lang="ts">
/**
 * Slice2Up.vue — two captioned images, DOM-structure port of
 * `apps/fe/src/routes/partials/slices/slice2Up.html`. Per-image aspect/grid
 * placement is entirely CSS-driven off the `layout`/`bottomAligned` modifier
 * classes — see `data/slices/slice2Up.ts`'s file header for the layout
 * variants. The one exception is the uncropped `open` layout: its boxes
 * take each image's own proportions, so the per-image width/height ratio is
 * passed to CSS as the `--slice-ratio` custom property (only emitted for
 * that layout — the fixed-ratio variants' markup is unchanged).
 *
 * Captions render `inline` (no `<p>` wrap, `<br>`-joined blocks) — the old
 * resolver rendered them via bare `renderPortableText(im.caption)` with no
 * `wrap` option (see `apps/fe/scripts/slices/helpers.ts`'s
 * `resolveCaptionedImages()`).
 */
import type { ResolvedSlice2Up } from "~/data/slices/slice2Up";

defineProps<{ data: ResolvedSlice2Up }>();
</script>

<template>
  <section
    :class="['slice-2up', `slice-2up--${data.layout}`, { 'slice-2up--bottom-aligned': data.bottomAligned }]"
    data-slice="slice2Up"
  >
    <figure
      v-for="(item, i) in data.images"
      :key="i"
      class="slice-2up__item"
      :style="data.layout === 'open' ? { '--slice-ratio': item.ratio } : undefined"
    >
      <div class="slice-2up__media">
        <FigureBase v-if="item.image" v-bind="item.image" />
      </div>
      <figcaption v-if="item.hasCaption" class="slice-caption">
        <RichText inline :blocks="item.caption" />
      </figcaption>
    </figure>
  </section>
</template>
