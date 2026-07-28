/**
 * GROQ queries for build-time content fetching.
 *
 * The slice-driven page query is composed from the slice registry — adding
 * a slice in `apps/fe/scripts/slices/` automatically widens the slice
 * projection so its fields are fetched.
 */

import { sliceRegistry } from "../slices";

/** Global / site options singleton. */
export const siteOptionsQuery = `
  *[_type == "siteOptions"][0] {
    _id,
    name,
    introText,
    language,
    seo,
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
 * Build the conditional slice projection used inside every page query.
 * Each slice contributes a `_type == "<name>" => { ...fields }` clause
 * derived from its registered `query` field.
 */
function buildSlicesProjection(): string {
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
 * `allowRouting` so the template can decide whether to route, and
 * `stylizedTitle` (raw Portable Text blocks) for the rendered title.
 */
export const pageHomeQuery = `
  *[_type == "pageHome"][0] {
    _id,
    title,
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

/** All Details (used for indexing every Detail into a route). */
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
 * from the dereferenced target's type + slug, so `renderPortableText` in
 * `utils/portable-text.ts` never has to resolve a raw Sanity reference at
 * render time. External link defs already store `href`/`blank` directly,
 * so the leading `...` spread carries them through untouched.
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
    ${richBodyProjection}
  }`;

/** Imprint singleton — title/slug plus a rich-text body (see richBodyProjection). */
export const pageImprintQuery = `
  *[_type == "pageImprint"][0] {
    _id,
    title,
    "slug": slug.current,
    ${richBodyProjection}
  }`;
