/**
 * DetailPage — manages lifecycle for `/${slug}` detail routes.
 *
 * Auto-discovered by PageManager via the folder name "detail", so every CMS
 * page entry with `key: "detail"` and `template: "detail"` instantiates this
 * class regardless of URL slug. The crossfade is DOM-only: the container's
 * `style.opacity` is driven by Anima in `in()` and `out()`.
 *
 * Container lifecycle:
 *   init(): pin container opacity to 0 so it stays invisible until in() fades up,
 *           and wire the title nav's hover fade-swap.
 *   in():   fade container 0 → 1 so the detail page enters in lockstep with
 *           the DOM crossfade.
 *   onScroll(): desktop-only — fades the nav out while the outro section is
 *           in view, and auto-navigates home after a short dwell at the very
 *           bottom of the page.
 */

import { Anima, type AnimaState } from "kido/anima";

import { App } from "@app/context";
import { skipNextHomeBeat } from "@app/controller/beat-skip";
import { takeImageBridge } from "@app/controller/image-bridge";
import { animaToPromise } from "@app/controller/transition-fx";
import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

import type { ScrollEvent } from "kido";

// Detail entrance/exit fades — mirror the home page (home.ts homeAnim.homeIn*/
// homeOut*) so both pages move with identical timing: a 200ms hold after the
// previous page clears, then a 1200ms container fade in — and an 800ms fade
// out — on kido's "slow" ease (the shared brand-beat spring-fit curve, see
// Ease.slow in kido/utils).
const DETAIL_IN_DURATION = 1200;
const DETAIL_OUT_DURATION = 800;
const DETAIL_IN_DELAY = 200;

// Ease for the scroll-driven title-nav show/hide (see setNavHidden) —
// linear, matching the home nav fade-swap's curve (home.ts NAV_FADE_EASE).
// The old title ⇄ "( Close )" hover fade-swap is gone: closing lives in the
// persistent `( Close )` footer (`.detail__footer`) on every tier, and the
// title nav is a passive heading.
const NAV_FADE_EASE: number[] = [0, 0, 1, 1];

// Desktop outro choreography (see onScroll):
// - The title nav fades out over NAV_HIDE_DURATION once the outro section
//   enters the viewport, and fades back in when the user scrolls above it.
// - Resting at the very bottom of the page for BOTTOM_DWELL_MS auto-navigates
//   home through the normal SPA transition. Scrolling away (target moving off
//   the bottom) before the dwell elapses cancels it silently.
// BOTTOM_EPSILON absorbs sub-pixel rounding in the scroller's damped values.
const NAV_HIDE_DURATION = 400;
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
//   settled at the 20vh page rhythm, init() offsets it down to the centred
//   position with a translateY, and mobileEntrance() holds the centred
//   chrome for COVER_HOLD_DURATION then slides the cover up while the
//   slices fade in.
// TO REVERT: flip this to true AND swap the mobile `padding` on
// `.detail__cover` in _detail.module.scss back to `20vh 0 0` (the two are
// a pair — the slide math measures the settled padding off the element).
const MOBILE_COVER_ENTRANCE_SLIDE: boolean = false;

// Mobile entrance hold (slide choreography only): the centred cover, nav,
// and Close footer show alone for this long (the chrome fades in over this
// window) before phase two — the cover slides up and the slices fade in.
const COVER_HOLD_DURATION = 400;

export default class DetailPage extends BasePage {
  /** The title nav (`.detail__nav`) — a passive heading; the scroll-driven
   *  show/hide (see setNavHidden) is its only animation. */
  private navEl: HTMLElement | null = null;
  /** The outro section (`.detail__outro`) — the nav-fade scroll trigger. */
  private outroEl: HTMLElement | null = null;
  /** True while the nav is scroll-hidden (outro in view). */
  private navHidden = false;
  /** In-flight scroll-driven nav show/hide fade — superseded on re-toggle. */
  private navHideAnima: Anima | null = null;
  /** Pending bottom-dwell timer handle, null when disarmed. */
  private bottomTimer: number | null = null;
  /** Latched once the dwell navigation fires so it can never double-trigger. */
  private navigatedHome = false;
  /** The cover element (mobile entrance slide target). */
  private coverEl: HTMLElement | null = null;
  /** Pixels the cover starts translated DOWN by on mobile entry — the
   *  distance from the settled 20vh padding to the home-matched centred
   *  position. 0 when no slide is pending (desktop/tablet, back-nav). */
  private coverSettleDelta = 0;
  /** In-flight cover settle tween — paused on cleanup. */
  private coverPadAnima: Anima | null = null;
  /** Window resize handler keeping the mobile end padding measured. */
  private resizeHandler: (() => void) | null = null;

  /**
   * Pin the DOM container to opacity 0. The EmptyTransition swap would briefly
   * show the detail DOM at full opacity before the in() animation starts
   * without this — pinning here ensures a clean fade-in from black. The title
   * nav is a passive heading (closing lives in the `( Close )` footer), so
   * it only needs querying for the scroll-driven show/hide.
   */
  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    dbg.page("detail:init");

    (container as HTMLElement).style.opacity = "0";

    this.navEl = (container as HTMLElement).querySelector<HTMLElement>(
      ".detail__nav"
    );

    // Outro section — scroll trigger for the desktop nav fade (see onScroll).
    // display:none on mobile, where onScroll bails before ever measuring it.
    this.outroEl = (container as HTMLElement).querySelector<HTMLElement>(
      ".detail__outro"
    );

    // Mobile cover entrance slide (gated off by default — see
    // MOBILE_COVER_ENTRANCE_SLIDE): offset the cover down from its settled
    // layout position to the home-matched centred position with a
    // transform — layout, document height, and scroll bounds are already
    // final; only pixels move. in() animates the translation back to 0.
    // Skipped on back-nav, where the restored scroll expects the settled
    // look immediately (coverSettleDelta stays 0 and in() skips the tween).
    // With the flag off, coverSettleDelta always stays 0 and in() takes the
    // same paths as desktop — the cover rests centred and never moves.
    this.coverEl = (container as HTMLElement).querySelector<HTMLElement>(
      ".detail__cover"
    );
    if (
      MOBILE_COVER_ENTRANCE_SLIDE &&
      this.coverEl &&
      App.target !== "back" &&
      window.matchMedia(MOBILE_MEDIA_QUERY).matches
    ) {
      const heroH =
        this.coverEl.querySelector<HTMLElement>(".detail__cover-inner")
          ?.offsetHeight ?? 0;
      // The centred target anchors to the SMALL viewport
      // (documentElement.clientHeight — stable while the mobile browser
      // toolbar shows/hides, unlike innerHeight/100vh), matching the home
      // reveal overlay's 100svh centring exactly. The settled padding is
      // measured off the element rather than assumed, so the CSS can use
      // any unit (it ships 20vh) without desyncing this math.
      const svh = document.documentElement.clientHeight;
      const settledPad =
        parseFloat(getComputedStyle(this.coverEl).paddingTop) || 0;
      this.coverSettleDelta = svh / 2 - heroH / 2 - settledPad;
      this.coverEl.style.transform = `translateY(${this.coverSettleDelta}px)`;
    }

    // Mobile end padding: centre the LAST module on the viewport midline at
    // full scroll — the mirror of the cover's centred start. The value
    // depends on the module's measured height, so it can't live in CSS;
    // re-measured on resize (orientation changes both terms).
    this.setMobileEndPadding();
    this.resizeHandler = (): void => this.setMobileEndPadding();
    window.addEventListener("resize", this.resizeHandler);
  }

  /**
   * Mobile: pad `.detail__container`'s bottom so the last visible module
   * (the outro is display:none on mobile) can centre on the viewport midline
   * at full scroll — 50vh − half the module's height, the same treatment the
   * cover gets at the top via its padding-top formula. The stylesheet's
   * 50svh is only the pre-measure fallback; this inline value replaces it.
   * No-ops (and clears any stale inline value) off-mobile.
   */
  private setMobileEndPadding(): void {
    const containerEl = (
      this.container as HTMLElement | null
    )?.querySelector<HTMLElement>(".detail__container");
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
   * Build the cover settle Anima (mobile entrance phase two): animates the
   * translateY that init() applied — from coverSettleDelta down to 0 — on
   * the entrance fade's duration and ease, starting after the
   * COVER_HOLD_DURATION chrome beat. Transform-only, so no per-frame layout.
   * `onFrame` receives the cover's current offset RELATIVE TO ITS START
   * position each frame (0 → −delta) — the bridge path applies it to its
   * fixed clone so the held image moves in lockstep with the cover instead
   * of ghosting over it. Returns null when no slide is pending.
   */
  private makeCoverSettleAnima(
    onFrame?: (offsetFromStart: number) => void
  ): Anima | null {
    const coverEl = this.coverEl;
    const delta = this.coverSettleDelta;
    if (!coverEl || delta === 0) return null;

    return new Anima({
      el: window,
      d: DETAIL_IN_DURATION,
      e: "slow",
      de: COVER_HOLD_DURATION,
      u: (state: AnimaState) => {
        const p = state.prE;
        coverEl.style.transform = `translateY(${delta * (1 - p)}px)`;
        onFrame?.(-delta * p);
      },
    });
  }

  /**
   * Mobile entrance choreography — two phases instead of the desktop's
   * single fade:
   *   1. (0 → COVER_HOLD_DURATION) the chrome fades in: nav, Close footer,
   *      and the cover itself when there is no bridge clone standing in for
   *      it. The cover sits at its home-matched centred offset (see init);
   *      the slices stay hidden.
   *   2. (COVER_HOLD_DURATION → end) the cover slides up to its settled
   *      position while the slices fade in; a bridge clone follows the
   *      cover's offset and cross-fades out over the solid cover beneath it.
   * Scrolling naturally resumes when this resolves (afterIn continues).
   */
  private async mobileEntrance(bridge: HTMLElement | null): Promise<void> {
    const container = this.container as HTMLElement;
    container.style.opacity = "1";

    const cover = this.coverEl!;
    const chromeTargets = [
      ...container.querySelectorAll<HTMLElement>(
        ".detail__nav, .detail__footer"
      ),
    ];
    // No bridge → the cover has no stand-in and fades in with the chrome.
    // With a bridge the cover is held HIDDEN beneath the solid clone (only one
    // copy of the image is ever visible — see the bridge notes in in()) and
    // hard-swapped in at the end, so it is never a fade target here.
    if (!bridge) chromeTargets.push(cover);
    else cover.style.opacity = "0";

    const sliceTargets = Array.from(
      container.querySelectorAll<HTMLElement>(".detail__container > *")
    ).filter((el) => el !== cover);

    for (const el of [...chromeTargets, ...sliceTargets])
      el.style.opacity = "0";

    const settleAnima = this.makeCoverSettleAnima((offset) => {
      if (bridge) bridge.style.transform = `translateY(${offset}px)`;
    });
    if (settleAnima) this.coverPadAnima = settleAnima;

    await Promise.all([
      // Phase one — chrome in over the hold window.
      animaToPromise(
        new Anima({
          el: window,
          d: COVER_HOLD_DURATION,
          e: "slow",
          u: (state: AnimaState) => {
            for (const el of chromeTargets)
              el.style.opacity = String(state.prE);
          },
        })
      ),
      // Phase two — slices in after the hold. The clone stays solid (it is
      // hard-swapped for the cover below), so it is not a fade target.
      animaToPromise(
        new Anima({
          el: window,
          d: DETAIL_IN_DURATION,
          e: "slow",
          de: COVER_HOLD_DURATION,
          u: (state: AnimaState) => {
            const p = state.prE;
            for (const el of sliceTargets) el.style.opacity = String(p);
          },
        })
      ),
      settleAnima ? animaToPromise(settleAnima) : Promise.resolve(),
    ]);

    for (const el of [...chromeTargets, ...sliceTargets])
      el.style.opacity = "";
    // Hard swap (bridge path): reveal the identical cover and drop the clone in
    // the same frame — no doubled shadow.
    if (bridge) cover.style.opacity = "";
    bridge?.remove();
    this.finishCoverSettle();
  }

  /** Land the settled cover state: drop the (now identity) transform and
   *  clear the pending delta so a re-run of in() skips the slide. */
  private finishCoverSettle(): void {
    if (this.coverEl) this.coverEl.style.transform = "";
    this.coverSettleDelta = 0;
  }

  /**
   * Scroll-driven nav show/hide (desktop). Fades the title nav out when the
   * outro section scrolls into view and back in when it leaves. Picks up from
   * the nav's CURRENT opacity so reversing mid-fade never jumps.
   */
  private setNavHidden(hidden: boolean): void {
    if (!this.navEl || this.navHidden === hidden) return;
    this.navHidden = hidden;
    dbg.page(`detail:nav-${hidden ? "hide" : "show"}`);

    // Supersede any previous show/hide fade before starting the new one.
    this.navHideAnima?.pause();

    const el = this.navEl;

    const from = parseFloat(getComputedStyle(el).opacity);
    const start = Number.isFinite(from) ? from : hidden ? 1 : 0;
    const to = hidden ? 0 : 1;

    this.navHideAnima = new Anima({
      el: window,
      d: NAV_HIDE_DURATION,
      e: NAV_FADE_EASE,
      u: (state: AnimaState) => {
        el.style.opacity = String(start + (to - start) * state.prE);
      },
      cb: () => {
        // Fully shown → drop the inline value so CSS owns the nav again.
        if (!hidden) el.style.opacity = "";
      },
    });
    this.navHideAnima.play();
  }

  /**
   * Bottom-dwell auto-close (desktop). When the scroller rests at the very
   * bottom of the page — both the damped `current` AND the user-driven
   * `target` at max, so a scroll-up cancels instantly even while the damping
   * is still settling — a BOTTOM_DWELL_MS timer is armed. If the user is
   * still at the bottom when it fires, the SPA navigates home (running the
   * full detail → home exit transition). Scrolling away first disarms the
   * timer and nothing happens.
   */
  private checkBottomDwell(e: ScrollEvent): void {
    const atBottom =
      e.max > 0 &&
      e.current >= e.max - BOTTOM_EPSILON &&
      e.target >= e.max - BOTTOM_EPSILON;

    if (!atBottom) {
      if (this.bottomTimer !== null) {
        window.clearTimeout(this.bottomTimer);
        this.bottomTimer = null;
        dbg.page("detail:bottom-dwell cancelled");
      }
      return;
    }

    if (this.bottomTimer !== null || this.navigatedHome || App.mutating) return;

    dbg.page("detail:bottom-dwell armed");
    this.bottomTimer = window.setTimeout(() => {
      this.bottomTimer = null;
      if (this.navigatedHome || App.mutating) return;
      this.navigatedHome = true;
      dbg.page("detail:bottom-dwell → navigate home");
      // The outro the user is dwelling on IS the DIAA brand moment — suppress
      // the return-home intro beat so the mark doesn't play twice in a row.
      skipNextHomeBeat();
      void App.ctrl?.navigate("/");
    }, BOTTOM_DWELL_MS);
  }

  /**
   * Scroll hook (subscribed by PageManager after in()) — desktop-only outro
   * choreography: fade the nav out once the outro enters the viewport, and
   * arm the bottom-dwell auto-close at full scroll. Mobile bails entirely —
   * the outro is display:none there and the Close footer handles closing.
   */
  onScroll(e: ScrollEvent): void {
    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;

    if (this.outroEl) {
      const outroInView =
        this.outroEl.getBoundingClientRect().top <=
        document.documentElement.clientHeight * OUTRO_NAV_HIDE_RATIO;
      this.setNavHidden(outroInView);
    }

    this.checkBottomDwell(e);
  }

  /**
   * Fade the DOM container up to opacity 1. Runs inside
   * `PageManager.afterIn()` after the previous page has been removed, so
   * the detail page reveals at its correct bounds.
   *
   * Mirrors the home entrance exactly (see home.ts HOME_IN_*): init() already
   * pinned the container to opacity 0, so this holds for DETAIL_IN_DELAY then
   * fades in over DETAIL_IN_DURATION on kido's "slow" ease — same duration and
   * curve as home, so both pages enter identically.
   */
  async in(): Promise<void> {
    dbg.page("detail:in");

    // Home→detail bridge: when the home page handed off a live "reveal" image
    // clone (text mode, image active — see controller/transitions/home-to-detail.ts),
    // hold it over the detail cover while the rest of the page fades in, then
    // hand off to the real cover. Null on every other navigation, where this
    // falls through to the normal entrance fade.
    //
    // The bridge clone is pinned exactly over `.detail__cover` (same size/pos —
    // see _detail.module.scss). Only ONE copy of the image may be visible at a
    // time. The previous approach held the cover SOLID and faded the clone out
    // over it — two stacked copies. That reads as one for an OPAQUE cover, but a
    // cover with transparency (e.g. a transparent SVG with a baked drop-shadow)
    // composites its two semi-transparent shadows into a visibly DOUBLED/darker
    // shadow for the whole fade. So instead we HIDE the cover beneath the solid
    // clone for the entire entrance and hard-swap them in a single frame at the
    // end: invisible because clone and cover are the same image at the same
    // position, with no moment of two shadows and no white bleeding through.
    const bridge = takeImageBridge();

    // Mobile forward entry (coverSettleDelta pending from init) runs the
    // two-phase choreography: chrome + centred cover for a beat, then the
    // cover slides up while the slices fade in. Back-nav has no pending
    // slide (delta 0) and falls through to the plain fade below.
    if (this.coverSettleDelta !== 0 && this.coverEl) {
      await this.mobileEntrance(bridge);
      return;
    }

    if (bridge) {
      const container = this.container as HTMLElement;
      container.style.opacity = "1";

      const cover = container.querySelector<HTMLElement>(".detail__cover");
      // Hide the real cover beneath the solid clone so only the clone's single
      // shadow renders during the entrance (see the note above) — never two.
      if (cover) cover.style.opacity = "0";

      // `.detail__footer` is the persistent fixed `( Close )` footer (every
      // tier) — it fades in with the nav instead of popping.
      const fadeTargets = [
        ...container.querySelectorAll<HTMLElement>(
          ".detail__nav, .detail__footer"
        ),
        ...Array.from(
          container.querySelectorAll<HTMLElement>(".detail__container > *")
        ).filter((el) => el !== cover),
      ];
      for (const el of fadeTargets) el.style.opacity = "0";

      // The clone stays fully solid the whole time — the image never changes.
      await animaToPromise(
        new Anima({
          el: window,
          d: DETAIL_IN_DURATION,
          e: "slow",
          de: DETAIL_IN_DELAY,
          u: (state: AnimaState) => {
            const p = state.prE;
            for (const el of fadeTargets) el.style.opacity = String(p);
          },
        })
      );

      for (const el of fadeTargets) el.style.opacity = "";
      // Hard swap: reveal the identical cover and drop the clone in the same
      // frame — no gap, no crossfade, no doubled shadow.
      if (cover) cover.style.opacity = "";
      bridge.remove();
      return;
    }

    await this.fadeContainer(1, DETAIL_IN_DURATION, {
      e: "slow",
      de: DETAIL_IN_DELAY,
    });
  }

  /**
   * Fade DOM container down to 0. Runs inside `PageManager.beforeOut()`
   * before the EmptyTransition swaps the DOM.
   */
  async out(): Promise<void> {
    dbg.page("detail:out");
    const container = this.container as HTMLElement | null;

    await animaToPromise(
      new Anima({
        el: window,
        d: DETAIL_OUT_DURATION,
        e: "slow",
        u: (state: AnimaState) => {
          const p = state.prE;
          const opacity = 1 - p;
          if (container) container.style.opacity = String(opacity);
        },
      })
    );
  }

  /**
   * Teardown: stop any in-flight nav fade so nothing leaks across SPA
   * navigation, then run the base slice teardown.
   */
  async cleanup(): Promise<void> {
    this.navHideAnima?.pause();
    this.navHideAnima = null;
    if (this.bottomTimer !== null) {
      window.clearTimeout(this.bottomTimer);
      this.bottomTimer = null;
    }
    this.outroEl = null;
    this.navHidden = false;
    this.navigatedHome = false;
    this.coverPadAnima?.pause();
    this.coverPadAnima = null;
    this.coverEl = null;
    this.coverSettleDelta = 0;
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.navEl = null;
    await super.cleanup();
  }
}
