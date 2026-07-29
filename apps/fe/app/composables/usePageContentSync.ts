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
 * Fix: a `router.beforeEach` guard that calls `GET /api/page-content`
 * (`server/api/page-content.get.ts` — the one place besides
 * `content.server.ts` allowed to import `data/content.ts`'s Sanity-calling
 * code) for `to.path` and refreshes `usePageData()` with the result BEFORE
 * the entering page component mounts — exactly what a hard reload would have
 * provided.
 *
 * Registered from `app.vue`'s `<script setup>`, deliberately called AFTER
 * `useNavLock()`: `router.beforeEach` guards run in REGISTRATION order, and
 * `useNavLock()`'s guard must synchronously claim the navigation mutex
 * (blocking a rapid double-click) before this guard's `await`ed fetch could
 * otherwise let a second navigation start unguarded in the gap.
 */
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
      const { data } = await $fetch<{ data: RouteContent | null }>("/api/page-content", {
        query: { path: to.path },
      });
      usePageData().value = data;
      console.debug(
        `[page-content-sync] refreshed for ${to.path} → template="${data?.template ?? "none (404)"}"`,
      );
    } catch (err) {
      // Let the navigation proceed regardless — [slug].vue's own guard 404s
      // on stale/null content rather than leaving the user stuck mid-nav.
      console.error("[page-content-sync] fetch failed for", to.path, err);
    }

    return true;
  });
}
