/**
 * Image Slideshow slice resolver. Renders the full ordered image set into a
 * 3:2 viewport that spans the center 8 columns. All images are emitted into
 * the DOM stacked on top of each other; the runtime toggles which one is
 * visible on click (Phase 3/5). A single `caption` plus `total` are threaded
 * through for the "current / total caption" line shown under the image
 * (space-separated, no em dash).
 *
 * Ported verbatim from `apps/fe/scripts/slices/sliceImageSlideshow.ts` — no
 * pre-rendered HTML fields exist here, so no data-shape changes beyond the
 * shared `SliceDefinition` (no `template`, no `media`).
 */

import { pictureFromUrl } from "../image-url";
import type { PictureData, RawSlice, SliceDefinition } from "./types";

interface RawSliceSlideshow extends RawSlice {
  images?: Array<{ url?: string | null; lqip?: string | null }> | null;
  caption?: string | null;
}

export interface ResolvedSliceSlideshow {
  images: PictureData[];
  total: number;
  caption: string;
  hasCaption: boolean;
}

const sliceImageSlideshow: SliceDefinition<
  RawSliceSlideshow,
  ResolvedSliceSlideshow
> = {
  name: "sliceImageSlideshow",
  query: `
    images[]{ "url": asset->url, "lqip": asset->metadata.lqip },
    caption
  `,
  resolve: (raw) => {
    // 3:2 viewport → 3000×2000 intrinsic hint; index 0 becomes the LCP-priority
    // image and renders active so SSR shows the first slide.
    const images = (raw.images ?? [])
      .map((im, i) => pictureFromUrl(im.url, "", i, 3000, 2000, im.lqip))
      .filter((p): p is PictureData => p !== null);
    const caption = (raw.caption ?? "").trim();
    return {
      images,
      total: images.length,
      caption,
      hasCaption: caption.length > 0,
    };
  },
};

export default sliceImageSlideshow;
