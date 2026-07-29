import type { RouteContent } from "~/data/content";

/**
 * composables/usePageContentSync.ts — the client-side counterpart to
 * `plugins/content.server.ts`, fixing the root cause of "clicking a home
 * grid item does nothing."
 *
 * `plugins/content.server.ts` populates `usePageData()` exactly once, for
 * the single SSR request that produced the currently-hydrated page — Nuxt
 * never re-runs a `.server.ts` plugin on the client. Nothing else in this
 * app ever re-fetches content for a route reached via a pure SPA navigation
 * (`plugins/click-delegation.client.ts`'s `router.push`), so
 * `usePageData()` stayed pinned to whatever the FIRST server-rendered route
 * resolved: navigating "/" → a Detail slug left `usePageData().value`
 * holding `{template: "home", ...}`, and `[slug].vue`'s own setup-time guard
 * (`initialContent.template === "home"` → 404) threw immediately — the page
 * never actually swapped even though `router.push` succeeded and the URL
 * changed. Navigating a Detail/Contact/Imprint page back to "/" had the
 * mirror-image bug: `index.vue`'s `home` computed saw stale non-"home"
 * content and rendered an empty grid.
 *
 * Fix: a `router.beforeEach` guard that fetches
 * `GET /_content/<slug>/index.json`
 * (`server/routes/_content/[slug]/index.json.get.ts` — the one place
 * besides `content.server.ts` allowed to import `data/content.ts`'s
 * Sanity-calling code) for `to.path` and refreshes `usePageData()` with the
 * result BEFORE the entering page component mounts — exactly what a hard
 * reload would have provided.
 *
 * PATH SEGMENT, NOT QUERY STRING — this app's prod deploy is a fully STATIC
 * `nuxt generate` build with no live Nitro server at all
 * (`apps/fe/vercel.json`'s `framework: null`). An earlier version of this
 * fix used a `?path=` query-string API route, which 404s on static hosting:
 * static file serving can vary by PATH but never by query string, so
 * `nuxt.config.ts`'s `prerender:routes` hook can bake one static JSON file
 * per route (`/_content/dog-project/index.json`) but has no way to bake a
 * response that varies per query value. The `[slug]/index.json` (not
 * `[slug].json`) file shape is itself a second fix — see that server
 * route's own file header for why a literal suffix glued onto the dynamic
 * segment silently broke `getRouterParam()` during an actual prerender
 * crawl. `toContentSlug()` below computes the exact same path-segment
 * encoding the server route expects — keep the two in sync if either
 * changes.
 *
 * Registered from `app.vue`'s `<script setup>`, deliberately called AFTER
 * `useNavLock()`: `router.beforeEach` guards run in REGISTRATION order, and
 * `useNavLock()`'s guard must synchronously claim the navigation mutex
 * (blocking a rapid double-click) before this guard's `await`ed fetch could
 * otherwise let a second navigation start unguarded in the gap.
 */

/** Path-segment sentinel for the home route ("/") — a bare `/` can't be a
 *  directory name inside `_content/`. Matches `data/slices/helpers.ts`'s
 *  `resolveCta()`, which already uses the same sentinel string for the home
 *  route elsewhere in this app, and
 *  `server/routes/_content/[slug]/index.json.get.ts`'s own copy of this
 *  constant (duplicated rather than shared — one lives in client code, the
 *  other in a server route file with no common importable module between
 *  them that isn't itself server-only). */
const HOME_SLUG_SENTINEL = "__home__";

/** Encodes a route path (`to.path`, e.g. "/", "/dog-project") into the
 *  `[slug]` route param
 *  `server/routes/_content/[slug]/index.json.get.ts` expects. */
function toContentSlug(path: string): string {
  if (path === "/") return HOME_SLUG_SENTINEL;
  return path.replace(/^\/+/, "");
}

let registered = false;

export function usePageContentSync(): void {
  if (registered) return;
  registered = true;

  const router = useRouter();

  router.beforeEach(async (to, from) => {
    // Skip the very first navigation (hard load / SSR hydration) — its
    // content already came from plugins/content.server.ts's per-request
    // fetch. Vue Router's own signal for "this is the initial navigation":
    // the FROM route has no matched records yet.
    if (from.matched.length === 0) return true;

    try {
      const slug = toContentSlug(to.path);
      const { data } = await $fetch<{ data: RouteContent | null }>(`/_content/${slug}/index.json`);
      usePageData().value = data;
      console.debug(
        `[page-content-sync] refreshed for ${to.path} → template="${data?.template ?? "none (404)"}"`,
      );
    } catch (err) {
      // Bug found in the Sanity Studio Presentation tab (preview mode):
      // letting the SPA navigation proceed regardless (the original
      // behaviour here) is WRONG when this fetch fails — `usePageData()`
      // never gets updated, so the entering page mounts against STALE
      // content from the route being LEFT, `[slug].vue`'s own guard sees
      // the template mismatch, and the user lands on a real 404 — "routing
      // to detail pages doesn't work", not a silent no-op.
      //
      // Root cause of the failure itself, in preview mode specifically:
      // this fetch is a same-origin XHR issued from WITHIN whatever
      // document is currently loaded — when that document is the
      // Presentation iframe, third-party-cookie policies (Safari ITP,
      // Firefox ETP, Chrome's phased rollout) can drop `__preview_session`
      // from a SUBRESOURCE request like this one even with `SameSite=None;
      // Secure` already set (see `server-preview/utils/preview-auth.ts`'s
      // `grantSession()`, now also `Partitioned`/CHIPS-tagged as the
      // complementary fix) — but a full DOCUMENT navigation of that same
      // iframe is not subject to the same restriction, since browsers treat
      // top-level-for-that-frame navigations differently from subresource
      // fetches for cookie-sending purposes. That's the mechanism this
      // fallback leans on: it doesn't matter whether THIS specific fetch
      // could see the cookie, only that a real navigation reliably will.
      //
      // Falling back to a genuine full-page navigation — through
      // `content.server.ts`'s SSR path, which resolves the correct
      // perspective per-request exactly like a hard reload always has —
      // recovers correctly regardless of why the fetch failed (a
      // third-party-cookie-blocked XHR in preview mode, or an ordinary
      // network blip in any mode). `return false` cancels the in-flight SPA
      // transition so Vue Router never ALSO tries to render the doomed
      // in-app state while the real navigation is landing.
      console.error("[page-content-sync] fetch failed for", to.path, err);
      console.warn(`[page-content-sync] falling back to a full page navigation for ${to.fullPath}`);
      window.location.assign(to.fullPath);
      return false;
    }

    return true;
  });
}
