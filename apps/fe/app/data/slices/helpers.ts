/**
 * Shared helpers for slice resolvers — keeps each slice file focused on its
 * own field shape rather than re-implementing the same plumbing.
 *
 * Ported from `apps/fe/scripts/slices/helpers.ts`. The HTML-rendering
 * helpers (`renderPortableText`, `preserveLineBreaks`) are gone — Phase 3
 * renders Portable Text client-side with `@portabletext/vue`, so this layer
 * only needs to shape data, never produce markup. `hasPortableTextContent()`
 * below replaces the old `renderPortableText(x).length > 0` idiom for the
 * `has*` boolean flags that templates used to gate optional sections on.
 */

import { pictureFromUrl } from "../image-url";
import type { MediaData, PictureData } from "../image-url";
import type { PortableTextBlock } from "../types";
import type { CtaRaw, CtaResolved, GlobalsDoc, LocationResolved } from "./types";

/**
 * GROQ projection for a rich-text field that resolves link annotations.
 * Spreads every block as-is but rewrites `markDefs` so internal links
 * arrive with a ready-to-use `href` (mirroring the footerLinks projection in
 * `data/queries.ts`); external links already carry href/blank natively.
 * Interpolate into a slice `query` in place of the bare field name — Phase
 * 3's `RichText.vue` renders the resolved defs as `<a>` without ever having
 * to dereference a raw Sanity reference at render time.
 */
export function richTextQuery(field: string): string {
  return `${field}[] {
    ...,
    markDefs[] {
      ...,
      _type == "internalLink" => {
        "href": select(
          linkTarget->_type == "pageHome" => "/",
          linkTarget->_type == "pageContact" => "/" + coalesce(linkTarget->slug.current, "contact"),
          linkTarget->_type == "pageImprint" => "/" + coalesce(linkTarget->slug.current, "imprint"),
          defined(linkTarget->slug.current) => "/" + linkTarget->slug.current,
          ""
        )
      }
    }
  }`;
}

/**
 * Resolve a raw CTA (title + first link) into a flat shape components can
 * render directly. Returns null if the CTA is missing or has no link
 * target.
 *
 * The pageHome singleton carries the sentinel slug "__home__" which is
 * mapped to "/" so internal links to the home page resolve correctly.
 */
export function resolveCta(raw: CtaRaw | undefined): CtaResolved | null {
  if (!raw || !raw.link) return null;
  let href = raw.link.href ?? "";
  if (!href) return null;
  if (href === "__home__") href = "/";
  return {
    title: raw.title ?? raw.link.title ?? "",
    href,
    blank: raw.link._type === "externalLink" ? (raw.link.blank ?? false) : false,
  };
}

/**
 * Build slice media: the poster `PictureData` from `imageUrl` plus the
 * optional MP4 `videoUrl`. Returns null when there is no image (slices
 * require one, so this only nulls out on a misconfigured doc). When
 * `videoUrl` is present the consuming component renders a looping autoplay
 * `<video>` with the image as poster; otherwise it renders the plain
 * `<img>`. Mirrors the Detail cover's `coverMedia()` (data/content.ts) for
 * slices.
 */
export function mediaFromUrls(
  imageUrl: string | undefined | null,
  videoUrl: string | undefined | null,
  alt: string,
  index: number,
  width = 3000,
  lqip?: string | null,
): MediaData | null {
  const pic = pictureFromUrl(imageUrl, alt, index, width, undefined, lqip);
  if (!pic) return null;
  return { ...pic, hasVideo: !!videoUrl, video: videoUrl ?? "" };
}

/** Raw shape of one `imageWithCaption` array item as projected by the slice
 *  queries: `{ "url": image.asset->url, "lqip": image.asset->metadata.lqip,
 *  caption }`. */
export interface CaptionedImageRaw {
  url?: string | null;
  lqip?: string | null;
  caption?: PortableTextBlock[] | null;
}

/**
 * Captioned image flattened for components — picture data plus the RAW
 * caption blocks (renamed contract: the old `captionHtml` string is now
 * `caption: PortableTextBlock[] | null`). Phase 3's 2Up/3Up slice
 * components render `caption` with `<RichText>` when `hasCaption` is true.
 */
export interface CaptionedImage {
  image: PictureData | null;
  caption: PortableTextBlock[] | null;
  hasCaption: boolean;
}

/**
 * Resolve an `imageWithCaption[]` array into component-ready entries. Used
 * by the 2Up and 3Up slices, which share the same `{ url, caption }` item
 * shape.
 */
export function resolveCaptionedImages(
  images: CaptionedImageRaw[] | null | undefined,
  width = 3000,
): CaptionedImage[] {
  return (images ?? []).map((im, i) => ({
    image: pictureFromUrl(im.url, "", i, width, undefined, im.lqip),
    caption: im.caption ?? null,
    hasCaption: hasPortableTextContent(im.caption),
  }));
}

/**
 * Resolve the globals singleton's `globalLocations` list into the shape
 * used by every locations-aware slice (intro, global offices, etc.).
 */
export function resolveLocations(globals: GlobalsDoc | null): LocationResolved[] {
  return (globals?.globalLocations ?? []).map((loc, i) => ({
    city: loc.city ?? "",
    country: loc.country ?? "",
    timezoneCode: loc.timezoneCode ?? "",
    index: i,
    number: String(i),
  }));
}

/**
 * True when a Portable Text block array contains at least one non-whitespace
 * character of visible span text. Replaces the old
 * `renderPortableText(blocks).length > 0` check used to compute `has*` flags
 * (e.g. `hasCaption`, `hasTitle`, `hasText`) — since this layer no longer
 * renders HTML, it answers the same "is there anything here to show" question
 * by walking the raw blocks directly instead.
 */
export function hasPortableTextContent(
  blocks: PortableTextBlock[] | null | undefined,
): boolean {
  if (!blocks || blocks.length === 0) return false;
  return blocks.some((b) =>
    (b.children ?? []).some(
      (c) => typeof c.text === "string" && c.text.trim().length > 0,
    ),
  );
}
