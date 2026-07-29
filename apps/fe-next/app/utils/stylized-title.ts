import type { PortableTextBlock } from "~/data/types";

/**
 * stylized-title.ts — a minimal, bold/italic-only Portable Text renderer for
 * the "Stylized Title" field (home grid labels + detail nav heading).
 *
 * This is a DELIBERATELY narrow subset of the old build-time
 * `renderPortableText()` (`apps/fe/scripts/utils/portable-text.ts`): the
 * Stylized Title schema itself only allows a single normal block with
 * `strong`/`em` decorators (no styles, lists, links, or other mark types —
 * see `content.ts`'s `DetailRef.stylizedTitle` comment), so a full
 * `@portabletext/vue`-powered `<RichText>` component would be massive
 * overkill just to flip two boolean flags per span. Phase 3's `<RichText>`
 * component will supersede this for every OTHER Portable Text field (slice
 * text, Contact/Imprint body) — those support arbitrary blocks/marks/links
 * and genuinely need it.
 *
 * Falls back to the escaped plain title when `blocks` is empty/absent,
 * mirroring the old `renderPortableText(x) || escapeHtml(title)` idiom.
 */

/** Escape the five HTML-significant characters so span text can safely be
 *  interpolated into a `v-html` string. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a Stylized Title's Portable Text blocks to a small HTML string
 * (`<strong>`/`<em>` only), or the escaped `fallback` title when there are
 * no blocks/no text. Intended for `v-html` on a `<span>`/label element.
 */
export function stylizedTitleHtml(
  blocks: PortableTextBlock[] | null | undefined,
  fallback: string,
): string {
  if (!blocks || blocks.length === 0) return escapeHtml(fallback);

  const html = blocks
    .map((block) =>
      (block.children ?? [])
        .map((span) => {
          const text = escapeHtml(typeof span.text === "string" ? span.text : "");
          const marks = Array.isArray(span.marks) ? span.marks : [];
          let out = text;
          if (marks.includes("em")) out = `<em>${out}</em>`;
          if (marks.includes("strong")) out = `<strong>${out}</strong>`;
          return out;
        })
        .join(""),
    )
    .join("");

  return html.length > 0 ? html : escapeHtml(fallback);
}
