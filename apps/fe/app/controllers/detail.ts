import { gsap } from "gsap";
import { ResizeHub } from "kido/resize";

import { skipNextHomeBeat } from "~/lib/beat-skip";
import { takeImageBridge } from "~/lib/image-bridge";
import { navDirection } from "~/lib/scroll-restore";
import { raiseImageBridge } from "~/transitions/home-to-detail";

import type { PageController, ScrollEvent } from "~/controllers/page-controller";

/**
 * controllers/detail.ts — manages lifecycle for `/${slug}` detail routes,
 * ported from apps/fe/src/routes/detail/detail.ts.
 *
 * Every Detail route (`content.template === "detail"` in pages/[slug].vue)
 * gets its own controller instance via `createDetailController()` — a
 * factory, not a class or module-scope singleton, since `[slug].vue` is
 * remounted fresh per route (`page-key="r => r.fullPath"` in app.vue forces
 * a new component instance per distinct slug), so each mount's closured
 * state is naturally isolated with no risk of leaking into the next.
 *
 * The crossfade is DOM-only: the container's opacity is driven by GSAP in
 * in()/out().
 *
 * Container lifecycle:
 *   onInit(): pin container opacity to 0 so it stays invisible until in()
 *             fades up, and wire the title nav's scroll-driven show/hide.
 *   in():     fade container 0 → 1 so the detail page enters in lockstep
 *             with the DOM crossfade.
 *   onScroll(): desktop-only — fades the nav out while the outro section is
 *             in view, and auto-navigates home after a short dwell at the
 *             very bottom of the page.
 */

// Detail entrance/exit fades — mirror the home page (home.ts homeAnim.homeIn*/
// homeOut*, Phase 5b) so both pages move with identical timing: a 200ms hold
// after the previous page clears, then a 1200ms container fade in — and an
// 800ms fade out — on kido's "slow" ease (the shared brand-beat spring-fit
// curve, see Ease.slow in kido/utils). GSAP durations are SECONDS, not ms.
const DETAIL_IN_DURATION = 1.2;
const DETAIL_OUT_DURATION = 0.8;
const DETAIL_IN_DELAY = 0.2;

// Ease for the scroll-driven title-nav show/hide (see setNavHidden) —
// linear, matching the home nav fade-swap's curve (home.ts NAV_FADE_EASE).
// The old title ⇄ "( Close )" hover fade-swap is gone: closing lives in the
// persistent `( Close )` footer (`.detail__footer`) on every tier, and the
// title nav is a passive heading.
const NAV_FADE_EASE = "none";

// Desktop outro choreography (see onScroll):
// - The title nav fades out over NAV_HIDE_DURATION once the outro section
//   enters the viewport, and fades back in when the user scrolls above it.
// - Resting at the very bottom of the page for BOTTOM_DWELL_MS auto-navigates
//   home through the normal SPA transition. Scrolling away (target moving off
//   the bottom) before the dwell elapses cancels it silently.
// BOTTOM_EPSILON absorbs sub-pixel rounding in Lenis's damped scroll value.
const NAV_HIDE_DURATION = 0.4;
const BOTTOM_DWELL_MS = 300;
const BOTTOM_EPSILON = 2;
// The nav fades out once the outro has scrolled up far enough that its top
// edge crosses this fraction of the viewport height (0.5 = the vertical
// midpoint). A threshold well inside the viewport also sidesteps the short-page
// false-trigger the old bottom-edge test (`top <= clientHeight`) had — a page
// whose content ended near the viewport bottom faded the nav out at scroll 0.
const OUTRO_NAV_HIDE_RATIO = 0.5;

// Mobile tier — keep in sync with `breakpoint-mobile` in
// styles/includes/_breakpoints.module.scss (everything at or below 768px).
// Gates the cover's entrance slide, which only exists on the mobile layout.
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

// ── REVERT SWITCH — mobile cover entrance slide ──────────────────────────
// false (current): the mobile cover behaves like DESKTOP — it rests at the
//   home-matched centred position (padding-top: 50svh − hero/2, see the
//   mobile block on `.detail__cover` in _detail.module.scss), the bridge
//   image lands on it and NEVER moves, and everything beneath simply fades
//   in through the standard in() paths.
// true: restores the two-phase slide choreography — CSS ships the cover
//   settled at the 20vh page rhythm, onInit() offsets it down to the centred
//   position with a translateY, and mobileEntrance() holds the centred
//   chrome for COVER_HOLD_DURATION then slides the cover up while the
//   slices fade in.
// TO REVERT: flip this to true AND swap the mobile `padding` on
// `.detail__cover` in _detail.module.scss back to `20vh 0 0` (the two are
// a pair — the slide math measures the settled padding off the element).
//
// Typed `: boolean` (not inferred as the literal `false`) so TypeScript
// doesn't narrow the guards below to `never` and flag this whole dormant
// branch as unreachable — same reason the original source annotates it.
const MOBILE_COVER_ENTRANCE_SLIDE: boolean = false;

// Mobile entrance hold (slide choreography only): the centred cover, nav,
// and Close footer show alone for this long (the chrome fades in over this
// window) before phase two — the cover slides up and the slices fade in.
const COVER_HOLD_DURATION = 0.4;

/**
 * createDetailController — build a fresh PageController for one Detail
 * route instance.
 */
export function createDetailController(): PageController {
  /** The title nav (`.detail__nav`) — a passive heading; the scroll-driven
   *  show/hide (see setNavHidden) is its only animation. */
  let navEl: HTMLElement | null = null;
  /** The outro section (`.detail__outro`) — the nav-fade scroll trigger. */
  let outroEl: HTMLElement | null = null;
  /** True while the nav is scroll-hidden (outro in view). */
  let navHidden = false;
  /** In-flight scroll-driven nav show/hide tween — superseded on re-toggle. */
  let navHideTween: gsap.core.Tween | null = null;
  /** Pending bottom-dwell timer handle, null when disarmed. */
  let bottomTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latched once the dwell navigation fires so it can never double-trigger. */
  let navigatedHome = false;
  /** The cover element (mobile entrance slide target). */
  let coverEl: HTMLElement | null = null;
  /** Pixels the cover starts translated DOWN by on mobile entry — the
   *  distance from the settled 20vh padding to the home-matched centred
   *  position. 0 when no slide is pending (desktop/tablet, back-nav). */
  let coverSettleDelta = 0;
  /** In-flight cover settle tween — killed on teardown. */
  let coverSettleTween: gsap.core.Tween | null = null;
  /** kido ResizeHub subscription id for the mobile end-padding measurement. */
  let resizeSubId: symbol | null = null;
  /** Router + nav-lock state, captured at onInit() time (a guaranteed-safe
   *  Nuxt app context) for the later bottom-dwell setTimeout callback. */
  let router: ReturnType<typeof useRouter> | null = null;
  let mutating: ReturnType<typeof useNavLock>["mutating"] | null = null;

  /**
   * Mobile: pad `.detail__container`'s bottom so the last visible module
   * (the outro is display:none on mobile) can centre on the viewport midline
   * at full scroll — 50vh − half the module's height, the same treatment the
   * cover gets at the top via its padding-top formula. The stylesheet's
   * 50svh is only the pre-measure fallback; this inline value replaces it.
   * No-ops (and clears any stale inline value) off-mobile.
   */
  function setMobileEndPadding(root: HTMLElement): void {
    const containerEl = root.querySelector<HTMLElement>(".detail__container");
    if (!containerEl) return;

    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      containerEl.style.paddingBottom = "";
      return;
    }

    const children = Array.from(containerEl.children) as HTMLElement[];
    let last: HTMLElement | null = null;
    for (let i = children.length - 1; i >= 0; i--) {
      const el = children[i]!;
      if (getComputedStyle(el).display === "none") continue;
      last = el;
      break;
    }
    if (!last) return;

    const pad = Math.max(0, window.innerHeight / 2 - last.offsetHeight / 2);
    containerEl.style.paddingBottom = `${pad}px`;
  }

  /**
   * Build the cover settle tween (mobile entrance phase two): animates the
   * translateY GSAP's `y` property applied in onInit — from coverSettleDelta
   * down to 0 — on the entrance fade's duration and ease, starting after the
   * COVER_HOLD_DURATION chrome beat. Transform-only, so no per-frame layout.
   * `onUpdate` reports the cover's current offset RELATIVE TO ITS START
   * position each frame (0 → −delta) to the bridge clone so the held image
   * moves in lockstep with the cover instead of ghosting over it. Returns
   * null when no slide is pending.
   */
  function makeCoverSettleTween(onFrame?: (offsetFromStart: number) => void): gsap.core.Tween | null {
    if (!coverEl || coverSettleDelta === 0) return null;

    return gsap.to(coverEl, {
      y: 0,
      duration: DETAIL_IN_DURATION,
      delay: COVER_HOLD_DURATION,
      ease: "slow",
      onUpdate() {
        if (!onFrame || !coverEl) return;
        const currentY = Number(gsap.getProperty(coverEl, "y"));
        onFrame(currentY - coverSettleDelta);
      },
    });
  }

  /** Land the settled cover state: drop the (now identity) transform and
   *  clear the pending delta so a re-run of in() skips the slide. */
  function finishCoverSettle(): void {
    if (coverEl) gsap.set(coverEl, { clearProps: "transform" });
    coverSettleDelta = 0;
  }

  /**
   * Mobile entrance choreography — two phases instead of the desktop's
   * single fade:
   *   1. (0 → COVER_HOLD_DURATION) the chrome fades in: nav, Close footer,
   *      and the cover itself when there is no bridge clone standing in for
   *      it. The cover sits at its home-matched centred offset (see onInit);
   *      the slices stay hidden.
   *   2. (COVER_HOLD_DURATION → end) the cover slides up to its settled
   *      position while the slices fade in; a bridge clone follows the
   *      cover's offset and cross-fades out over the solid cover beneath it.
   * Scrolling naturally resumes when this resolves.
   */
  async function mobileEntrance(root: HTMLElement, bridge: HTMLElement | null): Promise<void> {
    gsap.set(root, { opacity: 1 });

    const cover = coverEl!;
    const chromeTargets = Array.from(root.querySelectorAll<HTMLElement>(".detail__nav, .detail__footer"));
    // No bridge → the cover has no stand-in and fades in with the chrome.
    // With a bridge the cover is held HIDDEN beneath the solid clone (only
    // one copy of the image is ever visible — see the bridge notes in in())
    // and hard-swapped in at the end, so it is never a fade target here.
    if (!bridge) chromeTargets.push(cover);
    else gsap.set(cover, { opacity: 0 });

    const sliceTargets = Array.from(root.querySelectorAll<HTMLElement>(".detail__container > *")).filter(
      (el) => el !== cover,
    );

    gsap.set([...chromeTargets, ...sliceTargets], { opacity: 0 });

    const settleTween = makeCoverSettleTween((offset) => {
      if (bridge) bridge.style.transform = `translateY(${offset}px)`;
    });
    if (settleTween) coverSettleTween = settleTween;

    await Promise.all([
      // Phase one — chrome in over the hold window.
      gsap.to(chromeTargets, { opacity: 1, duration: COVER_HOLD_DURATION, ease: "slow" }),
      // Phase two — slices in after the hold. The clone stays solid (it is
      // hard-swapped for the cover below), so it is not a fade target.
      gsap.to(sliceTargets, {
        opacity: 1,
        duration: DETAIL_IN_DURATION,
        delay: COVER_HOLD_DURATION,
        ease: "slow",
      }),
      settleTween ?? Promise.resolve(),
    ]);

    gsap.set([...chromeTargets, ...sliceTargets], { clearProps: "opacity" });
    // Hard swap (bridge path): reveal the identical cover and drop the clone
    // in the same frame — no doubled shadow.
    if (bridge) gsap.set(cover, { clearProps: "opacity" });
    bridge?.remove();
    finishCoverSettle();
  }

  /**
   * Scroll-driven nav show/hide (desktop). Fades the title nav out when the
   * outro section scrolls into view and back in when it leaves. Picks up
   * from the nav's CURRENT opacity so reversing mid-fade never jumps.
   */
  function setNavHidden(hidden: boolean): void {
    if (!navEl || navHidden === hidden) return;
    navHidden = hidden;
    console.debug(`[page:detail] nav-${hidden ? "hide" : "show"}`);

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
        if (!hidden) el.style.opacity = "";
      },
    });
  }

  /**
   * Bottom-dwell auto-close (desktop). When the scroller rests at the very
   * bottom of the page — both the damped `current` AND the user-driven
   * `target` at max, so a scroll-up cancels instantly even while the
   * damping is still settling — a BOTTOM_DWELL_MS timer is armed. If the
   * user is still at the bottom when it fires, the SPA navigates home
   * (running the full detail → home exit transition). Scrolling away first
   * disarms the timer and nothing happens.
   */
  function checkBottomDwell(e: ScrollEvent): void {
    const atBottom =
      e.max > 0 && e.current >= e.max - BOTTOM_EPSILON && e.target >= e.max - BOTTOM_EPSILON;

    if (!atBottom) {
      if (bottomTimer !== null) {
        clearTimeout(bottomTimer);
        bottomTimer = null;
        console.debug("[page:detail] bottom-dwell cancelled");
      }
      return;
    }

    if (bottomTimer !== null || navigatedHome || mutating?.value) return;

    console.debug("[page:detail] bottom-dwell armed");
    bottomTimer = setTimeout(() => {
      bottomTimer = null;
      if (navigatedHome || mutating?.value) return;
      navigatedHome = true;
      console.debug("[page:detail] bottom-dwell → navigate home");
      // The outro the user is dwelling on IS the DIAA brand moment — suppress
      // the return-home intro beat so the mark doesn't play twice in a row.
      skipNextHomeBeat();
      void router?.push("/");
    }, BOTTOM_DWELL_MS);
  }

  return {
    /**
     * Pin the DOM container to opacity 0. The transition swap would briefly
     * show the detail DOM at full opacity before the in() animation starts
     * without this — pinning here ensures a clean fade-in from black. The
     * title nav is a passive heading (closing lives in the `( Close )`
     * footer), so it only needs querying for the scroll-driven show/hide.
     */
    onInit(root: HTMLElement): void {
      console.debug("[page:detail] onInit");
      router = useRouter();
      mutating = useNavLock().mutating;

      gsap.set(root, { opacity: 0 });

      navEl = root.querySelector<HTMLElement>(".detail__nav");
      // Outro section — scroll trigger for the desktop nav fade (see
      // onScroll). display:none on mobile, where onScroll bails before ever
      // measuring it.
      outroEl = root.querySelector<HTMLElement>(".detail__outro");

      // Mobile cover entrance slide (gated off by default — see
      // MOBILE_COVER_ENTRANCE_SLIDE): offset the cover down from its
      // settled layout position to the home-matched centred position with a
      // transform — layout, document height, and scroll bounds are already
      // final; only pixels move. in() animates the translation back to 0.
      // Skipped on back-nav, where the restored scroll expects the settled
      // look immediately (coverSettleDelta stays 0 and in() skips the
      // tween). With the flag off, coverSettleDelta always stays 0 and in()
      // takes the same paths as desktop — the cover rests centred and never
      // moves.
      coverEl = root.querySelector<HTMLElement>(".detail__cover");
      if (
        MOBILE_COVER_ENTRANCE_SLIDE &&
        coverEl &&
        navDirection.value !== "back" &&
        window.matchMedia(MOBILE_MEDIA_QUERY).matches
      ) {
        const heroH = coverEl.querySelector<HTMLElement>(".detail__cover-inner")?.offsetHeight ?? 0;
        // The centred target anchors to the SMALL viewport
        // (documentElement.clientHeight — stable while the mobile browser
        // toolbar shows/hides, unlike innerHeight/100vh), matching the home
        // reveal overlay's 100svh centring exactly. The settled padding is
        // measured off the element rather than assumed, so the CSS can use
        // any unit (it ships 20vh) without desyncing this math.
        const svh = document.documentElement.clientHeight;
        const settledPad = Number.parseFloat(getComputedStyle(coverEl).paddingTop) || 0;
        coverSettleDelta = svh / 2 - heroH / 2 - settledPad;
        gsap.set(coverEl, { y: coverSettleDelta });
      }

      // Mobile end padding: centre the LAST module on the viewport midline at
      // full scroll — the mirror of the cover's centred start. The value
      // depends on the module's measured height, so it can't live in CSS;
      // re-measured on resize (orientation changes both terms). ResizeHub
      // debounces resize/orientationchange via a shared RAF hub instead of a
      // bare window listener per page.
      setMobileEndPadding(root);
      resizeSubId = ResizeHub.add(() => setMobileEndPadding(root));
    },

    /**
     * Fade the DOM container up to opacity 1.
     *
     * Mirrors the home entrance exactly (see controllers/home.ts's
     * HOME_IN_*, Phase 5b): onInit() already pinned the container to
     * opacity 0, so this holds for DETAIL_IN_DELAY then fades in over
     * DETAIL_IN_DURATION on kido's "slow" ease — same duration and curve as
     * home, so both pages enter identically.
     */
    async in(root: HTMLElement): Promise<void> {
      console.debug("[page:detail] in");

      // Home→detail bridge: when the home page handed off a live "reveal"
      // image clone (text mode, image active — see
      // transitions/home-to-detail.ts, Phase 5b), hold it over the detail
      // cover while the rest of the page fades in, then hand off to the
      // real cover. Null on every other navigation, where this falls
      // through to the normal entrance fade.
      //
      // The bridge clone is pinned exactly over `.detail__cover` (same
      // size/pos — see _detail.module.scss). Only ONE copy of the image may
      // be visible at a time. The previous approach held the cover SOLID
      // and faded the clone out over it — two stacked copies. That reads as
      // one for an OPAQUE cover, but a cover with transparency (e.g. a
      // transparent SVG with a baked drop-shadow) composites its two
      // semi-transparent shadows into a visibly DOUBLED/darker shadow for
      // the whole fade. So instead we HIDE the cover beneath the solid
      // clone for the entire entrance and hard-swap them in a single frame
      // at the end: invisible because clone and cover are the same image at
      // the same position, with no moment of two shadows and no white
      // bleeding through.
      const bridge = takeImageBridge();

      // Bring the clone forward now that home is fully faded/gone: bridgeOut()
      // (transitions/home-to-detail.ts) created it stacked BEHIND the home
      // text (matching .home__text-gpu's own z:0 vs .home__text's z:1, so the
      // fading text reads on top of the still-visible image, not covered by
      // it) — this is the moment that relationship stops mattering (home is
      // gone) and a DIFFERENT one starts: the clone needs to sit above THIS
      // page's own content for the crossfade/hard-swap below. See that
      // function's doc comment for the full two-phase z-index rationale.
      if (bridge) raiseImageBridge(bridge);

      // Mobile forward entry (coverSettleDelta pending from onInit) runs
      // the two-phase choreography: chrome + centred cover for a beat, then
      // the cover slides up while the slices fade in. Back-nav has no
      // pending slide (delta 0) and falls through to the plain fade below.
      if (coverSettleDelta !== 0 && coverEl) {
        await mobileEntrance(root, bridge);
        return;
      }

      if (bridge) {
        gsap.set(root, { opacity: 1 });

        const cover = root.querySelector<HTMLElement>(".detail__cover");
        // Hide the real cover beneath the solid clone so only the clone's
        // single shadow renders during the entrance (see the note above) —
        // never two.
        if (cover) gsap.set(cover, { opacity: 0 });

        // `.detail__footer` is the persistent fixed `( Close )` footer
        // (every tier) — it fades in with the nav instead of popping.
        const fadeTargets = [
          ...root.querySelectorAll<HTMLElement>(".detail__nav, .detail__footer"),
          ...Array.from(root.querySelectorAll<HTMLElement>(".detail__container > *")).filter(
            (el) => el !== cover,
          ),
        ];
        gsap.set(fadeTargets, { opacity: 0 });

        // The clone stays fully solid the whole time — the image never changes.
        await gsap.to(fadeTargets, {
          opacity: 1,
          duration: DETAIL_IN_DURATION,
          delay: DETAIL_IN_DELAY,
          ease: "slow",
        });

        gsap.set(fadeTargets, { clearProps: "opacity" });
        // Hard swap: reveal the identical cover and drop the clone in the
        // same frame — no gap, no crossfade, no doubled shadow.
        if (cover) gsap.set(cover, { clearProps: "opacity" });
        bridge.remove();
        return;
      }

      await new Promise<void>((resolve) => {
        gsap.set(root, { opacity: 0 });
        gsap.to(root, {
          opacity: 1,
          duration: DETAIL_IN_DURATION,
          delay: DETAIL_IN_DELAY,
          ease: "slow",
          onComplete: resolve,
        });
      });
    },

    /** Fade DOM container down to 0 before the transition swaps the DOM. */
    out(root: HTMLElement): Promise<void> {
      console.debug("[page:detail] out");
      return new Promise((resolve) => {
        gsap.set(root, { opacity: 1 });
        gsap.to(root, {
          opacity: 0,
          duration: DETAIL_OUT_DURATION,
          ease: "slow",
          onComplete: resolve,
        });
      });
    },

    /**
     * Scroll hook (subscribed after in() resolves) — desktop-only outro
     * choreography: fade the nav out once the outro enters the viewport,
     * and arm the bottom-dwell auto-close at full scroll. Mobile bails
     * entirely — the outro is display:none there and the Close footer
     * handles closing.
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
     * Teardown: stop any in-flight nav fade so nothing leaks across SPA
     * navigation.
     */
    onDestroy(): void {
      navHideTween?.kill();
      navHideTween = null;
      if (bottomTimer !== null) {
        clearTimeout(bottomTimer);
        bottomTimer = null;
      }
      outroEl = null;
      navHidden = false;
      navigatedHome = false;
      coverSettleTween?.kill();
      coverSettleTween = null;
      coverEl = null;
      coverSettleDelta = 0;
      if (resizeSubId) {
        ResizeHub.remove(resizeSubId);
        resizeSubId = null;
      }
      navEl = null;
      router = null;
      mutating = null;
    },
  };
}

export default createDetailController;
