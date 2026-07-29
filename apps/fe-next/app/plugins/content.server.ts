/**
 * plugins/content.server.ts — per-request content fetch.
 *
 * Runs once per SSR request / prerendered route. Resolves the perspective,
 * fetches the site-wide singleton and the current route's content in
 * parallel, and stashes both into `useState` so every component on this
 * request/page can read them without re-fetching (composables/useSiteOptions,
 * composables/usePageData).
 *
 * `.server.ts` plugins never run in the client bundle, so this is the one
 * place `data/content.ts` (and therefore `@sanity/client`) gets imported —
 * satisfying the server-only discipline documented on every module under
 * `data/`.
 */
import { loadRouteContent, loadSiteOptions } from "~/data/content";
import type { SanityPerspective } from "~/data/client";

export default defineNuxtPlugin(async () => {
  // Perspective is hardcoded to "published" for now — Phase 6 swaps this to
  // a cookie-gated "drafts" perspective (set by /preview/enable) plus the
  // stega config, without touching any of the loaders above it.
  const perspective: SanityPerspective = "published";

  // `useRoute()` is safe to call inside a Nuxt plugin — vue-router is
  // installed before user plugins run, both in SSR and during
  // `nuxt generate`'s per-route prerender crawl.
  const route = useRoute();
  const path = route.path;

  console.debug(`[content] fetching — path="${path}", perspective="${perspective}"`);

  const [siteOptions, pageContent] = await Promise.all([
    loadSiteOptions(perspective),
    loadRouteContent(path, perspective),
  ]);

  useSiteOptions().value = siteOptions;
  usePageData().value = pageContent;

  console.debug(
    `[content] fetched — template="${pageContent?.template ?? "none (404)"}"`,
  );
});
