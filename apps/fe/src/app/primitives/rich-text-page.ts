/**
 * RichTextPage — shared lifecycle base for CMS singleton pages that render a
 * single centered rich-text body followed by a full-viewport DIAA outro
 * (Contact, Imprint). Both pages are structurally identical to DetailPage
 * minus the cover image / slices / home-bridge branch: a fixed passive title
 * heading, a 100vh centered text panel, a 100vh brand outro, and a
 * persistent fixed `( Close )` footer as the way home (same model as the
 * detail page — there is no hover title ⇄ "( Close )" swap). The detail
 * page's desktop outro choreography is shared too: the title fades out once
 * the outro scrolls into view, and resting at the very bottom auto-navigates
 * home. That behavior is extracted here once instead of duplicated per page
 * — subclasses only supply a dbg label, which doubles as the BEM block name
 * for the nav/outro selectors (`.{pageKey}__nav`, `.{pageKey}__outro`).
 *
 * Container lifecycle:
 *   init(): pin container opacity to 0 so it stays invisible until in() fades
 *           up (the EmptyTransition DOM swap would otherwise show it at full
 *           opacity for a frame), and query the nav/outro for the desktop
 *           outro choreography.
 *   in():   fade container 0 → 1, mirroring the detail/home entrance timing
 *           exactly so every page transition feels consistent.
 *   out():  800ms content fade on the same "slow" ease before the swap.
 */

import { Anima, type AnimaState } from "kido/anima";

import { App } from "@app/context";
import { skipNextHomeBeat } from "@app/controller/beat-skip";
import { animaToPromise } from "@app/controller/transition-fx";
import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

import type { ScrollEvent } from "kido";

// Entrance/exit fades — mirror DetailPage/home exactly so every page moves
// with identical timing: a 200ms hold after the previous page clears, then a
// 1200ms container fade in — and an 800ms fade out — on kido's "slow" ease
// (the shared brand-beat spring-fit curve — see Ease.slow in kido/utils).
const IN_DURATION = 1200;
const IN_DELAY = 200;
const IN_EASE = "slow";
const OUT_DURATION = 800;

// Desktop outro choreography — mirrors DetailPage (keep in sync with the
// constants in routes/detail/detail.ts):
// - The title nav fades out over NAV_HIDE_DURATION once the outro section
//   enters the viewport, and back in when the user scrolls above it.
// - Resting at the very bottom of the page for BOTTOM_DWELL_MS auto-navigates
//   home through the normal SPA transition. Scrolling away (target moving off
//   the bottom) before the dwell elapses cancels it silently.
// BOTTOM_EPSILON absorbs sub-pixel rounding in the scroller's damped values.
const NAV_HIDE_DURATION = 400;
const NAV_FADE_EASE: number[] = [0, 0, 1, 1];
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

export abstract class RichTextPage extends BasePage {
  /** Short key labelling dbg.page() calls AND naming the page's BEM block —
   *  the nav/outro are queried as `.{pageKey}__nav` / `.{pageKey}__outro`
   *  (e.g. "contact", "imprint"). */
  protected abstract readonly pageKey: string;

  /** The title nav — a passive heading; the scroll-driven show/hide (see
   *  setNavHidden) is its only animation. */
  private navEl: HTMLElement | null = null;
  /** The outro section — the nav-fade scroll trigger. */
  private outroEl: HTMLElement | null = null;
  /** True while the nav is scroll-hidden (outro in view). */
  private navHidden = false;
  /** In-flight scroll-driven nav show/hide fade — superseded on re-toggle. */
  private navHideAnima: Anima | null = null;
  /** Pending bottom-dwell timer handle, null when disarmed. */
  private bottomTimer: number | null = null;
  /** Latched once the dwell navigation fires so it can never double-trigger. */
  private navigatedHome = false;

  /**
   * Pin the DOM container to opacity 0. Pinning here prevents a flash of the
   * fully-opaque page before in() runs — same reasoning as DetailPage. The
   * title heading is passive (closing lives in the `( Close )` footer), so
   * it only needs querying for the scroll-driven show/hide.
   */
  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    dbg.page(`${this.pageKey}:init`);

    (container as HTMLElement).style.opacity = "0";

    this.navEl = (container as HTMLElement).querySelector<HTMLElement>(
      `.${this.pageKey}__nav`
    );
    // Outro section — scroll trigger for the desktop nav fade (see onScroll).
    // display:none on mobile, where onScroll bails before ever measuring it.
    this.outroEl = (container as HTMLElement).querySelector<HTMLElement>(
      `.${this.pageKey}__outro`
    );
  }

  /**
   * Scroll-driven nav show/hide (desktop) — same treatment as DetailPage.
   * Fades the title nav out when the outro section scrolls into view and
   * back in when it leaves. Picks up from the nav's CURRENT opacity so
   * reversing mid-fade never jumps.
   */
  private setNavHidden(hidden: boolean): void {
    if (!this.navEl || this.navHidden === hidden) return;
    this.navHidden = hidden;
    dbg.page(`${this.pageKey}:nav-${hidden ? "hide" : "show"}`);

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
   * Bottom-dwell auto-close (desktop) — same treatment as DetailPage. When
   * the scroller rests at the very bottom of the page — both the damped
   * `current` AND the user-driven `target` at max, so a scroll-up cancels
   * instantly even while the damping is still settling — a BOTTOM_DWELL_MS
   * timer is armed. If the user is still at the bottom when it fires, the
   * SPA navigates home (running the full exit transition). Scrolling away
   * first disarms the timer and nothing happens.
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
        dbg.page(`${this.pageKey}:bottom-dwell cancelled`);
      }
      return;
    }

    if (this.bottomTimer !== null || this.navigatedHome || App.mutating) return;

    dbg.page(`${this.pageKey}:bottom-dwell armed`);
    this.bottomTimer = window.setTimeout(() => {
      this.bottomTimer = null;
      if (this.navigatedHome || App.mutating) return;
      this.navigatedHome = true;
      dbg.page(`${this.pageKey}:bottom-dwell → navigate home`);
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
   * the outro is display:none there and the page fits the viewport.
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
   * the page reveals at its correct bounds. Mirrors the detail/home
   * entrance exactly (see the DETAIL_IN_ / HOME_IN_ constants): init()
   * already pinned the container to opacity 0, so this holds for IN_DELAY
   * then fades in over IN_DURATION on kido's "slow" ease.
   */
  async in(): Promise<void> {
    dbg.page(`${this.pageKey}:in`);
    await this.fadeContainer(1, IN_DURATION, { e: IN_EASE, de: IN_DELAY });
  }

  /**
   * Fade DOM container down to 0 over OUT_DURATION on the shared "slow"
   * ease. Runs inside `PageManager.beforeOut()` before the EmptyTransition
   * swaps the DOM — same exit timing as every other page.
   */
  async out(): Promise<void> {
    dbg.page(`${this.pageKey}:out`);
    const container = this.container as HTMLElement | null;

    await animaToPromise(
      new Anima({
        el: window,
        d: OUT_DURATION,
        e: IN_EASE,
        u: (state: AnimaState) => {
          const p = state.prE;
          const opacity = 1 - p;
          if (container) container.style.opacity = String(opacity);
        },
      }),
    );
  }

  /**
   * Teardown: stop any in-flight nav fade and disarm the bottom-dwell timer
   * so nothing leaks across SPA navigation, then run the base teardown.
   */
  async cleanup(): Promise<void> {
    this.navHideAnima?.pause();
    this.navHideAnima = null;
    if (this.bottomTimer !== null) {
      window.clearTimeout(this.bottomTimer);
      this.bottomTimer = null;
    }
    this.navEl = null;
    this.outroEl = null;
    this.navHidden = false;
    this.navigatedHome = false;
    await super.cleanup();
  }
}

export default RichTextPage;
