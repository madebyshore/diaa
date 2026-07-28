/**
 * BaseTransition and TransitionRegistry — the foundational contracts for the
 * page transition subsystem.
 *
 * BaseTransition defines the abstract lifecycle that every transition animation
 * must implement: an `out` phase that animates the old page away, and an `in`
 * phase that animates the new page in. Both phases return Promises so that
 * the orchestrator (TransitionManager / Ctrl) can await them sequentially.
 *
 * TransitionRegistry is a registry that maps "fromKey:toKey" route pairs to
 * specific BaseTransition instances. When a route-specific transition is not
 * registered, the registry falls back to a default transition supplied at
 * construction time. This enables a single default transition for the common
 * case while allowing custom animations for specific route pairs.
 *
 * References:
 *   - TRAN-01: BaseTransition abstract class
 *   - TRAN-02: TransitionRegistry resolve with fallback
 *   - TRAN-04: TransitionRegistry register for specific route pairs
 */

import { dbg } from "../debug";

// ---------------------------------------------------------------------------
// BaseTransition
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all page transitions.
 *
 * Concrete subclasses implement the `out` and `in` methods to define the
 * animation behaviour. The `out` method animates the current (fromEl) page
 * out of view; the `in` method animates the next (toEl) page into view.
 * Both must return a Promise that resolves when the animation is complete
 * so the orchestrator can sequence them safely.
 *
 * @example
 * class SlideTransition extends BaseTransition {
 *   async out(fromEl, toEl) { ... }
 *   async in(fromEl, toEl) { ... }
 * }
 */
export abstract class BaseTransition {
  /**
   * Animate the outgoing page element out of view.
   *
   * Called by TransitionManager before inserting the new page. The returned
   * Promise must resolve only when the out animation is fully complete so
   * the orchestrator knows it is safe to proceed to the `in` phase.
   *
   * @param fromEl - The DOM element of the page that is leaving.
   * @param toEl   - The DOM element of the page that is entering (may be used
   *                 for coordinated animations, e.g. shared-element transitions).
   */
  abstract out(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;

  /**
   * Animate the incoming page element into view.
   *
   * Called by TransitionManager after the DOM has been updated (old page
   * removed, new page inserted). The returned Promise must resolve when the
   * in animation is fully complete so the orchestrator can run post-mount
   * teardown (scrollers, GPU scenes, etc.).
   *
   * @param fromEl - The DOM element of the page that has left.
   * @param toEl   - The DOM element of the page that is entering.
   */
  abstract in(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;

  /**
   * Clear any inline styles set during the transition.
   *
   * Called by TransitionManager AFTER removeOld() so the layout reflow from
   * fixed → static positioning happens when only the new page is in the DOM.
   * Override this if your transition sets inline styles on toEl during in().
   *
   * @param toEl - The new page element whose inline styles should be cleared.
   */
  cleanup(toEl: HTMLElement): void {
    toEl.removeAttribute("style");
  }
}

// ---------------------------------------------------------------------------
// TransitionRegistry
// ---------------------------------------------------------------------------

/**
 * Registry that maps "fromKey:toKey" route-pair strings to BaseTransition
 * instances, with a default fallback for unregistered pairs.
 *
 * The registry is constructed with a mandatory default transition. Custom
 * transitions are then registered for specific route pairs via `register`.
 * At navigation time, `resolve` looks up the pair and returns either the
 * specific transition or the default.
 *
 * Null keys are normalised to the wildcard token "*" so that null-safe
 * resolution is handled transparently — the resolved key "*:*" will never
 * match a registered pair and therefore always falls back to the default.
 *
 * @example
 * const registry = new TransitionRegistry(new DefaultTransition());
 * registry.register("home", "about", new SlideTransition());
 * const transition = registry.resolve("home", "about"); // SlideTransition
 */
export class TransitionRegistry {
  /** Internal map keyed by "fromKey:toKey" strings. */
  private readonly map: Map<string, BaseTransition>;

  /** Fallback transition used when no route-specific entry exists. */
  private readonly defaultTransition: BaseTransition;

  /**
   * Create a new registry with the given default transition.
   *
   * The default transition is used whenever `resolve` cannot find a
   * registered entry for the requested route pair.
   *
   * @param defaultTransition - Must be a fully-initialised BaseTransition instance.
   */
  constructor(defaultTransition: BaseTransition) {
    this.map = new Map<string, BaseTransition>();
    this.defaultTransition = defaultTransition;
    dbg.registry("initialised with default transition", defaultTransition.constructor.name);
  }

  /**
   * Register a custom transition for a specific route pair.
   *
   * The pair is stored as the composite key "<fromKey>:<toKey>" so that
   * look-ups are O(1). Registrations are last-write-wins — calling register
   * again with the same pair overwrites the previous entry.
   *
   * @param fromKey    - The route key of the page being left (e.g. "home").
   * @param toKey      - The route key of the page being entered (e.g. "about").
   * @param transition - The BaseTransition instance to use for this pair.
   */
  register(fromKey: string, toKey: string, transition: BaseTransition): void {
    const key = this._makeKey(fromKey, toKey);
    this.map.set(key, transition);
    dbg.registry(`registered "${key}" -> ${transition.constructor.name}`);
  }

  /**
   * Resolve the transition for a given route pair.
   *
   * Looks up the "<fromKey>:<toKey>" entry in the registry. If no entry is
   * found — or if either key is null — returns the default transition.
   *
   * @param fromKey - The route key of the page being left, or null if unknown.
   * @param toKey   - The route key of the page being entered, or null if unknown.
   * @returns The registered transition for the pair, or the default transition.
   */
  resolve(fromKey: string | null, toKey: string | null): BaseTransition {
    const key = this._makeKey(
      fromKey ?? "*",
      toKey ?? "*"
    );

    const found = this.map.get(key);

    if (found !== undefined) {
      dbg.registry(`resolved "${key}" -> ${found.constructor.name}`);
      return found;
    }

    dbg.registry(`no match for "${key}", using default`);
    return this.defaultTransition;
  }

  /**
   * Build the composite registry key from a from/to route key pair.
   *
   * @param fromKey - The from route key (already null-normalised by the caller).
   * @param toKey   - The to route key (already null-normalised by the caller).
   * @returns A string of the form "fromKey:toKey".
   */
  private _makeKey(fromKey: string, toKey: string): string {
    return `${fromKey}:${toKey}`;
  }
}
