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
 */

import { mediaFromUrls } from "./helpers";
import type { MediaData, RawSlice, SliceDefinition } from "./types";

interface RawSliceImage extends RawSlice {
  aspect?: string;
  full?: boolean;
  image?: string | null;
  /** Base64 blur placeholder, projected from `image.asset->metadata.lqip`. */
  lqip?: string | null;
  /** Raw MP4 asset URL, projected from `video.asset->url`. */
  video?: string | null;
}

export interface ResolvedSliceImage {
  full: boolean;
  /** Aspect token used for the `--ar-*` class, e.g. "4x3". */
  aspect: string;
  /** Column span used for the `--c*` class (6 / 4, or 12 when full). */
  cols: number;
  /** Poster image + optional video — renders `<video>` when `hasVideo`. */
  image: MediaData | null;
}

const sliceImage: SliceDefinition<RawSliceImage, ResolvedSliceImage> = {
  name: "sliceImage",
  query: `
    aspect,
    full,
    "image": image.asset->url,
    "lqip": image.asset->metadata.lqip,
    "video": video.asset->url
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
    const aspect = full ? "3x2" : storedAspect;
    // One span per aspect: 4:3 always takes the centre-6 span (the retired
    // Size dropdown's "Small"), 3:4 the centre 4.
    const cols = full ? 12 : aspect === "4x3" ? 6 : 4;
    // All detail-page images are served at the site-wide 3000w source width
    // regardless of column span — layout size is a CSS concern only.
    return {
      full,
      aspect,
      cols,
      image: mediaFromUrls(raw.image, raw.video, "", 0, 3000, raw.lqip),
    };
  },
};

export default sliceImage;
