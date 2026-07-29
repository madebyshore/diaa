<script setup lang="ts">
/**
 * SliceImageSlideshow.vue — DOM-structure port of
 * `apps/fe/src/routes/partials/slices/sliceImageSlideshow.html`, PLUS the
 * click/keyboard slide-advance runtime ported from
 * `apps/fe/src/app/slices/sliceImageSlideshow.ts`.
 *
 * Every image renders stacked inside the viewport (all present in the DOM,
 * matching the old "every image is rendered stacked" behavior — no v-if
 * pruning); exactly one carries `.is-active` at a time, tracked here as a
 * plain `ref` index rather than DOM class toggling (the old vanilla-TS
 * runtime had to read/write `classList` directly; Vue's reactivity makes
 * that unnecessary, but the OBSERVABLE behavior — instant swap, no
 * transition, wraps past the last back to the first — is identical).
 * Clicking (or pressing Enter/Space on) the `role="button"` viewport
 * advances by one, wrapping. The `current / total` counter caption stays in
 * sync via the same `activeIndex` ref.
 *
 * Deliberate simplification vs. the old runtime: the old code only attached
 * click/keydown listeners when there were 2+ images (a single/zero-image
 * slideshow got NO listeners at all). Here the listeners are always
 * attached but `show()` no-ops below 2 images — same observable behavior
 * (nothing visibly advances), just via an internal guard instead of never
 * wiring the handlers.
 */
import type { ResolvedSliceSlideshow } from "~/data/slices/sliceImageSlideshow";

const props = defineProps<{ data: ResolvedSliceSlideshow }>();

// Active slide index. Starts at 0 to match the old template's SSR markup,
// which always marked `isFirst` (index 0) `.is-active`.
const activeIndex = ref(0);

/**
 * Activate slide `next`, wrapping in both directions; no-op if it's already
 * active OR there are fewer than 2 images (mirrors the old runtime's early
 * returns). Logs the same `[slice:slideshow] advance N / total` debug line.
 */
function show(next: number): void {
  const count = props.data.images.length;
  if (count < 2) return;
  const wrapped = ((next % count) + count) % count;
  if (wrapped === activeIndex.value) return;
  activeIndex.value = wrapped;
  console.debug("[slice:slideshow] advance", wrapped + 1, "/", count);
}

/** Advance one step forward (wraps past the last back to the first). */
function advance(): void {
  show(activeIndex.value + 1);
}

/** Enter/Space activate the `role="button"` viewport, matching native `<button>` key semantics. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    advance();
  }
}
</script>

<template>
  <section class="slice-slideshow" data-slice="sliceImageSlideshow">
    <div
      class="slice-slideshow__viewport"
      role="button"
      tabindex="0"
      aria-label="Next image"
      @click="advance"
      @keydown="onKeydown"
    >
      <div
        v-for="(image, i) in data.images"
        :key="i"
        :class="['slice-slideshow__slide', { 'is-active': i === activeIndex }]"
      >
        <FigureBase v-bind="image" />
      </div>
    </div>
    <p class="slice-slideshow__caption">
      <span class="slice-slideshow__counter"
        ><span class="slice-slideshow__counter-current">{{ activeIndex + 1 }}</span> /
        <span class="slice-slideshow__counter-total">{{ data.total }}</span></span
      ><span v-if="data.hasCaption" class="slice-slideshow__caption-text">{{ data.caption }}</span>
    </p>
  </section>
</template>
