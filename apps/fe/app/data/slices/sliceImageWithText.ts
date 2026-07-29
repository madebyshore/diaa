/**
 * Image-with-Text slice resolver. Three stacked rows — centered title, image,
 * rich-text body. Aspect is constrained by the schema to the landscape ratios
 * 3:2 / 4:3 (span the center 6 columns, height set by the aspect ratio) or
 * 3:4 (centered, height = 4 column-widths).
 *
 * Ported from `apps/fe/scripts/slices/sliceImageWithText.ts`. Renamed
 * contract (Phase 3 consumer): the old `titleHtml`/`textHtml` pre-rendered
 * strings are gone. `stylizedTitle` and `text` now pass through as raw
 * Portable Text blocks — Phase 3's `<SliceImageWithText>` renders
 * `stylizedTitle` with `<RichText>` when `hasTitle` is true, and `text` with
 * `<RichText wrap="p">`-equivalent behavior when `hasText` is true (mirrors
 * the old `renderPortableText(x, { wrap: "p" })` call for the body).
 */

import { mediaFromUrls, hasPortableTextContent, richTextQuery } from "./helpers";
import type { MediaData, PortableTextBlock, RawSlice, SliceDefinition } from "./types";

interface RawSliceImageWithText extends RawSlice {
  aspect?: string;
  /** Constrained rich-text title (bold/italic decorators only) — same shape
   *  as the Detail document's stylizedTitle. */
  stylizedTitle?: PortableTextBlock[] | null;
  image?: string | null;
  /** Raw MP4 asset URL, projected from `video.asset->url`. */
  video?: string | null;
  text?: PortableTextBlock[] | null;
}

export interface ResolvedSliceImageWithText {
  aspect: string;
  /** Raw title blocks — Phase 3 renders with `<RichText>`. */
  stylizedTitle: PortableTextBlock[] | null;
  hasTitle: boolean;
  /** Poster image + optional video — renders `<video>` when `hasVideo`. */
  image: MediaData | null;
  /** Raw body blocks — Phase 3 renders with `<RichText>`, paragraph-wrapped. */
  text: PortableTextBlock[] | null;
  hasText: boolean;
}

const sliceImageWithText: SliceDefinition<
  RawSliceImageWithText,
  ResolvedSliceImageWithText
> = {
  name: "sliceImageWithText",
  query: `
    aspect,
    stylizedTitle,
    "image": image.asset->url,
    "video": video.asset->url,
    ${richTextQuery("text")}
  `,
  resolve: (raw) => {
    // Normalize to the schema-allowed set; anything unexpected falls back to
    // the 3:2 default.
    const aspect = ["3x2", "4x3", "3x4"].includes(raw.aspect ?? "")
      ? (raw.aspect as string)
      : "3x2";
    // Plain-text flatten of the stylized title blocks — still needed as the
    // image alt attribute (this is text extraction, not HTML rendering, so
    // it stays in the data layer rather than moving to Phase 3).
    const titleText = (raw.stylizedTitle ?? [])
      .map((b) => (b.children ?? []).map((c) => c.text ?? "").join(""))
      .join(" ")
      .trim();
    // Served at the site-wide 3000w source width; the aspect variant only
    // affects layout, not the fetched image size.
    return {
      aspect,
      stylizedTitle: raw.stylizedTitle ?? null,
      hasTitle: hasPortableTextContent(raw.stylizedTitle),
      image: mediaFromUrls(raw.image, raw.video, titleText, 0, 3000),
      text: raw.text ?? null,
      hasText: hasPortableTextContent(raw.text),
    };
  },
};

export default sliceImageWithText;
