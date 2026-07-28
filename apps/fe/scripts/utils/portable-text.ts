/**
 * Minimal Portable Text → HTML renderer for build-time use.
 *
 * Opt-in companion to the default `pt::text()` flattening in queries.ts.
 * Where a field is projected as the raw block array (not `pt::text()`),
 * this renderer walks the blocks and emits HTML that preserves decorator
 * marks as `<span class="...">` wrappers.
 *
 * Scope:
 * - Supports the default Sanity decorators: `strong`, `em`, `underline`,
 *   `code`, plus the two project-specific font-family decorators `serif`
 *   and `mono`. Custom classes `.serif` and `.mono` are applied so the
 *   frontend stylesheet can set the font-family. Extend the map below if
 *   more decorators are added.
 * - Splits blocks on `\n` characters the same way `preserveLineBreaks`
 *   does — newlines within a block span become `<br>` tags.
 * - Link annotations (internal/external) render as `<a class="rt-link">`.
 *   Internal links rely on the GROQ projection resolving their `href` up
 *   front (see `richTextQuery` in scripts/slices/helpers.ts); annotations
 *   without a usable href degrade to plain text. A link spanning multiple
 *   marks-split spans emits one `<a>` per span — visually seamless since
 *   the anchors are adjacent and share styling.
 * - Does NOT support list items, headings, or embedded images in this
 *   pass. Blocks with `style != "normal"` are still rendered as plain
 *   text inside their span stack. Add block-level rendering when a field
 *   needs it.
 *
 * This implementation is intentionally self-contained (no `@portabletext/*`
 * dependency) because the feature surface is tiny.
 */

/** A single text span within a Portable Text block. */
export interface PortableTextSpan {
  _type: "span";
  _key?: string;
  text: string;
  marks?: string[];
}

/** A Portable Text block. `children` contains spans + inline annotations. */
export interface PortableTextBlock {
  _type: "block";
  _key?: string;
  style?: string;
  children: PortableTextSpan[];
  markDefs?: Array<{ _key: string; _type: string; [key: string]: unknown }>;
}

/** Mapping from decorator value → HTML tag + optional class. */
const DECORATOR_MAP: Record<string, { tag: string; className?: string }> = {
  strong: { tag: "strong" },
  em: { tag: "em" },
  underline: { tag: "u" },
  code: { tag: "code" },
  serif: { tag: "span", className: "serif" },
  mono: { tag: "span", className: "mono" },
};

/**
 * Escape HTML-dangerous characters so raw user text can't inject markup.
 * The renderer itself is responsible for inserting `<br>` / `<span>`, so
 * we always escape the span's text content first. Exported for callers that
 * build HTML fallbacks alongside rendered Portable Text (e.g. the plain-title
 * fallback next to a stylized title in sanity-content.ts).
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap a span's escaped text with its decorator marks, outermost first.
 * Unknown marks (including annotation keys) are skipped silently —
 * annotations are handled separately by `wrapAnnotations`.
 */
function wrapMarks(text: string, marks: string[] | undefined): string {
  if (!marks || marks.length === 0) return text;
  let output = text;
  for (const mark of marks) {
    const def = DECORATOR_MAP[mark];
    if (!def) continue;
    const classAttr = def.className ? ` class="${def.className}"` : "";
    output = `<${def.tag}${classAttr}>${output}</${def.tag}>`;
  }
  return output;
}

/**
 * Wrap already-decorated inline HTML in an anchor when the span carries a
 * link annotation mark. Marks that aren't decorators reference a markDef by
 * `_key`; internal/external link defs carry an `href` (internal ones are
 * pre-resolved by the GROQ projection — see `richTextQuery` in
 * scripts/slices/helpers.ts). External links with `blank: true` open in a
 * new tab. Defs without a usable href are skipped so the text still renders.
 */
function wrapAnnotations(
  html: string,
  marks: string[] | undefined,
  markDefs: PortableTextBlock["markDefs"]
): string {
  if (!marks || marks.length === 0 || !markDefs || markDefs.length === 0) {
    return html;
  }
  let output = html;
  for (const mark of marks) {
    const def = markDefs.find((d) => d._key === mark);
    if (!def) continue;
    const href = typeof def.href === "string" ? def.href : "";
    if (!href) continue;
    const external =
      def._type === "externalLink" && def.blank === true
        ? ` target="_blank" rel="noopener noreferrer"`
        : "";
    output = `<a class="rt-link" href="${escapeHtml(href)}"${external}>${output}</a>`;
  }
  return output;
}

/**
 * Render a single block's children as inline HTML. Newline characters in
 * span text become `<br>` to match the existing `preserveLineBreaks`
 * behaviour used elsewhere. Decorator marks wrap innermost; link
 * annotations wrap outermost so the whole styled run is clickable.
 */
function renderBlockInline(block: PortableTextBlock): string {
  return block.children
    .map((child) => {
      if (child._type !== "span") return "";
      const escaped = escapeHtml(child.text).replace(/\n/g, "<br>");
      const decorated = wrapMarks(escaped, child.marks);
      return wrapAnnotations(decorated, child.marks, block.markDefs);
    })
    .join("");
}

/**
 * Render an array of Portable Text blocks to HTML. Consecutive blocks are
 * joined with `<br>` so they read as line-separated in flow — matches the
 * existing `\n` → `<br>` convention for pt::text() output.
 *
 * When `wrap` is `"p"`, each block is wrapped in a `<p>` tag instead of
 * being joined with `<br>`. Use this when the output sits inside a
 * container that needs real paragraph elements (e.g. the Who We Are body).
 */
export function renderPortableText(
  blocks: PortableTextBlock[] | null | undefined,
  opts?: { wrap?: "p" }
): string {
  if (!blocks || blocks.length === 0) return "";
  if (opts?.wrap === "p") {
    return blocks.map((b) => `<p>${renderBlockInline(b)}</p>`).join("");
  }
  return blocks.map(renderBlockInline).join("<br>");
}
