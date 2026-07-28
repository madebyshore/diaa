/**
 * Image-with-Text slice resolver. Three stacked rows — centered title, image,
 * rich-text body. Aspect is constrained by the schema to the landscape ratios
 * 3:2 / 4:3 (span the center 6 columns, height set by the aspect ratio) or
 * 3:4 (centered, height = 4 column-widths).
 */

import { mediaFromUrls, renderPortableText, richTextQuery } from "./helpers";
import type { SliceMedia, RawSlice, SliceDefinition } from "./types";
import type { PortableTextBlock } from "../utils/portable-text";

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

interface ResolvedSliceImageWithText {
  aspect: string;
  /** Rendered title HTML (<strong>/<em> preserved, content escaped) —
   *  emitted via triple-mustache in the partial. */
  titleHtml: string;
  hasTitle: boolean;
  /** Poster image + optional video — renders `<video>` when `hasVideo`. */
  image: SliceMedia | null;
  textHtml: string;
  hasText: boolean;
}

const sliceImageWithText: SliceDefinition<
  RawSliceImageWithText,
  ResolvedSliceImageWithText
> = {
  name: "sliceImageWithText",
  template: "sliceImageWithText",
  query: `
    aspect,
    stylizedTitle,
    "image": image.asset->url,
    "video": video.asset->url,
    ${richTextQuery("text")}
  `,
  media: (raw) => [raw.image ?? null],
  resolve: (raw) => {
    // Normalize to the schema-allowed set; anything unexpected falls back to
    // the 3:2 default.
    const aspect = ["3x2", "4x3", "3x4"].includes(raw.aspect ?? "")
      ? (raw.aspect as string)
      : "3x2";
    // Stylized title — same constrained rich text as the Detail title.
    // Rendered inline (<strong>/<em> preserved, content escaped); a plain-text
    // flatten of the same blocks feeds the image alt attribute.
    const titleHtml = renderPortableText(raw.stylizedTitle ?? undefined);
    const titleText = (raw.stylizedTitle ?? [])
      .map((b) => (b.children ?? []).map((c) => c.text ?? "").join(""))
      .join(" ")
      .trim();
    // Body is rich text — paragraphs (Enter) become <p>, line breaks
    // (Shift+Enter) become <br>, decorator marks are preserved.
    const textHtml = renderPortableText(raw.text, { wrap: "p" });
    // Served at the site-wide 3000w source width; the aspect variant only
    // affects layout, not the fetched image size.
    return {
      aspect,
      titleHtml,
      hasTitle: titleHtml.length > 0,
      image: mediaFromUrls(raw.image, raw.video, titleText, 0, 3000),
      textHtml,
      hasText: textHtml.length > 0,
    };
  },
};

export default sliceImageWithText;
