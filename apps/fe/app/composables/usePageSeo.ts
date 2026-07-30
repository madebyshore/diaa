import type { SeoData } from "~/data/content";

/**
 * usePageSeo — shared SEO/meta wiring, originally ported from the old
 * `routes/partials/meta.html` Mustache partial and since grown into the
 * real thing: the placeholder `https://example.com` canonical/OG values and
 * the eight nonexistent `public/` icon links the partial carried are gone,
 * replaced by CMS-driven values layered over Global defaults.
 *
 * Inputs:
 *   `title`     — the composed document title (bare `siteTitle` on home,
 *                 `"<siteTitle> - <pageTitle>"` elsewhere — that branching
 *                 stays in the page component).
 *   `siteTitle` — the Global site title, used for `og:site_name`.
 *   `pageSeo`   — the current route content's resolved `SeoData`
 *                 (`usePageData().value.seo`), layered over the Global
 *                 document's own SEO defaults: a page's
 *                 metaDescription/keywords/ogImage win when set, the Global
 *                 SEO tab's values fill the gaps, and the Global META tab's
 *                 `ogImage` sits between the two for images (page override →
 *                 Meta-tab default → Global-SEO-tab image).
 *
 * Everything else comes from shared state:
 *   - `useSiteOptions()` (hydrated by plugins/content.server.ts) supplies
 *     the Global favicon / default OG image / language / SEO fallbacks.
 *     Type-only `~/data/content` import — erased at compile time, so no
 *     `@sanity/client` enters the client bundle (absolute rule #1).
 *   - `runtimeConfig.public.siteUrl` (nuxt.config.ts) supplies the absolute
 *     site origin — the SAME `resolveSiteUrl()` resolution the
 *     sitemap.xml/robots.txt routes use (SITE_URL →
 *     VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL), so the canonical always
 *     points at the production domain on Vercel. When unset (local dev with
 *     no env), the canonical/og:url tags are omitted rather than emitted
 *     broken.
 *   - `useRoute().path` supplies the per-page canonical path. Home's
 *     canonical is the bare origin (no trailing slash), matching the
 *     sitemap's own `${baseUrl}${p === "/" ? "" : p}` composition exactly.
 *
 * All params accept getters and every tag value is a getter, so the tags
 * stay reactive if the underlying state changes client-side after hydration
 * (matches `useSeoMeta`'s own reactive-getter convention).
 */
export function usePageSeo(
  title: MaybeRefOrGetter<string>,
  siteTitle: MaybeRefOrGetter<string>,
  pageSeo?: MaybeRefOrGetter<SeoData | null | undefined>,
): void {
  const siteOptions = useSiteOptions();
  const route = useRoute();
  const siteUrl = useRuntimeConfig().public.siteUrl as string;

  // Per-page value wins, Global SEO tab fills the gaps.
  const description = (): string =>
    toValue(pageSeo)?.metaDescription || siteOptions.value?.seo.metaDescription || "";
  const keywords = (): string => {
    const page = toValue(pageSeo)?.metaKeywords ?? [];
    const global = siteOptions.value?.seo.metaKeywords ?? [];
    return (page.length ? page : global).join(", ");
  };
  // Image precedence: page override → Global Meta-tab default → Global SEO
  // tab's own ogImage. Sanity CDN URLs are already absolute, as og:image
  // requires.
  const ogImage = (): string =>
    toValue(pageSeo)?.ogImage ||
    siteOptions.value?.ogImage ||
    siteOptions.value?.seo.ogImage ||
    "";

  // Canonical = origin + path, home collapsing to the bare origin — the
  // exact composition sitemap.xml uses, so the two can never disagree.
  const canonical = (): string =>
    siteUrl ? (route.path === "/" ? siteUrl : `${siteUrl}${route.path}`) : "";

  // `|| undefined` on the optional values — unhead omits a tag whose value
  // resolves to undefined, where "" would render an empty content="".
  useSeoMeta({
    title: () => toValue(title),
    description: () => description() || undefined,
    robots: "index,follow",
    ogTitle: () => toValue(title),
    ogDescription: () => description() || undefined,
    ogType: "website",
    ogUrl: () => canonical() || undefined,
    ogImage: () => ogImage() || undefined,
    ogSiteName: () => toValue(siteTitle),
    ogLocale: "en_US",
    twitterCard: "summary_large_image",
    twitterTitle: () => toValue(title),
    twitterDescription: () => description() || undefined,
    twitterImage: () => ogImage() || undefined,
    themeColor: "#ffffff",
    colorScheme: "light dark",
  });

  useHead({
    // Global SEO tab's language code drives <html lang> ("en" fallback,
    // resolved server-side in loadSiteOptions).
    htmlAttrs: {
      lang: () => siteOptions.value?.language || "en",
    },
    // `keywords` isn't part of useSeoMeta's typed input — emitted as a plain
    // meta tag instead, and only when a value actually exists.
    meta: () => {
      const k = keywords();
      return k ? [{ name: "keywords", content: k }] : [];
    },
    // CMS favicon (Global → Meta tab): one icon link + the Apple touch icon
    // from the same asset — replaces the old partial's eight links to
    // `public/` files that never existed (each one a guaranteed 404).
    // `/favicon.ico` stays as the no-CMS-value fallback purely because
    // browsers request it unprompted anyway. Returned as a literal so
    // unhead's contextual link typing applies (an intermediate
    // `Record<string, string>[]` annotation fails to typecheck).
    link: () => {
      const href = canonical();
      const favicon = siteOptions.value?.favicon;
      return [
        ...(href ? [{ rel: "canonical" as const, href }] : []),
        ...(favicon
          ? [
              { rel: "icon" as const, href: favicon, type: faviconMime(favicon) },
              { rel: "apple-touch-icon" as const, href: favicon },
            ]
          : [{ rel: "icon" as const, href: "/favicon.ico", sizes: "any" }]),
      ];
    },
  });
}

/** MIME type for the favicon link, derived from the CDN URL's extension —
 *  Sanity serves the original format, so the extension is authoritative. */
function faviconMime(url: string): string {
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "ico") return "image/x-icon";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}
