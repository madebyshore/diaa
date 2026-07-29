/**
 * controllers/page-controller.ts — the PageController contract, ported from
 * diaa's BasePage (apps/fe/src/app/primitives/base-page.ts). Every route's
 * imperative DOM choreography (home/detail/contact/imprint) implements this
 * shape; `transitions/default.ts` and `composables/usePageController.ts`
 * orchestrate lifecycle calls against whichever controller is registered for
 * the current route.
 *
 * No GPU fields (cardStyle/onBind/onFrame/onResize/freezeBounds) — diaa is
 * already DOM-only (GPU was kill-switched before this port started), so only
 * the DOM lifecycle shape transfers from the reference tamahagane-nuxt build.
 *
 * `in()`/`out()` are MANDATORY (not optional) — every diaa page has visible
 * content-fade timing, unlike a GPU-plane-only default. BaseController below
 * supplies the default 1200ms-in/800ms-out "slow"-ease container fade
 * (ported from BasePage.fadeContainer) that home/detail/rich-text-page
 * override or extend.
 */
import { gsap } from "gsap";

/** Scroll event payload passed to onScroll — shape matches what
 *  composables/useLenisScroll.ts bridges from Lenis's "scroll" event
 *  (desktop) or native window scroll (mobile fallback). */
export interface ScrollEvent {
  current: number;
  target: number;
  max: number;
}

export interface PageController {
  /**
   * Page mount. `root` = THIS page's element (query scoped, never
   * `document` — during a transition BOTH pages are in the DOM). Set up
   * refs, wire listeners, restore persisted UI state — all while the
   * transition has already pinned this element hidden (see
   * transitions/default.ts's onBeforeEnter). Equivalent to
   * `BasePage.init()`'s body (after `super.init()`).
   *
   * Called SYNCHRONOUSLY by transitions/default.ts's onBeforeEnter for every
   * SPA navigation (not via composables/usePageController.ts's onMounted —
   * see that file's header comment for why). On first page load (no
   * transition runs), composables/useBoot.ts calls this directly instead.
   */
  onInit(root: HTMLElement): void;

  /** Page unmount. Tear down everything onInit created. Equivalent to
   *  BasePage.cleanup(). */
  onDestroy(): void;

  /**
   * Entrance. Called by the transition's onEnter AFTER the outgoing page's
   * out() has resolved (sequential, matching diaa's beforeOut→afterIn
   * ordering) and after scroll restore has run. Resolve when the animation
   * completes. Equivalent to BasePage.in().
   */
  in(root: HTMLElement): Promise<void>;

  /**
   * Exit. Called by the transition's onLeave, `root` = the LEAVING element
   * (about to be removed). Equivalent to BasePage.out().
   */
  out(root: HTMLElement): Promise<void>;

  /**
   * Scroll hook — subscribed via useLenisScroll after in() resolves,
   * unsubscribed before out() runs. Equivalent to BasePage's onScroll.
   */
  onScroll?(e: ScrollEvent): void;
}

// Sitewide page fade contract, ported from BasePage's PAGE_IN_DURATION/
// PAGE_OUT_DURATION/PAGE_FADE_EASE constants. GSAP durations are in SECONDS,
// not ms — 1200ms/800ms become 1.2/0.8.
const PAGE_IN_DURATION = 1.2;
const PAGE_OUT_DURATION = 0.8;
const PAGE_FADE_EASE = "slow";

/**
 * BaseController — the default container crossfade every page controller
 * can extend or fully override. Mirrors BasePage.fadeContainer/in()/out()
 * exactly: snaps to the opposite end first (deterministic tween direction),
 * then tweens opacity over the given duration/ease.
 */
export class BaseController implements PageController {
  onInit(root: HTMLElement): void {
    // Start hidden — configured here (and in subclass onInit) while
    // invisible, then revealed by in(), so navigating never flashes the
    // page's default/cached state before its real state is applied.
    root.style.opacity = "0";
  }

  onDestroy(): void {}

  in(root: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      gsap.set(root, { opacity: 0 });
      gsap.to(root, {
        opacity: 1,
        duration: PAGE_IN_DURATION,
        ease: PAGE_FADE_EASE,
        onComplete: resolve,
      });
    });
  }

  out(root: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      gsap.set(root, { opacity: 1 });
      gsap.to(root, {
        opacity: 0,
        duration: PAGE_OUT_DURATION,
        ease: PAGE_FADE_EASE,
        onComplete: resolve,
      });
    });
  }
}
