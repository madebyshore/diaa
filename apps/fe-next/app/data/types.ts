/**
 * data/types.ts — shared Portable Text shapes used across the data layer.
 *
 * The old `apps/fe/scripts/utils/portable-text.ts` pre-rendered these blocks
 * to HTML strings at build time (see that file for the renderer this repo
 * used to ship). This Nuxt port does NOT do that: raw Portable Text block
 * arrays pass through `loadRouteContent()`/`loadSiteOptions()` untouched, all
 * the way to the client, where Phase 3's `@portabletext/vue`-based
 * `RichText.vue` renders them (decorators, links, line breaks) and Phase 6's
 * stega encoding can annotate individual string fields. Keeping blocks raw
 * end-to-end is what makes both of those possible — a build-time HTML string
 * can't carry stega markers or be walked field-by-field by the editor.
 *
 * The shape below is intentionally loose (`[key: string]: unknown` escape
 * hatches) rather than a tight replica of the old renderer's narrower
 * interface — the old renderer only had to support what it rendered
 * (strong/em/underline/code/serif/mono decorators, link marks), but
 * `@portabletext/vue` and Sanity's Presentation overlays both expect the
 * full, unconstrained Portable Text shape to pass through untouched.
 */

/** A single inline span within a Portable Text block. */
export interface PortableTextSpan {
  _type: string;
  _key?: string;
  text?: string;
  marks?: string[];
  [key: string]: unknown;
}

/** A single Portable Text block (or an inline object/annotation target). */
export interface PortableTextBlock {
  _type: string;
  _key?: string;
  style?: string;
  children?: PortableTextSpan[];
  markDefs?: Array<{ _key: string; _type: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
