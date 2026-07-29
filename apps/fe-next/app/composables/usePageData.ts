import type { RouteContent } from "~/data/content";

/**
 * usePageData — the current route's resolved content, hydrated once per
 * request by `plugins/content.server.ts`. `null` means the route didn't
 * resolve to any known template (home/detail/contact/imprint) — Phase 2's
 * `[slug].vue` treats that as a 404.
 *
 * Type-only import above — see `useSiteOptions.ts` for why this keeps
 * `data/content.ts` (and `@sanity/client`) out of the client bundle.
 */
export const usePageData = () =>
  useState<RouteContent | null>("content:page-data", () => null);
