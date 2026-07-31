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
 */

/** Responsive image data shared by covers, slices, and captioned images. */
export interface PictureData {
  src: string;
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
  return {
    src: `${baseUrl}?auto=format&fm=webp&w=${w}&q=85`,
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
  return {
    src: `${baseUrl}?auto=format&fm=webp&w=${width}`,
    alt,
    width,
    height,
    isFirst: index === 0,
    lqip: lqip ?? "",
  };
}
