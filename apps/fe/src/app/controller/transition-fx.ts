/**
 * transition-fx.ts — DefaultTransition and animaToPromise helper.
 *
 * Implements the page transition using only compositor-friendly properties
 * (transform + opacity on separate elements).
 *
 *   - Duration: 1000ms
 *   - Out easing (page transform): cubic-bezier(0.16, 1, 0.3, 1) — "o6"
 *   - Overlay easing (opacity):    cubic-bezier(0.25, 1, 0.5, 1) — "o4"
 *   - In easing (bg slide + clip): cubic-bezier(0.76, 0, 0.2, 1) — "io"
 *   - Y easing (old page Y):       cubic-bezier(0.68, 0, 0.28, 1) — "ioo"
 *
 * The transition uses a combined approach: the new page has BOTH a clip-path
 * reveal AND a white .bg div sliding up. The old page gets a dark overlay
 * fade + translate/scale down.
 *
 * GPU integration: all plane animation is controlled here and in page modules,
 * NOT by the GPU's internal crossfade. Old planes stay visible — the curtain
 * slides over them. The transition sets toScene plane opacities to 0 so they
 * don't flash after commit. Page modules animate new plane opacities 0→1 in
 * their in() hook.
 *
 * References:
 *   - TRAN-03: DefaultTransition implementation
 *   - INFR-04: animaToPromise pattern
 */

import { Anima, type AnimaPlayOptions, type AnimaState } from "kido/anima";

import { App } from "../context";
import { dbg } from "../debug";

import { BaseTransition } from "./transition-registry";

/**
 * Easing curves — cubic-bezier control point arrays [x1, y1, x2, y2].
 */
const EASE_O6: [number, number, number, number] = [0.16, 1, 0.3, 1];
const EASE_O4: [number, number, number, number] = [0.25, 1, 0.5, 1];
const EASE_IO: [number, number, number, number] = [0.76, 0, 0.2, 1];

/** Transition duration in ms */
const DURATION = 1000;

// ---------------------------------------------------------------------------
// animaToPromise helper
// ---------------------------------------------------------------------------

/**
 * Wrap an Anima instance's play() call in a Promise that resolves when the
 * animation's completion callback (cb) fires.
 *
 * @param anima - A configured Anima instance whose play() should be called.
 * @param opts  - Additional AnimaPlayOptions merged into the play call.
 * @returns A Promise that resolves (void) when the animation finishes.
 */
export function animaToPromise(anima: Anima, opts: AnimaPlayOptions = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    anima.play({ ...opts, cb: resolve });
  });
}

// ---------------------------------------------------------------------------
// DefaultTransition
// ---------------------------------------------------------------------------

/**
 * The default page transition — curtain reveal with overlay and clip-path.
 *
 * Out: dark overlay fades in (o4 easing) + old page recedes via transform (o6 easing)
 * In:  white .bg curtain slides up (io easing) + clip-path reveal (io easing)
 *
 * Both run simultaneously.
 */
export class DefaultTransition extends BaseTransition {
  /** Tracks dynamically created elements for cleanup */
  private _overlay: HTMLElement | null = null;
  private _bg: HTMLElement | null = null;

  /**
   * Animate the old page out.
   *
   * Creates a dark overlay div on top of the content and fades it in
   * (opacity 0 → 1, o4 easing) while the page slides up and scales down
   * (o6 easing). The overlay is a separate element so its opacity animation
   * is compositor-only.
   *
   * @param fromEl - The DOM element of the page that is leaving.
   * @param _toEl  - Unused — required by BaseTransition contract.
   */
  async out(fromEl: HTMLElement, _toEl: HTMLElement): Promise<void> {
    dbg.txOut("old page — slide up + darken overlay");

    // Stack below the new page
    fromEl.style.position = "relative";
    fromEl.style.zIndex = "1";
    fromEl.style.willChange = "transform";

    // Set transform-origin to the current viewport top so the scale
    // always shrinks from what the user sees, not the element's center.
    const scrollY = window.scrollY || 0;
    fromEl.style.transformOrigin = `center ${scrollY + (App.win.h || window.innerHeight) / 2}px`;

    // Create dark overlay covering the entire viewport. Appended to
    // document.body with position:fixed so it stacks above page content.
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
      "background:rgba(0,0,0,0.8);opacity:0;z-index:5;" +
      "will-change:opacity;pointer-events:none;";
    document.body.appendChild(overlay);
    this._overlay = overlay;

    const vh = App.win.h || window.innerHeight;

    // Animate page transform (o6 easing — fast start, smooth decel)
    const pageAnim = new Anima({
      el: fromEl,
      d: DURATION,
      r: 5,
      e: EASE_O6,
      p: {
        y: [0, -Math.round(vh * 0.15), "px"],
        scale: [1, 0.9],
      },
    });

    // Animate overlay opacity (o4 easing — separate compositor layer)
    const overlayAnim = new Anima({
      el: overlay,
      d: DURATION,
      r: 5,
      e: EASE_O4,
      p: {
        o: [0, 1],
      },
    });

    await Promise.all([
      animaToPromise(pageAnim),
      animaToPromise(overlayAnim),
    ]);

    // Lock hidden so the old page can't flash back before removeOld()
    fromEl.style.visibility = "hidden";
  }

  /**
   * Animate the new page in via white background curtain + clip-path reveal.
   *
   * A white .bg div slides up from below (transform, io easing) while the
   * page's clip-path opens from bottom to top (also io easing).
   *
   * @param _fromEl - Unused — required by BaseTransition contract.
   * @param toEl    - The DOM element of the incoming page.
   */
  async in(_fromEl: HTMLElement, toEl: HTMLElement): Promise<void> {
    dbg.txIn("new page — curtain slide up + clip reveal");

    const vh = App.win.h || window.innerHeight;

    // Position new page fixed to viewport so the curtain reveal works
    // regardless of scroll position. Cleanup scrolls to top first, then
    // strips styles so the fixed→relative shift is invisible.
    toEl.style.position = "fixed";
    toEl.style.top = "0";
    toEl.style.left = "0";
    toEl.style.width = "100%";
    toEl.style.height = "100vh";
    toEl.style.zIndex = "10";
    toEl.style.overflow = "hidden";
    toEl.style.background = "transparent";
    toEl.style.clipPath = "inset(100% 0% 0% 0%)";

    // Create white curtain — first child so content stacks on top
    const bg = document.createElement("div");
    bg.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;" +
      "background:#fff;will-change:transform;pointer-events:none;";
    toEl.insertBefore(bg, toEl.firstChild);
    this._bg = bg;

    // Single Anima drives .bg transform AND clip-path via `u` callback.
    // Both use the io easing (cubic-bezier(0.76, 0, 0.2, 1)).
    const anima = new Anima({
      el: toEl,
      d: DURATION,
      r: 5,
      e: EASE_IO,
      u: (state: AnimaState) => {
        const p = state.prE; // eased progress 0 → 1

        // .bg slides up: translate3d(0, vh→0, 0)
        const bgY = Math.round((1 - p) * vh);
        bg.style.transform = `translate3d(0, ${bgY}px, 0)`;

        // Clip-path opens: inset(100→0% 0% 0% 0%)
        const clip = Math.round((100 - p * 100) * 100) / 100;
        toEl.style.clipPath = `inset(${clip}% 0% 0% 0%)`;
      },
    });

    await animaToPromise(anima);

    dbg.txIn("curtain complete — styles kept until removeOld");
  }

  /**
   * Clean up transition artifacts after the old page is removed.
   *
   * Removes the dynamically created .bg and overlay elements, then strips
   * all inline styles so the page returns to normal document flow.
   *
   * @param toEl - The new page element to clean up.
   */
  cleanup(toEl: HTMLElement): void {
    this._bg?.remove();
    this._overlay?.remove();
    this._bg = null;
    this._overlay = null;

    // Scroll to top BEFORE removing fixed positioning so the page is
    // already at y=0 when it enters document flow — no visible shift.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });

    toEl.removeAttribute("style");
  }
}

// ---------------------------------------------------------------------------
// EmptyTransition — no-op DOM swap, used as the registry default
// ---------------------------------------------------------------------------

/**
 * EmptyTransition runs no animations. Page hooks own all visual transition
 * work: `Page.out()` fades DOM content down (inside `PageManager.beforeOut`),
 * `Page.in()` fades it up (inside `PageManager.afterIn`). This class only
 * handles the brief 150ms window after `insertNew()` and before `removeOld()`
 * where both pages coexist in `#app` — without `position: fixed` on toEl,
 * it would flow as `lastElementChild` below fromEl and the page would
 * visibly snap up when the old page is removed.
 */
export class EmptyTransition extends BaseTransition {
  async out(_fromEl: HTMLElement, _toEl: HTMLElement): Promise<void> {
    dbg.txOut("empty (page hooks own visual work)");
  }

  async in(_fromEl: HTMLElement, toEl: HTMLElement): Promise<void> {
    dbg.txIn("empty — pin toEl fixed overlay");

    toEl.style.position = "fixed";
    toEl.style.top = "0";
    toEl.style.left = "0";
    toEl.style.width = "100%";
    toEl.style.height = "100vh";
    toEl.style.zIndex = "2";
    toEl.style.willChange = "auto";
    // Hide the incoming page until its in() hook reveals it. page.init()
    // configures the page (e.g. home restores its persisted mode) while it's
    // invisible, then page.in() fades it 0→1 — so we never flash the default
    // or cached state during the transition window. cleanup() keeps it at 0.
    toEl.style.opacity = "0";
  }

  cleanup(toEl: HTMLElement): void {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    toEl.removeAttribute("style");
    // Keep the page hidden after stripping the transition styles — page.in()
    // (which runs next, in PageManager.afterIn) owns the reveal. Without this,
    // removeAttribute would restore opacity 1 for a frame before in() pins it.
    toEl.style.opacity = "0";
  }
}

// ---------------------------------------------------------------------------
// FadeTransition — opacity crossfade (kept for opt-in registry entries)
// ---------------------------------------------------------------------------

/** Fade duration in ms. Tuned for a snappy but readable swap. */
const FADE_DURATION = 600;

/**
 * A pure DOM opacity crossfade transition. `Page.out()` fades content down
 * before this runs (inside `PageManager.beforeOut`), and `Page.in()` fades it
 * back up (inside `PageManager.afterIn`).
 *
 * Layout: toEl is positioned `fixed` over fromEl during the transition.
 * Without that, toEl is `lastElementChild` of #app and flows BELOW fromEl —
 * when removeOld runs, the page snaps up. Fixed positioning hides the snap.
 */
export class FadeTransition extends BaseTransition {
  /**
   * DOM fade out of the outgoing page. The outgoing page's `out()` hook
   * (already ran in `PageManager.beforeOut`) handles content-level cleanup;
   * this method only animates the DOM container.
   */
  async out(fromEl: HTMLElement, _toEl: HTMLElement): Promise<void> {
    dbg.txOut("fade out fromEl (planes already faded by page.out)");

    fromEl.style.willChange = "opacity";

    await animaToPromise(
      new Anima({
        el: fromEl,
        d: FADE_DURATION,
        e: EASE_O4,
        u: (state: AnimaState) => {
          fromEl.style.opacity = String(1 - state.prE);
        },
      }),
    );
  }

  /**
   * Position toEl as a fixed-position overlay, pin its opacity to 0, then
   * fade only the DOM toEl up to 1. The page's `in()` hook (runs after this
   * resolves, in `PageManager.afterIn`) owns all content reveal animations.
   */
  async in(_fromEl: HTMLElement, toEl: HTMLElement): Promise<void> {
    dbg.txIn("fade in toEl (fixed overlay)");

    // Stack toEl over fromEl while both coexist in the DOM. Without this,
    // toEl flows below fromEl and a layout jump happens at removeOld.
    toEl.style.position = "fixed";
    toEl.style.top = "0";
    toEl.style.left = "0";
    toEl.style.width = "100%";
    toEl.style.height = "100vh";
    toEl.style.zIndex = "2";
    toEl.style.opacity = "0";
    toEl.style.willChange = "opacity";

    await animaToPromise(
      new Anima({
        el: toEl,
        d: FADE_DURATION,
        e: EASE_O4,
        u: (state: AnimaState) => {
          toEl.style.opacity = String(state.prE);
        },
      }),
    );
  }

  /**
   * Scroll to top before stripping styles so the page is at y=0 when it
   * enters normal flow — otherwise the fixed → relative shift would jump.
   */
  cleanup(toEl: HTMLElement): void {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    toEl.removeAttribute("style");
  }
}
