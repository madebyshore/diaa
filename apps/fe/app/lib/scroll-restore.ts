import type Lenis from "lenis";

/**
 * lib/scroll-restore.ts — per-route scroll position snapshots + restore
 * logic, porting `PageManager.scrollState` (apps/fe/src/app/page-manager.ts)
 * to Lenis. Diaa saved `{cur, tar}` per route key and restored via
 * `App.target === "back" ? scrollTo(snap.tar, true) : scrollTo(0, true)`.
 * Lenis has one scroll value (no separate damped-current vs. user-target
 * concept the way kido's scroller does), so one number per route suffices.
 *
 * Callers pass `route.fullPath` (the page-controller registry's key), but
 * snapshots are stored under the PATH alone — see snapshotKey().
 */
const snapshots = new Map<string, number>();

/**
 * Reduce a route fullPath to the key its scroll snapshot is stored under:
 * the pathname, with any query string and hash dropped.
 *
 * Links opened from Instagram (and most other apps) arrive with tracking
 * parameters appended — `/?utm_source=ig&fbclid=...`. Home's scroll was then
 * saved under that full string, while the "( Close )" footer on a detail
 * page navigates to a bare `/` and looked the snapshot up under `/`: no
 * match, so home reset to the top instead of returning the visitor to the
 * project they had opened. It only happened to visitors arriving through
 * such a link, which is why it never reproduced from a typed URL. No view in
 * this app varies by query string, so the path alone identifies the page.
 */
function snapshotKey(fullPath: string): string {
  const end = fullPath.search(/[?#]/);
  return end === -1 ? fullPath : fullPath.slice(0, end);
}

/** Save the current Lenis scroll position for `path`. Mobile runs Lenis too
 *  (a passive mirror of native touch scroll — plugins/lenis.client.ts), so
 *  mobile scroll IS snapshotted + restored on back-nav like desktop (except
 *  home, which transitions/default.ts centres on the entry just left);
 *  the null guard is a dormant fallback for a Lenis-less configuration. */
export function saveScroll(path: string, lenis: Lenis | null): void {
  if (lenis) snapshots.set(snapshotKey(path), lenis.scroll);
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
    // DORMANT since mobile runs Lenis (see saveScroll's note) — kept for a
    // Lenis-less configuration. Original rationale:
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
    const y = snapshots.get(snapshotKey(path));
    if (y != null) {
      lenis.scrollTo(y, { immediate: true, force: true });
      console.debug("[scroll-restore] restored", path, y);
      return;
    }
  }
  lenis.scrollTo(0, { immediate: true, force: true });
  console.debug("[scroll-restore] reset to top", path);
}

/**
 * Mobile home only: scroll the text list so the entry linking to `path`
 * (the detail page just left) rests on the centre line — where a label sits
 * after every completed scroll step, and where the reveal image centres.
 * Called from transitions/default.ts's onEnter right after the reset to top.
 *
 * The centre line is measured, not recomputed: it is the vertical centre of
 * `.home__text-gpu-inner`, the fixed 1:1 box every reveal figure centres in
 * (50svh on mobile — _home.module.scss). Measuring keeps this in step with
 * the CSS rhythm (which uses svh/lvh units JS can't read directly); the
 * label's box centre is the same point the list's padding/gap centre on.
 * No-ops (stays at the top) when the entry isn't in the list — Contact and
 * Imprint — or is `display: none` under the active taxonomy filter.
 */
export function centreHomeEntry(page: HTMLElement, lenis: Lenis | null, path: string): void {
  const item = page.querySelector<HTMLElement>(`.home__text-item[href="${CSS.escape(path)}"]`);
  const band = page.querySelector<HTMLElement>(".home__text-gpu-inner")?.getBoundingClientRect();
  const rect = item?.getBoundingClientRect();
  if (!rect || rect.height === 0 || !band || band.height === 0) {
    console.debug("[scroll-restore] no visible home entry for", path, "— staying at top");
    return;
  }
  const y = Math.max(
    0,
    window.scrollY + rect.top + rect.height / 2 - (band.top + band.height / 2),
  );
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
  console.debug("[scroll-restore] centred home entry", path, y);
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
