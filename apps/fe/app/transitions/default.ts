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

      let direction = takeNavDirection();

      // Close-button scroll parity on touch tiers (client request): leaving a
      // [slug] page for home via the "( Close )" footer is a FORWARD nav (an
      // anchor click, no popstate), so it would reset home to the top — but
      // on mobile/tablet the user expects Close to behave like the browser
      // back button and return them to wherever they left the home scroll.
      // Upgrading the direction here (rather than inside scroll-restore.ts)
      // keeps the tier gate next to the only call site that knows the
      // route names. ≤1024px matches the SCSS mobile+tablet tiers exactly
      // (the 12-col desktop grid starts at 1025 — see core/root.module.scss);
      // desktop keeps the original Close-resets-to-top behaviour. A direct
      // detail load with no home snapshot is safe: restoreOrResetScroll's
      // "back" branch falls through to top when no snapshot exists.
      if (
        direction === "forward" &&
        outgoingName === "slug" &&
        incomingName === "index" &&
        window.matchMedia("(max-width: 1024px)").matches
      ) {
        direction = "back";
        console.debug("[scroll-restore] slug→home on touch tier — treating Close as back");
      }

      // Sequential timing: wait for the OLD page's out() to fully resolve
      // before starting the new page's real entrance — reproduces diaa's
      // two-stage beat even though both elements have coexisted in the DOM
      // the whole time.
      await leaveFinished;

      // UNPIN — back to normal document flow, but keep the page invisible
      // (opacity stays "0") — BEFORE the entrance (`controller.in()`) runs,
      // not after. This corrects a regression from an earlier version of
      // this fix, which unpinned in onAfterEnter (i.e. AFTER `in()`
      // resolved): the page spent its ENTIRE visible entrance fade still
      // `position:fixed` at its OLD viewport-pinned rect while the
      // document's REAL (stale, pre-reset) scroll sat underneath it, then
      // un-pinned and snapped to the correct scroll only at the very end —
      // "entrance animates from the middle of the page, then jumps to top
      // once it finishes." Diaa's real ordering (`EmptyTransition.cleanup()`
      // un-pins BEFORE `PageManager.afterIn()`'s `initCurrentPage()` →
      // `animateCurrentPageIn()`) unpins-then-scrolls-then-animates — the
      // entrance ALWAYS plays already at its final, correct scroll, never
      // mid-page. Position/sizing styles are cleared individually (not a
      // blanket `removeAttribute("style")`, which would also drop the
      // `opacity: 0` pin below and flash the page at full opacity before its
      // own fade starts) — `onAfterEnter` still does the full
      // `removeAttribute` once `in()` has resolved, for final cleanup.
      page.style.position = "";
      page.style.top = "";
      page.style.left = "";
      page.style.width = "";
      page.style.height = "";
      page.style.zIndex = "";
      page.style.opacity = "0";

      // resize() + restoreOrResetScroll() run IMMEDIATELY after the unpin
      // above, with NO `await` in between — same synchronous task, so the
      // browser never gets a chance to paint the page at the wrong scroll
      // position for even one frame. `resize()` first, synchronously: Lenis
      // caches its scrollable `limit` (read from `content.scrollHeight`) and
      // only recomputes it automatically via a DEBOUNCED ResizeObserver
      // callback that wouldn't have fired yet at this exact tick — without
      // forcing a synchronous recalculation here, `scrollTo()`'s own
      // `clamp(0, target, this.limit)` would clamp against a STALE
      // (pre-unpin) limit, exactly matching diaa's own
      // `initCurrentPage()` comment: "Recalculate scroller bounds against
      // the freshly-initialised page before restoring scroll... so without
      // this, scrollTo() below would clamp to a stale max." This is now
      // purely insurance — the page is already back in normal flow with its
      // real height by the time this runs, unlike the earlier (buggy)
      // version where it ran while still pinned fixed.
      $lenis?.resize();
      restoreOrResetScroll($lenis, incomingPath, direction);

      $lenis?.stop();
      await controller?.in(page);
      $lenis?.start();

      done();
    },

    onAfterEnter(el) {
      const page = el as HTMLElement;
      // Position/sizing styles and scroll were already handled in onEnter,
      // above, before controller.in() ran — this is now pure residual
      // cleanup: wipe whatever inline opacity in() left behind (every
      // controller resolves at inline opacity: 1, never clearing it itself)
      // so CSS regains ownership via `#page.is-controlled { opacity: unset }`
      // below, matching diaa's EmptyTransition.cleanup() handing the page
      // back to normal styling once its entrance settles.
      page.removeAttribute("style");
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
