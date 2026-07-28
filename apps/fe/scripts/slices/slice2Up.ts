/**
 * 2Up slice resolver. Two captioned images; the Layout variant drives their
 * per-image aspect + grid placement (handled in CSS):
 *   vertical → both 3:4, centered, 14.8rem gap, height = 4 column-widths
 *   a        → first 3:4 (col 2/3), second 4:3 (col 6/6)
 *   b        → first 4:3 (col 2/6), second 3:4 (col 9/3), baseline-aligned
 */

import { resolveCaptionedImages } from "./helpers";
import type { CaptionedImage, CaptionedImageRaw } from "./helpers";
import type { RawSlice, SliceDefinition } from "./types";

interface RawSlice2Up extends RawSlice {
  layout?: string;
  bottomAligned?: boolean;
  images?: CaptionedImageRaw[] | null;
}

interface ResolvedSlice2Up {
  layout: string;
  bottomAligned: boolean;
  images: CaptionedImage[];
}

const slice2Up: SliceDefinition<RawSlice2Up, ResolvedSlice2Up> = {
  name: "slice2Up",
  template: "slice2Up",
  query: `
    layout,
    bottomAligned,
    images[]{ "url": image.asset->url, caption }
  `,
  media: (raw) => (raw.images ?? []).map((im) => im.url ?? null),
  resolve: (raw) => ({
    layout: raw.layout ?? "vertical",
    bottomAligned: raw.bottomAligned ?? false,
    images: resolveCaptionedImages(raw.images, 3000),
  }),
};

export default slice2Up;
