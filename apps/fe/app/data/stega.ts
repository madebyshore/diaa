/**
 * data/stega.ts — Phase 6: the stega filter used by the drafts-perspective
 * preview render (see `data/client.ts`'s "drafts" branch, threaded through
 * `data/content.ts`'s loaders and called from `plugins/content.server.ts` +
 * `server-preview/routes/preview/refresh.post.ts`).
 *
 * Ported near-verbatim from the PROVEN `preview`-branch implementation
 * (`apps/fe/scripts/preview/stega.ts`, fixed at commit `dcbf37c`) — same
 * exclusion set, same array-index blind-spot fix, same rationale. File-path
 * references inside the comments below have been updated to point at where
 * the equivalent Nuxt files actually live (`data/queries.ts`,
 * `data/slices/*.ts`, `data/content.ts`) instead of the old Vite build's
 * `scripts/*` tree — the UNDERLYING reasoning (why each field is dangerous
 * to stega-encode, the array-index bug, the intro-hang mechanism) is
 * unchanged and preserved in full; only the paths it points at were stale.
 *
 * `@sanity/client`'s stega encoder walks every string leaf in a GROQ result
 * and — when enabled — invisibly embeds zero-width metadata into it so
 * Sanity's Presentation tool can map rendered text back to the Studio field
 * that produced it. That's exactly what we want for visible copy (titles,
 * portable-text bodies), but it is actively harmful for any string that ends
 * up as a route key, a filename, a URL, an HTML attribute value, or a value
 * whose length/uniqueness turns a single encode into a page-wide blast
 * radius (see `title`/`name` below): a stega-tagged image URL 404s, a
 * stega-tagged slug never matches a route this app actually serves, and a
 * stega-tagged `<title>` or intro phrase balloons a handful of visible
 * characters into tens of thousands of invisible ones (see the intro-hang
 * note below).
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
 * happened to `introText`/`introPhrases` in the original build — see the
 * intro-hang note below.
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
 * documented) — this is INHERITED rationale from the original vanilla-TS
 * SPA build; the specific file paths it names (`Intro.setRandomPhrase()`,
 * `Application.init()`) describe THAT implementation, not this Nuxt app's
 * own `composables/useBoot.ts` GSAP intro timeline. It is preserved here
 * verbatim because the underlying mechanism is about how browsers handle
 * dense zero-width-character runs in `textContent`/layout generally, not
 * about any one boot implementation — the same class of bug is fully
 * capable of recurring in this app's own intro phrase rendering if this
 * field is ever accidentally left un-excluded:
 *
 * `Intro.setRandomPhrase()` (apps/fe/src/engine/boot/intro.ts, the ORIGINAL
 * build) read the `<script class="intro__phrases">` JSON payload injected at
 * build time, picked one phrase, and wrote it straight into
 * `.intro__text.textContent` — no per-character animation. The hang wasn't
 * in JS logic: `Application.init()` `await`ed `intro.play()` in boot phase 4
 * *before* phase 5 wired up page entrance + interactivity, so anything that
 * stalled `play()` stalled the entire SPA becoming interactive. A
 * stega-tagged phrase turns a few words into a single string carrying tens
 * of thousands of invisible zero-width characters (ZWSP/ZWNJ/ZWJ/word-
 * joiner). Setting `textContent` to that string forces the browser to run
 * its line-breaking/bidi/grapheme-cluster analysis over the whole run on
 * first layout — ZWJ in particular is an emoji-sequence-combining hint, and
 * shaping engines are not linear in the presence of dense ZWJ runs. That
 * analysis can block the main thread for seconds to minutes depending on
 * phrase length and browser, well past anything a rAF-driven opacity tween
 * expects, so `play()` either takes minutes to resolve or the tab appears
 * hung while it's computing — either way the app never becomes interactive
 * and the Presentation iframe looks dead.
 *
 * ---------------------------------------------------------------------------
 * Exclusion list:
 *
 *   slug         — `detailBySlugQuery`/`pageContactQuery`/`pageImprintQuery`
 *                  slugs (data/queries.ts). Becomes the route path
 *                  (`data/content.ts`'s `loadRouteContent()` param) and a
 *                  prerendered-route key.
 *   href         — `siteOptionsQuery.footerLinks[].href`, and every
 *                  internalLink markDef produced by the rich-text/link
 *                  projection helpers (data/queries.ts,
 *                  data/slices/helpers.ts) — consumed by Contact/Imprint
 *                  bodies and sliceText/sliceImageWithText. Rendered as an
 *                  `<a href>` attribute.
 *   image        — sliceImage.ts / sliceImageWithText.ts:
 *                  `"image": image.asset->url`. Consumed by
 *                  `data/image-url.ts`'s URL-building helpers, which split
 *                  on "?" — a stega-tagged URL breaks that split and 404s.
 *   video        — sliceImage.ts / sliceImageWithText.ts:
 *                  `"video": video.asset->url`. Same URL-splitting concern
 *                  as `image` above.
 *   coverImage   — `detailBySlugQuery`/home-grid projection's `coverImage`
 *                  (data/queries.ts) → `data/content.ts`'s `coverMedia()`/
 *                  `data/image-url.ts`'s `sanityPicture()`, which also
 *                  splits on "?".
 *   coverVideo   — same query/field family as `coverImage` above.
 *   coverLqip    — `coverImage.asset->metadata.lqip` (data/queries.ts), a
 *                  base64 data-URI blur placeholder rendered as an inline
 *                  `background-image` style by FigureBase.vue. Stega
 *                  characters inside a data URI corrupt the base64 payload
 *                  (broken/blank placeholder), and the value is never
 *                  visible text.
 *   lqip         — the slice-level alias for the same
 *                  `asset->metadata.lqip` projection (sliceImage.ts,
 *                  sliceImageWithText.ts, slice2Up/3Up/slideshow image
 *                  arrays). Same data-URI-in-style-attribute concern as
 *                  `coverLqip`.
 *   url          — the array-item alias used by sliceImageSlideshow.ts
 *                  (`images[]{ "url": asset->url }`), slice2Up.ts and
 *                  slice3Up.ts (`images[]{ "url": image.asset->url,
 *                  caption }`). Consumed by `data/slices/helpers.ts`'s
 *                  URL-building helpers.
 *   introText    — `siteOptionsQuery.introText` (data/queries.ts), a bare
 *                  `string[]` — this is the field `data/content.ts` renames
 *                  to `introPhrases`, ultimately rendered as the intro
 *                  overlay's phrase text. See the intro-hang note above:
 *                  this is the array-of-strings case that needed the
 *                  `lastStringSegment()` fix, not just a set entry.
 *   title        — home-grid/detail titles, taxonomy title,
 *                  pageContact/pageImprintQuery.title, footerLinks[].title,
 *                  slice CTA title (`data/slices/helpers.ts`'s
 *                  `resolveCta()`). Feeds document-`<title>` composition
 *                  ("<siteTitle> - <pageTitle>") on every route and
 *                  `coverMedia()`'s `alt` parameter — the single biggest
 *                  contributor to bloat if left encoded (duplicated across
 *                  every generated page's `<title>` and every cover image's
 *                  `alt`). KNOWN TRADEOFF: a Detail/grid item's *visible*
 *                  heading normally renders via `stylizedTitle` (kept
 *                  encoded, see below) with plain `title` only as the
 *                  escaped-text fallback when no stylizedTitle is authored —
 *                  that fallback heading, taxonomy nav-filter button labels
 *                  (no stylizedTitle alternative exists for taxonomies), and
 *                  slice CTA button labels lose Presentation click-to-edit as
 *                  a result. Accepted: correctness (no page-breaking bloat,
 *                  no intro hang) outweighs inline-editing convenience for
 *                  these specific plain-text fallbacks; editors can still
 *                  edit them directly in the Studio.
 *   name         — `siteOptionsQuery.name` → `data/content.ts`'s
 *                  `siteTitle`. Same `<title>`/OG-meta duplication-across-
 *                  every-page concern as `title` above. Never rendered as
 *                  visible body copy (the nav wordmark is static markup, not
 *                  CMS-driven), so this one has no click-to-edit tradeoff.
 *
 * Explicitly NOT excluded (stays stega-encoded, by design):
 *   stylizedTitle, text, caption, quoteAuthor — all rendered as visible
 *   Portable Text / plain body copy with no attribute or routing role, via
 *   `components/content/RichText.vue` (`@portabletext/vue`). Zero-width
 *   stega characters survive into the rendered DOM untouched — which is
 *   exactly what Presentation's click-to-edit overlays need to find and
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
  "coverLqip",
  "lqip",
  "url",
  "introText",
  "title",
  "name",
  // Becomes a CSS class token (`home__image-slot--${coverSize}`,
  // `detail__cover-inner--${coverSize}`, `home__text-gpu-figure--…`) — a
  // stega-tagged value would break every variant-class selector match, so
  // no figure would ever get its size rules on preview builds.
  "coverSize",
  // Slice variant tokens, same failure mode as `coverSize`: `layout` becomes
  // `slice-2up--${layout}` / `slice-3up--${layout}` and is compared exactly
  // (`layout === "open"`) to decide whether per-image ratios are emitted;
  // `aspect` is matched exactly by the Image slice resolver ("open-v",
  // "4x3", …) to pick its `--ar-*` / `--c*` classes. A stega-tagged value
  // would miss every one of those matches.
  "layout",
  "aspect",
  // SEO/meta fields (composables/usePageSeo.ts). None of these ever render
  // as visible page text — they land in <head> attribute values, where
  // stega's zero-width characters would corrupt the emitted markup:
  // `favicon`/`faviconDark`/`ogImage` are CDN URLs (a stega-tagged URL 404s
  // in the tab icon / social scraper); `metaDescription`/`metaKeywords`
  // become <meta> content attributes (`metaKeywords` is a bare string[] —
  // covered by lastStringSegment()'s array-index handling, see the
  // blind-spot note above); `language` becomes the <html lang> attribute.
  "favicon",
  "faviconDark",
  "ogImage",
  "metaDescription",
  "metaKeywords",
  "language",
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
 * Hard-fails FAST when `studioUrl` is empty, before any Sanity client is
 * constructed or fetch attempted. Lesson from the original preview build
 * (see plan doc reference `4ae9ff8`): an empty `studioUrl` passes straight
 * through `createClient({ stega: { enabled: true, studioUrl: "" } })`
 * without complaint — `@sanity/client` doesn't validate it at construction
 * time — and only fails LATER, mid-fetch, deep inside the stega-encoding
 * pass. That failure mode is easy to miss (it degrades into empty/partial
 * renders rather than a loud startup error), so every caller that resolves
 * `studioUrl` from `SANITY_STUDIO_URL` (`plugins/content.server.ts`,
 * `server-preview/routes/preview/refresh.post.ts`) calls this FIRST, rather
 * than trusting the client library to catch it.
 */
export function requireStudioUrl(studioUrl: string | undefined): string {
  if (!studioUrl) {
    throw new Error(
      "[preview] SANITY_STUDIO_URL is required to serve drafts/preview content — set it " +
        "(e.g. http://localhost:3333 in local dev) before enabling preview. " +
        "An empty value would otherwise pass client construction silently and only fail " +
        "later, mid-fetch, as an empty/partial render.",
    );
  }
  return studioUrl;
}

/**
 * Builds the `StegaConfig` passed to `getSanityClient("drafts", config,
 * stega)` (see `data/client.ts`) for the drafts preview render. `studioUrl`
 * should already have passed through `requireStudioUrl()` — this function
 * doesn't re-validate it, to keep the hard-fail point a single, obvious call
 * site per caller rather than duplicated defensive checks.
 *
 * CLICK-TO-EDIT IS DELIBERATELY DISABLED (2026-07): `enabled: false` below
 * switches off the zero-width stega encoding entirely, which removes
 * Presentation's click-to-edit overlays — with no encoded markers in the
 * rendered text, `@sanity/visual-editing`'s overlay controller finds no
 * targets to draw. Everything else about preview survives unchanged: the
 * drafts perspective, the live refresh-on-save flow, and the iframe
 * navigation sync all run through `enableVisualEditing()`'s channel
 * (plugins-preview/visual-editing.client.ts), none of which depend on stega.
 * This is the single construction point for the drafts StegaConfig, so
 * flipping this one flag governs all three drafts fetch paths
 * (plugins/content.server.ts, server-preview/routes/preview/refresh.post.ts,
 * server/routes/_content/[slug]/index.json.get.ts).
 *
 * To re-enable overlays: set `enabled: true` — the exclusion filter and its
 * documentation above are kept fully intact for exactly that eventuality,
 * and MUST be kept current (absolute rule #3) as long as this flag can be
 * flipped back.
 */
export function buildPreviewStega(studioUrl: string): StegaConfig {
  return {
    enabled: false,
    studioUrl,
    filter: buildStegaFilter(),
  };
}
