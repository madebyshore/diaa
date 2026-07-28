/**
 * Shared types for the slice registry.
 *
 * A "slice" is one entry in a Sanity page's `slices[]` array. Every slice
 * type that the site can render is registered as a `SliceDefinition` so
 * adding a new slice in Sanity becomes a three-step recipe:
 *   1. Define the schema in `apps/be/schemaTypes/slices/<slice>.js`
 *   2. Drop a Mustache partial in `apps/fe/src/routes/partials/slices/<slice>.html`
 *   3. Register a `SliceDefinition` here in `apps/fe/scripts/slices/`
 *
 * The page query, the build-time renderer, and the page templates are
 * all driven from the registry — they don't know about specific slices.
 */

import type { PortableTextBlock } from "../utils/portable-text";

/**
 * Image data passed to Mustache templates — matches the shared
 * `apps/fe/src/routes/partials/picture.html` partial. The slice helpers'
 * `pictureFromUrl()` builder emits responsive srcsets via Sanity URL
 * transform params so a slice's `{{> picture}}` renders an AVIF/WebP/JPEG
 * `<picture>` element identical to local-image pages.
 */
export interface PictureData {
  src: string;
  alt: string;
  width: number;
  height: number;
  isFirst: boolean;
}

/**
 * PictureData augmented with the optional-video fields the shared
 * `{{> picture}}` partial reads (`hasVideo`, `video`). Mirrors the Detail
 * cover's `CoverMedia` shape so a slice image can render a looping autoplay
 * `<video>` (with the image as poster) instead of an `<img>`. These live on the
 * same object the template enters via `{{#image}}`, so the partial finds every
 * field it needs.
 */
export interface SliceMedia extends PictureData {
  /** True when a video file was uploaded — the partial renders `<video>`. */
  hasVideo: boolean;
  /** Raw Sanity file-asset URL for the MP4, or "" when absent. */
  video: string;
}

/** Resolved CTA link — either an internal slug or an external URL. */
export interface CtaLinkRaw {
  _type: "internalLink" | "externalLink";
  title?: string;
  href?: string;
  blank?: boolean;
}

/** A CTA as it lives on a slice document (title + first link entry). */
export interface CtaRaw {
  title?: string;
  link?: CtaLinkRaw;
}

/** CTA flattened for templates — `{ title, href, blank }`. */
export interface CtaResolved {
  title: string;
  href: string;
  blank: boolean;
}

/** A single global office location resolved for templates. */
export interface LocationResolved {
  city: string;
  country: string;
  timezoneCode: string;
  index: number;
  number: string;
}

/** Shape of the globals singleton fetched at build time. */
export interface GlobalsDoc {
  globalLocations?: Array<{
    city?: string;
    country?: string;
    timezoneCode?: string;
  }>;
}

/** Shape of the clients singleton fetched at build time. */
export interface ClientsDoc {
  list?: string[];
}

/**
 * Build-time context passed to every slice resolver. Includes singletons
 * fetched alongside the page data plus pre-resolved helper outputs that
 * many slices want (e.g. global locations).
 */
export interface SliceContext {
  globals: GlobalsDoc | null;
  clients: ClientsDoc | null;
  /** Locations pre-resolved with index + display number. */
  locations: LocationResolved[];
}

/** A single slice as it comes back from GROQ — `_type` discriminates. */
export interface RawSlice {
  _type: string;
  _key?: string;
  [field: string]: unknown;
}

/**
 * A registered slice. The renderer uses `name` to match Sanity's `_type`,
 * `query` to project this slice's fields inside the page query, `resolve`
 * to turn raw Sanity data into template data, and `template` to find the
 * Mustache partial it should be rendered with.
 */
export interface SliceDefinition<TRaw extends RawSlice = RawSlice, TResolved = unknown> {
  /** Sanity `_type` identifier, e.g. `"sliceHero"`. */
  name: string;
  /**
   * GROQ projection fragment for this slice — `{ field: ... }` body only.
   * The page query splices this in inside a `_type == "<name>" => { ... }`
   * conditional. Do not include the `_type` / `_key` fields; they are
   * always projected at the slice level.
   */
  query: string;
  /**
   * Mustache partial filename (without extension) inside
   * `apps/fe/src/routes/partials/slices/`. The renderer loads this and
   * renders it with the resolver's output.
   */
  template: string;
  /** Transform raw Sanity data into the object passed to the template. */
  resolve: (raw: TRaw, ctx: SliceContext) => TResolved;
  /**
   * Ordered raw asset URLs this slice renders as `_g` GPU planes — must match
   * the DOM order its partial emits `{{> picture}}` figures (nulls allowed for
   * absent images; they're filtered when building the route media map).
   * `sanity-content` walks these to pump each slice's textures into
   * `media[detailUrl]`. Omit for image-less slices (e.g. Text).
   */
  media?: (raw: TRaw) => Array<string | null>;
}

/** Helper alias for re-exporting shared text type from one place. */
export type { PortableTextBlock };
