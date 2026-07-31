/**
 * data/content.ts — the single published/drafts seam.
 *
 * SERVER-ONLY (imports `client.ts`, which carries `@sanity/client` and, on
 * the drafts path, a read token). Never import this from client-side code —
 * reach it only from `.server.ts` plugins, server routes, or (Phase 2)
 * `nuxt.config.ts`'s `prerender:routes` build hook.
 *
 * Ported from `apps/fe/scripts/sanity-content.ts`'s `loadSanityContent()`,
 * split into two request-scoped loaders instead of one build-time
 * do-everything function:
 *   - `loadSiteOptions(perspective, config)` — the site-wide singleton
 *     (title, intro phrases, footer links). Fetched once per request/build,
 *     independent of which route is being rendered.
 *   - `loadRouteContent(path, perspective, config)` — resolves ONE route's
 *     data. The old pipeline built every page's data in one pass at build
 *     time; this port fetches per-route on demand (SSR request, or one
 *     `prerender:routes` invocation per path in Phase 2) since Nuxt's model
 *     is request/route-scoped rather than "build the whole site's data into
 *     one manifest object."
 *
 * Every function below takes `config: SanityClientConfig` explicitly rather
 * than reaching for `useRuntimeConfig()` itself. This file has two callers
 * with two different sources for that config (`content.server.ts`'s live
 * Nuxt app context vs. `nuxt.config.ts`'s build-process `process.env`) — see
 * `client.ts`'s file header for the full rationale, including why this also
 * keeps the module typecheckable from `nuxt.config.ts`.
 *
 * Route resolution mirrors the old routing precedence: "/" is always home;
 * anything else is tried as a Detail slug, then a Contact slug, then an
 * Imprint slug (both fall back to "contact"/"imprint" when unauthored), in
 * that order, and null if nothing matches (the caller — Phase 2's
 * `[slug].vue` — 404s).
 */

import type { StegaConfig } from "@sanity/client";

import { getSanityClient, type SanityClientConfig, type SanityPerspective } from "./client";
import { sanityPicture, type MediaData } from "./image-url";
import {
  allTaxonomiesQuery,
  detailBySlugQuery,
  pageContactQuery,
  pageHomeQuery,
  pageImprintQuery,
  siteOptionsQuery,
} from "./queries";
import { resolveSlices } from "./slices/registry";
import type { SliceContext } from "./slices/types";
import type { PortableTextBlock } from "./types";

/**
 * Fallback intro phrase used when the CMS Global doc provides none (empty
 * field, or a Sanity-less request). Mirrors the default documented and
 * pre-filled via `initialValue` on the Studio's Intro Text field, so the
 * intro always has a phrase to show. Keep these two in sync.
 */
const DEFAULT_INTRO_PHRASE = "Design, interiors, architecture, atmosphere";

// ── Raw Sanity payload shapes (loose — mirrors the old sanity-content.ts) ──

/** Raw per-document `seo` object, projected by `queries.ts`'s shared
 *  `seoProjection` (metaDescription/metaKeywords verbatim, ogImage already
 *  resolved to its CDN URL). */
interface RawSeo {
  metaDescription?: string | null;
  metaKeywords?: string[] | null;
  ogImage?: string | null;
}

interface DetailRef {
  _id: string;
  title?: string;
  /** Rich-text title (bold/italic decorators only) — same field the home
   *  grid and detail heading both render. Plain `title` is the fallback and
   *  stays the browser-tab/document title source. */
  stylizedTitle?: PortableTextBlock[] | null;
  /** Routing switch — undefined (legacy docs) and true both route; only an
   *  explicit false suppresses the page + link. */
  allowRouting?: boolean | null;
  slug?: string | null;
  coverImage?: string | null;
  /** Base64 blur placeholder (`coverImage.asset->metadata.lqip`) — rendered
   *  behind the cover while the full image loads (see FigureBase). */
  coverLqip?: string | null;
  coverVideo?: string | null;
  coverSize?: string | null;
  taxonomy?: { _id: string; title?: string } | null;
  /** Per-page SEO overrides — only present on `detailBySlugQuery`. */
  seo?: RawSeo | null;
  /** Authored slices — only present on `detailBySlugQuery`. */
  slices?: import("./slices/types").RawSlice[] | null;
}

interface TaxonomyDoc {
  _id: string;
  title?: string;
}

interface PageHomeDoc {
  _id: string;
  title?: string;
  seo?: RawSeo | null;
  taxonomies?: TaxonomyDoc[] | null;
  grid?: DetailRef[] | null;
}

interface FooterLinkRaw {
  title?: string | null;
  href?: string | null;
  blank?: boolean | null;
}

interface SiteOptionsDoc {
  _id: string;
  name?: string;
  introText?: string[] | null;
  language?: string;
  /** Meta-tab favicon/OG defaults, projected to raw CDN URLs. */
  favicon?: string | null;
  faviconDark?: string | null;
  ogImage?: string | null;
  seo?: RawSeo | null;
  footerLinks?: FooterLinkRaw[] | null;
}

/** pageContact / pageImprint singleton payload — title + slug + a rich-text
 *  body (Portable Text blocks with link markDefs resolved to route hrefs by
 *  `richBodyProjection` in `queries.ts`). Both singletons share this exact
 *  shape, so one interface and one resolution path serve both pages. */
interface RichTextPageDoc {
  _id: string;
  title?: string;
  slug?: string | null;
  seo?: RawSeo | null;
  body?: PortableTextBlock[] | null;
}

// ── Public shapes ───────────────────────────────────────────────────────

/**
 * Resolved per-document SEO data — normalized from the shared `seo` object
 * every schema type carries. Consumed by `composables/usePageSeo.ts`, which
 * layers a page's own values over the Global document's defaults.
 */
export interface SeoData {
  metaDescription: string;
  metaKeywords: string[];
  /** Raw CDN URL of the OG image, or null when unset. */
  ogImage: string | null;
}

/** Normalize a raw `seo` object (possibly absent) into a fully-populated
 *  `SeoData` so consumers never null-check individual fields. */
function resolveSeo(raw: RawSeo | null | undefined): SeoData {
  return {
    metaDescription: raw?.metaDescription?.trim() ?? "",
    metaKeywords: (raw?.metaKeywords ?? []).filter(
      (k): k is string => typeof k === "string" && k.trim().length > 0,
    ),
    ogImage: raw?.ogImage ?? null,
  };
}

export interface FooterLink {
  title: string;
  href: string;
  blank: boolean;
}

/** Site-wide singleton data — independent of which route is being rendered. */
export interface SiteOptionsContent {
  siteTitle: string;
  /** Intro overlay phrases; the runtime intro picks one at random per load.
   *  Falls back to `[DEFAULT_INTRO_PHRASE]` when the CMS has none. */
  introPhrases: string[];
  footerLinks: FooterLink[];
  /** ISO 639-1 language code from the Global SEO tab ("en" fallback) —
   *  feeds `<html lang>`. */
  language: string;
  /** Global Meta-tab light-mode favicon (raw CDN URL), or null when unset.
   *  Also the default icon when no dark-mode variant exists, and always the
   *  Apple touch icon (iOS ignores `media` on icon links). */
  favicon: string | null;
  /** Global Meta-tab dark-mode favicon (raw CDN URL), or null when unset —
   *  emitted with a `(prefers-color-scheme: dark)` media query in
   *  `usePageSeo`. */
  faviconDark: string | null;
  /** Global Meta-tab default OG image (raw CDN URL), or null when unset.
   *  Per-page `seo.ogImage` values override it in `usePageSeo`. */
  ogImage: string | null;
  /** Global SEO defaults — the fallback layer under each page's own seo. */
  seo: SeoData;
}

/** One flattened home-grid placement. */
export interface HomeGridItem {
  /** Position in authored order — links a text-mode label, its image cell,
   *  and (Phase 5) its hover-reveal figure by position. */
  flatIndex: number;
  slug: string;
  /** When false, Phase 2 renders a non-routing element instead of a link. */
  routable: boolean;
  /** Plain title — fallback source when `stylizedTitle` has no content, and
   *  the alt-text source for the cover image. */
  title: string;
  /** Raw stylized-title Portable Text blocks — Phase 3 renders with
   *  `<RichText>` when non-empty, falling back to escaped `title`
   *  otherwise (mirrors the old `renderPortableText(x) || escapeHtml(title)`). */
  stylizedTitle: PortableTextBlock[] | null;
  cover: MediaData;
  coverSize: string;
  /** Taxonomy id, or "" if unassigned — the nav filter's `data-taxonomy`. */
  taxonomyId: string;
}

/** `path` (all three variants below) — the route this content was resolved
 *  for, stamped on by `loadRouteContent()` in a single choke point (never
 *  set by the individual `loadHomeContent()`/`loadDetailContent()`/etc.
 *  sub-loaders, so it's optional at the type level and only ever guaranteed
 *  present on a `loadRouteContent()` result). Exists so a page component can
 *  tell "is this `usePageData()` write actually for MY route" before
 *  treating it as authoritative — see `pages/index.vue`'s `home` computed
 *  and `pages/[slug].vue`'s `content` computed for why that check matters:
 *  `usePageData()` is ONE shared `useState`, but `composables/
 *  usePageContentSync.ts` writes the INCOMING route's content to it BEFORE
 *  the OUTGOING page unmounts (it has to — the entering component's own
 *  `<script setup>` needs fresh data the moment it mounts, and Vue's
 *  mode-less `<Transition>` keeps both pages alive throughout the swap —
 *  see `transitions/default.ts`'s file header). Without this tag, the
 *  still-visible outgoing page's OWN reactive computed would see the
 *  write too and re-render against the WRONG route's data mid-fade. */
export interface HomeRouteContent {
  template: "home";
  path?: string;
  /** The Home singleton's own SEO overrides (Global fills the gaps). */
  seo: SeoData;
  gridItems: HomeGridItem[];
  taxonomies: Array<{ id: string; title: string }>;
  footerLinks: FooterLink[];
}

export interface DetailRouteContent {
  template: "detail";
  path?: string;
  /** Plain title — document-title source (composed with siteTitle at the
   *  SEO-meta layer, Phase 2) and the cover's alt-text source. */
  title: string;
  stylizedTitle: PortableTextBlock[] | null;
  cover: MediaData & { coverSize: string };
  /** This Detail's own SEO overrides (Global fills the gaps). */
  seo: SeoData;
  /** Resolved slices, in authored order — see `resolveSlices()` in
   *  `data/slices/registry.ts`. Each entry is `{ _type, _key, data }`, where
   *  `data` is that slice's own `resolve()` output; Phase 3's
   *  `<SliceRenderer>` dispatches on `_type`. */
  slices: ReturnType<typeof resolveSlices>;
}

export interface RichTextRouteContent {
  template: "contact" | "imprint";
  path?: string;
  title: string;
  /** The singleton's own SEO overrides (Global fills the gaps). */
  seo: SeoData;
  body: PortableTextBlock[] | null;
}

/** Discriminated union returned by `loadRouteContent()` — branch on
 *  `.template`. `null` means no route matched (caller 404s). */
export type RouteContent =
  | HomeRouteContent
  | DetailRouteContent
  | RichTextRouteContent;

/**
 * Build the cover-media fields for a Detail. When the Detail has a
 * `coverVideo` (MP4) it renders as a looping autoplay `<video>` everywhere
 * the cover appears, with `coverImage` (if any) served as the poster via
 * `src`. When only an image exists this collapses to plain picture
 * behaviour. Callers must have already checked the Detail carries at least
 * one of coverImage/coverVideo. Ported verbatim from the old
 * `coverMedia()` in `sanity-content.ts`.
 */
function coverMedia(d: DetailRef, alt: string, index: number): MediaData {
  const pic = d.coverImage
    ? sanityPicture(d.coverImage, alt, index, 3000, d.coverLqip)
    : { src: "", alt, width: 3000, height: 4000, isFirst: index === 0, lqip: "" };
  return {
    ...pic,
    hasVideo: !!d.coverVideo,
    video: d.coverVideo ?? "",
  };
}

/**
 * Normalize a stored coverSize to the current option set: `3x4` (single
 * size), `4x3-sm`, `4x3-lg`. The Studio dropdown once offered 3:4 in
 * Small/Large too — those legacy values fold into the unified `3x4` here so
 * published documents keep rendering (the CSS variant classes only exist for
 * the normalized tokens). Unknown/missing values fall back to `4x3-sm`,
 * matching the loaders' historical default.
 */
function normalizeCoverSize(raw: string | null | undefined): string {
  if (raw === "3x4" || raw === "3x4-sm" || raw === "3x4-lg") return "3x4";
  if (raw === "4x3-lg") return "4x3-lg";
  return "4x3-sm";
}

/** A Detail counts as a grid slot / routable page when it has either a cover
 *  image OR a cover video (MP4) — video-only Details are valid, the image is
 *  just the optional poster/fallback. Ported verbatim from the old
 *  `if (!d.coverImage && !d.coverVideo) continue` gate. */
function hasCover(d: { coverImage?: string | null; coverVideo?: string | null }): boolean {
  return !!(d.coverImage || d.coverVideo);
}

/** Undefined (legacy docs where the field was hidden) and `true` both route;
 *  only an explicit `false` suppresses the page + link. */
function isRoutable(allowRouting: boolean | null | undefined): boolean {
  return allowRouting !== false;
}

/**
 * Load the site-wide singleton (title, intro phrases, footer links, seo).
 * Independent of route — fetch once per request/build and share across
 * every page (nav, footer, `<title>` composition, the intro overlay).
 *
 * `stega` (Phase 6) is only meaningful for the "drafts" perspective — pass
 * `buildPreviewStega(requireStudioUrl(...))` (data/stega.ts) from an
 * authenticated preview request; omit it (or pass "published") everywhere
 * else. See `data/client.ts`'s `getSanityClient()` for why this is a no-op
 * on the "published" branch regardless of what's passed here.
 */
export async function loadSiteOptions(
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<SiteOptionsContent> {
  const client = getSanityClient(perspective, config, stega);
  const siteOptions = await client.fetch<SiteOptionsDoc | null>(siteOptionsQuery);

  const introPhrases = (siteOptions?.introText ?? [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());

  const footerLinks: FooterLink[] = (siteOptions?.footerLinks ?? [])
    .filter((l): l is FooterLinkRaw => !!l?.href)
    .map((l) => ({
      title: l.title ?? "",
      href: l.href ?? "",
      blank: l.blank === true,
    }));

  console.debug(
    `[data] siteOptions loaded — title="${siteOptions?.name ?? ""}", introPhrases=${introPhrases.length}, footerLinks=${footerLinks.length}`,
  );

  return {
    siteTitle: siteOptions?.name ?? "",
    introPhrases: introPhrases.length ? introPhrases : [DEFAULT_INTRO_PHRASE],
    footerLinks,
    language: siteOptions?.language?.trim() || "en",
    favicon: siteOptions?.favicon ?? null,
    faviconDark: siteOptions?.faviconDark ?? null,
    ogImage: siteOptions?.ogImage ?? null,
    seo: resolveSeo(siteOptions?.seo),
  };
}

/** Build the home route's content: the flattened grid + taxonomy list +
 *  footer links (the old pipeline duplicated footerLinks onto the home
 *  page's own data alongside the site-wide singleton — kept for parity).
 *  `stega` — see `loadSiteOptions()`'s doc comment. */
async function loadHomeContent(
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<HomeRouteContent> {
  const client = getSanityClient(perspective, config, stega);
  const [pageHome, siteOptions] = await Promise.all([
    client.fetch<PageHomeDoc | null>(pageHomeQuery),
    client.fetch<SiteOptionsDoc | null>(siteOptionsQuery),
  ]);

  const taxonomies = (pageHome?.taxonomies ?? [])
    .filter((t): t is TaxonomyDoc => !!t?._id)
    .map((t) => ({ id: t._id, title: t.title ?? "" }));

  const footerLinks: FooterLink[] = (siteOptions?.footerLinks ?? [])
    .filter((l): l is FooterLinkRaw => !!l?.href)
    .map((l) => ({
      title: l.title ?? "",
      href: l.href ?? "",
      blank: l.blank === true,
    }));

  const gridItems: HomeGridItem[] = [];
  if (pageHome?.grid?.length) {
    let flatIndex = 0;
    const seenDetailIds = new Set<string>();
    for (const d of pageHome.grid) {
      if (!hasCover(d)) continue;
      if (seenDetailIds.has(d._id)) continue;
      seenDetailIds.add(d._id);

      gridItems.push({
        flatIndex,
        slug: d.slug ?? "",
        routable: isRoutable(d.allowRouting),
        title: d.title ?? "",
        stylizedTitle: d.stylizedTitle ?? null,
        cover: coverMedia(d, d.title ?? "", flatIndex),
        coverSize: normalizeCoverSize(d.coverSize),
        taxonomyId: d.taxonomy?._id ?? "",
      });
      flatIndex++;
    }
  }

  console.debug(
    `[content] home resolved — gridItems=${gridItems.length}, taxonomies=${taxonomies.length}`,
  );

  return { template: "home", seo: resolveSeo(pageHome?.seo), gridItems, taxonomies, footerLinks };
}

/** Slice-resolver context for detail pages. Matches the old pipeline's
 *  hardcoded `{ globals: null, clients: null, locations: [] }` — none of
 *  the six registered slices read globals/clients today. If a future slice
 *  needs global locations, fetch the (currently dormant) globals singleton
 *  here and pass `resolveLocations(globals)` through instead. */
const DETAIL_SLICE_CONTEXT: SliceContext = { globals: null, clients: null, locations: [] };

/** Try to resolve `path` as a `/:slug` Detail route. Returns null if no
 *  routable Detail matches. `stega` — see `loadSiteOptions()`'s doc comment. */
async function loadDetailContent(
  slug: string,
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<DetailRouteContent | null> {
  const client = getSanityClient(perspective, config, stega);
  const detail = await client.fetch<DetailRef | null>(detailBySlugQuery, { slug });
  if (!detail || !hasCover(detail) || !isRoutable(detail.allowRouting)) return null;

  console.debug(
    `[content] detail resolved — slug="${slug}", slices=${detail.slices?.length ?? 0}`,
  );

  return {
    template: "detail",
    title: detail.title ?? "",
    stylizedTitle: detail.stylizedTitle ?? null,
    // Detail cover is sized to match the home text-mode reveal image (same
    // 3000w source, same coverSize-driven aspect) — index 0 so it gets
    // fetchpriority="high" as the page's LCP.
    cover: { ...coverMedia(detail, detail.title ?? "", 0), coverSize: normalizeCoverSize(detail.coverSize) },
    seo: resolveSeo(detail.seo),
    slices: resolveSlices(detail.slices, DETAIL_SLICE_CONTEXT),
  };
}

/** Try to resolve `path` as the Contact singleton (slug falls back to
 *  "contact" when unauthored). Returns null if the slug doesn't match.
 *  `stega` — see `loadSiteOptions()`'s doc comment. */
async function loadContactContent(
  slug: string,
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<RichTextRouteContent | null> {
  const client = getSanityClient(perspective, config, stega);
  const pageContact = await client.fetch<RichTextPageDoc | null>(pageContactQuery);
  if ((pageContact?.slug ?? "contact") !== slug) return null;
  return {
    template: "contact",
    title: pageContact?.title ?? "Contact",
    seo: resolveSeo(pageContact?.seo),
    body: pageContact?.body ?? null,
  };
}

/** Try to resolve `path` as the Imprint singleton (slug falls back to
 *  "imprint" when unauthored). Returns null if the slug doesn't match.
 *  `stega` — see `loadSiteOptions()`'s doc comment. */
async function loadImprintContent(
  slug: string,
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<RichTextRouteContent | null> {
  const client = getSanityClient(perspective, config, stega);
  const pageImprint = await client.fetch<RichTextPageDoc | null>(pageImprintQuery);
  if ((pageImprint?.slug ?? "imprint") !== slug) return null;
  return {
    template: "imprint",
    title: pageImprint?.title ?? "Imprint",
    seo: resolveSeo(pageImprint?.seo),
    body: pageImprint?.body ?? null,
  };
}

/**
 * Resolve one route's content. `path` is the full pathname (e.g. "/",
 * "/some-project", "/contact"). Tries, in order: home ("/" only) → Detail by
 * slug → Contact → Imprint. Returns null when nothing matches — the caller
 * (`[slug].vue`) is responsible for 404ing.
 *
 * Stamps the resolved content with `path: path` — the single choke point for
 * this (see the `RouteContent` variants' own `path` doc comment for why it
 * exists) — rather than threading it through every sub-loader below, which
 * stay ignorant of routing entirely.
 *
 * `stega` (Phase 6) — see `loadSiteOptions()`'s doc comment; threaded
 * through to whichever sub-loader ends up resolving `path`.
 */
export async function loadRouteContent(
  path: string,
  perspective: SanityPerspective,
  config: SanityClientConfig,
  stega?: StegaConfig,
): Promise<RouteContent | null> {
  if (path === "/") {
    const home = await loadHomeContent(perspective, config, stega);
    return { ...home, path };
  }

  const slug = path.replace(/^\/+/, "");
  if (!slug) return null;

  const detail = await loadDetailContent(slug, perspective, config, stega);
  if (detail) return { ...detail, path };

  const contact = await loadContactContent(slug, perspective, config, stega);
  if (contact) return { ...contact, path };

  const imprint = await loadImprintContent(slug, perspective, config, stega);
  if (imprint) return { ...imprint, path };

  console.debug(`[content] no route matched — path="${path}"`);
  return null;
}

/**
 * Enumerate every prerenderable path: home + every routable Detail slug +
 * the Contact/Imprint slugs. Consumed by Phase 2's `prerender:routes` Nitro
 * hook so `nuxt generate` emits one HTML file per CMS-authored route,
 * without needing a sitemap crawl to discover them.
 *
 * Detail paths are derived from `loadHomeContent()`'s already-deduped
 * `gridItems` — deliberately NOT a separate `*[_type == "detail"]` listing
 * query. Routing surface = grid placement, not "any Detail document with a
 * slug" (see the `detailBySlugQuery` comment in `queries.ts`); reusing
 * `loadHomeContent()`'s output is what guarantees this function can never
 * drift out of sync with what `loadRouteContent()` actually resolves.
 *
 * Called from `nuxt.config.ts`'s `prerender:routes` build hook, which has no
 * live Nuxt app instance — `config` is built there from `process.env`
 * instead of `useRuntimeConfig()`.
 */
export async function loadAllRoutePaths(
  perspective: SanityPerspective,
  config: SanityClientConfig,
): Promise<string[]> {
  const client = getSanityClient(perspective, config);
  const [home, pageContact, pageImprint] = await Promise.all([
    loadHomeContent(perspective, config),
    client.fetch<RichTextPageDoc | null>(pageContactQuery),
    client.fetch<RichTextPageDoc | null>(pageImprintQuery),
  ]);

  const detailPaths = home.gridItems
    .filter((g) => g.routable && g.slug)
    .map((g) => `/${g.slug}`);

  const paths = [
    "/",
    ...detailPaths,
    `/${pageContact?.slug ?? "contact"}`,
    `/${pageImprint?.slug ?? "imprint"}`,
  ];

  console.debug(`[content] loadAllRoutePaths — ${paths.length} paths`);
  return paths;
}

// Re-exported for callers that want the raw taxonomy list without pulling in
// the whole home route (none today — kept for parity with the old
// `allTaxonomiesQuery` export being independently usable).
export { allTaxonomiesQuery };
