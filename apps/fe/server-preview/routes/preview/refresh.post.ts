/**
 * POST /preview/refresh — re-fetches ONE route's content through the
 * drafts+stega perspective and returns it as `RouteContent` JSON. Called by
 * `app/plugins-preview/visual-editing.client.ts`'s `refresh()` handler
 * (wired to `@sanity/visual-editing`'s `refresh` option) after a Studio
 * draft save, with the currently-viewed route's path.
 *
 * Gated by the same strict auth check as every other route except
 * `/preview/enable` (`server-preview/middleware/noindex.ts`) — this handler
 * itself never needs to check `isAuthorized()`; the middleware already did
 * and would have thrown a 401 before this ran. (A local re-check would just
 * be dead code duplicating the middleware's own gate.)
 */
import { loadRouteContent } from "../../../app/data/content";
import type { SanityClientConfig } from "../../../app/data/client";
import { buildPreviewStega, requireStudioUrl } from "../../../app/data/stega";

interface RefreshBody {
  path?: string;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RefreshBody>(event).catch(() => undefined);
  const query = getQuery(event);
  const path = body?.path || (typeof query.path === "string" ? query.path : undefined);

  if (!path) {
    throw createError({ statusCode: 400, statusMessage: "Missing required `path`." });
  }

  // No-arg form — see server-preview/utils/preview-auth.ts's file header
  // for why passing `event` here trips a spurious h3-version type mismatch
  // in this toolchain.
  const runtimeConfig = useRuntimeConfig();
  const config: SanityClientConfig = {
    projectId: runtimeConfig.public.sanityProjectId,
    dataset: runtimeConfig.public.sanityDataset,
    apiVersion: runtimeConfig.public.sanityApiVersion,
    sanityReadToken: runtimeConfig.sanityReadToken,
  };

  const stega = buildPreviewStega(requireStudioUrl(runtimeConfig.sanityStudioUrl));
  const content = await loadRouteContent(path, "drafts", config, stega);

  console.debug(
    `[preview:refresh] path="${path}", template="${content?.template ?? "none (404)"}"`,
  );

  return content;
});
