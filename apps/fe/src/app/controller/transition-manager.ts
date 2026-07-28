/**
 * transition-manager.ts — TransitionManager, the coordinator between Ctrl and
 * the transition animation layer.
 *
 * TransitionManager is responsible for orchestrating the two phases of a page
 * transition ("out" and "in") using the Ctrl/Mutation callback pattern:
 *
 *   1. out(callbacks): Runs PageManager.beforeOut(), starts the outgoing
 *      animation, and then calls callbacks.update() to signal Ctrl that the
 *      "out" phase is complete and the "in" phase should begin.
 *
 *   2. in(callbacks): Calls callbacks.insertNew() (DOM insert), starts the
 *      outgoing and incoming animations simultaneously (Promise.all), then waits
 *      two rAF frames (double-RAF) for layout to commit, updates the scroller,
 *      and finally calls callbacks.removeOld(). PageManager.afterIn() is called
 *      at the end.
 *
 * The callbacks (insertNew, removeOld, update) are supplied by Ctrl so that
 * DOM timing is decoupled from animation timing — Ctrl decides what to do at
 * each moment, TransitionManager decides when to call it.
 *
 * References:
 *   - ROUT-01: Full navigation lifecycle orchestration
 *   - ROUT-03: Transition lock + safety timeout (handled by Ctrl; TM signals)
 *   - TRAN-02: Registry-based transition resolution
 */

import { App } from "../context";
import { dbg } from "../debug";
import { PageManager } from "../page-manager";

import type { TransitionRegistry, BaseTransition } from "./transition-registry";
import type { TransitionCallbacks } from "./types";

/**
 * Duration in milliseconds for the post-animation delay before removing the
 * old page element. Short enough to be imperceptible; long enough for the
 * GPU scene to have committed and the browser to have composited the final
 * frame of the in() animation.
 */
const REMOVE_OLD_DELAY_MS = 150;

/**
 * TransitionManager — coordinates the out and in phases of a page transition
 * using the callback pattern.
 *
 * Constructed by Ctrl with a TransitionRegistry. Ctrl calls out() at the start
 * of a navigation, then _in() after the update callback fires. Both phases
 * reach into the registry to resolve the current animation implementation.
 */
export class TransitionManager {
  /**
   * The registry used to resolve which BaseTransition handles the current
   * route pair. Injected by Ctrl at construction so different registries
   * (with different defaults or custom pairs) can be used in tests.
   */
  private readonly registry: TransitionRegistry;

  /**
   * The resolved BaseTransition for the current navigation sequence.
   * Stored on the instance during out() so that in() uses the same
   * transition object that was resolved for the "from" route pair.
   */
  private _transition: BaseTransition | null = null;

  /**
   * Create a new TransitionManager.
   *
   * @param registry - The TransitionRegistry to resolve transitions from.
   *   Usually constructed with DefaultTransition as the fallback, but any
   *   BaseTransition subclass can be passed in for testing.
   */
  constructor(registry: TransitionRegistry) {
    this.registry = registry;
    dbg.tm("initialised");
  }

  /**
   * Execute the "out" phase of a page transition.
   *
   * Sequence:
   * 1. Resolve the active BaseTransition from the registry using the current
   *    route's old and new page keys.
   * 2. Call PageManager.beforeOut() so the outgoing page can run cleanup hooks.
   * 3. Start the transition.out() animation on the current (from) element.
   * 4. When transition.out() resolves, call callbacks.update() — this triggers
   *    Ctrl._in(), which calls TransitionManager.in() to start the second phase.
   *
   * Note: out() is intentionally NOT async from Ctrl's perspective. The async
   * work is managed internally via a promise chain. Ctrl resumes via the update
   * callback rather than by awaiting out() directly.
   *
   * @param callbacks - DOM and lifecycle callbacks supplied by Ctrl.
   */
  out(callbacks: TransitionCallbacks): void {
    dbg.tmOut("begin");

    // Resolve the transition for the current route pair
    this._transition = this.registry.resolve(
      App.route.old.page,
      App.route.new.page
    );

    // Call PageManager lifecycle — let the outgoing page clean up
    const runOut = async (): Promise<void> => {
      try {
        await PageManager.beforeOut();
      } catch {
        // Page lifecycle errors must not block navigation
      }

      dbg.tmOut("complete, calling update");
      callbacks.update();
    };

    // Fire and forget — errors are swallowed above; Ctrl will handle via _in()
    void runOut();
  }

  /**
   * Execute the "in" phase of a page transition.
   *
   * Sequence:
   * 1. Call callbacks.insertNew() — Ctrl inserts the new page HTML via
   *    insertAdjacentHTML so both old and new pages coexist in the DOM.
   * 2. Locate the fromEl (old page, first child) and toEl (new page, last child).
   * 3. Run transition.out(fromEl, toEl) and transition.in(fromEl, toEl)
   *    simultaneously via Promise.all — no stagger, as per CONTEXT.md.
   * 4. Wait TWO rAF frames (double-RAF) for the browser to commit the new layout.
   * 5. Update scroller active route.
   * 6. After a short delay (REMOVE_OLD_DELAY_MS), call callbacks.removeOld() so
   *    the old page element is removed without a visual pop.
   * 7. Call PageManager.afterIn() for post-mount page lifecycle hooks.
   *
   * @param callbacks - DOM and lifecycle callbacks supplied by Ctrl.
   * @returns A Promise that resolves when the full "in" phase is complete,
   *   including removeOld and afterIn(). Ctrl awaits this to clear App.mutating.
   */
  async in(callbacks: TransitionCallbacks): Promise<void> {
    dbg.tmIn("begin");

    const transition = this._transition;
    if (!transition) {
      console.warn("[transition-manager:in] no transition resolved — skipping animation");
      callbacks.insertNew();
      callbacks.removeOld();
      return;
    }

    // Step 1: Insert the new page HTML into the DOM
    callbacks.insertNew();

    // Step 2: Locate old and new page elements
    // After insertNew, the container has: [oldPage, newPage]
    // We read these from App.app — Ctrl sets App.app to the #app element
    const container = App.app;
    const fromEl = container?.children[0] as HTMLElement | null;
    const toEl = container?.lastElementChild as HTMLElement | null;

    // Step 3: Run both animations simultaneously
    if (fromEl && toEl) {
      dbg.tmIn("running out+in animations simultaneously");
      await Promise.all([
        transition.out(fromEl, toEl),
        transition.in(fromEl, toEl),
      ]);
    } else {
      dbg.tmIn("DOM elements not found, skipping animation");
    }

    // Step 4: Double-RAF — wait two animation frames for the browser to commit
    // the new layout. A single rAF fires before the browser paints; GPU bounds
    // capture needs measurements AFTER paint so two nested rAF calls are required.
    // Guard: requestAnimationFrame may be unavailable in SSR / test environments;
    // fall back to setTimeout(0) which provides equivalent microtask deferral.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      } else {
        setTimeout(resolve, 0);
      }
    });

    // Step 5: Update scroller active route
    try {
      App.scroller?.setActiveRoute?.(App.route.new.url ?? "/");
    } catch {
      // Scroller errors must not block navigation
    }

    // Step 6: Remove old page after short delay so there is no visual pop
    // on the final frame of the in() animation
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        callbacks.removeOld();
        resolve();
      }, REMOVE_OLD_DELAY_MS);
    });

    // Step 6b: Clear transition inline styles on the new page AFTER the old
    // page is gone. This prevents a layout reflow flash (absolute → relative)
    // while both pages coexist in the DOM.
    if (transition && toEl) {
      transition.cleanup(toEl);
      dbg.tm("cleared inline styles on new page");
    }

    // Step 6c: Re-measure scroller bounds now that the old page is removed and
    // transition styles are cleared. The resize() in setActiveRoute (step 5) ran
    // while both pages were in the DOM — max is stale until we remeasure here.
    try {
      App.scroller?.resize?.();
      console.debug("[transition:in] scroller resized after cleanup");
    } catch {
      // Scroller errors must not block navigation
    }

    // Step 7: PageManager post-mount lifecycle
    try {
      await PageManager.afterIn();
    } catch {
      // Page lifecycle errors must not block navigation
    }

    dbg.tmIn("complete");
  }
}
