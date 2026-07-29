/**
 * resolveSiteUrl — shared base-URL resolution for the hand-rolled
 * `sitemap.xml` and `robots.txt` Nitro routes.
 *
 * Ported verbatim from the old Vite plugin's sitemap generator
 * (`apps/fe/scripts/routes-plugin.ts`, `emitRoutesAndBoot()`'s "Generate
 * sitemap.xml for SEO crawlers" block): `SITE_URL` wins over Vercel's
 * auto-populated `VERCEL_URL` (which never includes a protocol); a value
 * already prefixed with "http" passes through untouched (trailing slash
 * trimmed); anything else gets "https://" prepended. Returns "" when
 * neither env var is set, so callers can fall back to bare paths instead of
 * emitting a broken absolute URL.
 *
 * Lives in `server/utils/` so Nitro auto-imports it into every server route
 * without an explicit import statement — the same file-based auto-import
 * convention Nuxt uses for `app/composables/`/`app/utils/`.
 */
export function resolveSiteUrl(): string {
  const baseEnv = process.env.SITE_URL || process.env.VERCEL_URL || "";
  if (!baseEnv) return "";
  return baseEnv.startsWith("http")
    ? baseEnv.replace(/\/$/, "")
    : `https://${baseEnv.replace(/\/$/, "")}`;
}
