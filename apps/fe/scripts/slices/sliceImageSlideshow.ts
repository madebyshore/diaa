/**
 * Image Slideshow slice resolver. Renders the full ordered image set into a
 * 3:2 viewport that spans the center 8 columns. All images are emitted into
 * the DOM stacked on top of each other; the runtime (`app/slices/
 * sliceImageSlideshow.ts`) toggles which one is visible on click. A single
 * `caption` plus `total` are threaded through for the `current / total
 * caption` line shown under the image (space-separated, no em dash).
 */

import { pictureFromUrl } from "./helpers";
import type { PictureData, RawSlice, SliceDefinition } from "./types";

interface RawSliceSlideshow extends RawSlice {
  images?: Array<{ url?: string | null }> | null;
  caption?: string | null;
}

interface ResolvedSliceSlideshow {
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
  template: "sliceImageSlideshow",
  query: `
    images[]{ "url": asset->url },
    caption
  `,
  // Every image is rendered (stacked) so the carousel can swap between them.
  media: (raw) => (raw.images ?? []).map((im) => im.url ?? null),
  resolve: (raw) => {
    // 3:2 viewport → 3000×2000 intrinsic hint; index 0 becomes the LCP-priority
    // image and renders with `.is-active` so SSR shows the first slide.
    const images = (raw.images ?? [])
      .map((im, i) => pictureFromUrl(im.url, "", i, 3000, 2000))
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
