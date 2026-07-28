/**
 * sanity-content.ts — build-time content loader.
 *
 * Fetches the new schema layout (pageHome + Details + Taxonomies) and
 * console.logs the resolved data so the rest of the wiring can be designed
 * with the shape visible in the build output. No HTML is rendered from
 * the CMS payload yet — pages still ship with empty `data: {}`.
 */

import {
  pageHomeQuery,
  siteOptionsQuery,
  allDetailsQuery,
  allTaxonomiesQuery,
  pageContactQuery,
  pageImprintQuery,
} from "./utils/queries";
import { renderSlices } from "./slices/render";
import type { RawSlice, SliceContext } from "./slices/types";
import { escapeHtml, renderPortableText } from "./utils/portable-text";
import type { PortableTextBlock } from "./utils/portable-text";
// Type-only import — @sanity/client is loaded dynamically at runtime (see the
// try/import below) so it stays optional for Sanity-less builds, but its
// published types are still available at compile time and erased on emit.
import type { StegaConfig } from "@sanity/client";

/**
 * Fallback intro phrase used when the CMS Global doc provides none (empty field,
 * or a Sanity-less build). Mirrors the default documented and pre-filled via
 * `initialValue` on the Studio's Intro Text field, so the intro always has a
 * phrase to show. Keep these two in sync.
 */
const DEFAULT_INTRO_PHRASE = "Design, interiors, architecture, atmosphere";

interface SanityClient {
  fetch: <T>(query: string) => Promise<T>;
  config: () => { projectId?: string; dataset?: string };
}

interface SanityClientFactory {
  (config: {
    projectId: string;
    dataset: string;
    apiVersion: string;
    useCdn: boolean;
    token?: string;
    perspective?: "published" | "drafts";
    stega?: StegaConfig;
  }): SanityClient;
}

interface SanityConfig {
  dataset?: string;
  projectId?: string;
  token?: string;
  apiVersion?: string;
}

/** Picture data passed to Mustache templates. */
interface PictureData {
  src: string;
  alt: string;
  width: number;
  height: number;
  isFirst: boolean;
}

/**
 * Cover-media data: a PictureData plus optional video fields. When `hasVideo`
 * is true the `{{> picture}}` partial (and the home text-gpu figure) render a
 * looping autoplay `<video src={video}>` with `src` (the coverImage) as its
 * poster; otherwise they render the `<img>` as before. Shared by the home
 * grid, the hover reveal, and the detail-page cover so all three stay in sync.
 */
interface CoverMedia extends PictureData {
  hasVideo: boolean;
  video: string;
}

/** A single page emitted by the build — rendered to HTML by routes-plugin. */
interface PageEntry {
  path: string;
  key: string;
  title: string;
  template: string;
  data: Record<string, unknown>;
}

interface SanityContentResult {
  pages: PageEntry[];
  /** Top-level site title from the Sanity Global doc. Used in <title> and OG/Twitter meta. */
  siteTitle: string;
  /**
   * Intro overlay phrases from the Sanity Global doc. Threaded into the shell
   * by routes-plugin so the intro can pick one at random at runtime. Falls back
   * to [DEFAULT_INTRO_PHRASE] when the CMS has none, so it is never empty.
   */
  introPhrases: string[];
}

interface SanityContentOptions {
  dataset?: string;
  projectId?: string;
  token?: string;
  apiVersion?: string;
  /**
   * Sanity API perspective — which document version the client resolves.
   * "published" (the default, existing behavior) reads only published
   * documents; "drafts" reads draft edits and is used by the preview
   * server so client-editor changes show up before publishing.
   */
  perspective?: "published" | "drafts";
  /**
   * Sanity stega config, forwarded verbatim to the client. When enabled,
   * `@sanity/client` transparently encodes zero-width metadata into string
   * query results so Presentation-tool overlays can map rendered text back
   * to the field that produced it. `filter` lets callers exclude fields
   * (slugs, hrefs, image URLs, …) that must not carry stega characters
   * because they end up in an attribute rather than visible text. Left
   * undefined in production builds, where no stega encoding happens.
   */
  stega?: StegaConfig;
}

// ── Sanity payload shapes (loose — we only console.log them for now) ────

interface DetailRef {
  _id: string;
  title?: string;
  /** Rich-text title (bold/italic decorators only) — rendered as the visible
   *  title on the home grid and detail heading. Plain `title` is the fallback
   *  and stays the browser-tab title. */
  stylizedTitle?: PortableTextBlock[] | null;
  /** Routing switch — undefined (legacy docs) and true both route; only an
   *  explicit false suppresses the page + link. */
  allowRouting?: boolean | null;
  slug?: string | null;
  coverImage?: string | null;
  /** Optional MP4 cover URL. When present the cover renders as a looping video. */
  coverVideo?: string | null;
  coverSize?: string | null;
  taxonomy?: { _id: string; title?: string } | null;
  /** Authored slices — only present on the allDetailsQuery projection. */
  slices?: RawSlice[] | null;
}

interface TaxonomyDoc {
  _id: string;
  title?: string;
}

interface PageHomeDoc {
  _id: string;
  title?: string;
  taxonomies?: TaxonomyDoc[] | null;
  // Flat, ordered list of dereferenced Details (was rows × cells). The front
  // end reflows them into a single centered responsive row.
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
  /** Intro overlay phrases — the intro picks one at random per load. */
  introText?: string[] | null;
  language?: string;
  seo?: unknown;
  footerLinks?: FooterLinkRaw[] | null;
}

interface FooterLink {
  title: string;
  href: string;
  blank: boolean;
}

/**
 * pageContact / pageImprint singleton payload — title + slug + a rich-text
 * body (Portable Text blocks with link markDefs resolved to route hrefs by
 * `richBodyProjection` in utils/queries.ts). Both singletons share this
 * exact shape, so one interface and one resolution path serve both pages.
 */
interface RichTextPageDoc {
  _id: string;
  title?: string;
  slug?: string | null;
  body?: PortableTextBlock[] | null;
}

// ── Responsive image helpers (kept for the static fallback) ──────────────

function localPicture(basename: string, alt: string, index: number): PictureData {
  const base = `/assets/images/${basename}`;
  return {
    src: `${base}-1024w.jpg`,
    alt,
    width: 1000,
    height: 1333,
    isFirst: index === 0,
  };
}

// Mark localPicture as intentionally retained.
void localPicture;

/**
 * Build a single-URL PictureData. `w` is the Sanity image width parameter.
 * Defaults to 3000w so every consumer (home grid hover reveals, detail
 * pages, slices) gets a retina-sharp source; callers can still pass a
 * custom `w` when a different size is needed.
 */
function sanityPicture(
  sanityUrl: string,
  alt: string,
  index: number,
  w = 3000,
): PictureData {
  const baseUrl = sanityUrl.split("?")[0];
  return {
    src: `${baseUrl}?auto=format&fm=webp&w=${w}&q=85`,
    alt,
    width: w,
    height: Math.round((w * 4) / 3),
    isFirst: index === 0,
  };
}

/**
 * Build the cover-media fields for a Detail. When the Detail has a `coverVideo`
 * (MP4) it is rendered as a looping autoplay `<video>` everywhere the cover
 * appears, with the `coverImage` (if any) served as the poster/fallback via
 * `src`. When only an image exists this collapses to plain PictureData
 * behaviour. Callers must have already checked the Detail carries at least one
 * of coverImage / coverVideo.
 */
function coverMedia(d: DetailRef, alt: string, index: number): CoverMedia {
  // Image fields drive both the <img> branch and the <video> poster. When the
  // Detail is video-only, fall back to an empty src (poster="" is harmless) and
  // the 3:4 dimensions the layout expects.
  const pic: PictureData = d.coverImage
    ? sanityPicture(d.coverImage, alt, index)
    : { src: "", alt, width: 3000, height: 4000, isFirst: index === 0 };
  return {
    ...pic,
    hasVideo: !!d.coverVideo,
    video: d.coverVideo ?? "",
  };
}

let sanityClient: SanityClientFactory | null = null;
let userConfig: SanityConfig = {};

try {
  const mod = await import("@sanity/client");
  sanityClient =
    (mod as { createClient?: SanityClientFactory }).createClient ||
    (mod as { default?: { createClient?: SanityClientFactory } }).default
      ?.createClient ||
    (mod.default as SanityClientFactory);
} catch {
  // @sanity/client is not installed — static fallback still works.
}

try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const cfgMod = await import("../project.config");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cfg = cfgMod.default?.sanity || {};
  userConfig = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    projectId: cfg.projectId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    dataset: cfg.dataset,
  };
} catch {
  // No project config; fall back to env vars.
}

/**
 * Build the page manifest for the build pipeline.
 *
 * Fetches the new schema (siteOptions, pageHome, details, taxonomies) and
 * console.logs the shapes. The frontend route entries are still scaffolds
 * — wiring those will follow once the data shape is reviewed in the
 * build output.
 */
export async function loadSanityContent(
  opts: SanityContentOptions = {},
): Promise<SanityContentResult> {
  let { dataset, projectId, token, apiVersion } = opts;
  const { perspective, stega } = opts;

  dataset = dataset || userConfig.dataset || process.env.SANITY_DATASET;
  projectId = projectId || userConfig.projectId || process.env.SANITY_PROJECT_ID;
  token = token || userConfig.token || process.env.SANITY_READ_TOKEN;
  apiVersion =
    apiVersion ||
    userConfig.apiVersion ||
    process.env.SANITY_API_VERSION ||
    "2023-10-10";

  const pages: PageEntry[] = [];
  // Flat list of every grid Detail, in authored order = render order. Shared
  // by Text mode, Image mode, and the text-gpu figures (linked by flatIndex).
  const homeGridItems: Record<string, unknown>[] = [];
  // Footer links resolved from siteOptions. Flattened to {title, href, blank}
  // so the Mustache template can iterate directly.
  let footerLinks: FooterLink[] = [];
  // Top-level site title from the Sanity Global doc. Threaded into the
  // shell HTML by routes-plugin so <title>, og:title etc. all pick it up.
  let siteTitle = "";
  // Intro overlay phrases from the Global doc. Threaded into the shell by
  // routes-plugin; the runtime intro picks one at random per load.
  let introPhrases: string[] = [];
  // Home page's taxonomy list (drives the filter buttons in the nav).
  let homeTaxonomies: Array<{ id: string; title: string }> = [];
  // One detail page emitted per Sanity Detail document with a coverImage. Each
  // gets its own path (`/${slug}`) and the shared `detail` template/key so
  // PageManager binds DetailPage to every URL.
  const detailPages: Array<{
    slug: string;
    title: string;
    /** Pre-rendered title HTML (stylized title, or escaped plain fallback). */
    titleHtml: string;
    cover: CoverMedia & { coverSize: string };
    slicesHtml: string;
  }> = [];
  // Contact / Imprint singleton fallbacks. Initialized here (mirroring the
  // footerLinks/siteTitle pattern above) and overwritten inside the fetch
  // try-block below, so the routes always exist — even in a Sanity-less
  // build or when the singleton doc hasn't been created yet.
  let contactPath = "/contact";
  let contactTitle = "Contact";
  let contactBodyHtml = "";
  let imprintPath = "/imprint";
  let imprintTitle = "Imprint";
  let imprintBodyHtml = "";

  if (sanityClient && projectId && dataset) {
    const client = sanityClient({
      projectId,
      dataset,
      apiVersion: apiVersion ?? "2023-10-10",
      // Draft content is never cached at Sanity's CDN edge — it must always
      // hit the live API so editors see their own unpublished changes.
      useCdn: perspective === "drafts" ? false : !token,
      perspective: perspective ?? "published",
      ...(token ? { token } : {}),
      ...(stega ? { stega } : {}),
    });

    try {
      const [siteOptions, pageHome, details, taxonomies, pageContact, pageImprint] =
        await Promise.all([
          client.fetch<SiteOptionsDoc | null>(siteOptionsQuery),
          client.fetch<PageHomeDoc | null>(pageHomeQuery),
          client.fetch<DetailRef[]>(allDetailsQuery),
          client.fetch<TaxonomyDoc[]>(allTaxonomiesQuery),
          client.fetch<RichTextPageDoc | null>(pageContactQuery),
          client.fetch<RichTextPageDoc | null>(pageImprintQuery),
        ]);

      // Site title from the Global singleton — drives <title> and OG/Twitter
      // meta in the shell template.
      siteTitle = siteOptions?.name ?? "";

      // Intro phrases from the Global singleton. Drop empty/blank entries so
      // the runtime never picks a blank phrase, and trim surrounding space.
      introPhrases = (siteOptions?.introText ?? [])
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim());

      // Flatten footer links from siteOptions. Drop entries without an href
      // (a link with no destination is useless). Default `blank` to false.
      footerLinks = (siteOptions?.footerLinks ?? [])
        .filter((l): l is FooterLinkRaw => !!l?.href)
        .map((l) => ({
          title: l.title ?? "",
          href: l.href ?? "",
          blank: l.blank === true,
        }));

      console.log("[sanity-content] siteOptions →", JSON.stringify(siteOptions, null, 2));
      console.log("[sanity-content] pageHome →", JSON.stringify(pageHome, null, 2));
      console.log(
        `[sanity-content] taxonomies (${taxonomies?.length ?? 0}) →`,
        JSON.stringify(taxonomies, null, 2),
      );
      console.log(
        `[sanity-content] details (${details?.length ?? 0}) →`,
        JSON.stringify(details, null, 2),
      );
      console.log("[sanity-content] pageContact →", JSON.stringify(pageContact, null, 2));
      console.log("[sanity-content] pageImprint →", JSON.stringify(pageImprint, null, 2));

      // Contact singleton — falls back to "/contact" / "Contact" when the
      // CMS slug/title are absent so the route path stays stable. The body
      // is rendered through the shared Portable Text renderer, which turns
      // pre-resolved internal/external link markDefs into <a> tags.
      contactPath = "/" + (pageContact?.slug ?? "contact");
      contactTitle = pageContact?.title ?? "Contact";
      contactBodyHtml = renderPortableText(pageContact?.body, { wrap: "p" });

      // Imprint singleton — same fallback shape as Contact above.
      imprintPath = "/" + (pageImprint?.slug ?? "imprint");
      imprintTitle = pageImprint?.title ?? "Imprint";
      imprintBodyHtml = renderPortableText(pageImprint?.body, { wrap: "p" });

      // Home taxonomy list — what the editor picked under the Taxonomy tab
      // on the Home doc. Drives the filter buttons in the global nav.
      homeTaxonomies = (pageHome?.taxonomies ?? [])
        .filter((t): t is TaxonomyDoc => !!t?._id)
        .map((t) => ({ id: t._id, title: t.title ?? "" }));

      // Index every Detail (with its authored slices, from allDetailsQuery) by
      // _id so the grid loop — which only has the lightweight pageHome cell
      // projection — can pull the full slices array to render. The slice
      // context is minimal: these detail slices don't use globals/clients.
      const detailsById = new Map<string, DetailRef>();
      for (const dd of details ?? []) detailsById.set(dd._id, dd);
      const sliceCtx: SliceContext = {
        globals: null,
        clients: null,
        locations: [],
      };

      // Build grid items for the home template from the pageHome grid array.
      // The grid is now a flat, ordered list of Details (was rows × cells); we
      // walk it once, tagging each entry with a `flatIndex` so the front end can
      // link a text label, its image cell, and its text-gpu figure by position.
      if (pageHome?.grid?.length) {
        let flatIndex = 0;
        const seenDetailIds = new Set<string>();
        for (const d of pageHome.grid) {
          // A Detail earns a grid slot if it has either a cover image OR a
          // cover video (MP4). Video-only Details are valid — the image is just
          // the optional poster/fallback.
          if (!d?.coverImage && !d?.coverVideo) continue;
          if (seenDetailIds.has(d._id)) continue;
          seenDetailIds.add(d._id);

          // Routing is a standalone switch now (the "In Progress" toggle is
          // gone — in-progress signalling lives in the stylized title text).
          // Undefined (legacy docs, where the field was hidden) and true both
          // route; only an explicit false suppresses the page + link.
          const routable = d.allowRouting !== false;

          // Rendered title HTML for both home modes and the detail heading.
          // Prefer the stylized rich-text title (bold/italic preserved as
          // <strong>/<em>, content escaped by the renderer); fall back to the
          // escaped plain title. All italicisation lives in the stylized title.
          const titleHtml =
            renderPortableText(d.stylizedTitle ?? undefined) ||
            escapeHtml(d.title ?? "");

          const pic = coverMedia(d, d.title ?? "", flatIndex);
          homeGridItems.push({
            ...pic,
            // Image mode loads eagerly — every grid cover preloads (even
            // while the pane is display:none in Text mode) so toggling to
            // Image mode never shows a lazy pop-in.
            eager: true,
            coverSize: d.coverSize ?? "4x3-sm",
            title: d.title ?? "",
            // Pre-rendered title HTML — templates emit it via triple-mustache.
            titleHtml,
            // When false the template emits a non-routing <div> instead of an
            // <a>; when true it links to `/${slug}`.
            routable,
            slug: d.slug ?? "",
            flatIndex,
            // Taxonomy id (or empty if unassigned). The nav filter reads
            // `data-taxonomy` on each item to decide visibility.
            taxonomyId: d.taxonomy?._id ?? "",
          });

          // Collect one detail-page record per placement (with a slug), but
          // only when the item routes — an in-progress Detail without the
          // routing toggle renders its grid entry yet builds no page. The
          // slices array lives on the full Detail doc (allDetailsQuery), so
          // look it up by _id and render its slices to HTML here.
          if (d.slug && routable) {
            const full = detailsById.get(d._id);
            detailPages.push({
              slug: d.slug,
              title: d.title ?? "",
              titleHtml,
              // Cover for the detail page (rendered under the nav). It is sized
              // to exactly match the home text-mode reveal image, so it is served
              // at the same source width (3000, sanityPicture default) as the home
              // grid, and carries `coverSize` to pick the matching figure aspect.
              // index 0 → fetchpriority="high" (it is the page's LCP).
              cover: {
                ...coverMedia(d, d.title ?? "", 0),
                coverSize: d.coverSize ?? "4x3-sm",
              },
              slicesHtml: renderSlices(full?.slices ?? undefined, sliceCtx),
            });
          }

          flatIndex++;
        }
      }
    } catch (err) {
      console.warn("[sanity-content] fetch failed:", err);
    }
  } else {
    console.log(
      "[sanity-content] Sanity client not configured (projectId/dataset missing) — skipping fetch.",
    );
  }

  pages.push({
    path: "/",
    key: "home",
    title: "Home",
    template: "home",
    data: {
      gridItems: homeGridItems,
      taxonomies: homeTaxonomies,
      hasTaxonomies: homeTaxonomies.length > 0,
      footerLinks,
      hasFooterLinks: footerLinks.length > 0,
    },
  });

  // Contact singleton — a single centered rich-text field (see
  // richBodyProjection in utils/queries.ts). Pushed unconditionally, like
  // /about above, so the route exists even without a configured Sanity
  // client or before the doc is created in the Studio.
  pages.push({
    path: contactPath,
    key: "contact",
    // Browser/tab title: "<site title> - <page title>" (hyphen), e.g.
    // "Diaa - Contact". Falls back to the bare page title when siteOptions
    // has no name. The on-page heading still uses the bare `data.title`.
    title: siteTitle ? `${siteTitle} - ${contactTitle}` : contactTitle,
    template: "contact",
    data: { title: contactTitle, bodyHtml: contactBodyHtml },
  });

  // Imprint singleton — same shape/contract as Contact above.
  pages.push({
    path: imprintPath,
    key: "imprint",
    title: siteTitle ? `${siteTitle} - ${imprintTitle}` : imprintTitle,
    template: "imprint",
    data: { title: imprintTitle, bodyHtml: imprintBodyHtml },
  });

  // Emit one CMS-templated page per detail (slug → `/${slug}`). All share the
  // key "detail" so PageManager binds them to DetailPage.
  for (const d of detailPages) {
    const path = `/${d.slug}`;
    // Browser/tab title: "<site title> - <detail title>" (hyphen), e.g.
    // "Diaa - Project Name". This drives document.title on both hard load
    // (hydrateFromCache) and SPA navigation (Ctrl). The on-page nav heading
    // below stays the bare project name via data.title. Fall back to the bare
    // title if siteOptions has no name.
    const documentTitle = siteTitle ? `${siteTitle} - ${d.title}` : d.title;
    pages.push({
      path,
      key: "detail",
      title: documentTitle,
      template: "detail",
      // `title` stays the plain string (used as alt-text source and kept for
      // any plain-text consumer); `titleHtml` is what the nav heading renders.
      data: {
        title: d.title,
        titleHtml: d.titleHtml,
        cover: d.cover,
        slicesHtml: d.slicesHtml,
      },
    });
  }

  return {
    pages,
    siteTitle,
    // Fall back to the default phrase when the CMS provided none, so the intro
    // always renders a phrase beat.
    introPhrases: introPhrases.length ? introPhrases : [DEFAULT_INTRO_PHRASE],
  };
}

// Compatibility alias — `scripts/cms-refresh.ts` imports this name.
export const refreshSanityCache = loadSanityContent;
