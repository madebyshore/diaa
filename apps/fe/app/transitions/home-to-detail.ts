import { setImageBridge, takeImageBridge } from "~/lib/image-bridge";
import { useHomeMode } from "~/controllers/home";

/**
 * transitions/home-to-detail.ts — the home→detail image bridge, ported from
 * apps/fe/src/app/controller/transitions/home-to-detail.ts's `out()`.
 *
 * Special-cases the one navigation where home has visible, transferable
 * state: text mode with a project image revealed behind the labels. In that
 * case the revealed image is kept LIVE across the page swap so it reads as
 * a single continuous element bridging the two pages, rather than blinking
 * out with the rest of the home content.
 *
 * How the bridge works (timing is dictated by transitions/default.ts):
 *   1. This runs from onBeforeLeave — BEFORE controllers/home.ts's out()
 *      (which runs from onLeave, later) fades the home chrome — so the
 *      active figure is still fully visible on screen when this runs.
 *   2. bridgeOut() here clones that figure into a `position: fixed` element
 *      on the body, sized/placed from its live bounds, then HIDES the
 *      original figure so only the single clone is ever visible — two
 *      stacked copies (original + clone, coexisting until Vue removes the
 *      home section) would double the shadow of a transparent cover. The
 *      clone survives the home section's removal because it lives on the
 *      body, not in the page.
 *   3. transitions/default.ts's onBeforeEnter pins the incoming detail page
 *      as a hidden fixed overlay (unchanged, no bridge-specific work there).
 *   4. controllers/detail.ts's in() keeps the solid bridge clone as the ONLY
 *      visible copy of the image — the real `.detail__cover` (laid out at
 *      the same viewport position and size, see
 *      styles/pages/_detail.module.scss) is held hidden beneath it — while
 *      the rest of the detail page (nav, slices, outro) fades up
 *      underneath. At the end the clone and cover are hard-swapped in a
 *      single frame: invisible because they are the same image at the same
 *      spot. Only one copy is ever on screen, so an opaque cover and a
 *      transparent-with-shadow cover both hand off cleanly (no crossfade
 *      white-bleed, no doubled shadow).
 *
 * Any other home→detail navigation (image mode, or text mode with no image
 * revealed — e.g. keyboard activation without hover) takes the no-op path
 * and behaves exactly like the plain container-fade default.
 */

/**
 * Bridge clone z-index — TWO STAGES, not a single flat value. The clone has
 * to sit at a DIFFERENT stacking layer depending on what's actually visible
 * behind it at each phase of the transition:
 *
 *   1. While home is still fading OUT (bridgeOut() below runs before
 *      controllers/home.ts's out(), which fades the text pane over ~800ms —
 *      see transitions/default.ts's onBeforeLeave/onLeave ordering): the
 *      clone stands in for the ORIGINAL revealed figure, which always sat
 *      BEHIND the text labels (`.home__text-gpu { z-index: 0 }` vs.
 *      `.home__text { z-index: 1 }` — styles/pages/_home.module.scss). The
 *      clone must match that SAME relationship — `BRIDGE_Z_INDEX_HOME`,
 *      equal to `.home__text-gpu`'s own z-index — or the fading text renders
 *      UNDERNEATH the solid clone instead of visibly fading away ON TOP of
 *      it, cutting a solid opaque rectangle through the text instead of
 *      reading as one continuous image behind it.
 *   2. Once home is gone and controllers/detail.ts's in() takes the bridge
 *      (`takeImageBridge()`) to cross-fade the REST of the detail page up
 *      around it: the clone now needs to sit ABOVE the incoming detail
 *      page's own content (pinned at `z-index: 2` by transitions/
 *      default.ts's onBeforeEnter) so the crossfade — and the final
 *      hard-swap onto `.detail__cover` — reads correctly. `raiseImageBridge()`
 *      below bumps the SAME element to `BRIDGE_Z_INDEX_DETAIL` (100 — the
 *      project's z-index scale tops out at a handful of low values for nav/
 *      dev-grid, so 100 clears the incoming page's z:2 with a wide margin)
 *      at exactly that moment — called from detail.ts's in(), the instant it
 *      takes the bridge, before anything else in its own crossfade runs.
 *
 * A single flat z-index could satisfy phase 2 alone (a value above 2) but
 * not phase 1 (which needs the clone BELOW the home text's z:1, not above
 * it) — hence two stages instead of one constant.
 */
const BRIDGE_Z_INDEX_HOME = 0;
const BRIDGE_Z_INDEX_DETAIL = 100;

/**
 * Raise a held bridge clone from its home-phase stacking (behind the text,
 * see BRIDGE_Z_INDEX_HOME) to its detail-phase stacking (above the incoming
 * page, see BRIDGE_Z_INDEX_DETAIL). Called by controllers/detail.ts's in()
 * the instant it takes the bridge via `takeImageBridge()` — home is fully
 * faded/gone by then, so this is the right moment to bring the clone forward
 * for its cross-fade over the detail page's own content.
 */
export function raiseImageBridge(bridge: HTMLElement): void {
  bridge.style.zIndex = String(BRIDGE_Z_INDEX_DETAIL);
}

/**
 * bridgeOut — dispatched from transitions/default.ts's onBeforeLeave when
 * the route pair is home→[slug] (a cheap, coarse first-pass gate on route
 * `.name`). `toPath` narrows that further: Nuxt's `[slug].vue` serves
 * Detail, Contact, AND Imprint through one shared route name, so a
 * route-name check alone can't tell "clicked a grid item" apart from, say, a
 * footer link to `/contact` clicked without ever leaving hover on some
 * unrelated item. The precise check below instead asks a self-contained
 * question that needs no route-type lookup at all: is `toPath` the SAME href
 * as the currently-active figure's own text-item anchor? That is exactly
 * diaa's `App.route.new.page === "detail"` semantics (only bridge when
 * really heading to a project's detail page) verified against the SPECIFIC
 * item that's revealed, which is strictly safer — it also rules out the
 * near-impossible-but-not-quite-impossible case of hovering item A while
 * navigating to item B's page.
 */
export function bridgeOut(fromEl: HTMLElement, toPath: string): void {
  // Defensive: drop any clone orphaned by a previous aborted navigation so
  // it can never linger on the body across an unrelated nav.
  takeImageBridge()?.remove();

  const mode = useHomeMode();
  if (mode.value !== "text") {
    console.debug("[transition:bridge] home → detail (no bridge: not text mode)");
    return;
  }

  const figure = fromEl.querySelector<HTMLElement>(".home__text-gpu-figure.is-active");
  if (!figure) {
    console.debug("[transition:bridge] home → detail (no bridge: no active figure)");
    return;
  }

  const index = figure.dataset.index;
  const anchor =
    index != null ? fromEl.querySelector<HTMLElement>(`.home__text-item[data-index="${index}"]`) : null;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.getAttribute("href") !== toPath) {
    console.debug("[transition:bridge] home → detail (no bridge: navigation target mismatch)");
    return;
  }

  // Clone the figure (keeps the already-decoded <img>, so no re-fetch/flash)
  // and place it exactly over the live one. The live figure is fixed and
  // viewport-centred, so the clone is visually identical — removing the
  // home section underneath it is invisible. All sizing/placement is inline
  // so it is independent of the now-removed `.home__text-gpu` grid context.
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
    // Kill the .home__text-gpu-figure 800ms opacity transition —
    // controllers/detail.ts's in() drives the cross-fade opacity directly.
    "transition:none",
    "overflow:hidden",
    "opacity:1",
    "pointer-events:none",
    // Behind the text (matches .home__text-gpu's own z:0 vs .home__text's
    // z:1) for the home-out phase — see BRIDGE_Z_INDEX_HOME's doc comment
    // above. raiseImageBridge() bumps this once detail.ts's in() takes over.
    `z-index:${BRIDGE_Z_INDEX_HOME}`,
  ].join(";");

  // The reveal figure holds either an <img> or (for MP4 covers) a <video>.
  // Removing the figure's class above stripped the `._g`/figure sizing, so
  // re-apply the cover fit to whichever media the clone carries. A cloned
  // autoplay+muted <video> resumes playing on its own, so the bridge stays
  // live during the crossfade.
  const media = clone.querySelector<HTMLElement>("img, video");
  if (media) media.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";

  // Appended to `main#app` (NuxtPage's own parent), NOT `document.body` —
  // found necessary while fixing the "image renders over the outgoing text"
  // report. `app.vue`'s `<main id="app">` has `isolation: isolate`
  // (styles/core/base.module.scss), which creates its OWN stacking context:
  // a body-level child (the original design) competes with `#app` as a
  // WHOLE at the body level, not with anything z-indexed INSIDE it — so
  // `.home__text`'s `z-index: 1` (scoped inside #app's isolated context)
  // never actually got compared against the clone's z-index at all, and the
  // clone (later in DOM order than `#app` at the shared body-level "z:auto"
  // paint layer) won regardless of BRIDGE_Z_INDEX_HOME's value — confirmed
  // by walking the ancestor chain's computed styles with Playwright. A child
  // of `#app` instead shares that SAME isolated stacking context as `.home`
  // (and, once entered, the incoming detail page) — z-index numbers compare
  // directly and correctly there. `#app` has no `transform`/`filter`/
  // `perspective`/`contain` of its own (verified — `isolation` alone does
  // NOT do this), so the clone's `position: fixed` still resolves against
  // the viewport, not `#app`'s box; it does still outlive `.home`'s removal
  // (a sibling of `.home` under `#app`, not a descendant of it).
  document.getElementById("app")?.appendChild(clone);

  // Hide the ORIGINAL reveal figure now that its pixel-identical clone is
  // stacked over the exact same viewport rect. Both stay in the DOM until
  // the home section is removed, and for a cover with baked transparency (a
  // transparent SVG with a shadow in its pixels) two visible copies
  // composite their semi-transparent shadows into a DOUBLED / darker shadow
  // for that whole window — the "shadow gets darker for a beat" report.
  // visibility:hidden drops the paint + shadow INSTANTLY with zero visible
  // change (the clone already covers the rect); opacity:0 would instead
  // fade over the figure's 800ms opacity transition, leaving the double on
  // screen the entire fade. The figure is destroyed with the home section
  // on the normal path, so this inline style never needs restoring. It also
  // doubles as the signal controllers/home.ts's out() reads to know a
  // bridge is in flight (see that file's `bridging` check) — only
  // bridgeOut() ever sets it.
  figure.style.visibility = "hidden";

  setImageBridge(clone);
  console.debug("[transition:bridge] home → detail (bridge: holding active image)");
}
