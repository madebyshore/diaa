<script setup lang="ts">
/**
 * RichText.vue — the single Portable Text → DOM renderer for this app.
 *
 * Wraps `@portabletext/vue`'s `<PortableText>` and supplies the same
 * decorator/annotation semantics the old BUILD-TIME renderer
 * (`apps/fe/scripts/utils/portable-text.ts`) produced, so every field that
 * used to flow through `renderPortableText()` now renders identically at
 * RUNTIME instead: `strong`→`<strong>`, `em`→`<em>` (both already
 * `@portabletext/vue` defaults — no override needed), `underline`→`<u>`
 * (overridden: the library's own default is a styled `<span>`, which isn't
 * what the old renderer emitted), `code`→`<code>` (default), and the two
 * project-specific font decorators `serif`/`mono` → `<span class="serif">` /
 * `<span class="mono">` (not part of the library's default mark set at all).
 * Link annotations (`internalLink`/`externalLink` — both pre-resolved to a
 * ready `href` by `richTextQuery()` in `data/slices/helpers.ts`) render as
 * `<a class="rt-link">`, opening in a new tab with
 * `rel="noopener noreferrer"` only when an EXTERNAL link carries
 * `blank: true` — matching `wrapAnnotations()`'s exact rule verbatim. A
 * markDef with no usable `href` degrades to bare (unwrapped) text, same as
 * the old renderer silently skipping the wrap. Hard line breaks (`\n` in a
 * span's text, from Shift+Enter in the Studio) are handled NATIVELY by
 * `@portabletext/vue` — its default `hardBreak` component already emits
 * `<br>`, so no override is needed there.
 *
 * `inline` prop reproduces the one behavioral fork the old renderer had —
 * `renderPortableText(blocks, opts)`'s `wrap` option:
 *   - `inline: false` (default) — each block renders as a real `<p>`
 *     (`@portabletext/vue`'s own default `block.normal`). Matches every old
 *     `{ wrap: "p" }` call site: Contact/Imprint `body`, `sliceImageWithText`'s
 *     `text`, and `sliceText`'s plain/credits variant body.
 *   - `inline: true` — blocks render BARE (no wrapping tag at all) and
 *     consecutive blocks are joined by a literal `<br>` — matches every old
 *     call site that used `renderPortableText(x)` with NO `wrap` option:
 *     the Detail nav heading / home grid labels' `stylizedTitle` (old
 *     `sanity-content.ts`: `renderPortableText(d.stylizedTitle) ||
 *     escapeHtml(title)`), `sliceImageWithText`'s title, `slice2Up`/`slice3Up`
 *     captions (old `helpers.ts`: `renderPortableText(im.caption)`), and
 *     `sliceText`'s "quote" variant body (wrapped in hanging quote-mark
 *     spans by `<SliceText>` itself, not by this component).
 *
 *     This is also what lets `RichText` subsume Phase 2's
 *     `utils/stylized-title.ts` helper (now deleted — every stylizedTitle
 *     call site renders `<RichText inline>` instead): `@portabletext/vue`'s
 *     `<PortableText>` root renders as a bare Vue Fragment (verified against
 *     its compiled output — no wrapping element of its own), and the
 *     `inline` block component below ALSO renders as a bare fragment
 *     (`<br>` + slot content, no wrapping tag), so the composed output is a
 *     flat run of text/mark nodes — byte-for-byte what the old `v-html`
 *     output looked like, not a new wrapper element in the DOM.
 *
 * `fallback` mirrors the old `renderPortableText(x) || escapeHtml(title)`
 * idiom: rendered (auto-escaped by Vue's `{{ }}` interpolation — no manual
 * escaping needed) only when `blocks` has no visible span text.
 */
import { h, type Slots } from "vue";
import {
  PortableText,
  type PortableTextComponents,
  type PortableTextComponentProps,
  type PortableTextMarkComponentProps,
} from "@portabletext/vue";
// Type-only import — erased at compile time, so this never pulls the
// server-only `data/` layer's runtime code into the client bundle (see
// `data/content.ts`'s file header for the server-only convention).
import type { PortableTextBlock } from "~/data/types";

interface Props {
  /** Raw Portable Text blocks. Null/empty renders `fallback` (or nothing). */
  blocks: PortableTextBlock[] | null | undefined;
  /** Bare block rendering + `<br>`-joined blocks instead of `<p>` wrapping — see file header. */
  inline?: boolean;
  /** Plain-text fallback shown when `blocks` has no visible text. Omit to render nothing. */
  fallback?: string;
}

const props = withDefaults(defineProps<Props>(), {
  inline: false,
  fallback: "",
});

/**
 * True when there is at least one non-whitespace character of span text —
 * the same "is there anything here to show" check as the data layer's
 * `hasPortableTextContent()` (`data/slices/helpers.ts`), evaluated here since
 * this is the one place that decides between rendering Portable Text and
 * falling back to the plain-text prop.
 */
const hasContent = computed(() =>
  !!props.blocks?.some((block) =>
    (block.children ?? []).some((child) => typeof child.text === "string" && child.text.trim().length > 0),
  ),
);

/** `<u>` — the old renderer's `underline` decorator tag. Overrides
 *  `@portabletext/vue`'s own default, which renders a styled `<span>`.
 *  Typed against the library's own mark-component props (rather than a
 *  hand-rolled shape) so it structurally satisfies `PortableTextMarkComponent`
 *  without a cast — decorators don't read `value`/`markType`, hence `_props`. */
function underlineMark(_props: PortableTextMarkComponentProps, { slots }: { slots: Slots }) {
  return h("u", slots.default?.());
}

/** `<span class="serif">` — project-specific font decorator; not part of
 *  `@portabletext/vue`'s default mark set at all. */
function serifMark(_props: PortableTextMarkComponentProps, { slots }: { slots: Slots }) {
  return h("span", { class: "serif" }, slots.default?.());
}

/** `<span class="mono">` — sibling of `serifMark` for the other font decorator. */
function monoMark(_props: PortableTextMarkComponentProps, { slots }: { slots: Slots }) {
  return h("span", { class: "mono" }, slots.default?.());
}

/** Shape of an `internalLink`/`externalLink` markDef once `richTextQuery()`
 *  has resolved it — internal hrefs are pre-resolved by the GROQ projection,
 *  external ones carry `href`/`blank` natively from the schema. */
interface LinkMarkValue {
  /** Required by the library's `TypedObject` constraint on mark values; the
   *  actual discriminant used below is the `markType` context param instead
   *  (`internalLink` vs `externalLink`), not this field. */
  _type: string;
  href?: string;
  blank?: boolean;
}

/**
 * `<a class="rt-link">` for both link annotation types (registered under
 * both `internalLink` and `externalLink` below — Portable Text keys
 * annotation components by the markDef's own `_type`, not a shared "link"
 * name). Degrades to bare (unwrapped) text when `href` is missing, matching
 * `wrapAnnotations()`'s skip-if-no-href rule. Opens in a new tab only for an
 * EXTERNAL link explicitly marked `blank: true` — internal links never do.
 */
function linkMark(
  markProps: PortableTextMarkComponentProps<LinkMarkValue>,
  { slots }: { slots: Slots },
) {
  const href = markProps.value?.href;
  const children = slots.default?.();
  if (!href) return children;
  const external = markProps.markType === "externalLink" && markProps.value?.blank === true;
  return h(
    "a",
    {
      class: "rt-link",
      href,
      target: external ? "_blank" : undefined,
      rel: external ? "noopener noreferrer" : undefined,
    },
    children,
  );
}

/**
 * Inline (bare) block renderer used only in `inline` mode — no wrapping tag
 * around a block's content; a leading `<br>` separates it from the previous
 * block (skipped for the first block, `index === 0`). Mirrors the old
 * renderer's array-level `blocks.map(renderBlockInline).join("<br>")` join
 * exactly. Registered as a single catch-all `block` component (rather than a
 * `{ normal: ... }` record) since stylizedTitle/caption/quote fields are all
 * schema-constrained to the "normal" style — see `stylizedTitleField()` in
 * `apps/be/utils/fields.js`.
 */
function inlineBlock(blockProps: PortableTextComponentProps<unknown>, { slots }: { slots: Slots }) {
  const children = slots.default?.() ?? [];
  return blockProps.index > 0 ? [h("br"), ...children] : children;
}

/** Mark overrides shared by both inline and paragraph modes. */
const markComponents: PortableTextComponents["marks"] = {
  underline: underlineMark,
  serif: serifMark,
  mono: monoMark,
  internalLink: linkMark,
  externalLink: linkMark,
};

/** Full components object passed to `<PortableText>`, switching `block` on
 *  `inline` — see file header for which old call site maps to which mode. */
const components = computed<PortableTextComponents>(() =>
  props.inline ? { marks: markComponents, block: inlineBlock } : { marks: markComponents },
);
</script>

<template>
  <PortableText v-if="hasContent" :value="blocks ?? []" :components="components" />
  <template v-else-if="fallback">{{ fallback }}</template>
</template>
