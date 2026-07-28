/**
 * controller/index.ts — Ctrl class and installController factory.
 *
 * Ctrl is the centralized navigation controller for Tamahagane. It is the
 * single entry point that owns the full navigation lifecycle:
 *
 *   click / popstate
 *     → navigate(path)        [guard, lock, route update, side-effects]
 *     → TransitionManager.out [GPU prepare, PageManager.beforeOut, out anim]
 *     → _in()                 [called via update callback]
 *     → TransitionManager.in  [insertNew, simultaneous anims, GPU commit, removeOld]
 *     → finally               [clear lock, cancel safety timer]
 *
 * This replaces the four-file split of:
 *   - apps/fe/src/engine/router/index.ts (event delegation) — deleted Phase 03-03
 *   - apps/fe/src/app/controller.ts (out/in logic)        — deleted Phase 03-03
 *   - apps/fe/src/engine/router/transition.ts (GPU timing) — deleted Phase 03-03
 *
 * References:
 *   - ROUT-01: Single controller orchestrates full navigation lifecycle
 *   - ROUT-02: Event delegation on document intercepts link clicks and popstate
 *   - ROUT-03: Transition lock prevents concurrent navigation; 8s safety timeout
 *   - ROUT-05: Active nav link updates as a side-effect after route change
 *   - INFR-01: document.title updates on every route change before animation
 *   - INFR-03: finally-block cleanup ensures mutating always resets
 */

import { getFromCache } from "../cache";
import { App } from "../context";
import { dbg } from "../debug";

import { EmptyTransition } from "./transition-fx";
import { TransitionManager } from "./transition-manager";
import { TransitionRegistry } from "./transition-registry";
import { HomeDetailTransition } from "./transitions/home-to-detail";

import type { TransitionCallbacks } from "./types";

/**
 * Safety timeout duration (ms). If a full navigation sequence does not
 * complete within this window, App.mutating is force-reset so the user can
 * navigate again rather than being locked indefinitely.
 */
const TRANSITION_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Navigation-observer hook
// ---------------------------------------------------------------------------

/** Callback signature for `onNavigationCommitted()` — receives the pathname
 *  that was just pushed onto browser history. */
type NavigationObserver = (url: string) => void;

/**
 * Registered navigation observers. Deliberately generic (not preview- or
 * visual-editing-specific) — any future subsystem that needs to mirror SPA
 * pushState navigations (analytics, the Sanity Presentation URL bar, …) can
 * subscribe here instead of Ctrl growing a bespoke hook per consumer.
 */
const navigationObservers = new Set<NavigationObserver>();

/**
 * Registers a callback that fires with the new pathname immediately after
 * every `history.pushState()` call inside `Ctrl.navigate()` (skipped for
 * "back" navigations, which don't pushState — those are already observable
 * via the native `popstate` event). Introduced for
 * `src/app/preview/visual-editing.ts`, which needs Sanity Presentation's URL
 * bar to track in-iframe link clicks that never fire `popstate`.
 *
 * Invocation is wrapped in try/catch at the call site, so a throwing
 * observer can never break navigation.
 *
 * @param cb - Called with the new pathname after each forward navigation's
 *   pushState.
 * @returns An unsubscribe function.
 */
export function onNavigationCommitted(cb: NavigationObserver): () => void {
  navigationObservers.add(cb);
  return () => {
    navigationObservers.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Ctrl
// ---------------------------------------------------------------------------

/**
 * The centralized navigation controller.
 *
 * One instance is created at app boot via installController() and manages all
 * subsequent navigations. Ctrl is the "brain" of the routing system — it
 * coordinates the lock lifecycle, route state, DOM side-effects, and transition
 * choreography via TransitionManager.
 *
 * @example
 * const ctrl = installController();
 * // After this, all <a href> clicks and popstate events are handled.
 */
export class Ctrl {
  /**
   * The #app container element. Ctrl inserts new page HTML and removes old
   * page HTML directly on this element to achieve the dual-container pattern.
   */
  private readonly main: HTMLElement;

  /**
   * The TransitionRegistry that maps from/to route pairs to BaseTransition
   * instances. Constructed with DefaultTransition as the fallback. Public so
   * that app code can register custom transitions for specific route pairs.
   */
  readonly registry: TransitionRegistry;

  /**
   * The TransitionManager that coordinates the out/in animation phases via
   * the callback pattern. Constructed once; reused for every navigation.
   */
  private readonly transitionManager: TransitionManager;

  /**
   * The callback set for the current navigation sequence. Stored on the
   * instance so that navigate() and _in() share the same callbacks object
   * without passing it as a parameter through the async call boundary.
   */
  private _callbacks: TransitionCallbacks | null = null;

  /**
   * The safety timer handle for the current navigation. Cleared in finally
   * when _in() completes (or fails) to prevent the timer from firing after
   * a successful navigation.
   */
  private _safetyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The path being navigated to in the current sequence. Stored on the
   * instance so that _in() can log it in the finally block without it being
   * captured in a closure that may become stale.
   */
  private _currentPath: string = "";

  /**
   * Create a new Ctrl instance.
   *
   * @param main - The #app container element where page HTML is inserted.
   *   This element must remain in the DOM for the lifetime of the app.
   */
  constructor(main: HTMLElement) {
    this.main = main;
    this.registry = new TransitionRegistry(new EmptyTransition());
    // Custom pair: home → detail keeps the text-mode reveal image live across
    // the swap (see transitions/home-to-detail.ts). All other pairs use the
    // EmptyTransition default above.
    this.registry.register("home", "detail", new HomeDetailTransition());
    this.transitionManager = new TransitionManager(this.registry);

    dbg.ctrl("initialised");
  }

  /**
   * Navigate to a new path.
   *
   * The main entry point for all navigation. Guards against concurrent
   * navigation, sets the transition lock, updates route state, fires
   * document.title and nav link side-effects, then delegates to
   * TransitionManager.out() which calls back into _in() via the update
   * callback.
   *
   * Note: this method is intentionally NOT async at the top level for the
   * "out" phase. The out→in boundary is bridged by the update callback.
   * _in() is async and is awaited there.
   *
   * @param path   - The pathname to navigate to (e.g. "/about").
   * @param target - The source of navigation. Pass "back" for popstate
   *   (browser back/forward) to skip history.pushState. Any other value
   *   (anchor element, null) triggers pushState.
   */
  async navigate(path: string, target: EventTarget | string | null = null): Promise<void> {
    // Guard: prevent concurrent navigation
    if (App.mutating) {
      dbg.ctrl("navigation blocked — already mutating", path);
      return;
    }

    App.mutating = true;
    this._currentPath = path;

    // Lock scroll input for the entire mutation window — out phase, curtain,
    // and entrance — not just page.in() (PageManager.animateCurrentPageIn
    // pauses again for that inner span; pause/resume are idempotent). Resumed
    // wherever App.mutating is cleared: _in()'s finally and the safety valve.
    // Programmatic scrollTo (the scroll restore in initCurrentPage) bypasses
    // the pause, so restore-on-back still works.
    App.scroller?.pause();

    dbg.ctrlNav(App.route.new.url, "→", path);

    // Safety valve: force-reset the lock if navigation hangs longer than
    // TRANSITION_TIMEOUT_MS. This prevents the user from being permanently
    // locked out of navigation if an animation or async hook hangs.
    this._safetyTimer = setTimeout(() => {
      if (App.mutating) {
        console.warn("[ctrl] navigation timeout — force-resetting App.mutating");
        App.mutating = false;
        // The pause taken at navigate() start must release with the lock,
        // or a hung transition would leave scrolling dead forever.
        App.scroller?.resume();
      }
    }, TRANSITION_TIMEOUT_MS);

    // Update route state first so the new route is visible to all subscribers
    this._navigateRoute(path);
    App.target = target;

    // Side-effects that must happen before the animation starts:
    //   1. Update document.title from the cache entry (INFR-01)
    //   2. Update active nav link DOM classes (ROUT-05)
    const entry = getFromCache(path);
    if (entry?.title && typeof document !== "undefined") {
      document.title = entry.title;
      dbg.ctrlTitle(entry.title);
    }
    this._setActiveNavLink(path);

    // pushState before animation starts — skip for back nav.
    // Guard: history API may be unavailable in SSR / test environments.
    if (target !== "back" && typeof history !== "undefined") {
      history.pushState({ page: path }, "", path);
      dbg.ctrlHistory("pushState", path);

      // Notify any registered navigation observers (see onNavigationCommitted
      // above) now that the URL has actually committed. Never let a
      // misbehaving observer break navigation.
      for (const observer of navigationObservers) {
        try {
          observer(path);
        } catch (err) {
          console.error("[ctrl] navigation observer threw", err);
        }
      }
    }

    // Build the callbacks object for TransitionManager. Ctrl supplies DOM
    // operations; TransitionManager decides when to call them.
    //
    // The update callback bridges the async boundary between out() and _in().
    // A promise is created here so that navigate() can await the full sequence
    // (out→in) even though out() is synchronous from navigate()'s perspective.
    let resolveIn!: () => void;
    let rejectIn!: (err: unknown) => void;
    const inComplete = new Promise<void>((res, rej) => {
      resolveIn = res;
      rejectIn = rej;
    });

    this._callbacks = {
      update: () => {
        // Called by TransitionManager after out() completes. Start _in() and
        // wire its completion to the inComplete promise.
        this._in(entry?.html ?? "", resolveIn, rejectIn);
      },
      insertNew: () => {
        // Insert the new page HTML so old and new pages coexist in the DOM
        const html = entry?.html ?? "";
        this.main.insertAdjacentHTML("beforeend", html);
        // Track new container for page-manager and scroller
        App.container = this.main.lastElementChild as HTMLElement | null;
        dbg.ctrlDom("inserted new page");
      },
      removeOld: () => {
        // Remove the old (first) child after animation completes
        const old = this.main.children[0];
        if (old) {
          old.parentNode?.removeChild(old);
          dbg.ctrlDom("removed old page");
        }
      },
    };

    // Delegate to TransitionManager. out() fires the async chain internally
    // and calls callbacks.update() when the out phase is done.
    this.transitionManager.out(this._callbacks);

    // Await the full in() sequence before returning to the caller.
    await inComplete;
  }

  /**
   * Execute the "in" phase of the navigation.
   *
   * Called via the update callback supplied to TransitionManager.out().
   * This is an async method — it awaits TransitionManager.in() and then
   * clears the lock in the finally block to guarantee cleanup regardless
   * of errors.
   *
   * The resolveIn / rejectIn pair lets navigate() await the full out→in
   * sequence via the inComplete promise created in navigate().
   *
   * @param _html     - The HTML string for the new page (unused here; already
   *   captured in the insertNew callback closure from navigate()).
   * @param resolveIn - Resolve the inComplete promise to signal navigate() done.
   * @param rejectIn  - Reject the inComplete promise on unexpected error.
   */
  private async _in(_html: string, resolveIn: () => void, rejectIn: (err: unknown) => void): Promise<void> {
    if (!this._callbacks) {
      App.mutating = false;
      App.scroller?.resume();
      resolveIn();
      return;
    }

    try {
      await this.transitionManager.in(this._callbacks);
      resolveIn();
    } catch (err) {
      console.error("[ctrl] transition in() error", err);
      rejectIn(err);
    } finally {
      if (this._safetyTimer !== null) {
        clearTimeout(this._safetyTimer);
        this._safetyTimer = null;
      }
      App.mutating = false;
      // Release the whole-mutation scroll pause taken in navigate().
      App.scroller?.resume();
      dbg.ctrl("navigation complete", this._currentPath);
    }
  }

  /**
   * Update App route state for a navigation to the given path.
   *
   * Absorbed from apps/fe/src/app/controller.ts — identical logic. Maintains
   * App.route.old / App.route.new snapshots, App.is (current page flags), and
   * App.was (previous page flags) that page modules read for conditional logic.
   *
   * @param path - The pathname being navigated to.
   */
  private _navigateRoute(path: string): void {
    const pageKey = App.config.routes[path] ?? null;
    const prev = App.route.new;

    App.route.old = { ...prev };
    App.route.new = { url: path, page: pageKey };

    if (prev.page) App.is[prev.page] = false;
    if (pageKey) App.is[pageKey] = true;

    for (const k in App.was) App.was[k] = false;
    if (prev.page) App.was[prev.page] = true;

    dbg.ctrlRoute(App.route.old.page, "→", App.route.new.page);
  }

  /**
   * Update DOM nav link active-state classes for the given URL.
   *
   * Absorbed from apps/fe/src/app/controller.ts — identical logic. Applies
   * the "is-active", "is-case" classes to nav links and close/main link
   * elements to reflect the current route in the navigation UI.
   *
   * The entire method is wrapped in try/catch because nav link DOM state is
   * a cosmetic side-effect — it must never block navigation if the DOM is
   * in an unexpected state.
   *
   * @param url - The URL being navigated to.
   */
  private _setActiveNavLink(url: string): void {
    try {
      const normalized = url !== "/" ? url.replace(/\/$/, "") : "/";
      const links = document.querySelectorAll<HTMLElement>(".nav .nav-link[href]");
      const mainLinks = document.querySelectorAll<HTMLElement>(".main-link");
      const closeLink = document.querySelectorAll<HTMLElement>(".close-link");

      if (normalized !== "/" && normalized !== "/index") {
        // On non-home routes, mark nav UI as "case" (detail) mode
        closeLink.forEach((link) => {
          if (!link.classList.contains("is-case")) link.classList.add("is-case");
        });
        mainLinks.forEach((link) => {
          if (!link.classList.contains("is-case")) link.classList.add("is-case");
        });
      } else {
        // On home route, clear "case" mode and set the matching link as active
        closeLink.forEach((link) => {
          if (link.classList.contains("is-case")) link.classList.remove("is-case");
        });
        mainLinks.forEach((link) => {
          if (link.classList.contains("is-case")) link.classList.remove("is-case");
        });
        links.forEach((link) => {
          const href = link.getAttribute("href");
          if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) {
            link.classList.remove("is-active");
            return;
          }
          const linkUrl = href !== "/" ? href.replace(/\/$/, "") : "/";
          if (linkUrl === normalized) link.classList.add("is-active");
          else link.classList.remove("is-active");
        });
      }

      dbg.ctrlNavLink("active nav link updated for", normalized);
    } catch {
      // Silently ignore — nav link state is cosmetic
    }
  }
}

// ---------------------------------------------------------------------------
// installController
// ---------------------------------------------------------------------------

/**
 * Create and install a Ctrl instance as the application's navigation controller.
 *
 * Sets up event delegation on document for internal link clicks and on window
 * for popstate (back/forward). Both delegate to ctrl.navigate() so all
 * navigations go through the same lifecycle.
 *
 * This function replaces installRouter() from engine/router/index.ts.
 * The old file has been deleted in Phase 03-03.
 *
 * @returns The Ctrl instance, allowing callers to call navigate() directly
 *   for programmatic navigation (e.g., from page modules).
 * @throws Error if the #app element cannot be found in the DOM. This would
 *   indicate the HTML template is broken, so a hard throw is appropriate.
 */
export function installController(): Ctrl {
  const main = document.getElementById("app");
  if (!main) {
    throw new Error("[ctrl] #app element not found — check the HTML template");
  }
  App.app = main;

  const ctrl = new Ctrl(main);

  // Event delegation: intercept all internal link clicks on the document.
  // Uses closest("a") so clicks on child elements of an <a> are caught.
  // External links (http/mailto/tel/#) are excluded and passed through
  // normally — all schemes the CMS externalLink object allows.
  document.addEventListener("click", (evt: MouseEvent) => {
    const target = evt.target as Element | null;
    const anchor = target?.closest<HTMLAnchorElement>("a") ?? null;
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (
      !href ||
      href.startsWith("http") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#")
    ) {
      return;
    }

    const normalized = href !== "/" ? href.replace(/\/$/, "") : "/";
    evt.preventDefault();

    // Skip if already on this page
    if (location.pathname === normalized) return;

    dbg.ctrl(`navigate to ${normalized}`);
    void ctrl.navigate(normalized, anchor);
  });

  // popstate: browser back/forward navigation. Pass "back" as target so
  // history.pushState is skipped (the history entry already exists).
  window.addEventListener("popstate", () => {
    dbg.ctrl("popstate", location.pathname);
    void ctrl.navigate(location.pathname, "back");
  });

  dbg.ctrl("controller installed");
  return ctrl;
}
