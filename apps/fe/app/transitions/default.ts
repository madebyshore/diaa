import type { TransitionProps } from "vue";

import { unlockNav } from "~/composables/useNavLock";
import { subscribeOnScroll, unsubscribeOnScroll } from "~/composables/useLenisScroll";
import { getPageController, transitionInitPath } from "~/composables/usePageController";
import { saveScroll, restoreOrResetScroll, takeNavDirection } from "~/lib/scroll-restore";
import { bridgeOut } from "~/transitions/home-to-detail";

/**
 * transitions/default.ts — the diaa EmptyTransition + PageManager/
 * TransitionManager sequencing, reproduced inside Vue <Transition> hooks
 * WITHOUT `mode` (both pages coexist in the DOM the whole time — required
 * for the home→detail bridge and matches diaa's own dual-container swap).
 *
 * Diaa's real timing is SEQUENTIAL in wall-clock (outgoing out() fully
 * resolves over ~800ms, THEN incoming holds+fades over ~1400ms) even though
 * both DOM elements coexist the entire time — "no mode" is about DOM
 * coexistence, not simultaneous animation. This file re-imposes that
 * sequential content timing inside hooks that Vue would otherwise run
 * concurrently.
 */

/** Route fullPath of the page currently leaving — set by onBeforeLeave/
 *  onLeave, read by onLeave to resolve the correct controller. Vue transition
 *  hooks receive only the DOM element, not the route, so this closure state
 *  (populated by router.beforeEach below) bridges the gap — mirrors diaa's
 *  App.route.old/new snapshots. */
let outgoingPath = "";
let incomingPath = "";
/** Route `.name` values for the outgoing/incoming route, used by the
 *  home→detail bridge dispatch check in onBeforeLeave. */
let outgoingName: string | symbol | null | undefined = null;
let incomingName: string | symbol | null | undefined = null;

let trackingInstalled = false;

/** Populate outgoing/incoming path+name from router.beforeEach, since
 *  Vue Transition hooks only ever receive the raw DOM element. Idempotent —
 *  safe to call from multiple places (createDefaultTransition() calls it
 *  once per app, guarded by trackingInstalled). */
function installRouteTracking(): void {
  if (trackingInstalled) return;
  trackingInstalled = true;
  const router = useRouter();
  router.beforeEach((to, from) => {
    outgoingPath = from.fullPath;
    incomingPath = to.fullPath;
    outgoingName = from.name;
    incomingName = to.name;
    return true;
  });
}

let leaveFinished: Promise<void> = Promise.resolve();
let resolveLeave: (() => void) | null = null;

/** Nav direction for the CURRENT navigation, captured once by onEnter
 *  (`takeNavDirection()` clears the flag on read) and consumed later by
 *  onAfterEnter's scroll restore — see that hook for why the restore itself
 *  has to happen there, not here. */
let capturedDirection: "back" | "forward" = "forward";

/**
 * createDefaultTransition() — the Vue <Transition> props object passed to
 * `<NuxtPage :transition="defaultTransition">` in app.vue.
 */
export function createDefaultTransition(): TransitionProps {
  installRouteTracking();

  return {
    css: false,
    // NO `mode` — both pages coexist in the DOM throughout (see file header).

    onBeforeLeave(el) {
      const fromEl = el as HTMLElement;
      // Save the outgoing page's scroll position before anything else moves.
      const { $lenis } = useNuxtApp();
      saveScroll(outgoingPath, $lenis);

      // Home→detail bridge dispatch point. Cheap route-name gate here (skip
      // the DOM query entirely on any navigation that isn't home→[slug]);
      // bridgeOut() itself does the precise per-item match against
      // incomingPath (see that file's header — [slug].vue serves Detail,
      // Contact, AND Imprint through the same route name, so this alone
      // can't tell them apart).
      if (outgoingName === "index" && incomingName === "slug") {
        bridgeOut(fromEl, incomingPath);
      }
    },

    onLeave(el, done) {
      leaveFinished = new Promise((res) => {
        resolveLeave = res;
      });
      const fromEl = el as HTMLElement;
      const controller = getPageController(outgoingPath);
      (async () => {
        unsubscribeOnScroll();
        await controller?.out(fromEl);
        // page.out() already faded content to 0 — the element itself needs
        // no extra hide (matches diaa: EmptyTransition never sets visibility).
        resolveLeave?.();
        done();
      })();
    },

    // Synchronous — must match BasePage.init()'s hidden-pin + EmptyTransition
    // .in()'s fixed-overlay pin, in the SAME tick, before Vue paints this
    // element. See composables/usePageController.ts's header comment for why
    // onInit is called directly here rather than via that composable's
    // onMounted.
    onBeforeEnter(el) {
      const page = el as HTMLElement;
      page.style.position = "fixed";
      page.style.top = "0";
      page.style.left = "0";
      page.style.width = "100%";
      page.style.height = "100vh";
      page.style.zIndex = "2";
      page.style.opacity = "0";

      const controller = getPageController(incomingPath);
      controller?.onInit(page);
      // Also mark .is-controlled synchronously here (FOUC rule — see
      // apps/fe/app/styles/core/base.module.scss's `#page` opacity
      // default): this is the same tick composables/usePageController.ts's
      // onMounted guard checks against.
      page.classList.add("is-controlled");
      transitionInitPath.value = incomingPath;
    },

    async onEnter(el, done) {
      const page = el as HTMLElement;
      const controller = getPageController(incomingPath);
      const { $lenis } = useNuxtApp();

      // Captured now (takeNavDirection() clears the flag on read) but not
      // ACTED on until onAfterEnter, well below — see that hook's comment
      // for why the restore itself has to happen there.
      capturedDirection = takeNavDirection();

      // Sequential timing: wait for the OLD page's out() to fully resolve
      // before starting the new page's real entrance — reproduces diaa's
      // two-stage beat even though both elements have coexisted in the DOM
      // the whole time.
      await leaveFinished;

      $lenis?.stop();
      await controller?.in(page);
      $lenis?.start();

      done();
    },

    onAfterEnter(el) {
      const page = el as HTMLElement;
      page.removeAttribute("style");

      // Scroll restore/reset goes HERE — after removeAttribute("style")
      // has already returned the page to normal document flow — not
      // earlier. Two failure modes if it ran any sooner, both found by
      // testing against a real Lenis instance rather than assumed:
      //
      // 1. Before `leaveFinished` (the original bug report): the outgoing
      //    page is still in normal flow, NOT position:fixed, and still
      //    visibly mid-fade — an instant `lenis.scrollTo(..., {immediate:
      //    true})` yanks the whole document's scroll position while it's
      //    fully on screen, reading as "jump to top, THEN fade out"
      //    instead of "fade out in place."
      // 2. After `leaveFinished` but still BEFORE this unpin (where an
      //    earlier version of this fix placed it, inside onEnter): the
      //    incoming page is still `position:fixed` here (pinned by
      //    onBeforeEnter, unpinned only by the `removeAttribute` above) —
      //    a fixed-position element contributes NO normal-flow height, so
      //    with the outgoing page already gone, the document's measured
      //    scrollable height can be near-zero at that exact moment. A
      //    restore to a saved non-zero position got silently clamped back
      //    to 0 by Lenis's own bounds — confirmed via Playwright: the
      //    console log showed the correct target being restored, but
      //    `window.scrollY` never actually reached it.
      //
      // This mirrors diaa's real ordering: `EmptyTransition.cleanup()`
      // un-pins the incoming page BEFORE `PageManager.afterIn()` ever runs
      // `initCurrentPage()`'s restore-or-reset — the page is back in normal
      // flow, with real measurable height, by the time scroll is ever
      // touched. `capturedDirection` was read once, up in onEnter (its
      // module-scope flag has to be consumed exactly once per nav,
      // regardless of when the resulting restore actually happens).
      const { $lenis } = useNuxtApp();
      // `resize()` FIRST, synchronously — Lenis caches its scrollable
      // `limit` (read from `content.scrollHeight`) and only recomputes it
      // automatically via a DEBOUNCED ResizeObserver callback, which would
      // not have fired yet at this exact tick. With the incoming page having
      // just come OFF `position:fixed` above, the document's real height
      // just changed; without forcing a synchronous recalculation first,
      // `scrollTo()`'s own internal `clamp(0, target, this.limit)` clamps
      // against the STALE (near-zero, from while this page contributed no
      // normal-flow height) limit — confirmed via Playwright: the restore's
      // own debug log showed the correct target, but the clamp silently
      // dropped it back to 0 before this fix. Exactly matches
      // `initCurrentPage()`'s own comment: "Recalculate scroller bounds
      // against the freshly-initialised page before restoring scroll... so
      // without this, scrollTo() below would clamp to a stale max."
      $lenis?.resize();
      restoreOrResetScroll($lenis, incomingPath, capturedDirection);

      // Re-apply .is-controlled after removeAttribute("style") wiped the
      // class list along with inline styles — matches diaa's
      // EmptyTransition.cleanup() re-pinning opacity 0 after
      // removeAttribute() so nothing flashes. Since in() already resolved
      // opacity to 1 (or the controller cleared its own inline value on
      // settle), CSS's `#page.is-controlled { opacity: unset }` rule keeps
      // ownership here rather than re-hiding the page.
      page.classList.add("is-controlled");

      const controller = getPageController(incomingPath);
      if (controller?.onScroll) {
        subscribeOnScroll((e) => controller.onScroll?.(e));
      }

      // Transition's true completion point — unlock nav here, NOT from
      // router.afterEach (fires too early, before this animation settles).
      unlockNav();
    },
  };
}

// NOTE: deliberately no `export const defaultTransition = createDefaultTransition();`
// module-scope singleton here. createDefaultTransition() calls
// installRouteTracking(), which calls useRouter() — a Nuxt composable that
// requires an ACTIVE app/request context. A module-scope call executes once,
// at import time, which during SSR/prerender can run before any request
// context exists (Nitro's prerender crawler imports the module graph once
// and reuses the process across every route) — crashing every single route
// with NUXT_E1001 ("nuxt instance unavailable"). Callers (app.vue) must call
// createDefaultTransition() themselves, inside their own <script setup>,
// which runs within a guaranteed-active component/request context.
