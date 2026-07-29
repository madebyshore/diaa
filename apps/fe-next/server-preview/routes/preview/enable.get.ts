/**
 * GET /preview/enable?sanity-preview-secret=…&preview=<path>
 *
 * The link a Studio editor's Presentation tool opens to grant this browser
 * draft access (`apps/be/sanity.config.js`'s `presentationTool({
 * previewUrl: { previewMode: { enable: '/preview/enable' } } })`). Validates
 * the secret against Sanity via `@sanity/preview-url-secret`'s
 * `validatePreviewUrl()`, and on success grants a session cookie and
 * redirects to the path Presentation asked to preview.
 *
 * Ported from the proven `preview`-branch `auth.ts`'s
 * `handleEnableRequest()` (commit `dcbf37c`), adapted to Nitro/H3 idioms:
 * `setCookie()` (via `grantSession()`) instead of a hand-rolled `Set-Cookie`
 * header string, `sendRedirect()` instead of a manually-shaped 302
 * response, and `runtimeConfig` instead of a dynamic `project.config.js`
 * import (this app resolves Sanity project/dataset through
 * `nuxt.config.ts`'s `runtimeConfig.public`, not a standalone config file).
 *
 * The ONLY route reachable without an existing session — see
 * `server-preview/middleware/noindex.ts`'s auth gate, which explicitly
 * exempts this path.
 */
import { createClient } from "@sanity/client";
import { validatePreviewUrl } from "@sanity/preview-url-secret";

import { grantSession } from "../../utils/preview-auth";

export default defineEventHandler(async (event) => {
  // No-arg form — see server-preview/utils/preview-auth.ts's file header
  // for why passing `event` here trips a spurious h3-version type mismatch
  // in this toolchain (Nuxt's generated tsconfig path-maps bare "h3" to a
  // different installed version than the ambient `event` param carries).
  // The no-arg form still resolves the correct per-request runtime config
  // via Nitro's internal async-local-storage context.
  const runtimeConfig = useRuntimeConfig();
  const { sanityProjectId, sanityDataset, sanityApiVersion } = runtimeConfig.public;
  const token = runtimeConfig.sanityReadToken;

  if (!sanityProjectId || !sanityDataset || !token) {
    console.error(
      "[preview:auth] /preview/enable misconfigured — missing Sanity project id/dataset/read token",
    );
    throw createError({
      statusCode: 500,
      statusMessage: "Preview server misconfigured: SANITY_READ_TOKEN (and project id/dataset) are required.",
    });
  }

  // Drafts-perspective client purely for `validatePreviewUrl()`'s own
  // Sanity API call — independent of `data/client.ts`'s memoized clients
  // (this runs once per enable request, not per content fetch, and
  // `validatePreviewUrl()` needs a client it fully controls).
  const client = createClient({
    projectId: sanityProjectId,
    dataset: sanityDataset,
    apiVersion: sanityApiVersion,
    token,
    useCdn: false,
    perspective: "drafts",
  });

  const requestUrl = getRequestURL(event);
  // Pathname + search only (mirrors the proven implementation) —
  // `validatePreviewUrl()` parses this against an internal placeholder
  // origin, so only the search params actually matter.
  const result = await validatePreviewUrl(client, `${requestUrl.pathname}${requestUrl.search}`);

  if (!result.isValid) {
    console.debug("[preview:auth] invalid or expired preview secret");
    throw createError({ statusCode: 401, statusMessage: "Invalid or expired preview link." });
  }

  grantSession(event);

  const redirectTo = result.redirectTo || "/";
  console.debug("[preview:auth] session granted — redirecting to", redirectTo);
  return sendRedirect(event, redirectTo, 302);
});
