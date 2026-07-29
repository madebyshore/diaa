/**
 * plugins-preview/visual-editing.client.ts — the Sanity Presentation overlay
 * runtime. Enables click-to-edit overlays over stega-encoded content and
 * bridges Presentation's iframe navigation/refresh events to this app's own
 * Vue Router + reactive content state.
 *
 * Lives OUTSIDE `app/plugins/` — which Nuxt auto-scans and registers
 * UNCONDITIONALLY — specifically so it can be excluded from the prod module
 * graph BY CONSTRUCTION. `nuxt.config.ts` only references this file (via
 * its `plugins: previewEnabled ? [...] : []` array) when
 * `NUXT_PUBLIC_PREVIEW_ENABLED=true`; a file living inside `app/plugins/`
 * would be auto-registered by the directory scan regardless of that array
 * (the array is additive to the scan, not a toggle for it), so true
 * structural exclusion — verified by the Phase 6 report's `grep
 * .output/public/_nuxt/*.js` check — requires this file not be auto-scanned
 * in the first place. Mirrors `server-preview/`'s own `nitro.scanDirs`-gated
 * exclusion for the identical reason on the server side.
 */
import type { HistoryAdapterNavigate, HistoryUpdate } from "@sanity/visual-editing";

import { getPageController } from "~/composables/usePageController";
import type { RouteContent } from "~/data/content";

export default defineNuxtPlugin(() => {
  console.debug("[preview] visual-editing plugin loading");

  const router = useRouter();

  // History adapter — bridges Presentation's iframe navigation to this
  // app's own SPA router, and mirrors this app's OWN navigation back out to
  // Presentation so its URL bar / breadcrumb stay in sync.
  const history = {
    // Fires `navigate()` once per COMPLETED in-app route change
    // (`router.afterEach` — after the route resolves, not before a
    // transition even starts) so Presentation only ever hears about
    // navigations that actually landed.
    subscribe(navigate: HistoryAdapterNavigate): () => void {
      return router.afterEach((to) => {
        navigate({ type: "push", url: to.fullPath });
      });
    },
    // Reverse direction: Presentation asking this app to navigate (e.g. the
    // editor clicked a different location in the Studio's location picker).
    // Routed through `router.push()`/`.replace()`/`.back()` — NOT direct
    // History API / DOM manipulation — so the exact same
    // beforeEach-installed nav-lock guard, 8s safety valve, and transition
    // choreography (composables/useNavLock.ts, transitions/default.ts) that
    // gate every other navigation in this app also gate a
    // Presentation-driven one. Bypassing those would desync `App.mutating`-
    // equivalent state from the URL and could interrupt an in-flight
    // transition.
    update(update: HistoryUpdate): void {
      console.debug(`[preview] history update — type="${update.type}", url="${update.url}"`);
      if (update.type === "replace") {
        void router.replace(update.url);
      } else if (update.type === "pop") {
        router.back();
      } else {
        void router.push(update.url);
      }
    },
  };

  /**
   * Refresh handler — POSTs the CURRENT route's path to
   * `/preview/refresh` (server-preview/routes/preview/refresh.post.ts),
   * which re-fetches that one route through the drafts+stega perspective,
   * then rehydrates the page. See the inline comments below for exactly
   * what "rehydrates" means and why it's more than a bare
   * `usePageData().value = fresh`.
   */
  async function refresh(): Promise<void> {
    const path = router.currentRoute.value.fullPath;
    console.debug(`[preview] refresh requested — path="${path}"`);

    const fresh = await $fetch<RouteContent | null>("/preview/refresh", {
      method: "POST",
      body: { path },
    });

    // Vue reactivity does the heavy lifting for the DATA side: every page
    // template reads `usePageData()` reactively (see `pages/index.vue`'s
    // `computed(() => pageData.value...)` fields, and `pages/[slug].vue`'s
    // Phase 6 `content` computed — the latter had to be converted FROM a
    // plain destructured local specifically so this refresh flow could
    // reach it; see that file's header comment), so this single write is
    // what makes new copy/images/slices show up at all.
    usePageData().value = fresh;

    // Vue's reactive patch from the write above is scheduled synchronously
    // but lands in the DOM on the next tick — wait for it before touching
    // the DOM below, or the controller rehydration runs against stale
    // nodes.
    await nextTick();

    // REHYDRATION (the "minimal correct refresh" this design has to solve):
    // this is NOT a full page transition — no in()/out() animation runs, no
    // nav-lock engages, the route itself hasn't changed. Vue's reactive
    // re-render patches `#page`'s CHILDREN in place; it has no knowledge of,
    // and cannot re-run, whatever imperative DOM work each PageController's
    // onInit() did against the PREVIOUS render — GSAP-driven inline styles,
    // hover/click listeners bound to specific nodes, mode-toggle state,
    // ResizeObserver hookups (see controllers/home.ts, controllers/
    // detail.ts). Some of those nodes may have been patched in place by Vue
    // (same node, new text/attrs) and some may have been replaced outright
    // (e.g. a `v-for` key change from an edited slug), so the only broadly
    // correct move — without special-casing every controller's internals —
    // is a full re-init: tear down whatever the previous onInit() wired up
    // (onDestroy()) and re-run onInit() against the now-patched DOM, exactly
    // as if this were a fresh mount.
    //
    // Because this genuinely ISN'T a transition, none of the normal entrance
    // affordances apply: `BaseController.onInit()` (and every controller
    // that extends or mirrors it — controllers/page-controller.ts) pins the
    // root's opacity to 0 on the assumption a subsequent `in()` animation
    // will fade it back up. There is no `in()` call here, so that pin is
    // force-corrected to opacity 1 immediately afterward — a "no-anim
    // reveal" — rather than left hidden (the page would go blank mid-edit)
    // or replayed through the full entrance timeline (jarring/wrong for a
    // live-editing session; the user isn't navigating, they just saved a
    // field).
    const root = document.getElementById("page");
    const controller = getPageController(path);
    if (root && controller) {
      controller.onDestroy();
      controller.onInit(root);
      root.style.opacity = "1";
      root.classList.add("is-controlled");
      console.debug(`[preview] rehydrated controller for path="${path}"`);
    } else {
      console.warn(
        `[preview] refresh: could not rehydrate — root=${Boolean(root)}, controller=${Boolean(controller)} (path="${path}")`,
      );
    }
  }

  // Dynamic import — `@sanity/visual-editing`'s own dependency graph
  // (React, comlink, ...) is only evaluated once this plugin actually runs
  // client-side, not the moment this file's containing chunk is parsed —
  // keeps the preview build's initial client bundle lean and defers the
  // (non-trivial) overlay-runtime cost until it's actually needed.
  import("@sanity/visual-editing")
    .then(({ enableVisualEditing }) => {
      enableVisualEditing({
        history,
        refresh: (payload) => {
          // HistoryRefresh's `source` is "manual" (Presentation's refresh
          // button) or the deprecated "mutation" shape — both mean the same
          // thing here: re-fetch this route's content. `refresh()` above
          // does the actual work; its return type (`Promise<void>`)
          // matches what `enableVisualEditing`'s `refresh` option expects.
          console.debug(`[preview] refresh event — source="${payload.source}"`);
          return refresh();
        },
      });
      console.debug("[preview] visual-editing enabled");
    })
    .catch((error: unknown) => {
      console.error("[preview] failed to load @sanity/visual-editing", error);
    });
});
