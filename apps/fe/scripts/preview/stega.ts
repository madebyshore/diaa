/**
 * stega.ts — Phase 4: the stega filter used by the drafts-perspective
 * preview render (see render.ts).
 *
 * `@sanity/client`'s stega encoder walks every string leaf in a GROQ result
 * and — when enabled — invisibly embeds zero-width metadata into it so
 * Sanity's Presentation tool can map rendered text back to the Studio field
 * that produced it. That's exactly what we want for visible copy (titles,
 * portable-text bodies), but it is actively harmful for any string that ends
 * up as a route key, a filename, a URL, or an HTML attribute value: the
 * invisible characters corrupt the value (a stega-tagged image URL 404s; a
 * stega-tagged slug never matches `App.config.routes`).
 *
 * `buildPreviewStega()` returns a `StegaConfig` whose `filter` excludes
 * exactly those fields, keyed on `resultPath`'s last segment — the alias
 * name each GROQ query gives the field, not its underlying Studio schema
 * path (per `FilterDefault`'s docs, `resultPath` mirrors the *query* shape,
 * which is what our exclusion list needs to match since aliases like
 * `"image": image.asset->url` are the actual keys these values arrive under).
 *
 * ---------------------------------------------------------------------------
 * Exclusion list (documented here per the plan — copy into apps/fe/docs/
 * visual-editing.md when that doc is written):
 *
 *   slug         — pageHomeQuery grid[].slug, allDetailsQuery.slug,
 *                  pageContactQuery/pageImprintQuery.slug (scripts/utils/queries.ts).
 *                  Becomes the route path and an `App.config.routes` key.
 *   href         — siteOptionsQuery.footerLinks[].href (both externalLink and
 *                  internalLink branches), and every internalLink markDef
 *                  produced by richBodyProjection / richTextQuery() (used by
 *                  pageContact/pageImprint bodies, sliceText, sliceImageWithText
 *                  — scripts/utils/queries.ts + scripts/slices/helpers.ts).
 *                  Rendered as an `<a href>` attribute.
 *   image        — sliceImage.ts / sliceImageWithText.ts: `"image": image.asset->url`.
 *                  Consumed by helpers.mediaFromUrls()/pictureFromUrl(), which
 *                  does `url.split("?")[0]` — a stega-tagged URL breaks that split
 *                  and 404s.
 *   video        — sliceImage.ts / sliceImageWithText.ts: `"video": video.asset->url`.
 *                  Same mediaFromUrls() URL-splitting concern as `image` above.
 *   coverImage   — pageHomeQuery grid[].coverImage, allDetailsQuery.coverImage
 *                  (scripts/utils/queries.ts) → sanity-content.ts's coverMedia()/
 *                  sanityPicture(), which also splits on "?".
 *   coverVideo   — pageHomeQuery grid[].coverVideo, allDetailsQuery.coverVideo —
 *                  same as coverImage.
 *   url          — the array-item alias used by sliceImageSlideshow.ts
 *                  (`images[]{ "url": asset->url }`), slice2Up.ts and
 *                  slice3Up.ts (`images[]{ "url": image.asset->url, caption }`).
 *                  Consumed by helpers.pictureFromUrl()/resolveCaptionedImages().
 *
 * Explicitly NOT excluded (stays stega-encoded, by design):
 *   title, stylizedTitle, text, caption, quoteAuthor, name (siteOptions),
 *   introText — all rendered as visible text/Portable Text. `escapeHtml()`
 *   in scripts/utils/portable-text.ts only touches `&<>"'`, so the zero-width
 *   stega characters survive into the DOM untouched — which is exactly what
 *   Presentation's click-to-edit overlays need to find and decode.
 * ---------------------------------------------------------------------------
 */

import type { FilterDefault, StegaConfig } from "@sanity/client";

/**
 * `resultPath` last-segment names that must never carry stega-encoded
 * characters — see the exclusion list documented above this constant.
 */
const EXCLUDED_RESULT_KEYS: ReadonlySet<string> = new Set([
  "slug",
  "href",
  "image",
  "video",
  "coverImage",
  "coverVideo",
  "url",
]);

/**
 * Builds the `filter` function passed to `@sanity/client`'s `stega` option.
 * Excludes every field in `EXCLUDED_RESULT_KEYS` (matched on the last segment
 * of `resultPath`, which reflects the GROQ query's own aliasing) and defers
 * to the client's own `filterDefault` for everything else — this keeps
 * `@sanity/client`'s built-in heuristics (e.g. skipping non-text-shaped
 * values) intact rather than replacing them outright.
 */
function buildStegaFilter(): FilterDefault {
  return (props) => {
    const last = props.resultPath[props.resultPath.length - 1];
    if (typeof last === "string" && EXCLUDED_RESULT_KEYS.has(last)) {
      console.debug("[preview] stega excluded field:", props.resultPath.join("."));
      return false;
    }
    return props.filterDefault(props);
  };
}

/**
 * Builds the `StegaConfig` passed to `renderSite({ stega })` for the drafts
 * preview render (see render.ts). `studioUrl` is threaded straight from the
 * `SANITY_STUDIO_URL` env var so `@sanity/client` can compose deep links back
 * into the Studio for its own encoded metadata.
 *
 * @param studioUrl - Where the Sanity Studio is hosted (see external-setup
 *   docs) — passed through verbatim, may be an empty string in local dev
 *   before the env var is configured (stega still runs, just without a
 *   resolvable studio link).
 */
export function buildPreviewStega(studioUrl: string): StegaConfig {
  return {
    enabled: true,
    studioUrl,
    filter: buildStegaFilter(),
  };
}
