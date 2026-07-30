/**
 * data/queries.ts — GROQ queries for the server-only Sanity data layer.
 *
 * Ported VERBATIM from `apps/fe/scripts/utils/queries.ts` — same field
 * names, same aliases, same projections. Aliases matter beyond readability:
 * Sanity's stega encoding (Phase 6) walks the RESULT shape by field path, so
 * renaming an alias here would silently change which fields stega can
 * annotate later. Do not "clean up" aliases during this port.
 *
 * The slice-driven projection is still composed from the slice registry
 * (`data/slices/registry.ts`) exactly like the old file — adding a slice
 * there automatically widens every query that splices in
 * `buildSlicesProjection()`.
 */

import { sliceRegistry } from "./slices/registry";

/**
 * Shared `seo` object projection — every document type carries the same
 * `seo` object (schemaTypes/objects/seo.js: metaDescription, metaKeywords,
 * ogImage). The ogImage alias resolves to the raw CDN URL so consumers
 * never touch a Sanity asset reference. Spliced into the site-options,
 * home, detail, contact, and imprint queries below.
 */
const seoProjection = `seo {
      metaDescription,
      metaKeywords,
      "ogImage": ogImage.asset->url
    }`;

/** Global / site options singleton. Verbatim port of the old
 *  `siteOptionsQuery`, plus the Meta-tab favicon/ogImage fields and the
 *  typed seo projection. */
export const siteOptionsQuery = `
  *[_type == "siteOptions"][0] {
    _id,
    name,
    introText,
    language,
    "favicon": favicon.asset->url,
    "faviconDark": faviconDark.asset->url,
    "ogImage": ogImage.asset->url,
    ${seoProjection},
    footerLinks[] {
      _type,
      _type == "externalLink" => {
        title,
        href,
        blank
      },
      _type == "internalLink" => {
        "title": coalesce(title, linkTarget->title),
        "href": select(
          linkTarget->_type == "pageHome" => "/",
          linkTarget->_type == "pageContact" => "/" + coalesce(linkTarget->slug.current, "contact"),
          linkTarget->_type == "pageImprint" => "/" + coalesce(linkTarget->slug.current, "imprint"),
          defined(linkTarget->slug.current) => "/" + linkTarget->slug.current,
          ""
        ),
        "blank": false
      }
    }
  }`;

/**
 * Build the conditional slice projection used inside every page/detail query
 * that carries a `slices[]` array. Each slice contributes a
 * `_type == "<name>" => { ...fields }` clause derived from its registered
 * `query` field. Exported (unlike the old file's private helper) because
 * both `allDetailsQuery` and `detailBySlugQuery` below need to splice it in.
 */
export function buildSlicesProjection(): string {
  const conditionals = sliceRegistry
    .map((s) => `_type == "${s.name}" => {\n${s.query.trim()}\n}`)
    .join(",\n");
  const body = conditionals
    ? `_type,
  _key,
  ${conditionals}`
    : `_type,
  _key`;
  return `slices[] {
  ${body}
}`;
}

const slicesProjection = buildSlicesProjection();

/**
 * Home page query — pulls the singleton plus its taxonomy list (title only,
 * used for the nav filters) and the flat grid placements. Grid Details carry
 * `allowRouting` so the caller can decide whether to route, and
 * `stylizedTitle` (raw Portable Text blocks — Phase 3 renders these) for the
 * title. Deliberately does NOT include the slices projection — grid items
 * only need cover art, not a Detail's full slice body; `detailBySlugQuery`
 * fetches slices for the one Detail actually being routed to.
 */
export const pageHomeQuery = `
  *[_type == "pageHome"][0] {
    _id,
    title,
    ${seoProjection},
    "taxonomies": taxonomies[]->{
      _id,
      title
    },
    "grid": grid[]->{
      _id,
      title,
      stylizedTitle,
      allowRouting,
      "slug": slug.current,
      "coverImage": coverImage.asset->url,
      "coverVideo": coverVideo.asset->url,
      coverSize,
      "taxonomy": taxonomy->{_id, title}
    }
  }`;

/**
 * All Details, including their slices — verbatim port of the old
 * `allDetailsQuery`. Kept for parity with the old pipeline (and any future
 * caller that genuinely wants every Detail's full body in one round trip),
 * but `content.ts`'s per-request `loadRouteContent()` uses the cheaper
 * `detailBySlugQuery` below instead of fetching + filtering this one.
 */
export const allDetailsQuery = `
  *[_type == "detail"] | order(title asc) {
    _id,
    title,
    "slug": slug.current,
    "coverImage": coverImage.asset->url,
    "coverVideo": coverVideo.asset->url,
    coverSize,
    "taxonomy": taxonomy->{_id, title},
    ${slicesProjection}
  }`;

/**
 * Single Detail by slug, full body — filtered server-side to one document
 * instead of fetching every Detail and finding it in memory.
 *
 * IMPORTANT divergence guard: the old pipeline never gave a Detail a route
 * just because the document exists with a slug — `sanity-content.ts` only
 * ever pushed a `detailPages` entry for a Detail it encountered while
 * walking `pageHome.grid` (the id→slices lookup via `allDetailsQuery` was
 * just an optimization to avoid re-querying slices per grid item; grid
 * placement was always the actual routing gate). A Detail document that
 * exists but was never added to the home grid got NO page in the old site.
 * The `_id in *[_type == "pageHome"][0].grid[]._ref` clause below
 * reproduces that gate at the query level — verified against production
 * data during this port: 28 `detail` documents exist, but only 27 are
 * reachable through `pageHome.grid`, and the 28th must 404, not resolve.
 */
export const detailBySlugQuery = `
  *[
    _type == "detail" &&
    slug.current == $slug &&
    _id in *[_type == "pageHome"][0].grid[]._ref
  ][0] {
    _id,
    title,
    "slug": slug.current,
    "coverImage": coverImage.asset->url,
    "coverVideo": coverVideo.asset->url,
    coverSize,
    allowRouting,
    stylizedTitle,
    ${seoProjection},
    "taxonomy": taxonomy->{_id, title},
    ${slicesProjection}
  }`;

/** All Taxonomies (title only — Taxonomies no longer store a Details array). */
export const allTaxonomiesQuery = `
  *[_type == "taxonomy"] | order(title asc) {
    _id,
    title
  }`;

/**
 * Shared rich-text body projection for singleton pages that consist of a
 * single Portable Text field (Contact, Imprint). Spreads each block as-is
 * except for `markDefs`: internal link defs get an extra `href` resolved
 * from the dereferenced target's type + slug, so the client-side renderer
 * never has to resolve a raw Sanity reference at render time. External link
 * defs already store `href`/`blank` directly, so the leading `...` spread
 * carries them through untouched. This GROQ-side href resolution is
 * renderer-independent — it ports as-is regardless of whether the consumer
 * is the old Mustache pipeline or Phase 3's `@portabletext/vue` component.
 */
const richBodyProjection = `
  body[] {
    ...,
    markDefs[] {
      ...,
      _type == "internalLink" => {
        "href": select(
          linkTarget->_type == "pageHome" => "/",
          linkTarget->_type == "pageContact" => "/" + coalesce(linkTarget->slug.current, "contact"),
          linkTarget->_type == "pageImprint" => "/" + coalesce(linkTarget->slug.current, "imprint"),
          defined(linkTarget->slug.current) => "/" + linkTarget->slug.current,
          "/"
        )
      }
    }
  }`;

/** Contact singleton — title/slug plus a rich-text body (see richBodyProjection). */
export const pageContactQuery = `
  *[_type == "pageContact"][0] {
    _id,
    title,
    "slug": slug.current,
    ${seoProjection},
    ${richBodyProjection}
  }`;

/** Imprint singleton — title/slug plus a rich-text body (see richBodyProjection). */
export const pageImprintQuery = `
  *[_type == "pageImprint"][0] {
    _id,
    title,
    "slug": slug.current,
    ${seoProjection},
    ${richBodyProjection}
  }`;
