import type { SiteOptionsContent } from "~/data/content";

/**
 * useSiteOptions — the site-wide singleton (title, intro phrases, footer
 * links, seo), hydrated once per request by `plugins/content.server.ts`.
 *
 * Type-only import above (`import type`) — erased at compile time, so this
 * composable pulls nothing from `data/content.ts` (and therefore no
 * `@sanity/client`) into the client bundle. The actual value is populated
 * server-side and reaches the client via Nuxt's payload, same as any other
 * `useState`.
 */
export const useSiteOptions = () =>
  useState<SiteOptionsContent | null>("content:site-options", () => null);
