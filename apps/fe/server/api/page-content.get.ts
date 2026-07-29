/**
 * GET /api/page-content?path=/some-slug — the client-side counterpart to
 * `plugins/content.server.ts`.
 *
 * That plugin is a `.server.ts` Nuxt plugin: it runs exactly once, for the
 * single SSR request that produced whichever page was hard-loaded, and
 * populates `usePageData()`/`useSiteOptions()` for that one route. It has no
 * way to run again for a route reached via a pure client-side (SPA)
 * navigation — Nuxt never re-invokes `.server.ts` plugins on the client. Left
 * unaddressed, `usePageData()` stays pinned to whatever the FIRST
 * server-rendered route resolved: navigating home → a Detail slug leaves
 * `usePageData().value` holding `{template: "home", ...}`, and `[slug].vue`'s
 * own setup-time guard (`initialContent.template === "home"` → 404) throws
 * immediately, so the incoming page never actually renders even though the
 * URL changes — this is the root cause of "clicking a home grid item does
 * nothing."
 *
 * `composables/usePageContentSync.ts` calls this endpoint from a
 * `router.beforeEach` guard before every SPA navigation and refreshes
 * `usePageData()` with the result, so the entering route always sees fresh
 * content for its OWN path — exactly what a hard reload would have provided.
 *
 * This is a real Nitro route (not a `.server.ts` Nuxt plugin), so — per
 * `plugins/content.server.ts`'s file header — the ambient `getCookie` global
 * works fine here without the header-parsing workaround that plugin needs.
 * Relative imports (not the `~` alias) mirror
 * `server-preview/routes/preview/refresh.post.ts`'s existing convention for
 * reaching `app/data/*` from a server route.
 */
import { loadRouteContent } from "../../app/data/content";
import type { SanityClientConfig, SanityPerspective } from "../../app/data/client";
import {
  PREVIEW_SESSION_COOKIE,
  resolvePreviewSessionSecret,
  verifyPreviewSessionCookie,
} from "../../app/data/preview-auth-core";
import { buildPreviewStega, requireStudioUrl } from "../../app/data/stega";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const path = typeof query.path === "string" ? query.path : undefined;
  if (!path) {
    throw createError({ statusCode: 400, statusMessage: "Missing required `path` query param." });
  }

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
  // the same shared verify logic both callers use.
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
  console.debug(`[api:page-content] path="${path}" → template="${data?.template ?? "none (404)"}"`);
  return { data };
});
