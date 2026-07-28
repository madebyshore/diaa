/**
 * Shared helpers for slice resolvers — keeps each slice file focused on
 * its own field shape rather than re-implementing the same plumbing.
 */

import { renderPortableText } from "../utils/portable-text";
import type { PortableTextBlock } from "../utils/portable-text";
import type {
  CtaRaw,
  CtaResolved,
  PictureData,
  SliceMedia,
  GlobalsDoc,
  LocationResolved,
} from "./types";

/**
 * Convert newlines in a `pt::text()` string into `<br>` tags so line
 * breaks survive HTML rendering. Triple-mustache the result so the tags
 * are not escaped.
 */
export function preserveLineBreaks(text: string): string {
  return text.replace(/\n/g, "<br>");
}

/**
 * GROQ projection for a `richText` field that resolves link annotations.
 * Spreads every block as-is but rewrites `markDefs` so internal links
 * arrive with a ready-to-use `href` (mirroring the footerLinks projection
 * in scripts/utils/queries.ts); external links already carry href/blank
 * natively. Interpolate into a slice `query` in place of the bare field
 * name — the portable-text renderer turns the resolved defs into
 * `<a class="rt-link">` output.
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
 * Resolve a raw CTA (title + first link) into a flat shape Mustache can
 * render. Returns null if the CTA is missing or has no link target.
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
    blank:
      raw.link._type === "externalLink" ? (raw.link.blank ?? false) : false,
  };
}

/**
 * Convert a Sanity asset URL (or local path) to PictureData. Returns null
 * when the URL is absent so templates can `{{#image}}…{{/image}}` to omit
 * the markup entirely.
 *
 * Emits a single Sanity URL with `auto=format&fm=webp&w=3000` so the shared
 * `{{> picture}}` partial renders one `<img>` instead of multi-format
 * `<source>` srcsets — keeps Sanity bandwidth usage in check.
 */
export function pictureFromUrl(
  url: string | undefined | null,
  alt: string,
  index: number,
  width = 3000,
  height = 4000
): PictureData | null {
  if (!url) return null;
  const baseUrl = url.split("?")[0] ?? url;
  return {
    src: `${baseUrl}?auto=format&fm=webp&w=${width}`,
    alt,
    width,
    height,
    isFirst: index === 0,
  };
}

/**
 * Build slice media: the poster `PictureData` from `imageUrl` plus the optional
 * MP4 `videoUrl`. Returns null when there is no image (slices require one, so
 * this only nulls out on a misconfigured doc). When `videoUrl` is present the
 * shared `{{> picture}}` partial renders a looping autoplay `<video>` with the
 * image as poster; otherwise it renders the plain `<img>`. The video fields sit
 * on the same object `{{#image}}` enters, so the partial finds them. Mirrors the
 * Detail cover's `coverMedia()` (sanity-content.ts) for slices.
 */
export function mediaFromUrls(
  imageUrl: string | undefined | null,
  videoUrl: string | undefined | null,
  alt: string,
  index: number,
  width = 3000
): SliceMedia | null {
  const pic = pictureFromUrl(imageUrl, alt, index, width);
  if (!pic) return null;
  return { ...pic, hasVideo: !!videoUrl, video: videoUrl ?? "" };
}

/** Raw shape of one `imageWithCaption` array item as projected by the slice
 *  queries: `{ "url": image.asset->url, caption }`. */
export interface CaptionedImageRaw {
  url?: string | null;
  caption?: PortableTextBlock[] | null;
}

/** Captioned image flattened for templates — picture data + rendered caption. */
export interface CaptionedImage {
  image: PictureData | null;
  captionHtml: string;
  hasCaption: boolean;
}

/**
 * Resolve an `imageWithCaption[]` array into template-ready entries. Used by
 * the 2Up and 3Up slices, which share the same `{ url, caption }` item shape.
 * Captions are rendered as inline Portable Text (decorator marks + `<br>`s).
 */
export function resolveCaptionedImages(
  images: CaptionedImageRaw[] | null | undefined,
  width = 3000
): CaptionedImage[] {
  return (images ?? []).map((im, i) => {
    const captionHtml = renderPortableText(im.caption);
    return {
      image: pictureFromUrl(im.url, "", i, width),
      captionHtml,
      hasCaption: captionHtml.length > 0,
    };
  });
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

/** Re-export so slice files can pull everything from one helpers module. */
export { renderPortableText };
