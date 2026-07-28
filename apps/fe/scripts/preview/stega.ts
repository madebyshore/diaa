/**
 * stega.ts — Phase 4: the stega filter used by the drafts-perspective
 * preview render (see render.ts).
 *
 * `@sanity/client`'s stega encoder walks every string leaf in a GROQ result
 * and — when enabled — invisibly embeds zero-width metadata into it so
 * Sanity's Presentation tool can map rendered text back to the Studio field
 * that produced it. That's exactly what we want for visible copy (titles,
 * portable-text bodies), but it is actively harmful for any string that ends
 * up as a route key, a filename, a URL, an HTML attribute value, or a value
 * whose length/uniqueness turns a single encode into a page-wide blast
 * radius (see `title`/`name` below): a stega-tagged image URL 404s, a
 * stega-tagged slug never matches `App.config.routes`, and a stega-tagged
 * `<title>` or intro phrase balloons a handful of visible characters into
 * tens of thousands of invisible ones (see the intro-hang note below).
 *
 * `buildPreviewStega()` returns a `StegaConfig` whose `filter` excludes
 * exactly those fields, keyed on the last **string** segment of
 * `resultPath` — the alias name each GROQ query gives the field, not its
 * underlying Studio schema path (per `FilterDefault`'s docs, `resultPath`
 * mirrors the *query* shape, which is what our exclusion list needs to
 * match since aliases like `"image": image.asset->url` are the actual keys
 * these values arrive under).
 *
 * ---------------------------------------------------------------------------
 * Array-index blind spot (fixed here — read before adding a new key):
 *
 * `resultPath` for a value inside a plain array-of-strings ends in a
 * **number** (the index), not the field name — e.g. `siteOptions.introText`
 * (a bare `string[]`, no `_key` because it isn't an array of objects) reaches
 * the filter with `resultPath = ["introText", 0]`. Matching only
 * `resultPath[resultPath.length - 1]` against the exclusion set therefore
 * silently misses every item: the last segment is `0`, not `"introText"`,
 * so `EXCLUDED_RESULT_KEYS.has(0)` is trivially false and the string sails
 * through the default filter fully stega-encoded. This is exactly what
 * happened to `introText`/`introPhrases` — see the intro-hang note below.
 *
 * Fields that are arrays of *objects* (`footerLinks[]`, `grid[]`, slice
 * `images[]`, …) don't have this problem: the leaf value's path ends in the
 * object's own property name (`["footerLinks", 0, "href"]`), so the last
 * segment is already a string. The blind spot is specific to arrays whose
 * items are themselves raw strings.
 *
 * `lastStringSegment()` below walks `resultPath` from the end and skips any
 * trailing numeric (or Sanity keyed-segment) index, returning the nearest
 * actual string key. That fixes `introText` and guards against any future
 * scalar-string array field hitting the same bug — re-check this whenever a
 * new exclusion is added for a field that is (or becomes) a bare string
 * array.
 *
 * ---------------------------------------------------------------------------
 * Intro-hang mechanism (why `introText` had to be excluded, not just
 * documented):
 *
 * `Intro.setRandomPhrase()` (apps/fe/src/engine/boot/intro.ts) reads the
 * `<script class="intro__phrases">` JSON payload injected by
 * routes-plugin.ts, picks one phrase, and writes it straight into
 * `.intro__text.textContent` — no `Split` involved, no per-character
 * animation. The hang isn't in JS: `Application.init()` (apps/fe/src/app/
 * index.ts) `await`s `intro.play()` in boot phase 4 *before* phase 5 wires up
 * page entrance + interactivity, so anything that stalls `play()` stalls the
 * entire SPA becoming interactive — which is exactly the reported "won't
 * route to a page or anything" symptom. A stega-tagged phrase turns a few
 * words into a single string carrying tens of thousands of invisible
 * zero-width characters (ZWSP/ZWNJ/ZWJ/word-joiner). Setting `textContent`
 * to that string forces the browser to run its line-breaking/bidi/grapheme-
 * cluster analysis over the whole run on first layout — ZWJ in particular is
 * an emoji-sequence-combining hint, and shaping engines are not linear in
 * the presence of dense ZWJ runs. That analysis can block the main thread
 * for seconds to minutes depending on phrase length and browser, well past
 * anything `Anima`'s rAF-driven opacity tween expects, so `play()` either
 * takes minutes to resolve or the tab appears hung while it's computing —
 * either way phase 5 never runs and the Presentation iframe looks dead.
 *
 * ---------------------------------------------------------------------------
 * Exclusion list:
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
 *   introText    — siteOptionsQuery.introText (scripts/utils/queries.ts), a bare
 *                  `string[]` — this is the field sanity-content.ts renames to
 *                  `introPhrases` and routes-plugin.ts serializes verbatim into
 *                  the `<script class="intro__phrases">` JSON payload consumed
 *                  by Intro.setRandomPhrase(). See the intro-hang note above:
 *                  this is the array-of-strings case that needed the
 *                  `lastStringSegment()` fix, not just a set entry.
 *   title        — pageHomeQuery.title (unused downstream — harmless either
 *                  way), grid[]/allDetailsQuery.title, taxonomy title,
 *                  pageContact/pageImprintQuery.title, footerLinks[].title,
 *                  slice CTA title (helpers.resolveCta). Feeds `document.title`
 *                  composition ("<siteTitle> - <pageTitle>") on EVERY cache
 *                  entry and `coverMedia()`'s `alt` parameter, so one encoded
 *                  string gets duplicated across all 30 cache entries' `<title>`
 *                  tags and every cover image's `alt` attribute — the single
 *                  biggest contributor to the multi-MB bloat. KNOWN TRADEOFF:
 *                  a Detail/grid item's *visible* heading normally renders via
 *                  `stylizedTitle` (kept encoded, see below) with plain `title`
 *                  only as the escaped-text fallback when no stylizedTitle is
 *                  authored — that fallback heading, the taxonomy nav-filter
 *                  button labels (`{{title}}` in home.html, no stylizedTitle
 *                  alternative exists for taxonomies), and slice CTA button
 *                  labels lose Presentation click-to-edit as a result. Accepted:
 *                  correctness (no page-breaking bloat, no intro hang) outweighs
 *                  inline-editing convenience for these specific plain-text
 *                  fallbacks; editors can still edit them directly in the Studio.
 *   name         — siteOptionsQuery.name → sanity-content.ts's `siteTitle`.
 *                  Same `<title>`/OG-meta duplication-across-every-page concern
 *                  as `title` above. Never rendered as visible body copy (the
 *                  nav wordmark is static markup, not CMS-driven), so this one
 *                  has no click-to-edit tradeoff.
 *
 * Explicitly NOT excluded (stays stega-encoded, by design):
 *   stylizedTitle, text, caption, quoteAuthor — all rendered as visible
 *   Portable Text / plain body copy with no attribute or routing role.
 *   `escapeHtml()` in scripts/utils/portable-text.ts only touches `&<>"'`, so
 *   the zero-width stega characters survive into the DOM untouched — which
 *   is exactly what Presentation's click-to-edit overlays need to find and
 *   decode.
 * ---------------------------------------------------------------------------
 */

import type { FilterDefault, StegaConfig } from "@sanity/client";
import type { ContentSourceMapParsedPath } from "@sanity/client/csm";

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
  "introText",
  "title",
  "name",
]);

/**
 * Finds the nearest **string** segment at the end of a `resultPath`,
 * skipping any trailing array-index segments (a plain `number`, or a Sanity
 * keyed-segment object `{ _key, _index }`).
 *
 * This exists because a value inside a bare `string[]` field (no wrapping
 * object — e.g. `siteOptions.introText`) reaches the filter with a path like
 * `["introText", 0]`: the true last segment is the numeric index, not the
 * field name. Matching only the raw last segment silently excludes nothing
 * for such fields — see the "Array-index blind spot" note in the file
 * header. Fields that are arrays of *objects* never hit this path because
 * their leaf value's last segment is already the object's own property name
 * (e.g. `["footerLinks", 0, "href"]`).
 *
 * @param resultPath - The `resultPath` array supplied to a `FilterDefault` callback.
 * @returns The nearest string segment walking backward, or `undefined` if
 *   the path is empty or contains only numeric/keyed segments.
 */
function lastStringSegment(resultPath: ContentSourceMapParsedPath): string | undefined {
  for (let i = resultPath.length - 1; i >= 0; i--) {
    const segment = resultPath[i];
    if (typeof segment === "string") return segment;
    // `number` (array index) or `{ _key, _index }` (Sanity keyed array
    // segment) — neither is a field name, keep walking back.
  }
  return undefined;
}

/**
 * Builds the `filter` function passed to `@sanity/client`'s `stega` option.
 * Excludes every field in `EXCLUDED_RESULT_KEYS` (matched on the nearest
 * string segment of `resultPath`, walking back past any array index — see
 * `lastStringSegment()`) and defers to the client's own `filterDefault` for
 * everything else — this keeps `@sanity/client`'s built-in heuristics (e.g.
 * skipping non-text-shaped values) intact rather than replacing them
 * outright.
 */
function buildStegaFilter(): FilterDefault {
  return (props) => {
    const key = lastStringSegment(props.resultPath);
    if (key !== undefined && EXCLUDED_RESULT_KEYS.has(key)) {
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
