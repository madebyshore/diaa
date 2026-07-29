<script setup lang="ts">
/**
 * SliceText.vue — a rich-text block with a Variant (plain/quote/credits),
 * DOM-structure port of `apps/fe/src/routes/partials/slices/sliceText.html`.
 *
 * The "quote" variant renders `text` `inline` (no `<p>` wrap, `<br>`-joined
 * blocks) wrapped in hanging open/close quote-mark spans — the old resolver
 * built this exact markup by string-concatenating
 * `<span class="slice-text__quote-mark slice-text__quote-mark--open">"</span>`
 * + bare `renderPortableText(raw.text)` (no `wrap`) +
 * `<span class="slice-text__quote-mark slice-text__quote-mark--close">"</span>`
 * (see `apps/fe/scripts/slices/sliceText.ts`). Every other variant
 * (plain/credits) renders `text` with the default paragraph mode — the old
 * resolver used `renderPortableText(x, { wrap: "p" })` for those. CSS alone
 * (`.slice-text--{variant}`) drives the plain/credits width + alignment
 * difference — no markup difference between them.
 */
import type { ResolvedSliceText } from "~/data/slices/sliceText";

defineProps<{ data: ResolvedSliceText }>();
</script>

<template>
  <section :class="['slice-text', `slice-text--${data.variant}`]" data-slice="sliceText">
    <div class="slice-text__body">
      <template v-if="data.variant === 'quote'">
        <span class="slice-text__quote-mark slice-text__quote-mark--open">&ldquo;</span><RichText
          inline
          :blocks="data.text"
        /><span class="slice-text__quote-mark slice-text__quote-mark--close">&rdquo;</span>
      </template>
      <RichText v-else :blocks="data.text" />
    </div>
    <p v-if="data.hasAuthor" class="slice-text__author"><em>{{ data.author }}</em></p>
  </section>
</template>
