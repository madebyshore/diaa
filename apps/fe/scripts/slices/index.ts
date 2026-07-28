/**
 * Slice registry — the single source of truth that drives:
 *   - the GROQ projection used to fetch every page's slices[]
 *   - the build-time HTML renderer that turns slice data into markup
 *
 * Adding a new slice is a three-step recipe:
 *   1. Create the schema in `apps/be/schemaTypes/slices/<slice>.js`
 *   2. Drop a Mustache partial in `apps/fe/src/routes/partials/slices/<slice>.html`
 *   3. Create a `SliceDefinition` in `apps/fe/scripts/slices/<slice>.ts`
 *      and import it below.
 *
 * Pages don't reference specific slices in code — they iterate whatever
 * the editor placed in the slices array and render the pre-built HTML.
 */

import type { RawSlice, SliceContext } from "./types";
import sliceImage from "./sliceImage";
import sliceImageWithText from "./sliceImageWithText";
import sliceImageSlideshow from "./sliceImageSlideshow";
import slice2Up from "./slice2Up";
import slice3Up from "./slice3Up";
import sliceText from "./sliceText";

/**
 * Type-erased slice definition — what the registry stores. Each individual
 * slice file keeps its precise Raw / Resolved types for editor autocomplete;
 * the registry only ever needs to call `resolve(raw, ctx)` with any slice
 * and pass the output to Mustache, so we widen at registration time.
 */
export interface AnySliceDefinition {
  name: string;
  template: string;
  query: string;
  resolve: (raw: RawSlice, ctx: SliceContext) => unknown;
  media?: (raw: RawSlice) => Array<string | null>;
}

/**
 * Every registered slice. Order here is the order the GROQ slice projection
 * lists its conditionals — purely cosmetic, since each page renders whatever
 * order the editor placed in the slices array. Widened to AnySliceDefinition
 * because each definition's `resolve` takes its own narrow Raw type.
 */
export const sliceRegistry: AnySliceDefinition[] = [
  sliceImage,
  sliceImageWithText,
  sliceImageSlideshow,
  slice2Up,
  slice3Up,
  sliceText,
] as unknown as AnySliceDefinition[];

/** O(1) lookup by Sanity `_type`. */
export const sliceByName: Record<string, AnySliceDefinition> =
  sliceRegistry.reduce<Record<string, AnySliceDefinition>>((acc, def) => {
    acc[def.name] = def;
    return acc;
  }, {});
