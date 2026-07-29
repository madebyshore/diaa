/**
 * GET /robots.txt — hand-rolled Nitro route; the old Vite SPA never shipped
 * one (no server-side routing layer existed to hang it off of).
 *
 * Two modes, selected by the same `NUXT_PUBLIC_PREVIEW_ENABLED` flag that
 * gates the visual-editing plugin/`server-preview` scanDirs in
 * `nuxt.config.ts`:
 *   - prod/`nuxt generate` (`previewEnabled` false) — allow every crawler
 *     and point at the sitemap.
 *   - SSR preview (Phase 6) — `Disallow: /` for every user agent, so
 *     draft-content pages never get indexed even if a crawler somehow
 *     reaches the preview deployment directly. This is the CRAWL-time
 *     layer; Phase 6's preview server middleware additionally stamps
 *     `X-Robots-Tag: noindex` on every response as an independent
 *     INDEX-time layer — a crawler that ignores robots.txt entirely still
 *     gets told not to index what it fetches.
 *
 * Registered in `nuxt.config.ts`'s `prerender:routes` hook
 * (`ctx.routes.add("/robots.txt")`) so `nuxt generate` bakes this into a
 * static `.output/public/robots.txt` file — prod builds only ever produce
 * the allow-all body, since `previewEnabled` is false for every `generate`
 * run by construction (see nuxt.config.ts's `previewEnabled` const).
 */
export default defineEventHandler((event) => {
  const { previewEnabled } = useRuntimeConfig().public;

  if (previewEnabled) {
    setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return "User-agent: *\nDisallow: /\n";
  }

  const baseUrl = resolveSiteUrl();
  const sitemapLine = baseUrl ? `\nSitemap: ${baseUrl}/sitemap.xml\n` : "";

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return `User-agent: *\nAllow: /\n${sitemapLine}`;
});
