/**
 * apps/fe/src/app/index.ts — Application bootstrap entry point.
 *
 * Application.init() orchestrates five discrete boot phases. Each phase has a
 * single responsibility and awaits the previous phase before starting. All
 * rendering is DOM-only — there is no WebGPU engine. Initialization
 * (controller, scroller, page.init()) completes BEFORE the intro overlay wipes
 * away, so pages can set initial state without flashing.
 *
 * Boot phases:
 *   1. Intro       — new Intro() (overlay ready, no preloading needed)
 *   2. Controller  — history.scrollRestoration + installController()
 *   3. Scroller + page init — NativeScroller + PageManager.initCurrentPage()
 *   4. Intro animation — await intro.play() (DIAA fades in, holds, overlay fades out)
 *   5. Page entrance — PageManager.animateCurrentPageIn() (visible animations)
 */

import { NativeScroller } from "kido/native-scroller";

import { Intro } from "@engine/boot/intro";

import { loadPkg } from "./cache";
import { App } from "./context";
import { installController } from "./controller";
import { dbg } from "./debug";
import { PageManager } from "./page-manager";
import { maybeEnableVisualEditing } from "./preview/visual-editing";
import { bootstrap, resetScrollPosition } from "./utils";

/**
 * Top-level application orchestrator.
 *
 * A single Application instance is created at page load and init() is awaited
 * once. It is NOT a singleton — tests can create multiple instances without
 * side-effects on module-level state.
 */
export class Application {
  /**
   * URL at the time the Application was created. Used for bootstrap() to
   * pre-populate route state before any navigation occurs.
   */
  private url: string | null;

  /**
   * Create an Application instance. Does not start any async operations —
   * call init() to run the boot sequence.
   */
  constructor() {
    this.url = typeof location !== "undefined" ? location.pathname : null;
  }

  /**
   * Run the five-phase boot sequence.
   *
   * Each phase is clearly separated with console.debug markers so the sequence
   * can be traced in DevTools. The method resolves when all phases are
   * complete and the application is fully operational.
   */
  async init(): Promise<void> {
    if (!this.url) {
      console.error("[app] No url found.");
      return;
    }

    // Reset scroll position to top before any rendering
    resetScrollPosition();

    // Load route cache (tmhgne.json) before bootstrapping
    await loadPkg();

    // Bootstrap: populate App.config, App.route, initial DOM state
    await bootstrap(this.url);

    // -----------------------------------------------------------------------
    // Phase 1 — Intro
    // -----------------------------------------------------------------------
    dbg.bootPhase(1, "intro");

    // Create the intro animation object. No preloading is needed — the GPU
    // engine has been removed, so the overlay is purely a brand beat.
    const intro = new Intro();

    // -----------------------------------------------------------------------
    // Phase 2 — Controller install
    // -----------------------------------------------------------------------
    dbg.bootPhase(2, "controller install");

    // Disable browser scroll restoration before any pushState calls so the
    // browser does not try to restore scroll position on back navigation —
    // the NativeScroller handles this explicitly.
    if (typeof history !== "undefined") {
      history.scrollRestoration = "manual";
    }

    const ctrl = installController();
    App.ctrl = ctrl;

    // Fire-and-forget: enables Sanity Visual Editing overlays when this page
    // is served by the preview deployment (gated on window.__PREVIEW__ —
    // see src/app/preview/visual-editing.ts). A no-op everywhere else. The
    // function already catches its own errors; the .catch() here is a second
    // safety net so a rejected promise can never surface as an unhandled
    // rejection and must never block the boot sequence below.
    void maybeEnableVisualEditing().catch((err: unknown) => {
      console.debug("[visual-editing] boot hook failed:", err);
    });

    // -----------------------------------------------------------------------
    // Phase 3 — Scroller init + page init (before intro)
    // -----------------------------------------------------------------------
    dbg.bootPhase(3, "scroller + page init");

    try {
      App.scroller = new NativeScroller({
        container: document.querySelector('#app'),
        damping: 0.1,
      });

      // Register all configured routes with the scroller so each route has
      // its own scroll position tracked independently.
      const routes = Object.keys(App.config.routes);
      for (const route of routes) {
        App.scroller.registerRoute(route);
      }

      App.scroller.setActiveRoute(App.route.new.url ?? "/");
      App.scroller.start();

      // Register page classes and run page.init() — sets up initial state
      // (split text offscreen, etc.) BEFORE the intro overlay wipes away.
      // Matches the original akimbo boot order.
      PageManager.registerFromRoutes?.();
      await PageManager.initCurrentPage();
    } catch (err) {
      console.error("[boot:phase3] scroller/page init error:", err);
    }

    // -----------------------------------------------------------------------
    // Phase 4 — Intro animation
    // -----------------------------------------------------------------------
    dbg.bootPhase(4, "intro animation");

    // Play the wipe-up animation. The intro overlay covers everything until
    // this completes. Pages are already initialised (Phase 3) so text is
    // offscreen — no flash of unstyled content.
    await intro.play();

    // -----------------------------------------------------------------------
    // Phase 5 — Page entrance animations
    // -----------------------------------------------------------------------
    dbg.bootPhase(5, "page entrance animations");

    try {
      // Run the page's in() hook now that the intro overlay has cleared.
      // Triggers entrance animations (split text reveals, paragraph fade-ins)
      // that are visible to the user.
      await PageManager.animateCurrentPageIn();
    } catch (err) {
      console.error("[boot:phase5] page entrance animation error:", err);
    }

    // Wire global keyboard shortcuts
    this.globalKeyboardEvents();

    dbg.boot("application ready");
  }

  /**
   * Wire global keyboard shortcuts.
   *
   * Ctrl+G — toggle developer grid overlay (.dev-grid)
   */
  private globalKeyboardEvents(): void {
    if (typeof window === "undefined") return;

    window.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        const key = (event.key ?? "").toLowerCase();

        if (event.ctrlKey && key === "g") {
          const devGrid = document.querySelector<HTMLElement>(".dev-grid");
          devGrid?.classList.toggle("is-active");
          return;
        }
      },
      { passive: true }
    );
  }
}
