/**
 * Image slice resolver. A single centered image whose column span derives
 * from aspect + size, with the aspect ratio coming straight from the CMS.
 * `full` overrides everything: a full-bleed 3:2 image at 100vw.
 *
 * Column spans (12-col grid):
 *   4:3 → large → 8, small → 6
 *   3:4 → one fixed size → 4
 *   full → the whole width (no container padding)
 *
 * Mobile placement follows the span (see styles/slices/_image.module.scss):
 * c4 and c6 centre on the middle 4 of the 6-col grid, c8 runs full width.
 *
 * The CMS dropdown was narrowed to 3:4 / 4:3 with sizes Small / Large
 * (4:3 only) — legacy stored values from the wider option set are normalized
 * here (3:2 → 4:3, 2:3 → 3:4, "mid" size → the small span) so previously
 * published documents keep rendering without a content migration.
 */

import { mediaFromUrls } from "./helpers";
import type { MediaData, RawSlice, SliceDefinition } from "./types";

interface RawSliceImage extends RawSlice {
  aspect?: string;
  size?: string;
  full?: boolean;
  image?: string | null;
  /** Raw MP4 asset URL, projected from `video.asset->url`. */
  video?: string | null;
}

export interface ResolvedSliceImage {
  full: boolean;
  /** Aspect token used for the `--ar-*` class, e.g. "4x3". */
  aspect: string;
  /** Column span used for the `--c*` class (8 / 6 / 4, or 12 when full). */
  cols: number;
  /** Poster image + optional video — renders `<video>` when `hasVideo`. */
  image: MediaData | null;
}

const sliceImage: SliceDefinition<RawSliceImage, ResolvedSliceImage> = {
  name: "sliceImage",
  query: `
    aspect,
    size,
    full,
    "image": image.asset->url,
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
    // Size only differentiates 4:3 — "lg" spans 8, anything else ("sm", plus
    // the retired "mid") spans 6. 3:4 has exactly one size: the centre 4.
    const cols = full ? 12 : aspect === "4x3" ? (raw.size === "lg" ? 8 : 6) : 4;
    // All detail-page images are served at the site-wide 3000w source width
    // regardless of column span — layout size is a CSS concern only.
    return {
      full,
      aspect,
      cols,
      image: mediaFromUrls(raw.image, raw.video, "", 0, 3000),
    };
  },
};

export default sliceImage;
