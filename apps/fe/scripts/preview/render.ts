/**
 * render.ts — Phase 2: the memoized drafts render at the core of the
 * preview server.
 *
 * `getPreviewSite()` wraps the shared, host-agnostic `renderSite()`
 * (extracted from routes-plugin.ts in Phase 1) with:
 *   - a module-scope memo stamped with an epoch-ms `generatedAt`, so a warm
 *     serverless instance (or the local dev server) doesn't re-fetch Sanity
 *     on every request;
 *   - a short TTL (~30s) as a cross-instance staleness bound — Vercel Fluid
 *     compute can keep multiple instances warm with independent memos, so a
 *     TTL puts a ceiling on how stale any of them can get without a refresh;
 *   - an in-flight promise guard so concurrent requests that land on a cold
 *     memo share exactly one render instead of racing N renders;
 *   - a hard, actionable failure when `SANITY_READ_TOKEN` is missing —
 *     drafts perspective requires authentication, and silently falling back
 *     to published content would be far more confusing than a startup error.
 *
 * Path resolution is self-contained: `FE_ROOT` is computed from this file's
 * own `import.meta.url`, not `process.cwd()`, because this module is loaded
 * by two different working directories — the local `preview-server.ts`
 * script (run from `apps/fe/`) and, in Phase 5, a Vercel function under
 * `apps/preview/api/` (run from wherever Vercel's bundler puts it).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderSite, type RenderedSite } from "../routes-plugin.js";
import { buildPreviewStega } from "./stega.js";

/**
 * Resolves the root directory this module reads templates/manifest from.
 *
 * Three candidates, in priority order:
 *   1. `PREVIEW_FE_ROOT` env var — explicit override, always wins.
 *   2. The `apps/fe` package root derived from this file's own
 *      `import.meta.url` — the normal case (local `preview:cms`, tests),
 *      accepted only when its `src/routes/` actually exists on disk.
 *   3. `<cwd>/.preview-runtime` — the deployed Vercel function. There,
 *      `functions.includeFiles` globs can't reliably escape the
 *      `apps/preview` project root to reach sibling `apps/fe` files, so
 *      `apps/preview/scripts/copy-assets.mjs` copies the runtime-read subset
 *      (route templates, shell template, build manifest) into
 *      `.preview-runtime/` mirroring this same relative layout, and the
 *      function's cwd is the project root. Probing for it here means the
 *      deployment works with zero env configuration.
 *
 * If neither probe matches we still return the derived path so the eventual
 * template read fails with a path in its error message rather than here.
 */
function resolveFeRoot(): string {
  if (process.env.PREVIEW_FE_ROOT) {
    return path.resolve(process.env.PREVIEW_FE_ROOT);
  }
  const derived = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  if (fs.existsSync(path.join(derived, "src/routes"))) return derived;
  const bundled = path.resolve(".preview-runtime");
  if (fs.existsSync(path.join(bundled, "src/routes"))) {
    console.debug(`[preview] FE root resolved to bundled runtime: ${bundled}`);
    return bundled;
  }
  return derived;
}

/**
 * Absolute path to the directory holding the fe templates and build
 * manifest — `apps/fe` itself locally, or the copied `.preview-runtime/`
 * tree on a deployed Vercel function. See `resolveFeRoot()` for the
 * resolution rules.
 */
export const FE_ROOT = resolveFeRoot();

/** Routes directory `renderSite()` scans — same layout the Vite plugin uses. */
export const ROUTES_DIR = path.join(FE_ROOT, "src/routes");
/** Shell HTML template `renderSite()` wraps every route in. */
export const TEMPLATE = path.join(FE_ROOT, "index.html");
/** Build output directory — where the real `vite build` (prod-identical) assets live. */
export const DIST_DIR = path.join(FE_ROOT, "dist");

/** Cross-instance staleness bound: a warm memo older than this is re-rendered
 *  even without an explicit refresh, so a stuck/forgotten instance can't
 *  serve arbitrarily stale drafts forever. */
const MAX_AGE_MS = 30_000;

/** The memoized result: the rendered site plus the epoch-ms timestamp it was
 *  produced at. `generatedAt` is what `/tmhgne.json?fresh=` staleness checks
 *  compare against, and what `/__preview/refresh` echoes back to the client. */
export interface PreviewSite {
  site: RenderedSite;
  generatedAt: number;
}

let memo: PreviewSite | null = null;
let inflight: Promise<PreviewSite> | null = null;

/** Reads `SANITY_STUDIO_URL` for the stega config (and for `inject.ts`'s
 *  `window.__SANITY_STUDIO_URL__` stamp — see handler.ts). Empty string
 *  (stega still enabled, just without a resolvable studio deep-link) when
 *  unset — this is a soft warning, not a hard failure like the missing-token
 *  case below. */
export function studioUrlFromEnv(): string {
  const url = process.env.SANITY_STUDIO_URL;
  if (!url) {
    console.debug(
      "[preview] SANITY_STUDIO_URL is not set — stega links back to the Studio will be unresolvable",
    );
  }
  return url ?? "";
}

/**
 * Renders a fresh drafts-perspective site. Throws immediately if
 * `SANITY_READ_TOKEN` is missing — `loadSanityContent()` (called inside
 * `renderSite()`) swallows fetch failures internally and falls back to an
 * empty/static render, which would silently serve blank pages instead of the
 * actionable "you forgot to configure a token" error an editor setting this
 * up for the first time actually needs.
 */
async function renderFreshSite(): Promise<PreviewSite> {
  if (!process.env.SANITY_READ_TOKEN) {
    throw new Error(
      "[preview] SANITY_READ_TOKEN is required to render draft content. " +
        "Create a Viewer token in Sanity Manage → API → Tokens and set " +
        "SANITY_READ_TOKEN in your environment (apps/fe/.env for local " +
        "`pnpm preview:cms`, or the diaa-preview project's env vars once deployed).",
    );
  }

  console.debug("[preview] rendering fresh drafts site…");
  const site = await renderSite({
    routesDir: ROUTES_DIR,
    template: TEMPLATE,
    // Preview HTML should be structurally identical to a production build
    // (no dev-only grid overlay, etc.) — see inject.ts for how the real
    // hashed assets get layered on top of this in-memory render.
    isBuild: true,
    perspective: "drafts",
    stega: buildPreviewStega(studioUrlFromEnv()),
  });

  const generatedAt = Date.now();
  console.debug(`[preview] fresh render complete at ${generatedAt}`);
  return { site, generatedAt };
}

/** Options accepted by `getPreviewSite()`. */
export interface GetPreviewSiteOptions {
  /**
   * If set, a memo older than this epoch-ms timestamp is treated as stale
   * even if it's within the normal TTL window. Used right after a
   * `/__preview/refresh` call so a client's follow-up `/tmhgne.json?fresh=`
   * request can never be served a memo from before the refresh — important
   * on a multi-instance deployment where the refresh and the follow-up
   * fetch might land on different warm instances.
   */
  forceFreshSince?: number;
}

/**
 * Returns the current memoized drafts render, refreshing it first if the
 * memo is missing, older than `MAX_AGE_MS`, or older than
 * `opts.forceFreshSince`. Concurrent callers that all observe a stale/absent
 * memo share exactly one in-flight render rather than triggering N parallel
 * Sanity fetches.
 */
export async function getPreviewSite(
  opts: GetPreviewSiteOptions = {},
): Promise<PreviewSite> {
  const { forceFreshSince } = opts;
  const now = Date.now();
  const isStale =
    !memo ||
    now - memo.generatedAt > MAX_AGE_MS ||
    (forceFreshSince != null && memo.generatedAt < forceFreshSince);

  if (!isStale && memo) return memo;
  if (inflight) return inflight;

  inflight = renderFreshSite()
    .then((result) => {
      memo = result;
      inflight = null;
      return result;
    })
    .catch((err: unknown) => {
      inflight = null;
      throw err;
    });

  return inflight;
}

/**
 * Clears the in-memory memo so the next `getPreviewSite()` call is forced to
 * re-render. Called by the `/__preview/refresh` route after a Studio editor
 * saves a draft.
 */
export function bustPreviewSite(): void {
  console.debug("[preview] memo busted — next request re-renders");
  memo = null;
}
