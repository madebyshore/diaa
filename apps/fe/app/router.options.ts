import type { RouterConfig } from "@nuxt/schema";

/**
 * router.options.ts — disables Nuxt's built-in router scrollBehavior
 * entirely. `lib/scroll-restore.ts` (driven from transitions/default.ts's
 * onEnter) is the app's single owner of scroll on navigation: it resets to
 * top on forward navs, restores the per-route Lenis snapshot on back-navs,
 * and (Close-as-back, mobile/tablet) restores on the `( Close )` footer's
 * [slug]→home nav.
 *
 * Without this file, Nuxt's DEFAULT scrollBehavior ran on top of that: it
 * waits for `page:transition:finish`, then scrolls to top on forward navs
 * and to vue-router's own savedPosition on popstate. For plain forward navs
 * and browser back that duplicated scroll-restore.ts invisibly (same
 * outcome, applied twice) — but it broke the Close-as-back restore: our
 * onEnter restored the home snapshot mid-transition, then the default
 * behavior's deferred top-scroll landed AFTER the transition finished and
 * silently reset the page to 0 ("Close resets the scroll and shows the
 * first image" — reproduced headless: `[scroll-restore] restored / 2000`
 * followed by a final scrollY of 0). Returning `false` opts out of
 * vue-router scroll handling completely; no in-app navigation relies on it
 * (same-path hash anchors bypass the router — click-delegation.client.ts
 * lets the browser handle those natively).
 */
export default {
  scrollBehavior: () => false,
} satisfies RouterConfig;
