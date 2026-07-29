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
      // apps/fe-next/app/styles/core/base.module.scss's `#page` opacity
      // default): this is the same tick composables/usePageController.ts's
      // onMounted guard checks against.
      page.classList.add("is-controlled");
      transitionInitPath.value = incomingPath;
    },

    async onEnter(el, done) {
      const page = el as HTMLElement;
      const controller = getPageController(incomingPath);
      const { $lenis } = useNuxtApp();

      // Scroll restore/reset BEFORE the entrance fade, matching
      // initCurrentPage()'s ordering (restore happens before
      // animateCurrentPageIn).
      const direction = takeNavDirection();
      restoreOrResetScroll($lenis, incomingPath, direction);

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
