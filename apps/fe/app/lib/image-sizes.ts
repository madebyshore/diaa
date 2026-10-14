/**
 * lib/image-sizes.ts — the `sizes` attribute for every image surface.
 *
 * `data/image-url.ts` gives each image a `srcset` width ladder; the browser
 * can only pick the right rung if it knows how wide the image RENDERS, which
 * is a layout fact owned by the SCSS modules, not the data layer. These
 * strings restate those layouts in viewport units so the pick happens before
 * layout (that's how `sizes` works — it's evaluated against the viewport,
 * never the element). Each value is a deliberate UPPER BOUND of the real
 * rendered width: overshooting costs one rung of extra bytes, undershooting
 * shows a soft image, so every rounding goes up.
 *
 * Why this exists at all: every image used to ship as one 3000px URL, which
 * decoded to ~48 MB of bitmap apiece and got iPadOS Safari tabs killed for
 * memory on the home page (see `data/image-url.ts`'s header).
 *
 * Breakpoints mirror `styles/includes/_breakpoints.module.scss`
 * (xs 432 / md 820 / lg 1280). When a layout's column spans change there,
 * update the matching string here — nothing enforces the pairing.
 */

/**
 * The hero span (`--hero-span` in `_home.module.scss` / `_detail.module.scss`)
 * — the Text-mode reveal figure, the detail cover, the slideshow viewport and
 * the c4/c6 Image slice. 4:3 renders exactly this wide; 3:4 renders 3/4 of it
 * (HEIGHT is the span), both further capped by svh which only ever shrinks
 * them. Tiers: lg+ centre 6 of 12 (≈50vw), md centre 8 of 12 (≈67vw), the
 * 8-col tier inner 6 of 8 (75vw), phone full width.
 *
 * The Text-mode reveal and the detail cover MUST share this exact string:
 * the home→detail bridge clones the reveal's decoded `<img>` and hands off to
 * the detail cover underneath it, and identical srcset + sizes at the same
 * viewport means both resolve to the same rung — the cover is already in the
 * memory cache, so the hard swap shows no reload or sharpness change.
 */
export const HERO_SIZES = "(min-width: 1280px) 50vw, (min-width: 820px) 67vw, (min-width: 432px) 75vw, 100vw";

/** Image-mode home grid — four cells per row at every width. */
export const GRID_SIZES = "25vw";

/** Full-bleed / 12-column surfaces (Image slice `full` or c12). */
export const FULL_SIZES = "100vw";

/** Image slice c10 — inner 10 of 12 from md up, inner 6 of 8 on the 8-col
 *  tier, full padded width on phone. */
export const WIDE_SIZES = "(min-width: 820px) 84vw, (min-width: 432px) 75vw, 100vw";

/** 2Up items — never wider than half the viewport from md up; the small
 *  tiers stay at 100vw as a safe ceiling. */
export const HALF_SIZES = "(min-width: 820px) 50vw, 100vw";

/** 3Up items and the Image-with-Text media column — at most 4 of 12 columns
 *  from md up, inner 6 of 8 on the 8-col tier, full width on phone. */
export const THIRD_SIZES = "(min-width: 820px) 34vw, (min-width: 432px) 75vw, 100vw";
