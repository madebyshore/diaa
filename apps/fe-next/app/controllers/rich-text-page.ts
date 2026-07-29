import { gsap } from "gsap";

import { skipNextHomeBeat } from "~/lib/beat-skip";

import type { PageController, ScrollEvent } from "~/controllers/page-controller";

/**
 * controllers/rich-text-page.ts — shared lifecycle factory for CMS singleton
 * pages that render a single centered rich-text body followed by a
 * full-viewport DIAA outro (Contact, Imprint), ported from
 * apps/fe/src/app/primitives/rich-text-page.ts.
 *
 * Both pages are structurally identical to the Detail page minus the cover
 * image / slices / home-bridge branch: a fixed passive title heading, a
 * 100vh centered text panel, a 100vh brand outro, and a persistent fixed
 * `( Close )` footer as the way home (same model as the detail page — there
 * is no hover title ⇄ "( Close )" swap). The detail page's desktop outro
 * choreography is shared too: the title fades out once the outro scrolls
 * into view, and resting at the very bottom auto-navigates home. That
 * behavior is extracted here once instead of duplicated per page —
 * `createRichTextController(pageKey)` takes a BEM block name that doubles as
 * the dbg label AND the nav/outro selector scope (`.{pageKey}__nav`,
 * `.{pageKey}__outro`).
 *
 * Ported as a FACTORY returning a fresh `PageController`, not a class with
 * module-scope state (contrast controllers/home.ts's single module-scope
 * instance, Phase 5b) — `pages/[slug].vue` renders BOTH Contact and Imprint
 * through this same factory, and while only one is ever mounted at a time,
 * giving each call its own closured state (rather than sharing module-level
 * `let`s) means there is never a risk of one page's nav-hide tween or
 * bottom-dwell timer leaking into the other's, even across fast repeated
 * navigation.
 *
 * Container lifecycle:
 *   onInit(): pin container opacity to 0 so it stays invisible until in()
 *             fades up, and query the nav/outro for the desktop outro
 *             choreography.
 *   in():     fade container 0 → 1, mirroring the detail/home entrance
 *             timing exactly so every page transition feels consistent.
 *   out():    800ms content fade on the same "slow" ease before the swap.
 */

// Entrance/exit fades — mirror DetailPage/home exactly so every page moves
// with identical timing: a 200ms hold after the previous page clears, then a
// 1200ms container fade in — and an 800ms fade out — on kido's "slow" ease
// (the shared brand-beat spring-fit curve — see Ease.slow in kido/utils).
// GSAP durations are SECONDS, not ms.
const IN_DURATION = 1.2;
const IN_DELAY = 0.2;
const IN_EASE = "slow";
const OUT_DURATION = 0.8;

// Desktop outro choreography — mirrors DetailPage (keep in sync with the
// constants in controllers/detail.ts):
// - The title nav fades out over NAV_HIDE_DURATION once the outro section
//   enters the viewport, and back in when the user scrolls above it.
// - Resting at the very bottom of the page for BOTTOM_DWELL_MS auto-navigates
//   home through the normal SPA transition. Scrolling away (target moving off
//   the bottom) before the dwell elapses cancels it silently.
// BOTTOM_EPSILON absorbs sub-pixel rounding in Lenis's damped scroll value.
const NAV_HIDE_DURATION = 0.4;
// Linear — matches diaa's inline `[0, 0, 1, 1]` bezier array exactly. GSAP's
// built-in "none" ease is linear, so no CustomEase registration is needed.
const NAV_FADE_EASE = "none";
const BOTTOM_DWELL_MS = 300;
const BOTTOM_EPSILON = 2;
// The nav fades out once the outro has scrolled up far enough that its top
// edge crosses this fraction of the viewport height (0.5 = the vertical
// midpoint). The main panel is exactly 100vh tall, so at scroll 0 the outro's
// top edge sits at the viewport bottom (top === clientHeight) — comfortably
// past this halfway threshold, so the nav stays until the user scrolls.
const OUTRO_NAV_HIDE_RATIO = 0.5;

// Mobile tier — keep in sync with `breakpoint-mobile` in
// styles/includes/_breakpoints.module.scss (everything at or below 768px).
// The outro is display:none on mobile, so onScroll bails there entirely.
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

/**
 * createRichTextController — build a fresh PageController for a rich-text
 * singleton page. `pageKey` is both the dbg label and the BEM block name
 * used to scope the nav/outro queries (e.g. "contact" → `.contact__nav`,
 * `.contact__outro`).
 */
export function createRichTextController(pageKey: string): PageController {
  /** The title nav — a passive heading; the scroll-driven show/hide (see
   *  setNavHidden) is its only animation. */
  let navEl: HTMLElement | null = null;
  /** The outro section — the nav-fade scroll trigger. */
  let outroEl: HTMLElement | null = null;
  /** True while the nav is scroll-hidden (outro in view). */
  let navHidden = false;
  /** In-flight scroll-driven nav show/hide tween — superseded on re-toggle. */
  let navHideTween: gsap.core.Tween | null = null;
  /** Pending bottom-dwell timer handle, null when disarmed. */
  let bottomTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latched once the dwell navigation fires so it can never double-trigger. */
  let navigatedHome = false;
  /** Router instance, captured at onInit() time (a guaranteed-safe Nuxt app
   *  context) for the later bottom-dwell setTimeout callback, which runs
   *  outside any Vue/Nuxt call stack and can't safely call useRouter() itself. */
  let router: ReturnType<typeof useRouter> | null = null;
  /** Nav-lock's reactive `mutating` flag, captured the same way — the
   *  bottom-dwell handler must not auto-navigate while a nav is already in
   *  flight (mirrors diaa's `App.mutating` guard). */
  let mutating: ReturnType<typeof useNavLock>["mutating"] | null = null;

  /**
   * Scroll-driven nav show/hide (desktop) — same treatment as DetailPage.
   * Fades the title nav out when the outro section scrolls into view and
   * back in when it leaves. Picks up from the nav's CURRENT opacity so
   * reversing mid-fade never jumps.
   */
  function setNavHidden(hidden: boolean): void {
    if (!navEl || navHidden === hidden) return;
    navHidden = hidden;
    console.debug(`[page:${pageKey}] nav-${hidden ? "hide" : "show"}`);

    // Supersede any previous show/hide fade before starting the new one.
    navHideTween?.kill();

    const el = navEl;
    const from = Number.parseFloat(getComputedStyle(el).opacity);
    const start = Number.isFinite(from) ? from : hidden ? 1 : 0;
    const to = hidden ? 0 : 1;

    gsap.set(el, { opacity: start });
    navHideTween = gsap.to(el, {
      opacity: to,
      duration: NAV_HIDE_DURATION,
      ease: NAV_FADE_EASE,
      onComplete: () => {
        // Fully shown → drop the inline value so CSS owns the nav again.
        if (!hidden) el.style.opacity = "";
      },
    });
  }

  /**
   * Bottom-dwell auto-close (desktop) — same treatment as DetailPage. When
   * the scroller rests at the very bottom of the page — both the damped
   * `current` AND the user-driven `target` at max, so a scroll-up cancels
   * instantly even while the damping is still settling — a BOTTOM_DWELL_MS
   * timer is armed. If the user is still at the bottom when it fires, the
   * SPA navigates home (running the full exit transition). Scrolling away
   * first disarms the timer and nothing happens.
   */
  function checkBottomDwell(e: ScrollEvent): void {
    const atBottom =
      e.max > 0 && e.current >= e.max - BOTTOM_EPSILON && e.target >= e.max - BOTTOM_EPSILON;

    if (!atBottom) {
      if (bottomTimer !== null) {
        clearTimeout(bottomTimer);
        bottomTimer = null;
        console.debug(`[page:${pageKey}] bottom-dwell cancelled`);
      }
      return;
    }

    if (bottomTimer !== null || navigatedHome || mutating?.value) return;

    console.debug(`[page:${pageKey}] bottom-dwell armed`);
    bottomTimer = setTimeout(() => {
      bottomTimer = null;
      if (navigatedHome || mutating?.value) return;
      navigatedHome = true;
      console.debug(`[page:${pageKey}] bottom-dwell → navigate home`);
      // The outro the user is dwelling on IS the DIAA brand moment — suppress
      // the return-home intro beat so the mark doesn't play twice in a row.
      skipNextHomeBeat();
      void router?.push("/");
    }, BOTTOM_DWELL_MS);
  }

  return {
    /**
     * Pin the DOM container to opacity 0. Pinning here prevents a flash of
     * the fully-opaque page before in() runs — same reasoning as
     * DetailPage. The title heading is passive (closing lives in the
     * `( Close )` footer), so it only needs querying for the scroll-driven
     * show/hide.
     */
    onInit(root: HTMLElement): void {
      console.debug(`[page:${pageKey}] onInit`);
      router = useRouter();
      mutating = useNavLock().mutating;

      gsap.set(root, { opacity: 0 });

      navEl = root.querySelector<HTMLElement>(`.${pageKey}__nav`);
      // Outro section — scroll trigger for the desktop nav fade (see
      // onScroll below). display:none on mobile, where onScroll bails
      // before ever measuring it.
      outroEl = root.querySelector<HTMLElement>(`.${pageKey}__outro`);
    },

    /**
     * Fade the DOM container up to opacity 1. Mirrors the detail/home
     * entrance exactly (see the DETAIL_IN_ / HOME_IN_ constants): onInit()
     * already pinned the container to opacity 0, so this holds for
     * IN_DELAY then fades in over IN_DURATION on kido's "slow" ease.
     */
    in(root: HTMLElement): Promise<void> {
      console.debug(`[page:${pageKey}] in`);
      return new Promise((resolve) => {
        gsap.set(root, { opacity: 0 });
        gsap.to(root, {
          opacity: 1,
          duration: IN_DURATION,
          delay: IN_DELAY,
          ease: IN_EASE,
          onComplete: resolve,
        });
      });
    },

    /**
     * Fade DOM container down to 0 over OUT_DURATION on the shared "slow"
     * ease — same exit timing as every other page.
     */
    out(root: HTMLElement): Promise<void> {
      console.debug(`[page:${pageKey}] out`);
      return new Promise((resolve) => {
        gsap.set(root, { opacity: 1 });
        gsap.to(root, {
          opacity: 0,
          duration: OUT_DURATION,
          ease: IN_EASE,
          onComplete: resolve,
        });
      });
    },

    /**
     * Scroll hook (subscribed after in() resolves) — desktop-only outro
     * choreography: fade the nav out once the outro enters the viewport,
     * and arm the bottom-dwell auto-close at full scroll. Mobile bails
     * entirely — the outro is display:none there and the page fits the
     * viewport.
     */
    onScroll(e: ScrollEvent): void {
      if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;

      if (outroEl) {
        const outroInView =
          outroEl.getBoundingClientRect().top <=
          document.documentElement.clientHeight * OUTRO_NAV_HIDE_RATIO;
        setNavHidden(outroInView);
      }

      checkBottomDwell(e);
    },

    /**
     * Teardown: stop any in-flight nav fade and disarm the bottom-dwell
     * timer so nothing leaks across SPA navigation.
     */
    onDestroy(): void {
      navHideTween?.kill();
      navHideTween = null;
      if (bottomTimer !== null) {
        clearTimeout(bottomTimer);
        bottomTimer = null;
      }
      navEl = null;
      outroEl = null;
      navHidden = false;
      navigatedHome = false;
      router = null;
      mutating = null;
    },
  };
}

export default createRichTextController;
