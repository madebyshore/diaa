/**
 * Text slice resolver. A rich-text block with a Variant:
 *   plain   → paragraphs, spans center 8
 *   quote   → body wrapped in hanging " " curly quotes; optional
 *             italicised author line underneath; spans center 8
 *   credits → centered text, spans center 6
 *
 * All variants preserve rich-text marks, line breaks (Shift+Enter → <br>) and
 * paragraph breaks (Enter → <p>).
 *
 * Ported from `apps/fe/scripts/slices/sliceText.ts`. Renamed contract (Phase
 * 3 consumer): the old resolver branched on `variant` to build a pre-rendered
 * `textHtml` string — for the "quote" variant it wrapped the rendered body in
 * `<span class="slice-text__quote-mark">"</span>` open/close marks; for every
 * other variant it just paragraph-wrapped the body. That branching no longer
 * belongs in the data layer: `text` now always passes through as raw
 * Portable Text blocks, and it is Phase 3's `<SliceText>` component that
 * reads `variant === "quote"` and wraps its rendered `<RichText :value="text">`
 * output in the quote-mark spans (and the credits/plain variants get their
 * own layout via CSS, same as before). `author`/`hasAuthor` are unchanged —
 * they were already plain strings, not rendered HTML.
 */

import type { PortableTextBlock, RawSlice, SliceDefinition } from "./types";
import { richTextQuery } from "./helpers";

interface RawSliceText extends RawSlice {
  variant?: string;
  text?: PortableTextBlock[] | null;
  quoteAuthor?: string;
}

interface ResolvedSliceText {
  variant: string;
  /** Raw body blocks — Phase 3 renders with `<RichText>`, wrapping in quote
   *  marks itself when `variant === "quote"` (see file header). */
  text: PortableTextBlock[] | null;
  author: string;
  hasAuthor: boolean;
}

const sliceText: SliceDefinition<RawSliceText, ResolvedSliceText> = {
  name: "sliceText",
  query: `
    variant,
    ${richTextQuery("text")},
    quoteAuthor
  `,
  resolve: (raw) => {
    const variant = raw.variant ?? "plain";
    // Only the quote variant surfaces an author line — mirrors the old
    // resolver's explicit gate rather than trusting the schema to keep
    // quoteAuthor empty on non-quote docs.
    const author = variant === "quote" ? (raw.quoteAuthor ?? "") : "";
    return {
      variant,
      text: raw.text ?? null,
      author,
      hasAuthor: author.length > 0,
    };
  },
};

export default sliceText;
