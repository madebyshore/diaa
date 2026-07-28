/**
 * HomeDetailTransition — custom page transition from home to a detail page.
 *
 * Special-cases the one navigation where home has visible, transferable state:
 * text mode with a project image revealed behind the labels. In that case the
 * revealed image is kept LIVE across the page swap so it reads as a single
 * continuous element bridging the two pages, rather than blinking out with the
 * rest of the home content.
 *
 * How the bridge works (timing is dictated by TransitionManager):
 *   1. `HomePage.out()` (runs first, in beforeOut) fades only the home chrome
 *      (text/nav/footer) and leaves `.home__text-gpu` — so the active figure is
 *      still on screen when this transition runs.
 *   2. `out()` here clones that figure into a `position: fixed` element on the
 *      body, sized/placed from its live bounds, then HIDES the original figure so
 *      only the single clone is ever visible — two stacked copies (original +
 *      clone, coexisting until removeOld) would double the shadow of a
 *      transparent cover. The clone survives `removeOld()` (which deletes the
 *      home section) because it lives on the body, not in the page.
 *   3. `in()` pins the incoming detail page as a hidden fixed overlay (same as
 *      EmptyTransition) so `DetailPage.in()` can reveal it.
 *   4. `DetailPage.in()` keeps the solid bridge clone as the ONLY visible copy of
 *      the image — the real `.detail__cover` (laid out at the same viewport
 *      position and size, see styles/pages/_detail.module.scss) is held hidden
 *      beneath it — while the rest of the detail page (nav, slices, outro) fades
 *      up underneath. At the end the clone and cover are hard-swapped in a single
 *      frame: invisible because they are the same image at the same spot. Only one
 *      copy is ever on screen, so an opaque cover and a transparent-with-shadow
 *      cover both hand off cleanly (no crossfade white-bleed, no doubled shadow).
 *
 * Any other home→detail navigation (image mode, or text mode with no image
 * revealed — e.g. keyboard activation without hover) takes the no-op path and
 * behaves exactly like the default EmptyTransition.
 */

import { App } from "@app/context";
import { setImageBridge, takeImageBridge } from "@app/controller/image-bridge";
import { BaseTransition } from "@app/controller/transition-registry";
import { dbg } from "@app/debug";

/**
 * z-index for the fixed bridge clone. The project z-index scale tops out at 4
 * (dev-grid) and the transition pins the incoming page at 2, so 100 keeps the
 * held image above the detail content while it cross-fades in. It is
 * pointer-events:none and removed as soon as the cross-fade completes.
 */
const BRIDGE_Z_INDEX = 100;

export class HomeDetailTransition extends BaseTransition {
  /**
   * Promote the revealed home image to a fixed body clone when bridging.
   *
   * Runs while the home section is still in the DOM (before removeOld). When not
   * bridging this is a no-op — `HomePage.out()` has already faded the home
   * container, matching the default EmptyTransition behaviour.
   *
   * @param fromEl - The outgoing home `<section>`.
   * @param _toEl  - The incoming detail `<section>` (unused here).
   */
  async out(fromEl: HTMLElement, _toEl: HTMLElement): Promise<void> {
    // Defensive: drop any clone orphaned by a previous aborted navigation so it
    // can never linger on the body across an unrelated nav.
    takeImageBridge()?.remove();

    if (App.home.mode !== "text") {
      dbg.txOut("home → detail (no bridge: not text mode)");
      return;
    }

    const figure = fromEl.querySelector<HTMLElement>(
      ".home__text-gpu-figure.is-active",
    );
    if (!figure) {
      dbg.txOut("home → detail (no bridge: no active figure)");
      return;
    }

    // Clone the figure (keeps the already-decoded <img>, so no re-fetch/flash)
    // and place it exactly over the live one. The live figure is fixed and
    // viewport-centred, so the clone is visually identical — removing the home
    // section underneath it is invisible. All sizing/placement is inline so it
    // is independent of the now-removed `.home__text-gpu` grid context.
    const rect = figure.getBoundingClientRect();
    const clone = figure.cloneNode(true) as HTMLElement;
    clone.removeAttribute("class");
    clone.style.cssText = [
      "position:fixed",
      `top:${rect.top}px`,
      `left:${rect.left}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      "margin:0",
      "transform:none",
      // Kill the .home__text-gpu-figure 800ms opacity transition — DetailPage.in()
      // drives the cross-fade opacity directly.
      "transition:none",
      "overflow:hidden",
      "opacity:1",
      "pointer-events:none",
      `z-index:${BRIDGE_Z_INDEX}`,
    ].join(";");

    // The reveal figure holds either an <img> or (for MP4 covers) a <video>.
    // Removing the figure's class above stripped the `._g`/figure sizing, so
    // re-apply the cover fit to whichever media the clone carries. A cloned
    // autoplay+muted <video> resumes playing on its own, so the bridge stays
    // live during the crossfade.
    const media = clone.querySelector<HTMLElement>("img, video");
    if (media) media.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";

    document.body.appendChild(clone);

    // Hide the ORIGINAL reveal figure now that its pixel-identical clone is
    // stacked over the exact same viewport rect. Both stay in the DOM until the
    // home section is removed (~150ms into the transition), and for a cover with
    // baked transparency (a transparent SVG with a shadow in its pixels) two
    // visible copies composite their semi-transparent shadows into a DOUBLED /
    // darker shadow for that whole window — the "shadow gets darker for a beat"
    // report. visibility:hidden drops the paint + shadow INSTANTLY with zero
    // visible change (the clone already covers the rect); opacity:0 would
    // instead fade over the figure's 800ms opacity transition, leaving the
    // double on screen the entire fade. The figure is destroyed with the home
    // section on the normal path, so this inline style never needs restoring.
    figure.style.visibility = "hidden";

    setImageBridge(clone);
    dbg.txOut("home → detail (bridge: holding active image)");
  }

  /**
   * Pin the incoming detail page as a hidden fixed overlay so it stacks over the
   * outgoing home section while both coexist, and stays invisible until
   * `DetailPage.in()` reveals it. Identical to EmptyTransition.in — the bridge
   * (created in out()) sits above this via its higher z-index.
   *
   * @param _fromEl - The outgoing home `<section>` (unused).
   * @param toEl    - The incoming detail `<section>`.
   */
  async in(_fromEl: HTMLElement, toEl: HTMLElement): Promise<void> {
    dbg.txIn("home → detail — pin detail overlay");
    toEl.style.position = "fixed";
    toEl.style.top = "0";
    toEl.style.left = "0";
    toEl.style.width = "100%";
    toEl.style.height = "100vh";
    toEl.style.zIndex = "2";
    toEl.style.willChange = "auto";
    toEl.style.opacity = "0";
  }

  /**
   * Strip the transition's inline styles after the home section is removed, then
   * re-pin the detail page hidden so `DetailPage.in()` owns the reveal (same as
   * EmptyTransition.cleanup). The bridge clone is intentionally left in place —
   * `DetailPage.in()` cross-fades and removes it.
   *
   * @param toEl - The incoming detail `<section>`.
   */
  cleanup(toEl: HTMLElement): void {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    toEl.removeAttribute("style");
    toEl.style.opacity = "0";
  }
}
