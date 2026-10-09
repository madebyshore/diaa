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
// Type-only import — erased at compile time, never pulls the server-only
// `data/` layer into the client graph.
import type { PortableTextBlock } from "~/data/types";

const props = defineProps<{ data: ResolvedSliceText }>();

/**
 * The quote body with its trailing whitespace removed, so the closing quote
 * mark always sits directly against the last word.
 *
 * Why: the body renders `inline` (bare, `<br>`-joined blocks) and the
 * closing mark is emitted immediately after it. Anything an editor leaves
 * at the end of the field in the Studio — an empty trailing paragraph, a
 * Shift+Enter hard break, a stray space — therefore lands BETWEEN the last
 * word and the mark: an empty block or `\n` becomes a `<br>` and drops the
 * mark onto a line of its own; a space reopens a break opportunity the
 * styles rely on not existing (see `.slice-text__quote-mark--close`).
 * Trimming here (render-time, on a shallow copy — the resolved data in
 * `useState` is never mutated) fixes every such case without a content
 * edit. Only the END is trimmed; interior blank lines are authored intent.
 */
const quoteBlocks = computed<PortableTextBlock[]>(() => {
  const blocks = [...(props.data.text ?? [])];
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1]!;
    const children = [...(last.children ?? [])];
    // Walk the block's spans backwards, trimming until one keeps visible text.
    while (children.length > 0) {
      const child = children[children.length - 1]!;
      // A non-text inline object counts as content — stop trimming at it.
      if (typeof child.text !== "string") break;
      const trimmed = child.text.trimEnd();
      if (trimmed.length > 0) {
        children[children.length - 1] = { ...child, text: trimmed };
        break;
      }
      children.pop();
    }
    if (children.length > 0) {
      blocks[blocks.length - 1] = { ...last, children };
      break;
    }
    // Block had no visible text at all — drop it and re-check the one before.
    blocks.pop();
  }
  return blocks;
});
</script>

<template>
  <section :class="['slice-text', `slice-text--${data.variant}`]" data-slice="sliceText">
    <div class="slice-text__body">
      <template v-if="data.variant === 'quote'">
        <span class="slice-text__quote-mark slice-text__quote-mark--open">&ldquo;</span><RichText
          inline
          :blocks="quoteBlocks"
        /><span class="slice-text__quote-mark slice-text__quote-mark--close">&rdquo;</span>
      </template>
      <RichText v-else :blocks="data.text" />
    </div>
    <p v-if="data.hasAuthor" class="slice-text__author"><em>{{ data.author }}</em></p>
  </section>
</template>
