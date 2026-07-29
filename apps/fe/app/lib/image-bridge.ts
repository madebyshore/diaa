/**
 * image-bridge.ts — a one-slot handoff for the home→detail "live image" bridge.
 *
 * The home→detail transition (see `transitions/home-to-detail.ts`) keeps the
 * text-mode reveal image visible across the page swap by promoting it to a
 * `position: fixed` clone on `document.body`. That clone has to outlive both the
 * transition class and the removal of the home section, then be cross-faded out
 * by `DetailPage.in()` — two places that never touch each other directly. This
 * module is the minimal shared reference that bridges them, so neither the
 * transition nor the page needs to know about the other.
 *
 * Lifecycle: `HomeDetailTransition.out()` calls `setImageBridge(clone)`;
 * `DetailPage.in()` calls `takeImageBridge()` to claim it, fade it out, and
 * remove it. On any navigation that isn't a text-mode home→detail bridge, the
 * slot stays null and `takeImageBridge()` returns null — callers fall back to
 * their normal behaviour.
 */

/** The live-image clone awaiting handoff, or null when no bridge is in flight. */
let bridge: HTMLElement | null = null;

/**
 * Store the promoted live-image clone for the in-flight bridge. Called by
 * `HomeDetailTransition.out()` after it appends the fixed clone to the body.
 */
export function setImageBridge(el: HTMLElement | null): void {
  bridge = el;
}

/**
 * Claim and clear the pending bridge clone. Returns null when no bridge is in
 * flight (every navigation that isn't a text-mode home→detail jump), so callers
 * can branch to their default path. Clearing on read guarantees the slot never
 * leaks a stale reference into a later, unrelated navigation.
 */
export function takeImageBridge(): HTMLElement | null {
  const el = bridge;
  bridge = null;
  return el;
}
