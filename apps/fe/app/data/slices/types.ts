/**
 * Shared types for the slice registry.
 *
 * A "slice" is one entry in a Sanity page's `slices[]` array. Every slice
 * type the site can render is registered as a `SliceDefinition` so adding a
 * new slice becomes a recipe:
 *   1. Define the schema in `apps/be/schemaTypes/slices/<slice>.js`
 *   2. Build the Vue component in `app/components/slices/<Slice>.vue`
 *      (Phase 3) that dispatches on `_type` via `<SliceRenderer>`
 *   3. Register a `SliceDefinition` here in `app/data/slices/`
 *
 * Ported from `apps/fe/scripts/slices/types.ts` with one deliberate shape
 * change: there is no `template` field. The old pipeline used `template` to
 * pick a Mustache partial filename at build time; Phase 3's
 * `<SliceRenderer>` instead dispatches on the resolved object's `_type` to
 * pick a Vue component, so the template-name indirection has nothing to do.
 *
 * Also NOT ported: the old `media?: (raw) => Array<string | null>` field and
 * its `collectSliceMedia()` consumer. That collected slice image URLs into a
 * GPU texture manifest for a WebGPU rendering path this project doesn't
 * have — `apps/fe`'s CLAUDE.md is explicit that rendering is DOM-only, no
 * canvas, no GPU chunk — and grepping the old pipeline shows
 * `collectSliceMedia()` was never actually called from `sanity-content.ts`.
 * It was dead code; this port doesn't carry it forward.
 */

import type { MediaData, PictureData } from "../image-url";
import type { PortableTextBlock } from "../types";

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

/** CTA flattened for components — `{ title, href, blank }`. */
export interface CtaResolved {
  title: string;
  href: string;
  blank: boolean;
}

/** A single global office location resolved for components. */
export interface LocationResolved {
  city: string;
  country: string;
  timezoneCode: string;
  index: number;
  number: string;
}

/** Shape of the globals singleton fetched at request time. */
export interface GlobalsDoc {
  globalLocations?: Array<{
    city?: string;
    country?: string;
    timezoneCode?: string;
  }>;
}

/** Shape of the clients singleton fetched at request time. */
export interface ClientsDoc {
  list?: string[];
}

/**
 * Per-request context passed to every slice resolver. Includes singletons
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
 * A registered slice. The registry uses `name` to match Sanity's `_type`,
 * `query` to project this slice's fields inside the page/detail query, and
 * `resolve` to turn raw Sanity data into the shape Phase 3's Vue component
 * for this slice expects. No `template` field — see file header.
 */
export interface SliceDefinition<TRaw extends RawSlice = RawSlice, TResolved = unknown> {
  /** Sanity `_type` identifier, e.g. `"sliceImage"`. Also the discriminant
   *  Phase 3's `<SliceRenderer>` switches on to pick a Vue component. */
  name: string;
  /**
   * GROQ projection fragment for this slice — `{ field: ... }` body only.
   * `buildSlicesProjection()` (data/queries.ts) splices this in inside a
   * `_type == "<name>" => { ... }` conditional. Do not include the
   * `_type` / `_key` fields; they are always projected at the slice level.
   */
  query: string;
  /** Transform raw Sanity data into the object passed to the slice's
   *  component. Any field that used to render to an HTML string now passes
   *  through as raw Portable Text blocks — each slice module documents its
   *  own renamed fields and the Phase 3 consumer contract. */
  resolve: (raw: TRaw, ctx: SliceContext) => TResolved;
}

/** Re-exported so slice modules can pull every shared type from one place. */
export type { PortableTextBlock, PictureData, MediaData };
