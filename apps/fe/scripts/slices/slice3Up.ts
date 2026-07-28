/**
 * 3Up slice resolver. Three captioned images spanning columns 2–11 with a
 * one-column gap between each. The Layout variant drives per-image aspect +
 * size (mid spans 4 cols, small spans 2), all handled in CSS:
 *   a → 3:4 mid, 3:4 small, 4:3 small
 *   b → 4:3 small, 3:4 small, 3:4 mid
 *   c → 3:4 small, 3:4 mid, 4:3 small
 */

import { resolveCaptionedImages } from "./helpers";
import type { CaptionedImage, CaptionedImageRaw } from "./helpers";
import type { RawSlice, SliceDefinition } from "./types";

interface RawSlice3Up extends RawSlice {
  layout?: string;
  bottomAligned?: boolean;
  images?: CaptionedImageRaw[] | null;
}

interface ResolvedSlice3Up {
  layout: string;
  bottomAligned: boolean;
  images: CaptionedImage[];
}

const slice3Up: SliceDefinition<RawSlice3Up, ResolvedSlice3Up> = {
  name: "slice3Up",
  template: "slice3Up",
  query: `
    layout,
    bottomAligned,
    images[]{ "url": image.asset->url, caption }
  `,
  media: (raw) => (raw.images ?? []).map((im) => im.url ?? null),
  resolve: (raw) => ({
    layout: raw.layout ?? "a",
    bottomAligned: raw.bottomAligned ?? false,
    images: resolveCaptionedImages(raw.images, 3000),
  }),
};

export default slice3Up;
