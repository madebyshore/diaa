/**
 * usePageSeo — shared SEO/meta wiring, ported from the old
 * `routes/partials/meta.html` Mustache partial. That partial was byte-for-byte
 * identical across every route except two `{{siteTitle}}` interpolations
 * (`og:title`/`og:site_name`/`twitter:title`) — this composable centralizes
 * everything meta.html carried so `index.vue`/`[slug].vue` only have to
 * supply the two values that actually vary per page: the composed document
 * `title` (bare `siteTitle` on home, `"<siteTitle> - <pageTitle>"` elsewhere
 * — that branching stays in the page component, this composable doesn't
 * compose it) and `siteTitle` itself for the og/twitter fields.
 *
 * Both params accept a getter so the tags stay reactive if `useSiteOptions()`
 * / the resolved page title ever change client-side after hydration (not
 * expected to happen mid-Phase-2, but costs nothing and matches
 * `useSeoMeta`'s own reactive-getter convention).
 *
 * Icon links point at files that do not exist in `public/` yet — ported
 * anyway per the migration plan's "known-missing icon assets" risk note;
 * generate the real files before launch.
 */
export function usePageSeo(
  title: MaybeRefOrGetter<string>,
  siteTitle: MaybeRefOrGetter<string>,
): void {
  useSeoMeta({
    title: () => toValue(title),
    description: "",
    robots: "index,follow",
    ogTitle: () => toValue(siteTitle),
    ogDescription: "",
    ogType: "website",
    ogUrl: "https://example.com",
    ogImage: "https://example.com/og.png",
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogSiteName: () => toValue(siteTitle),
    ogLocale: "en_US",
    twitterCard: "summary_large_image",
    twitterTitle: () => toValue(siteTitle),
    twitterDescription: "",
    twitterImage: "https://example.com/og.png",
    themeColor: "#ffffff",
    colorScheme: "light dark",
  });

  useHead({
    link: [
      { rel: "canonical", href: "https://example.com" },
      { rel: "shortcut icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/android-chrome-192x192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/android-chrome-512x512.png" },
    ],
  });
}
