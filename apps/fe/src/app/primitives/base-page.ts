/**
 * BasePage — base class for all route page modules.
 *
 * Every route's default export should extend BasePage to inherit the standard
 * lifecycle hook interface. The controller (Ctrl) and PageManager invoke these
 * hooks in a defined sequence for each navigation:
 *
 *   init(container) → in() [enter animations] → out() [exit animations] → cleanup()
 *
 * The `ctx` property holds optional contextual data passed by the PageManager
 * when the page class is instantiated. Subclasses should call super() in their
 * constructors to ensure initialization is complete.
 */

export interface PageContext {
  [key: string]: unknown;
}

export type ScrollDirection = "vertical" | "horizontal";

import { Anima, type AnimaState } from "kido/anima";
import { setTheme } from "kido/utils";

import { dbg } from "@app/debug";
import { initSlices } from "@app/slices";

import type { ScrollEvent } from "kido";

// Sitewide page fade contract: EVERY page enters over PAGE_IN_DURATION and
// leaves over PAGE_OUT_DURATION, both on kido's "slow" ease (the spring-fit
// curve — see Ease.slow in kido/utils). These are the fadeContainer() defaults
// and drive the base in()/out() hooks; pages that override the hooks (home,
// detail, contact/imprint) keep their own constants pinned to the same values
// so the whole site moves with one rhythm.
const PAGE_IN_DURATION = 1200;
const PAGE_OUT_DURATION = 800;
const PAGE_FADE_EASE = "slow";

export class BasePage {
  protected readonly ctx: PageContext;
  protected container: HTMLElement | null;
  protected sections: HTMLElement[];
  /** Aggregated teardown for slice runtime listeners — set by init(). */
  protected sliceTeardown: (() => void) | null = null;

  /**
   * Initializes the page instance with optional context data.
   * Sets up the container and sections arrays, and applies the light theme
   * to the document root. Subclasses should call super(ctx) first.
   *
   * @param ctx - Optional key-value context passed by PageManager at instantiation.
   */
  constructor(ctx: PageContext = {}) {
    this.ctx = ctx;
    this.container = null;
    this.sections = [];
    setTheme("light");
  }

  /**
   * Lifecycle hook called by PageManager when the route's DOM container
   * becomes available in the document. Stores the container reference on
   * the instance for subclass access. Subclasses should call super.init()
   * and then query their DOM elements.
   *
   * Auto-inits every interactive slice rendered into this page's container.
   * Each slice runtime is a self-contained module under
   * `apps/fe/src/app/slices/`; the registry there dispatches by the
   * `data-slice` attribute the Mustache partial emits, so pages don't need
   * to know which slices they contain.
   *
   * @param container - The mounted HTML element for this route, or null if unavailable.
   */
  async init(container?: Element | null): Promise<void> {
    this.container = (container as HTMLElement | null) || null;
    this.sliceTeardown = initSlices(this.container);
    // Start hidden. The page is configured here (and in subclass init) while
    // invisible, then revealed by in() — so navigating never flashes the
    // page's default/cached state before its real state is applied.
    if (this.container) this.container.style.opacity = "0";
    dbg.page("BasePage.init called");
  }

  /**
   * Fade `this.container` to a target opacity (0 or 1) over `duration` ms.
   * Always snaps to the opposite end first so the tween direction is
   * deterministic regardless of the element's current opacity. Resolves when
   * the animation completes. The site is DOM-only (no WebGPU), so page
   * transitions are plain container crossfades driven from in()/out().
   *
   * `opts.e` overrides the easing (defaults to the shared "slow" spring-fit
   * curve — see Ease.slow in kido/utils); `opts.de` adds a pre-fade delay in
   * ms. The element holds at the `from` opacity during the delay, so a delayed
   * fade-in stays cleanly hidden until it starts.
   */
  protected fadeContainer(
    to: 0 | 1,
    duration = to === 1 ? PAGE_IN_DURATION : PAGE_OUT_DURATION,
    opts: { e?: string | number[]; de?: number } = {}
  ): Promise<void> {
    const el = this.container;
    if (!el) return Promise.resolve();
    const from = to === 1 ? 0 : 1;
    el.style.opacity = String(from);
    return new Promise<void>((resolve) => {
      new Anima({
        el: window,
        d: duration,
        de: opts.de ?? 0,
        e: opts.e ?? PAGE_FADE_EASE,
        u: (state: AnimaState) => {
          el.style.opacity = String(from + (to - from) * state.prE);
        },
      }).play({ cb: () => resolve() });
    });
  }

  /**
   * Returns the list of scroll-reveal sections registered for this page.
   * Used by the scroller integration to set up IntersectionObserver callbacks.
   */
  getSections(): HTMLElement[] {
    return this.sections;
  }

  /**
   * Exit animation hook. Called by PageManager before the route's DOM
   * container is removed from the document. The default fades the container
   * out over PAGE_OUT_DURATION on the "slow" ease. Override in subclasses to
   * run content-level exit animations (e.g., fade out text, slide away
   * elements) — keep the same duration/ease so pages leave consistently.
   *
   * Note: page-level transition overlay animations (the slide-up wipe effect)
   * are handled by TransitionFx — this hook is for content animations only.
   */
  async out(): Promise<void> {
    await this.fadeContainer(0);
  }

  /**
   * Teardown hook called after out() completes and the page is being removed.
   * Override in subclasses to release resources, remove event listeners, or
   * clean up DOM state. Unlike out() which handles exit animations, cleanup()
   * handles non-visual teardown such as cancelling timers, unsubscribing from
   * events, or resetting shared state.
   *
   * The base implementation tears down every slice runtime registered by
   * `initSlices()` during `init()`. Subclasses that override should call
   * `super.cleanup()` so slice listeners and timers don't leak across
   * navigation.
   */
  async cleanup(): Promise<void> {
    if (this.sliceTeardown) {
      this.sliceTeardown();
      this.sliceTeardown = null;
    }
  }

  /**
   * Enter animation hook. Called by PageManager after the route's DOM
   * container has been inserted into the document and init() has run.
   * The default fades the container in over PAGE_IN_DURATION on the "slow"
   * ease. Override in subclasses to run content-level entrance animations
   * (e.g., staggered text reveal, image fade-in) — keep the same
   * duration/ease so pages enter consistently.
   */
  async in(): Promise<void> {
    await this.fadeContainer(1);
  }

  /**
   * Optional scroll callback invoked by the NativeScroller integration on
   * each scroll tick. Implement in subclasses to respond to scroll position
   * changes within the page (e.g., parallax effects, scroll-triggered reveals).
   *
   * @param e - The scroll event payload from kido's scroller.
   */
  onScroll?(e: ScrollEvent): void;
}

export default BasePage;
