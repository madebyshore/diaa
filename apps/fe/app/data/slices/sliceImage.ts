/**
 * Image slice resolver. A single centered image whose column span derives
 * from aspect, with the aspect ratio coming straight from the CMS.
 * `full` overrides everything: a full-bleed 3:2 image at 100vw.
 *
 * Column spans (12-col grid):
 *   4:3 → 6 (the former "4:3 Small" — the only 4:3 size now)
 *   3:4 → one fixed size → 4
 *   full → the whole width (no container padding)
 *
 * Tablet/mobile placement is breakpoint-driven in the styles
 * (styles/slices/_image.module.scss): 4:3 (c6) spans all columns inside the
 * container padding — the former "4:3 Large" treatment — while 3:4 (c4)
 * stays a centered block.
 *
 * The CMS dropdown was narrowed to 3:4 / 4:3. The old Size (Small / Large)
 * field was removed — a stored `size` is simply not queried anymore, so
 * legacy "lg"/"sm"/"mid" documents all render at the single 4:3 span.
 * Legacy aspect values from the wider option set are still normalized here
 * (3:2 → 4:3, 2:3 → 3:4) so previously published documents keep rendering
 * without a content migration.
 *
 * Open aspect ("open-v" / "open-h") is the uncropped variant: the media box
 * takes the uploaded image's own proportions (`ratio`, projected from the
 * asset's dimensions metadata) instead of a fixed 3:4 / 4:3. The two options
 * exist because they occupy different WIDTHS — Vertical reuses the 3:4 span
 * (cols 4), Horizontal the 4:3 span (cols 6) — and in both the height then
 * follows the image. They resolve to `aspect: "open"` + `open: true`; the
 * component feeds `ratio` to CSS as a custom property.
 *
 * `caption` is the optional small caption under the image (same treatment
 * as the 2Up/3Up captions) — raw Portable Text, rendered by `<RichText>`.
 * Full-bleed images never show one, so `hasCaption` is forced false there
 * even if a caption was authored before `full` was switched on.
 */

import { hasPortableTextContent, mediaFromUrls, normalizeRatio } from "./helpers";
import type { MediaData, PortableTextBlock, RawSlice, SliceDefinition } from "./types";

interface RawSliceImage extends RawSlice {
  aspect?: string;
  full?: boolean;
  image?: string | null;
  /** Base64 blur placeholder, projected from `image.asset->metadata.lqip`. */
  lqip?: string | null;
  /** Raw MP4 asset URL, projected from `video.asset->url`. */
  video?: string | null;
  /** Intrinsic width / height of the image asset. */
  ratio?: number | null;
  caption?: PortableTextBlock[] | null;
}

export interface ResolvedSliceImage {
  full: boolean;
  /** Aspect token used for the `--ar-*` class, e.g. "4x3" — or "open" for
   *  the uncropped variants, whose ratio comes from `ratio` instead. */
  aspect: string;
  /** True for the Open aspect variants — the box follows the image's own
   *  proportions rather than a fixed ratio. */
  open: boolean;
  /** Intrinsic width / height of the image (3:4 fallback). Only consumed
   *  when `open`. */
  ratio: number;
  /** Column span used for the `--c*` class (6 / 4, or 12 when full). */
  cols: number;
  /** Poster image + optional video — renders `<video>` when `hasVideo`. */
  image: MediaData | null;
  caption: PortableTextBlock[] | null;
  hasCaption: boolean;
}

const sliceImage: SliceDefinition<RawSliceImage, ResolvedSliceImage> = {
  name: "sliceImage",
  query: `
    aspect,
    full,
    "image": image.asset->url,
    "lqip": image.asset->metadata.lqip,
    "video": video.asset->url,
    "ratio": image.asset->metadata.dimensions.aspectRatio,
    caption
  `,
  resolve: (raw) => {
    const full = !!raw.full;
    // Normalize retired aspect values to their nearest surviving orientation
    // so old documents render instead of falling through the CSS classes.
    const storedAspect =
      raw.aspect === "3x2"
        ? "4x3"
        : raw.aspect === "2x3"
          ? "3x4"
          : (raw.aspect ?? "3x4");
    // Open aspect collapses to one "open" class token; which of the two it
    // was only matters for the span (below). `full` overrides it entirely.
    const open = !full && (storedAspect === "open-v" || storedAspect === "open-h");
    const aspect = full ? "3x2" : open ? "open" : storedAspect;
    // One span per aspect: 4:3 always takes the centre-6 span (the retired
    // Size dropdown's "Small"), 3:4 the centre 4. Open Horizontal shares the
    // 4:3 span, Open Vertical the 3:4 one.
    const cols = full ? 12 : storedAspect === "4x3" || storedAspect === "open-h" ? 6 : 4;
    // All detail-page images are served at the site-wide 3000w source width
    // regardless of column span — layout size is a CSS concern only.
    return {
      full,
      aspect,
      open,
      ratio: normalizeRatio(raw.ratio),
      cols,
      image: mediaFromUrls(raw.image, raw.video, "", 0, 3000, raw.lqip),
      caption: raw.caption ?? null,
      hasCaption: !full && hasPortableTextContent(raw.caption),
    };
  },
};

export default sliceImage;
