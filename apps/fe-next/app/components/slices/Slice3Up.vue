<script setup lang="ts">
/**
 * Slice3Up.vue — three captioned images, DOM-structure port of
 * `apps/fe/src/routes/partials/slices/slice3Up.html`. Same shape and same
 * `inline` (bare, `<br>`-joined) caption rendering as `Slice2Up.vue` — see
 * that component's doc comment for the caption-mode rationale. Per-image
 * aspect/size is CSS-driven off the `layout` modifier class — see
 * `data/slices/slice3Up.ts`'s file header for the three layout variants.
 */
import type { ResolvedSlice3Up } from "~/data/slices/slice3Up";

defineProps<{ data: ResolvedSlice3Up }>();
</script>

<template>
  <section
    :class="['slice-3up', `slice-3up--${data.layout}`, { 'slice-3up--bottom-aligned': data.bottomAligned }]"
    data-slice="slice3Up"
  >
    <figure v-for="(item, i) in data.images" :key="i" class="slice-3up__item">
      <div class="slice-3up__media">
        <FigureBase v-if="item.image" v-bind="item.image" />
      </div>
      <figcaption v-if="item.hasCaption" class="slice-caption">
        <RichText inline :blocks="item.caption" />
      </figcaption>
    </figure>
  </section>
</template>
