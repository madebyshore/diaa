/**
 * resolveSiteUrl — shared base-URL resolution for the hand-rolled
 * `sitemap.xml` and `robots.txt` Nitro routes, and (via `nuxt.config.ts`'s
 * `runtimeConfig.public.siteUrl`) for every page's canonical/og:url tags
 * (`composables/usePageSeo.ts`).
 *
 * Resolution order: `SITE_URL` (explicit override — set this to the real
 * custom domain if one exists) → `VERCEL_PROJECT_PRODUCTION_URL` (Vercel's
 * auto-populated PRODUCTION domain, protocol-less — this is what makes
 * canonicals point at the production URL instead of the per-deployment
 * `*-git-branch-*.vercel.app` alias) → `VERCEL_URL` (the per-deployment
 * URL, last resort). A value already prefixed with "http" passes through
 * untouched (trailing slash trimmed); anything else gets "https://"
 * prepended. Returns "" when nothing is set, so callers can fall back to
 * bare paths / omit the tag instead of emitting a broken absolute URL.
 *
 * Lives in `server/utils/` so Nitro auto-imports it into every server route
 * without an explicit import statement; `nuxt.config.ts` imports it
 * explicitly (it's a pure function with no Nitro dependency).
 */
export function resolveSiteUrl(): string {
  const baseEnv =
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";
  if (!baseEnv) return "";
  return baseEnv.startsWith("http")
    ? baseEnv.replace(/\/$/, "")
    : `https://${baseEnv.replace(/\/$/, "")}`;
}
