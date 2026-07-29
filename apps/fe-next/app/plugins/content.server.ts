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
 *
 * `data/content.ts`'s functions take an explicit `SanityClientConfig` rather
 * than calling `useRuntimeConfig()` themselves (see `data/client.ts`'s file
 * header) — this plugin is the one place with a live Nuxt app context, so it
 * builds that config here and threads it through both loader calls.
 *
 * Phase 6 perspective seam: this file is a NORMAL, always-present plugin —
 * it ships in every build, prod included — so the drafts/preview branch
 * below is written to be a complete no-op cost-wise for a prod
 * (`previewEnabled` false) build: the `if (previewEnabled)` guard short-
 * circuits before touching the request event, the cookie, or
 * `data/preview-auth-core.ts`'s verify logic at all. That module IS still
 * part of the prod bundle (it's a normal `app/data/*` file, not gated by
 * `nitro.scanDirs`), but it contains no `@sanity/visual-editing` or
 * `@sanity/preview-url-secret` imports — see that file's own header — so
 * its presence doesn't violate the "zero preview-library bytes in prod"
 * guarantee, only the (much larger) preview-specific packages need
 * structural exclusion.
 *
 * NO h3 `getCookie()` call here at all — deliberate, and caught by hand
 * testing (a genuine runtime bug, not just the sibling type-check quirk
 * documented in `server-preview/utils/preview-auth.ts`'s header). Two
 * things were tried and both broke:
 *   - `import { getCookie } from "h3"` — Nuxt's build path-maps the bare
 *     `"h3"` specifier to a DIFFERENT h3 package instance than the one that
 *     actually constructs the request `event` in this pipeline. Calling
 *     THAT `getCookie(event, ...)` against an event built by the OTHER h3
 *     instance throws (`event.req.headers.get is not a function` — the two
 *     versions disagree on whether request headers are a Node-style object
 *     or a Fetch-style `Headers` interface).
 *   - The ambient auto-imported `getCookie` global (no import statement —
 *     works fine from `server-preview/`'s Nitro-route files) — throws
 *     `getCookie is not defined` from HERE specifically: `.server.ts` Nuxt
 *     plugins compile through the Nuxt/Vue SSR bundle, a different build
 *     pipeline than Nitro's own server-routes bundle, and that pipeline
 *     doesn't inject Nitro's h3-utils auto-import preset even though the
 *     ambient TYPE declarations (shared across the whole TS program) made
 *     it type-check fine.
 * `data/preview-auth-core.ts`'s `extractCookieValue()` sidesteps both: it
 * reads `event.node.req.headers.cookie` (h3's stable, version-independent
 * Node-compat event shape — see that function's own header) as a plain
 * string and parses it by hand, no h3 helper function call of any kind.
 */
import { loadRouteContent, loadSiteOptions } from "~/data/content";
import type { SanityClientConfig, SanityPerspective } from "~/data/client";
import {
  extractCookieValue,
  PREVIEW_SESSION_COOKIE,
  resolvePreviewSessionSecret,
  verifyPreviewSessionCookie,
} from "~/data/preview-auth-core";
import { buildPreviewStega, requireStudioUrl } from "~/data/stega";

export default defineNuxtPlugin(async () => {
  const runtimeConfig = useRuntimeConfig();
  const { previewEnabled } = runtimeConfig.public;

  // Resolve whether THIS request is an authenticated preview session.
  // `server-preview/middleware/noindex.ts` already 401s any unauthenticated
  // request in a previewEnabled build before Nuxt's renderer (and therefore
  // this plugin) ever runs — so in practice `sessionValid` is always true
  // here whenever this plugin executes in a preview build. This check stays
  // defense-in-depth rather than assuming that invariant holds: if the
  // middleware gate is ever bypassed, disabled, or misconfigured, this still
  // falls back to serving PUBLISHED content instead of silently leaking
  // drafts to an unauthenticated visitor.
  let sessionValid = false;
  if (previewEnabled) {
    const event = useRequestEvent();
    const cookieHeader = event?.node?.req?.headers?.cookie;
    const cookieValue = extractCookieValue(cookieHeader, PREVIEW_SESSION_COOKIE);
    const secret = resolvePreviewSessionSecret(
      runtimeConfig.previewSessionSecret,
      runtimeConfig.sanityReadToken,
    );
    sessionValid = verifyPreviewSessionCookie(cookieValue, secret);
  }

  const perspective: SanityPerspective = sessionValid ? "drafts" : "published";

  const config: SanityClientConfig = {
    projectId: runtimeConfig.public.sanityProjectId,
    dataset: runtimeConfig.public.sanityDataset,
    apiVersion: runtimeConfig.public.sanityApiVersion,
    sanityReadToken: runtimeConfig.sanityReadToken,
  };

  // Stega only ever applies to an authenticated drafts request — never to
  // "published" (data/client.ts hardcodes `stega: false` there regardless
  // of what's passed) and never when a preview build is serving an
  // unauthenticated visitor published content as its safe fallback.
  const stega = sessionValid
    ? buildPreviewStega(requireStudioUrl(runtimeConfig.sanityStudioUrl))
    : undefined;

  // `useRoute()` is safe to call inside a Nuxt plugin — vue-router is
  // installed before user plugins run, both in SSR and during
  // `nuxt generate`'s per-route prerender crawl.
  const route = useRoute();
  const path = route.path;

  console.debug(`[content] fetching — path="${path}", perspective="${perspective}"`);

  const [siteOptions, pageContent] = await Promise.all([
    loadSiteOptions(perspective, config, stega),
    loadRouteContent(path, perspective, config, stega),
  ]);

  useSiteOptions().value = siteOptions;
  usePageData().value = pageContent;

  console.debug(
    `[content] fetched — template="${pageContent?.template ?? "none (404)"}"`,
  );
});
