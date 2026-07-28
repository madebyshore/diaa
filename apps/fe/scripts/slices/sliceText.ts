/**
 * Text slice resolver. A rich-text block with a Variant:
 *   plain   → paragraphs, spans center 8
 *   quote   → body wrapped in hanging “ ” curly quotes; optional
 *             italicised author line underneath; spans center 8
 *   credits → centered text, spans center 6
 *
 * All variants preserve rich-text marks, line breaks (Shift+Enter → <br>) and
 * paragraph breaks (Enter → <p>).
 */

import { renderPortableText, richTextQuery } from "./helpers";
import type { RawSlice, SliceDefinition } from "./types";
import type { PortableTextBlock } from "../utils/portable-text";

interface RawSliceText extends RawSlice {
  variant?: string;
  text?: PortableTextBlock[] | null;
  quoteAuthor?: string;
}

interface ResolvedSliceText {
  variant: string;
  textHtml: string;
  author: string;
  hasAuthor: boolean;
}

const sliceText: SliceDefinition<RawSliceText, ResolvedSliceText> = {
  name: "sliceText",
  template: "sliceText",
  query: `
    variant,
    ${richTextQuery("text")},
    quoteAuthor
  `,
  resolve: (raw) => {
    const variant = raw.variant ?? "plain";
    let textHtml: string;
    if (variant === "quote") {
      // Quote body reads as one inline run wrapped in curly quotes; line
      // breaks within it are preserved as <br>. Each quote mark is wrapped
      // in a span so the stylesheet can hang it outside the text block —
      // the native CSS `hanging-punctuation` property is Safari-only, so
      // the hanging is done with positioned spans for every browser.
      const body = renderPortableText(raw.text);
      textHtml = body
        ? `<span class="slice-text__quote-mark slice-text__quote-mark--open">“</span>${body}<span class="slice-text__quote-mark slice-text__quote-mark--close">”</span>`
        : "";
    } else {
      textHtml = renderPortableText(raw.text, { wrap: "p" });
    }
    const author = variant === "quote" ? (raw.quoteAuthor ?? "") : "";
    return {
      variant,
      textHtml,
      author,
      hasAuthor: author.length > 0,
    };
  },
};

export default sliceText;
