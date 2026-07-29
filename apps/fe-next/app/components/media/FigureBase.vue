<script setup lang="ts">
/**
 * FigureBase — the responsive image/video figure, ported branch-for-branch
 * from `apps/fe/src/routes/partials/picture.html`.
 *
 * Props mirror the data layer's `PictureData`/`MediaData` shape
 * (`data/image-url.ts`) exactly, so every call site (home grid covers,
 * detail cover, Phase 3's slice images) can spread its resolved media object
 * straight in: `<FigureBase v-bind="item.cover" />`.
 *
 * Branch + attribute parity with the old partial:
 *   - `hasVideo` → `<video class="_g-video">`, autoplay/loop/muted/playsinline,
 *     `poster` only set when `src` is truthy (old: `{{#src}}poster="..."{{/src}}`).
 *   - otherwise → a plain `<img>` (no class, matching the old partial exactly),
 *     `fetchpriority="high"` when `isFirst`, `loading="lazy"` unless `eager`
 *     or `isFirst` (old: `{{^eager}}{{^isFirst}}loading="lazy"{{/isFirst}}{{/eager}}`).
 *   - `width`/`height` always set on both branches (old partial always emitted
 *     them — layout-stability, not just an old habit).
 *
 * `coverSize`-driven aspect/layout modifier classes (`--{{coverSize}}`) are
 * NOT applied here — in every old template they land on the *wrapping*
 * element (`.home__image-slot--{{coverSize}}`, `.detail__cover-inner--{{coverSize}}`),
 * never on the `_g` figure itself. Callers reproduce that wrapper + modifier
 * exactly as the old markup did; FigureBase stays a pure picture.html port.
 */

interface Props {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Sets fetchpriority="high" and skips lazy-loading — the page's likely LCP image. */
  isFirst?: boolean;
  /** Skips lazy-loading without claiming fetchpriority (e.g. an above-the-fold
   *  image that isn't index 0). Old partial: `{{^eager}}...{{/eager}}`. */
  eager?: boolean;
  hasVideo?: boolean;
  video?: string;
}

const props = withDefaults(defineProps<Props>(), {
  isFirst: false,
  eager: false,
  hasVideo: false,
  video: "",
});
</script>

<template>
  <figure class="_g">
    <video
      v-if="props.hasVideo"
      class="_g-video"
      :src="props.video"
      autoplay
      loop
      muted
      playsinline
      :poster="props.src || undefined"
      :width="props.width"
      :height="props.height"
    />
    <img
      v-else
      :src="props.src"
      :alt="props.alt"
      :fetchpriority="props.isFirst ? 'high' : undefined"
      :loading="!props.eager && !props.isFirst ? 'lazy' : undefined"
      :width="props.width"
      :height="props.height"
    />
  </figure>
</template>
