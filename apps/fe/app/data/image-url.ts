/**
 * data/image-url.ts — the ONE seam where Sanity CDN image URLs get their
 * transform params appended.
 *
 * Every GROQ query in `data/queries.ts` projects images as `asset->url`
 * plain strings (not raw asset refs, and not hotspot/crop metadata), so
 * there is nothing for `@sanity/image-url` to resolve here — its job is
 * building a URL *from* a ref/hotspot/crop, and we already have the final
 * CDN URL by the time it reaches these helpers. Pulling it in anyway would
 * add a dependency that does nothing. Parity with the old
 * `apps/fe/scripts/sanity-content.ts` / `scripts/slices/helpers.ts` URL
 * scheme matters more here than reaching for a fancier tool — and centralizing
 * the param-building in this one file means a future hotspot/crop upgrade
 * (querying the full asset + hotspot/crop fields and switching to
 * `@sanity/image-url`) only has to change this file.
 *
 * Two builders exist because the OLD pipeline used two different param
 * strings for two different call sites, and this port preserves that
 * verbatim rather than "fixing" it into one shared shape:
 *   - `sanityPicture()` (old: `sanity-content.ts`) — grid covers + detail
 *     covers. Includes `&q=85` and derives height as `round(w * 4/3)`.
 *   - `pictureFromUrl()` (old: `scripts/slices/helpers.ts`) — slice images.
 *     No quality param, and a fixed default height of 4000 regardless of
 *     the width argument (matches the old signature's literal default).
 *
 * Both builders also emit a `srcset` width ladder (see `buildSrcset()`), and
 * `src` is now a mid-size FALLBACK rather than the full 3000px source. The
 * old pipeline shipped every cover/slice image as a single 3000px URL, which
 * on an iPad decoded to ~48 MB of bitmap per image (3000×4000×4 bytes) — and
 * the home page alone keeps ~22 covers resident in the Text-mode reveal
 * overlay plus another 22 in the Image-mode grid, well past iPadOS Safari's
 * per-tab memory ceiling. The tab was being killed and reloaded ("the site
 * crashes intermittently" client report). With a ladder + a per-call-site
 * `sizes` (`lib/image-sizes.ts`, passed through FigureBase), each surface
 * only fetches/decodes what it actually renders at the device's DPR.
 */

/** srcset rungs, in px. Topped out at the caller's requested max width (3000
 *  everywhere today — the old single-URL size, so the sharpest surface on
 *  the biggest retina screen still gets exactly what it got before). Spaced
 *  so the browser never over-fetches by more than ~1.5× the slot's real
 *  device-pixel width. */
const SRCSET_WIDTHS = [480, 800, 1200, 1600, 2000, 2400, 3000] as const;

/** Width of the plain `src` fallback (and the `<video poster>`, which can't
 *  take a srcset at all). 1600 covers the hero reveal on an iPad at 2× and a
 *  1440 laptop's hero at 2× within a rung; browsers that understand srcset
 *  (all of them) only ever use this for posters. */
const FALLBACK_WIDTH = 1600;

/**
 * Build a `srcset` string for a Sanity CDN image: one `<url> <w>w` entry per
 * `SRCSET_WIDTHS` rung up to `maxWidth`, always ending on `maxWidth` itself.
 * `params` is the builder's fixed query string (format/quality/fit) — the
 * `w` param is appended per rung. Both builders pass `fit=max`, which tells
 * Sanity's image API never to upscale past the asset's intrinsic width, so
 * a rung wider than a small upload resolves to the original size instead of
 * an inflated bitmap that costs memory for no extra detail.
 */
function buildSrcset(baseUrl: string, params: string, maxWidth: number): string {
  const widths: number[] = SRCSET_WIDTHS.filter((w) => w < maxWidth);
  widths.push(maxWidth);
  return widths.map((w) => `${baseUrl}?${params}&w=${w} ${w}w`).join(", ");
}

/** Responsive image data shared by covers, slices, and captioned images. */
export interface PictureData {
  /** Mid-size fallback URL (`FALLBACK_WIDTH`, capped at the max width) —
   *  also the `<video poster>`. Real `<img>` rendering picks from `srcset`. */
  src: string;
  /** Width-descriptor ladder (`buildSrcset()`). Paired with a per-surface
   *  `sizes` from `lib/image-sizes.ts` at render time. Empty string when
   *  there is no image (video-only cover). */
  srcset: string;
  alt: string;
  width: number;
  height: number;
  /** True for the first image in its list — old templates used this to set
   *  `fetchpriority="high"` / eager-load the page's likely LCP image. */
  isFirst: boolean;
  /** Sanity's LQIP (`asset->metadata.lqip`) — a ~20px-wide base64 data URI
   *  rendered as a blur-up placeholder behind the real image while it loads
   *  (FigureBase applies it as a background-image). Inline data, zero extra
   *  requests. Empty string when the query didn't project it. */
  lqip: string;
}

/** `PictureData` plus the optional cover/slice video fields. When `hasVideo`
 *  is true, the consuming component renders a looping autoplay `<video>`
 *  with `src` (the still image) as its poster; otherwise a plain `<img>`. */
export interface MediaData extends PictureData {
  hasVideo: boolean;
  video: string;
}

/**
 * Build a single-URL `PictureData` for a grid/detail cover image. Mirrors
 * `sanityPicture()` in the old `sanity-content.ts` exactly: `w` defaults to
 * 3000 (retina-sharp source for every consumer — home grid hover reveals,
 * detail pages), height derives from width assuming a 3:4 aspect, and the
 * URL always carries `&q=85`.
 */
export function sanityPicture(
  sanityUrl: string,
  alt: string,
  index: number,
  w = 3000,
  lqip?: string | null,
): PictureData {
  const baseUrl = sanityUrl.split("?")[0];
  const params = "auto=format&fm=webp&q=85&fit=max";
  return {
    src: `${baseUrl}?${params}&w=${Math.min(w, FALLBACK_WIDTH)}`,
    srcset: buildSrcset(baseUrl ?? sanityUrl, params, w),
    alt,
    width: w,
    height: Math.round((w * 4) / 3),
    isFirst: index === 0,
    lqip: lqip ?? "",
  };
}

/**
 * Build a single-URL `PictureData` from a Sanity asset URL for slice images.
 * Mirrors `pictureFromUrl()` in the old `scripts/slices/helpers.ts` exactly:
 * no quality param, and `height` defaults to a fixed 4000 (not derived from
 * `width`) unless the caller overrides it — e.g. the slideshow slice passes
 * `(url, alt, index, 3000, 2000)` for its 3:2 viewport. Returns null when the
 * URL is absent so callers can skip rendering the image entirely.
 */
export function pictureFromUrl(
  url: string | undefined | null,
  alt: string,
  index: number,
  width = 3000,
  height = 4000,
  lqip?: string | null,
): PictureData | null {
  if (!url) return null;
  const baseUrl = url.split("?")[0] ?? url;
  const params = "auto=format&fm=webp&fit=max";
  return {
    src: `${baseUrl}?${params}&w=${Math.min(width, FALLBACK_WIDTH)}`,
    srcset: buildSrcset(baseUrl, params, width),
    alt,
    width,
    height,
    isFirst: index === 0,
    lqip: lqip ?? "",
  };
}
