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
  /** Sanity LQIP (base64 data URI, ~20px wide) — painted as a cover-fit
   *  background on the media element so a blurred placeholder shows the
   *  instant the box lays out, and the opaque full-res pixels simply cover
   *  it once loaded. Zero extra requests, no load-event JS needed. */
  lqip?: string;
}

const props = withDefaults(defineProps<Props>(), {
  isFirst: false,
  eager: false,
  hasVideo: false,
  video: "",
  lqip: "",
});

/**
 * True once the full-res media has decoded — at that point the LQIP
 * background is dead weight (and visibly bleeds through wherever the media
 * is animated below full opacity, e.g. the home grid's image mode), so we
 * drop the inline style entirely instead of leaving it painted underneath.
 */
const mediaLoaded = ref(false);

const mediaEl = ref<HTMLImageElement | HTMLVideoElement | null>(null);

/**
 * The `load` event can fire before hydration attaches our listener when the
 * image comes straight from cache — check the element's own completed state
 * on mount so a cache hit still clears the placeholder.
 */
onMounted(() => {
  const el = mediaEl.value;
  if (!el) return;
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
    mediaLoaded.value = true;
  } else if (el instanceof HTMLVideoElement && el.readyState >= 2) {
    mediaLoaded.value = true;
  }
});

/**
 * Inline background style carrying the LQIP placeholder. Inline (not a
 * class) because the data URI is per-image; undefined when no LQIP was
 * projected (so the element renders exactly as before this feature) and
 * again once the real media has loaded and the placeholder is obsolete.
 */
const lqipStyle = computed(() =>
  props.lqip && !mediaLoaded.value
    ? {
        backgroundImage: `url(${props.lqip})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined,
);
</script>

<template>
  <figure class="_g">
    <video
      v-if="props.hasVideo"
      ref="mediaEl"
      class="_g-video"
      :src="props.video"
      autoplay
      loop
      muted
      playsinline
      :poster="props.src || undefined"
      :width="props.width"
      :height="props.height"
      :style="lqipStyle"
      @loadeddata="mediaLoaded = true"
    />
    <img
      v-else
      ref="mediaEl"
      :src="props.src"
      :alt="props.alt"
      :fetchpriority="props.isFirst ? 'high' : undefined"
      :loading="!props.eager && !props.isFirst ? 'lazy' : undefined"
      :width="props.width"
      :height="props.height"
      :style="lqipStyle"
      @load="mediaLoaded = true"
    />
  </figure>
</template>
