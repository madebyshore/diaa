import { loadAllRoutePaths } from "../../app/data/content";
import type { SanityClientConfig } from "../../app/data/client";
import {
  SANITY_DEFAULT_API_VERSION,
  SANITY_DEFAULT_DATASET,
  SANITY_DEFAULT_PROJECT_ID,
} from "../../app/data/sanity-defaults";

/**
 * GET /sitemap.xml — ported 1:1 from the old Vite plugin's sitemap
 * generator (`apps/fe/scripts/routes-plugin.ts`, `emitRoutesAndBoot()`'s
 * "Generate sitemap.xml for SEO crawlers" block): same `<urlset>` shape,
 * same sorted-path ordering, same `SITE_URL`/`VERCEL_URL` base-URL
 * resolution (now `resolveSiteUrl()`, a server util auto-imported by
 * Nitro — see `server/utils/site-url.ts`).
 *
 * Registered in `nuxt.config.ts`'s `prerender:routes` hook
 * (`ctx.routes.add("/sitemap.xml")`), so `nuxt generate` bakes this into a
 * static `.output/public/sitemap.xml` file at build time; this handler only
 * actually executes live under the SSR preview deploy.
 *
 * The route list comes from the SAME `loadAllRoutePaths()` that the page
 * router and the `prerender:routes` hook use for path discovery — the
 * sitemap can never list a URL the site doesn't serve, or omit one it does,
 * without the underlying route-resolution logic itself drifting.
 */
export default defineEventHandler(async (event) => {
  // Mirrors the `SanityClientConfig` construction in `nuxt.config.ts`'s
  // `prerender:routes` hook — this file has no live Nuxt app instance to
  // pull `useRuntimeConfig()` from during `nuxt generate` either, so it
  // reads `process.env` directly with the same shared defaults.
  const config: SanityClientConfig = {
    projectId: process.env.SANITY_PROJECT_ID || SANITY_DEFAULT_PROJECT_ID,
    dataset: process.env.SANITY_DATASET || SANITY_DEFAULT_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || SANITY_DEFAULT_API_VERSION,
    sanityReadToken: process.env.SANITY_READ_TOKEN,
  };

  // Prod/`nuxt generate` always crawls the "published" perspective — same
  // reasoning as the `prerender:routes` hook: preview's SSR build never
  // runs `generate`, so there is no drafts branch to thread through here.
  const paths = await loadAllRoutePaths("published", config);

  const baseUrl = resolveSiteUrl();

  const urlEntries = [...paths]
    .sort()
    .map((p) => {
      const loc = baseUrl ? `${baseUrl}${p === "/" ? "" : p}` : p === "/" ? "/" : p;
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  setResponseHeader(event, "Content-Type", "application/xml; charset=utf-8");
  return xml;
});
