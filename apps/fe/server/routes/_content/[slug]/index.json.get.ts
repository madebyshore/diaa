/**
 * GET /_content/<slug>/index.json — the client-side counterpart to
 * `plugins/content.server.ts`, and the STATIC-HOSTING-COMPATIBLE replacement
 * for an earlier `GET /api/page-content?path=` version of this endpoint.
 *
 * `plugins/content.server.ts` is a `.server.ts` Nuxt plugin: it runs exactly
 * once, for the single SSR request that produced whichever page was
 * hard-loaded, and populates `usePageData()`/`useSiteOptions()` for that one
 * route. It has no way to run again for a route reached via a pure
 * client-side (SPA) navigation — Nuxt never re-invokes `.server.ts` plugins
 * on the client. Left unaddressed, `usePageData()` stays pinned to whatever
 * the FIRST server-rendered route resolved: navigating home → a Detail slug
 * leaves `usePageData().value` holding `{template: "home", ...}`, and
 * `[slug].vue`'s own setup-time guard (`initialContent.template === "home"`
 * → 404) throws immediately, so the incoming page never actually renders
 * even though the URL changes — this is the root cause of "clicking a home
 * grid item does nothing."
 *
 * WHY A PATH SEGMENT, NOT A QUERY STRING: this app's production deploy is a
 * fully STATIC `nuxt generate` build (`apps/fe/vercel.json`'s
 * `framework: null` + `outputDirectory: ".output/public"` — no Nitro runtime
 * at all in prod). Static hosting can serve a distinct file per PATH but
 * cannot vary a response by query string — a `?path=` API route 404s once
 * there's no live server to read the query from. Baking the route param
 * INTO the path (`/_content/dog-project/index.json`) makes each route's
 * content a genuine, independently cacheable static file, exactly like
 * `/sitemap.xml` and `/robots.txt` already are in this codebase
 * (`server/routes/*.get.ts`, explicitly registered for prerendering in
 * `nuxt.config.ts`'s `prerender:routes` hook).
 *
 * WHY `[slug]/index.json`, NOT `[slug].json` — an earlier version of this
 * route was a single file `[slug].json.get.ts`, deriving a
 * `/_content/:slug.json` pattern (confirmed via
 * `.nuxt/types/nitro-routes.d.ts`). That pattern matched the route (Nitro
 * dispatched to this handler) but `getRouterParam(event, "slug")` came back
 * `undefined` for every request during an actual `nuxt generate` prerender
 * crawl — Nitro's router does not reliably support a literal suffix glued
 * onto a dynamic segment in the same path chunk. Splitting the dynamic part
 * into its OWN full path segment (`[slug]`, a directory) with a fully
 * static literal filename after it (`index.json`, the exact same pattern
 * `robots.txt.get.ts`/`sitemap.xml.get.ts` already use, just one level
 * deeper) sidesteps the ambiguity entirely and was verified working against
 * a real `nuxt generate` prerender crawl before landing.
 *
 * `[slug]` is the route's own path with the leading slash stripped, or the
 * `"__home__"` sentinel for `/` (the same sentinel `data/slices/helpers.ts`'s
 * `resolveCta()` already uses for the home route elsewhere in this app) —
 * `/` itself can't be represented as a directory name inside `_content/`.
 * `composables/usePageContentSync.ts` computes this same encoding when
 * building the fetch URL.
 *
 * Three ways this route is reached, all correct without any code branching
 * here:
 *   - `nuxt generate` (prod): `nuxt.config.ts`'s `prerender:routes` hook
 *     explicitly registers `/_content/<slug>/index.json` for every content
 *     path (mirroring how it already registers the content PAGES
 *     themselves), baking each into a static JSON file at build time,
 *     "published" perspective only — a static site can never verify a live
 *     session cookie, so this matches how the content pages themselves are
 *     prerendered.
 *   - SSR dev / a hypothetical live SSR deploy: resolves dynamically, per
 *     request, exactly like `content.server.ts` does for a hard load.
 *   - Preview SSR (`NUXT_PUBLIC_PREVIEW_ENABLED=true`): never prerendered
 *     (see the `!previewEnabled` guard in `nuxt.config.ts`'s hook — same
 *     reasoning as why content pages aren't prerendered there either), so
 *     it always resolves dynamically per request, checking the preview
 *     session cookie below exactly like `content.server.ts` does.
 *
 * This is a real Nitro route (not a `.server.ts` Nuxt plugin), so — per
 * `plugins/content.server.ts`'s file header — the ambient `getCookie` global
 * works fine here without the header-parsing workaround that plugin needs.
 * Relative imports (not the `~` alias) mirror
 * `server-preview/routes/preview/refresh.post.ts`'s existing convention for
 * reaching `app/data/*` from a server route — one directory level deeper
 * here (`../../../../app/data/*`) than that file, matching this route's own
 * extra `[slug]/` nesting.
 */
import { loadRouteContent } from "../../../../app/data/content";
import type { SanityClientConfig, SanityPerspective } from "../../../../app/data/client";
import {
  PREVIEW_SESSION_COOKIE,
  resolvePreviewSessionSecret,
  verifyPreviewSessionCookie,
} from "../../../../app/data/preview-auth-core";
import { buildPreviewStega, requireStudioUrl } from "../../../../app/data/stega";

/** Sentinel path segment for the home route — see this file's header. Kept
 *  in sync with `composables/usePageContentSync.ts`'s own encoding. */
const HOME_SLUG_SENTINEL = "__home__";

export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, "slug");
  if (!slugParam) {
    throw createError({ statusCode: 400, statusMessage: "Missing required `slug` route param." });
  }

  const path = slugParam === HOME_SLUG_SENTINEL ? "/" : `/${slugParam}`;

  // No-arg form — see server-preview/routes/preview/refresh.post.ts's own
  // comment for why passing `event` here trips a spurious h3-version type
  // mismatch in this toolchain.
  const runtimeConfig = useRuntimeConfig();
  const { previewEnabled } = runtimeConfig.public;

  // Mirrors plugins/content.server.ts's session/perspective resolution
  // exactly (see that file's header for the full auth model). Duplicated
  // rather than shared because it runs in a genuinely different execution
  // context (a real Nitro route here vs. an SSR Nuxt plugin there) — that
  // file documents why raw cookie-header parsing is needed THERE but not
  // here (a real Nitro route can use the ambient `getCookie` helper
  // directly). `verifyPreviewSessionCookie()` (data/preview-auth-core.ts) is
  // the same shared verify logic both callers use. During a `nuxt generate`
  // prerender crawl this branch never runs at all — `previewEnabled` is a
  // build-time-fixed env var, always false for the static prod build (see
  // this file's header) — so `sessionValid` stays false and every
  // prerendered `_content/*/index.json` file is "published" only, exactly
  // like the content pages themselves.
  let sessionValid = false;
  if (previewEnabled) {
    const cookieValue = getCookie(event, PREVIEW_SESSION_COOKIE);
    const secret = resolvePreviewSessionSecret(
      runtimeConfig.previewSessionSecret,
      runtimeConfig.sanityReadToken,
    );
    sessionValid = verifyPreviewSessionCookie(cookieValue ?? null, secret);
  }

  const perspective: SanityPerspective = sessionValid ? "drafts" : "published";

  const config: SanityClientConfig = {
    projectId: runtimeConfig.public.sanityProjectId,
    dataset: runtimeConfig.public.sanityDataset,
    apiVersion: runtimeConfig.public.sanityApiVersion,
    sanityReadToken: runtimeConfig.sanityReadToken,
  };

  const stega = sessionValid
    ? buildPreviewStega(requireStudioUrl(runtimeConfig.sanityStudioUrl))
    : undefined;

  const data = await loadRouteContent(path, perspective, config, stega);
  console.debug(`[content-route] path="${path}" → template="${data?.template ?? "none (404)"}"`);
  return { data };
});
