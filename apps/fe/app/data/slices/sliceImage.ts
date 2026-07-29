/**
 * Image slice resolver. A single centered image whose column span derives
 * from aspect orientation + size, with the aspect ratio coming straight from
 * the CMS. `full` overrides everything: a full-bleed 3:2 image at 100vw.
 *
 * Column spans (12-col grid):
 *   landscape (3:2 / 4:3): large → 8, mid → 6
 *   portrait  (3:4 / 2:3): large → 6, mid → 4
 *   full:                  the whole width (no container padding)
 *
 * Ported verbatim from `apps/fe/scripts/slices/sliceImage.ts` — no
 * pre-rendered HTML fields exist here to rename, so this file has no
 * data-shape changes beyond the shared `SliceDefinition` (no `template`).
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
  /** Aspect token used for the `--ar-*` class, e.g. "3x2". */
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
    const aspect = full ? "3x2" : (raw.aspect ?? "3x2");
    const size = raw.size ?? "mid";
    const landscape = aspect === "3x2" || aspect === "4x3";
    const cols = full
      ? 12
      : landscape
        ? size === "lg"
          ? 8
          : 6
        : size === "lg"
          ? 6
          : 4;
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
