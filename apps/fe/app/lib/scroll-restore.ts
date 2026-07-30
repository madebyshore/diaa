import type Lenis from "lenis";

/**
 * lib/scroll-restore.ts — per-route scroll position snapshots + restore
 * logic, porting `PageManager.scrollState` (apps/fe/src/app/page-manager.ts)
 * to Lenis. Diaa saved `{cur, tar}` per route key and restored via
 * `App.target === "back" ? scrollTo(snap.tar, true) : scrollTo(0, true)`.
 * Lenis has one scroll value (no separate damped-current vs. user-target
 * concept the way kido's scroller does), so one number per route suffices.
 *
 * Keyed by `route.fullPath` (matches the page-controller registry's key) so
 * distinct dynamic routes never collide.
 */
const snapshots = new Map<string, number>();

/** Save the current Lenis scroll position for `path`. No-ops when Lenis is
 *  null (mobile — native scroll isn't snapshotted/restored, matching diaa's
 *  own behavior where NativeScroller mirrors but doesn't drive mobile scroll). */
export function saveScroll(path: string, lenis: Lenis | null): void {
  if (lenis) snapshots.set(path, lenis.scroll);
}

/**
 * Restore the saved scroll position for `path` on back-navigation, or reset
 * to top on forward navigation — mirrors `initCurrentPage()`'s
 * `App.target === "back"` branch exactly. `immediate: true` performs an
 * instant jump (no animation), matching diaa's `scrollTo(position, true)`.
 */
export function restoreOrResetScroll(
  lenis: Lenis | null,
  path: string,
  direction: "back" | "forward",
): void {
  if (!lenis) {
    // Mobile (native scroll, no Lenis): ALWAYS reset to top. There are no
    // snapshots to restore on mobile (saveScroll no-ops there), and without
    // this explicit reset the document silently keeps whatever scroll the
    // OUTGOING page left behind — the browser only clamps it (asynchronously)
    // once the old page's DOM is removed, which lands AFTER home's in() has
    // already computed its scroll-driven reveal (updateScrollReveal) against
    // the stale position. Symptom: returning home from a detail showed the
    // wrong centre image until the user's first real scroll re-synced it.
    // Resetting here — same synchronous task as the unpin in transitions/
    // default.ts's onEnter, before controller.in() runs — guarantees the
    // entrance always starts at the top with the FIRST visible item's figure
    // active. `direction` is deliberately ignored: with no snapshot, top is
    // the only correct target for back-nav too.
    window.scrollTo(0, 0);
    console.debug("[scroll-restore] mobile reset to top", path);
    return;
  }
  if (direction === "back") {
    const y = snapshots.get(path);
    if (y != null) {
      lenis.scrollTo(y, { immediate: true, force: true });
      console.debug("[scroll-restore] restored", path, y);
      return;
    }
  }
  lenis.scrollTo(0, { immediate: true, force: true });
  console.debug("[scroll-restore] reset to top", path);
}

/** "back" for the navigation currently in flight (set by a popstate listener
 *  in plugins/nav-direction.client.ts), "forward" otherwise (the default —
 *  covers every anchor click / programmatic router.push). `transitions/
 *  default.ts` reads this once per nav via `takeNavDirection()`, which resets
 *  it to "forward" immediately so a later back-nav doesn't leak into an
 *  unrelated forward nav. */
export const navDirection = ref<"back" | "forward">("forward");

/** Read and reset navDirection to "forward" in one step — call exactly once
 *  per navigation, from the transition's onEnter, before scroll restore. */
export function takeNavDirection(): "back" | "forward" {
  const d = navDirection.value;
  navDirection.value = "forward";
  return d;
}
