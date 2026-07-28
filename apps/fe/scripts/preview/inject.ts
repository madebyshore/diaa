/**
 * inject.ts — turns one page's in-memory drafts HTML into a preview-ready
 * document.
 *
 * `renderSite()` always emits the *dev-shell* shape of the shell template —
 * see routes-plugin.ts's own doc comment: the literal
 * `<script type="module" src="src/main.ts"></script>` tag, no hashed
 * asset tags, no inlined `__TMHGNE__` payload. That's fine for the Vite dev
 * server (which serves `src/main.ts` directly) but wrong for preview, which
 * has no dev server behind it — it needs byte-equivalent-to-prod HTML.
 * `injectPreviewHtml()` does in memory exactly what routes-plugin.ts's
 * `closeBundle()` does on disk for a production build:
 *   1. strip the dev entry script tag,
 *   2. inject the real hashed JS/CSS tags from the `dist/` build manifest
 *      (via the Phase-1-exported `findHashedAssets()`/`injectAssetTags()`),
 *   3. inline the boot manifest as `__TMHGNE__`.
 * On top of that it stamps the two preview-only globals
 * (`window.__PREVIEW__`, `window.__SANITY_STUDIO_URL__`) that
 * `maybeEnableVisualEditing()` (src/app/preview/visual-editing.ts) reads to
 * decide whether to load `@sanity/visual-editing` at all.
 */

import {
  findHashedAssets,
  injectAssetTags,
  type RenderedSite,
} from "../routes-plugin.js";

/**
 * Matches routes-plugin.ts's `closeBundle()` dev-script strip regex exactly,
 * so preview HTML never ships the unbundled dev-mode entry alongside the
 * real hashed bundle.
 */
const DEV_SCRIPT_RE =
  /<script\s+type=["']module["']\s+src=["']\s*src\/main\.(?:ts|js)\s*["'][^>]*>\s*<\/script>/gi;

/** Options accepted by `injectPreviewHtml()`. */
export interface InjectPreviewHtmlOptions {
  /** Where the Sanity Studio is hosted — stamped onto `window.__SANITY_STUDIO_URL__`. */
  studioUrl: string;
  /** Build output directory to read the hashed-asset manifest from. */
  distDir: string;
  /**
   * Epoch-ms render timestamp to embed in the inlined `__TMHGNE__` payload.
   * Defaults to `Date.now()` (i.e. "when this response was served") when
   * omitted — callers that have the drafts render's own `generatedAt`
   * (preview/render.ts's `PreviewSite`) should pass it through so the
   * inlined payload's timestamp matches the memo it came from.
   */
  generatedAt?: number;
}

/** The tmhgne.json-shaped payload inlined into preview HTML as `__TMHGNE__`.
 *  Mirrors routes-plugin.ts's on-disk `PkgPayload` shape (`generatedAt` +
 *  `routes` + `cache`) but keeps `generatedAt` as an epoch-ms number rather
 *  than an ISO string — preview's own `generatedAt` (render.ts) is already a
 *  number and consumers compare it numerically (`?fresh=`), so keeping the
 *  type consistent avoids a parse step on every comparison. */
export interface PreviewPkgPayload {
  generatedAt: number;
  routes: RenderedSite["routes"];
  cache: RenderedSite["cache"];
}

/**
 * Rewrites one rendered page's HTML into a preview-ready document: strips
 * the dev entry script, injects the real built JS/CSS tags, inlines the
 * boot manifest, and stamps the preview globals.
 *
 * @param html - The in-memory rendered HTML for one route, from
 *   `RenderedSite.pagesHtml`.
 * @param site - The full drafts render this page came from — supplies the
 *   `routes`/`cache` maps for the inlined `__TMHGNE__` payload.
 * @param opts - Studio URL, build output directory, and (optionally) the
 *   render's own `generatedAt` stamp.
 */
export function injectPreviewHtml(
  html: string,
  site: RenderedSite,
  opts: InjectPreviewHtmlOptions,
): string {
  let out = html.replace(DEV_SCRIPT_RE, "");

  const assets = findHashedAssets(opts.distDir);
  if (assets) {
    out = injectAssetTags(out, assets);
  } else {
    console.debug(
      "[preview] no build manifest found in",
      opts.distDir,
      "— run `pnpm --filter diaa build` once before starting the preview server",
    );
  }

  const globalsTag = `<script>window.__PREVIEW__=true;window.__SANITY_STUDIO_URL__=${JSON.stringify(
    opts.studioUrl,
  )};</script>`;
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, `${globalsTag}\n</head>`)
    : `${globalsTag}\n${out}`;

  const payload: PreviewPkgPayload = {
    generatedAt: opts.generatedAt ?? Date.now(),
    routes: site.routes,
    cache: site.cache,
  };
  // Mirrors closeBundle()'s </script>-escaping (routes-plugin.ts). Draft
  // content is editor-authored but not fully trusted — this keeps a rogue
  // "</script><script>…" in cached page HTML from breaking out of this tag.
  const safeJson = JSON.stringify(payload).replace(/<\/-?script>/gi, "<\\/script>");
  const pkgTag = `<script id="__TMHGNE__" type="application/json">${safeJson}</script>`;
  out = /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, `${pkgTag}\n</body>`)
    : `${out}${pkgTag}`;

  return out;
}
