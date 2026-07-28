/**
 * page-manager.ts — PageManager singleton for route page class registry.
 *
 * PageManager is responsible for:
 *   - Auto-discovering all route modules via import.meta.glob at build time
 *   - Registering page classes by folder-derived key (e.g. "home", "about")
 *   - Instantiating the correct page class for each route key via ensure()
 *   - Wiring page lifecycle hooks (out/in) into the navigation flow via
 *     beforeOut() and afterIn(), which are called by TransitionManager
 *
 * Zero-config registration: adding a new route only requires creating a folder
 * with an HTML template and a TypeScript module exporting a BasePage subclass.
 * No manual register() calls are needed.
 */

import { Reveal } from "kido/reveal";

import { App } from "@app/context";
import { dbg } from "@app/debug";
import { BasePage, type PageContext } from "@app/primitives/base-page";

/**
 * PageConstructor — the constructor signature all route page classes must satisfy.
 * PageManager uses this to instantiate page classes with an optional context object.
 */
type PageConstructor = new (ctx?: PageContext) => BasePage;

/**
 * PagePattern — a pattern-matching entry for keys that don't have exact registry entries.
 * Used when CMS-driven routes share a single page class (e.g. all case-study slugs).
 */
type PagePattern = { test: (key: string) => boolean; cls: PageConstructor };

/**
 * ScrollSnapshot — stores the last scroll position for a route key so the scroller
 * can restore position when navigating back to a previously visited page.
 */
type ScrollSnapshot = { cur: number; tar: number };

/**
 * CurrentPage — tracks the active page key and its live BasePage instance.
 * Set by afterIn() and read by beforeOut() for the current navigation cycle.
 */
type CurrentPage = { key: string; instance: BasePage };

/**
 * Auto-discovered route modules via Vite's import.meta.glob.
 * Resolved at build time — eager loading means all page classes are
 * synchronously available when the module is imported. The glob pattern is
 * relative to this file (src/app/page-manager.ts), so "../routes/*\/*.ts"
 * resolves to src/routes/{name}/{name}.ts for every route folder.
 *
 * The glob does NOT match files in src/routes/partials/ because there are
 * no TypeScript files there — only HTML/Mustache partials.
 */
const routeModules = import.meta.glob<{ default: PageConstructor }>(
  "../routes/*/*.ts",
  { eager: true }
);

/**
 * PageManagerImpl — the singleton page class registry and lifecycle coordinator.
 *
 * Maintains a map of route keys to page constructors (populated by autoRegister
 * at module load), tracks the current active page instance, saves/restores scroll
 * position across navigations, and wires page-level lifecycle hooks (out/in) into
 * the TransitionManager flow via beforeOut() and afterIn().
 */
class PageManagerImpl {
  private readonly registry: Map<string, PageConstructor>;
  private readonly patterns: PagePattern[];
  private current: CurrentPage | null;
  private readonly scrollState: Record<string, ScrollSnapshot>;
  private reveal: Reveal = new Reveal();
  private scrollerUnsub: null | (() => void) = null;

  /**
   * Initialise the PageManagerImpl with empty registry and state.
   * autoRegister() is called at module scope after instantiation to populate
   * the registry from the glob result without polluting the constructor.
   */
  constructor() {
    this.registry = new Map();
    this.patterns = [];
    this.current = null;
    this.scrollState = Object.create(null);
  }

  /**
   * Automatically register all route modules discovered by import.meta.glob.
   *
   * Iterates the module-scope routeModules object (resolved by Vite at build time)
   * and extracts the folder name from each glob path key. The path format is
   * "../routes/{folderName}/{file}.ts", so .at(-2) on the split segments gives
   * the folder name which becomes the page key.
   *
   * Entries with a missing folderName or missing mod.default are silently skipped.
   * This makes autoRegister() safe to call even when a route folder has a .ts file
   * that is not a page module.
   *
   * Called once at module scope immediately after `export const PageManager`.
   */
  autoRegister(): void {
    for (const [filePath, mod] of Object.entries(routeModules)) {
      const folderName = filePath.split("/").at(-2);
      if (!folderName || !mod.default) continue;
      this.register(folderName, mod.default);
      dbg.pageAuto("registered", folderName);
    }
  }

  /**
   * Register a page class under an exact string key.
   * Silently ignores empty keys or missing class. Returns this for chaining.
   *
   * @param key       - The route key (e.g. "home", "about", "case-study").
   * @param PageClass - The constructor for the page class to register.
   */
  register(key: string, PageClass: PageConstructor): this {
    if (key && PageClass) this.registry.set(key, PageClass);
    return this;
  }

  /**
   * Register a pattern-matching fallback for route keys that don't have exact entries.
   * Useful for CMS-driven routes where many URL slugs map to the same page class.
   * Patterns are checked in insertion order after the exact registry lookup fails.
   *
   * @param testFn    - A predicate that returns true for keys this pattern should match.
   * @param PageClass - The page class to use when the pattern matches.
   */
  registerPattern(
    testFn: (key: string) => boolean,
    PageClass: PageConstructor
  ): this {
    if (typeof testFn === "function" && PageClass)
      this.patterns.push({ test: testFn, cls: PageClass });
    return this;
  }

  /**
   * Resolve a route key to its registered page class.
   * Checks the exact registry first, then falls through to pattern matches.
   * Returns null if no match is found — callers use ensure() for a guaranteed instance.
   *
   * @param key - The route key to look up.
   */
  resolve(key?: string | null): PageConstructor | null {
    if (!key) return null;
    if (this.registry.has(key)) return this.registry.get(key) ?? null;
    const pattern = this.patterns.find((p) => p.test(key));
    return pattern ? pattern.cls : null;
  }

  /**
   * Instantiate the page class for the given key, falling back to BasePage
   * for unregistered keys. Never throws — always returns a valid BasePage instance.
   *
   * @param key - The route key to instantiate (e.g. "home", "about").
   */
  ensure(key?: string | null): BasePage {
    const PageCls = this.resolve(key) || BasePage;
    return new PageCls({ key, App });
  }

  /**
   * Return the registered page constructor for the given key, or null.
   * Used when callers need the class itself rather than an instance.
   *
   * @param key - The route key to look up.
   */
  getPageClass(key?: string | null): PageConstructor | null {
    return this.resolve(key);
  }

  /**
   * Return the current page tracking entry (key + instance), or null if no
   * navigation has completed yet.
   */
  getCurrent(): CurrentPage | null {
    return this.current;
  }

  /**
   * Return the live BasePage instance for the currently active route, or null.
   */
  getCurrentInstance(): BasePage | null {
    return this.current?.instance ?? null;
  }

  /**
   * Return the scroll-reveal section elements for the current page.
   * Used by the scroller integration to know which sections to observe.
   */
  getCurrentSections(): HTMLElement[] {
    const instance = this.current?.instance;
    return instance?.getSections?.() ?? [];
  }

  /**
   * Called by TransitionManager before the out-animation starts.
   * Reads App.route.old.page to find the outgoing page key, then calls out()
   * on the current page instance (or a temporary instance if current doesn't match).
   *
   * Also saves scroll position and tears down the scroller subscription and reveal
   * system so they are not running during the transition animation.
   */
  async beforeOut(): Promise<void> {
    try {
      const prevKey = App.route?.old?.page || null;
      if (!prevKey) return;

      dbg.pageOut(prevKey);

      if (this.current && this.current.key === prevKey) {
        try {
          // scroller is a runtime property on subclass instances, not on BasePage type
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sc = (this.current.instance as any)?.scroller as
            | { cur: number; tar: number }
            | undefined;
          if (sc) this.scrollState[prevKey] = { cur: sc.cur, tar: sc.tar };
        } catch {}

        try {
          if (this.scrollerUnsub) this.scrollerUnsub();
        } catch {}
        this.scrollerUnsub = null;

        try {
          this.reveal.destroy();
        } catch {}

        await (this.current.instance?.out?.() || Promise.resolve());
      } else {
        const tmp = this.ensure(prevKey);
        await (tmp.out?.() || Promise.resolve());
      }
    } catch (e) {
      console.warn("[page:out] error", e);
    }
  }

  /**
   * Initialise the incoming page without running its entrance animation.
   *
   * Creates the page instance, wires up the Reveal system, calls page.init(),
   * and restores scroll position. Called during boot so pages can set initial
   * state (e.g. GPU plane opacity 0) before the intro overlay wipes away.
   */
  async initCurrentPage(): Promise<void> {
    try {
      const nextKey = App.route?.new?.page || null;
      if (!nextKey) return;

      dbg.pageIn(nextKey);

      const instance = this.ensure(nextKey);
      this.current = { key: nextKey, instance };

      try {
        const container =
          (App.container as HTMLElement | null) ||
          (document.getElementById("page") as HTMLElement | null);

        this.reveal.init({
          root: container,
          selectors: {
            split: "._s",
          },
          getScrollPosition: () => App.scroller?.current ?? 0,
        });
        await instance.init(container);
      } catch {}

      // Recalculate scroller bounds against the freshly-initialised page before
      // restoring scroll. init() may change the content height (e.g. Home
      // restoring its persisted Image vs Text mode), and the earlier resize in
      // TransitionManager ran while the page was still in its cached default —
      // so without this, scrollTo() below would clamp to a stale max.
      try {
        App.scroller?.resize?.();
      } catch {}

      // ROUT-04: Restore scroll position on back-navigation; always start at top on forward nav.
      // NativeScroller.scrollTo(position, immediate=true) performs an instant jump (no animation).
      // The `any` cast is needed because the `Scroller | NativeScroller` union type does not
      // expose scrollTo in the shared type definition — it exists on NativeScroller at runtime.
      try {
        if (App.target === "back") {
          const snap = this.getScroll(nextKey);
          if (snap && (snap.cur > 0 || snap.tar > 0) && App.scroller) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (App.scroller as any).scrollTo?.(snap.tar, true);
            dbg.pageScroll("restored", nextKey, snap.tar);
          }
        } else if (App.scroller) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (App.scroller as any).scrollTo?.(0, true);
          dbg.pageScroll("reset to top for forward nav");
        }
      } catch {
        // Scroll restore errors must never block the page lifecycle
      }

      console.debug("[page:initCurrentPage] page.init() complete for", nextKey);
    } catch (e) {
      console.warn("[page:initCurrentPage] error", e);
    }
  }

  /**
   * Run the current page's entrance animation and subscribe to the scroller.
   *
   * Called after the intro overlay has finished so entrance animations are
   * visible. During navigation transitions, afterIn() calls this internally.
   */
  async animateCurrentPageIn(): Promise<void> {
    try {
      const instance = this.current?.instance;
      if (!instance) return;

      // Lock scroll input for the full duration of the entrance animation so
      // the page settles into place before the user can scroll. pause() only
      // ignores user wheel/touch/keyboard/native-scroll input — the damping RAF
      // and programmatic scrollTo (scroll restore already ran in
      // initCurrentPage) are unaffected. Resumed in finally so a throwing in()
      // can never leave scrolling stuck. onScroll is subscribed only after the
      // resume below, so per-page scroll hooks never fire mid-entrance.
      App.scroller?.pause();
      try {
        await (instance.in?.() || Promise.resolve());
      } finally {
        App.scroller?.resume();
      }

      try {
        if (App.scroller) {
          if (this.scrollerUnsub) this.scrollerUnsub();
          this.scrollerUnsub = App.scroller.subscribe((e) => {
            try {
              instance.onScroll?.(e);
            } catch {}
          });
        }
      } catch {}

      console.debug("[page:animateCurrentPageIn] page.in() complete");
    } catch (e) {
      console.warn("[page:animateCurrentPageIn] error", e);
    }
  }

  /**
   * Called by TransitionManager after the in-animation starts and new DOM is ready.
   * Convenience method that runs initCurrentPage() then animateCurrentPageIn()
   * in sequence. Used during navigation transitions where both phases happen together.
   *
   * Sets this.current so subsequent beforeOut() calls can reference the active page.
   */
  async afterIn(): Promise<void> {
    await this.initCurrentPage();
    await this.animateCurrentPageIn();
  }

  /**
   * Populate the registry with BasePage fallbacks for all route keys in App.config.routes
   * that don't already have a registered page class.
   *
   * Called at app boot as a safety net so every known route key has at least a
   * BasePage instance available, even if its page module failed to load. Routes
   * with a class registered via autoRegister() are not overwritten.
   */
  registerFromRoutes(): void {
    try {
      const map = App.config?.routes || {};
      Object.values(map).forEach((key) => {
        if (!key) return;
        if (!this.resolve(key)) this.register(key, BasePage);
      });
      dbg.pageMgr("registerFromRoutes complete");
    } catch {}
  }

  /**
   * Return the saved scroll snapshot for the given route key.
   * Returns {cur: 0, tar: 0} if no snapshot exists (e.g. first visit to this route).
   *
   * @param key - The route key to look up.
   */
  getScroll(key: string | null | undefined): ScrollSnapshot {
    return (key && this.scrollState[key]) || { cur: 0, tar: 0 };
  }

  /**
   * Save a scroll position snapshot for the given route key.
   * Called during beforeOut() to persist the scroller position before navigation.
   *
   * @param key   - The route key to save.
   * @param value - The scroll snapshot to store.
   */
  setScroll(
    key: string | null | undefined,
    value?: { cur?: number; tar?: number }
  ): void {
    if (key && value) {
      this.scrollState[key] = {
        cur: Number(value.cur) || 0,
        tar: Number(value.tar) || 0,
      };
    }
  }
}

export const PageManager = new PageManagerImpl();

/**
 * Auto-register all route modules discovered via import.meta.glob.
 * Called immediately after singleton creation so the registry is populated
 * before any navigation can occur.
 */
PageManager.autoRegister();

App.pageManager = PageManager;

export default PageManager;
