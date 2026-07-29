/**
 * Slice registry — the single source of truth that drives:
 *   - the GROQ projection used to fetch every page/detail's slices[]
 *     (`buildSlicesProjection()` in `data/queries.ts`)
 *   - Phase 3's `<SliceRenderer>`, which will import this same list to
 *     dispatch each resolved slice's `_type` to its Vue component
 *
 * Adding a new slice is a recipe:
 *   1. Create the schema in `apps/be/schemaTypes/slices/<slice>.js`
 *   2. Create a `SliceDefinition` in `app/data/slices/<slice>.ts` and
 *      import it below
 *   3. Build the matching Vue component in `app/components/slices/` (Phase 3)
 *
 * Ported from `apps/fe/scripts/slices/index.ts`. Pages don't reference
 * specific slices in code — they iterate whatever the editor placed in the
 * slices array and render the matching component.
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
 * slice file keeps its precise Raw/Resolved types for editor autocomplete;
 * the registry only ever needs to call `resolve(raw, ctx)` with any slice
 * and hand the output to a Vue component, so we widen at registration time.
 */
export interface AnySliceDefinition {
  name: string;
  query: string;
  resolve: (raw: RawSlice, ctx: SliceContext) => unknown;
}

/**
 * Every registered slice. Order here is the order the GROQ slice projection
 * lists its conditionals — purely cosmetic, since each page renders whatever
 * order the editor placed in the slices array. Widened to
 * `AnySliceDefinition` because each definition's `resolve` takes its own
 * narrow Raw type.
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
export const sliceByName: Record<string, AnySliceDefinition> = sliceRegistry.reduce<
  Record<string, AnySliceDefinition>
>((acc, def) => {
  acc[def.name] = def;
  return acc;
}, {});

/**
 * Resolve a raw `slices[]` array into per-slice resolved data, tagged with
 * `_type`/`_key` so Phase 3's `<SliceRenderer>` can dispatch each entry to
 * its Vue component and use `_key` as the `v-for` key. Unknown slice types
 * (a schema landed in Sanity before this app caught up) are dropped with a
 * console warning rather than throwing — matches the old build-time
 * renderer's "skip, don't crash the whole page" behavior.
 */
export function resolveSlices(
  slices: RawSlice[] | null | undefined,
  ctx: SliceContext,
): Array<{ _type: string; _key: string; data: unknown }> {
  if (!slices || slices.length === 0) return [];
  const resolved: Array<{ _type: string; _key: string; data: unknown }> = [];
  for (const slice of slices) {
    const def = sliceByName[slice._type];
    if (!def) {
      console.debug(`[data] unknown slice type "${slice._type}" — skipping`);
      continue;
    }
    resolved.push({
      _type: slice._type,
      _key: slice._key ?? `${slice._type}-${resolved.length}`,
      data: def.resolve(slice, ctx),
    });
  }
  return resolved;
}
