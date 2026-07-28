/**
 * Slice runtime registry — auto-dispatches per-slice init functions
 * against any rendered slice in a page container.
 *
 * Every slice partial in `routes/partials/slices/*.html` carries a
 * `data-slice="sliceName"` attribute on its root section. At page-init
 * time `initSlices(container)` walks every `[data-slice]` element in
 * the container and runs the matching init function from the registry.
 * Pages don't need to know which slices they contain — adding a new
 * interactive slice is a one-line registry edit, not a per-page
 * change.
 *
 * To add a new interactive slice:
 *   1. Create `apps/fe/src/app/slices/<sliceName>.ts` exporting
 *      `init<SliceName>(root: Element): (() => void) | void`
 *   2. Register it in the `sliceInits` map below
 *
 * Slices that are pure markup + CSS don't need a module here — they
 * just won't match the registry and will be silently skipped.
 */

import { initSliceImageSlideshow } from "./sliceImageSlideshow";

type SliceInit = (root: Element) => (() => void) | void;

/**
 * Registry of interactive slice runtime modules. Keys must match the
 * `data-slice` attribute emitted by the corresponding Mustache partial
 * (the Sanity slice `_type` name).
 */
const sliceInits: Record<string, SliceInit> = {
  sliceImageSlideshow: initSliceImageSlideshow,
};

/**
 * Walk every `[data-slice]` element under `container` and invoke the
 * matching init from the registry. Slices without a registered
 * runtime module are skipped silently.
 *
 * Returns a teardown function that aggregates every per-instance
 * cleanup returned by an init module — pages can call it from their
 * `cleanup()` hook to detach listeners on navigation.
 */
export function initSlices(container: Element | null | undefined): () => void {
  if (!container) return () => {};

  const slices = container.querySelectorAll<HTMLElement>("[data-slice]");
  const teardowns: Array<() => void> = [];

  slices.forEach((slice) => {
    const type = slice.getAttribute("data-slice");
    if (!type) return;
    const init = sliceInits[type];
    if (!init) return;
    const td = init(slice);
    if (typeof td === "function") teardowns.push(td);
  });

  return () => teardowns.forEach((fn) => fn());
}
