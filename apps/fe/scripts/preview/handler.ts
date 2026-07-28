/**
 * handler.ts — the framework-agnostic HTTP request handler shared by every
 * preview entrypoint (the local `node:http` server in preview-server.ts, and
 * — in Phase 5 — a Vercel catch-all function). Neither entrypoint knows
 * anything about routing, auth, or rendering; they just adapt their host's
 * request/response objects to and from the plain `PreviewRequest` /
 * `PreviewResponse` shapes here.
 *
 * Route table:
 *   GET  /__preview/enable    → auth.handleEnableRequest() (the only route
 *                               reachable without a session — it's how one
 *                               gets created)
 *   *everything else*         → 401 unless auth.isAuthorized()
 *   POST /__preview/refresh   → bust the drafts memo, re-render, respond
 *                               { ok, generatedAt }
 *   GET  /tmhgne.json         → the memoized boot manifest as JSON
 *   GET  <any other path>     → the memoized, preview-injected page HTML
 *
 * Every response — success or failure — carries `X-Robots-Tag: noindex` and
 * `Cache-Control: no-store`: this server only ever serves draft content, and
 * neither a search crawler nor an intermediate cache should ever retain it.
 */

import * as auth from "./auth.js";
import { injectPreviewHtml } from "./inject.js";
import { bustPreviewSite, getPreviewSite, studioUrlFromEnv, DIST_DIR } from "./render.js";

/** A framework-agnostic inbound request. Hosts (preview-server.ts, the
 *  future Vercel function) adapt their own request object into this shape. */
export interface PreviewRequest {
  method: string;
  /** Pathname only — no query string (see `search`). */
  path: string;
  /** The query string, including its leading "?", or "" when absent. */
  search: string;
  headers: Record<string, string | undefined>;
}

/** A framework-agnostic response. Hosts adapt this back into their own
 *  response object (e.g. `res.writeHead(status, headers); res.end(body)`). */
export interface PreviewResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

/** Headers applied to every response, success or failure — see the module
 *  doc comment for why. */
const NOINDEX_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex",
  "Cache-Control": "no-store",
};

/** Builds a JSON `PreviewResponse`. */
function json(status: number, data: unknown): PreviewResponse {
  return {
    status,
    headers: { ...NOINDEX_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
  };
}

/** Builds a plain-text `PreviewResponse`. */
function text(status: number, body: string): PreviewResponse {
  return {
    status,
    headers: { ...NOINDEX_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}

/** Strips a trailing slash (except for the root path itself) so `/about/`
 *  and `/about` resolve to the same `pagesHtml`/`routes` entry. */
function normalizePath(pathname: string): string {
  if (pathname !== "/" && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

/** Parses the `?fresh=<epochMs>` query param used to force a stale-memo
 *  refresh right after a `/__preview/refresh` call. Returns `undefined` for
 *  a missing or non-numeric value. */
function parseFreshParam(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("fresh");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Handles one inbound preview request end-to-end: routes to the auth/enable
 * flow, gates everything else behind the session cookie, then dispatches to
 * the refresh, manifest, or page-HTML routes.
 *
 * @param req - The framework-agnostic request (see `PreviewRequest`).
 */
export async function handlePreviewRequest(req: PreviewRequest): Promise<PreviewResponse> {
  const path = normalizePath(req.path);
  console.debug(`[preview] ${req.method} ${path}${req.search}`);

  // The enable route is the ONLY one reachable without a session — it's how
  // the session cookie gets minted in the first place, from a Studio-signed
  // preview link.
  if (req.method === "GET" && path === "/__preview/enable") {
    const result = await auth.handleEnableRequest(`${req.path}${req.search}`);
    return {
      status: result.status,
      headers: { ...NOINDEX_HEADERS, ...result.headers },
      body: result.body,
    };
  }

  if (!auth.isAuthorized(req.headers["cookie"])) {
    console.debug("[preview:auth] unauthorized request:", path);
    return text(401, "Unauthorized. Open this preview from a Sanity Presentation session.");
  }

  if (req.method === "POST" && path === "/__preview/refresh") {
    bustPreviewSite();
    const { generatedAt } = await getPreviewSite();
    console.debug("[preview:refresh] fresh render ready at", generatedAt);
    return json(200, { ok: true, generatedAt });
  }

  if (req.method === "GET" && path === "/tmhgne.json") {
    // exactOptionalPropertyTypes forbids passing forceFreshSince as an
    // explicit `undefined` — omit the key entirely when there's no `?fresh=`.
    const forceFreshSince = parseFreshParam(req.search);
    const { site, generatedAt } = await getPreviewSite(
      forceFreshSince != null ? { forceFreshSince } : {},
    );
    return json(200, { generatedAt, routes: site.routes, cache: site.cache });
  }

  if (req.method === "GET") {
    const { site, generatedAt } = await getPreviewSite();
    const html = site.pagesHtml.get(path);
    if (!html) return text(404, `Not found: ${path}`);

    const injected = injectPreviewHtml(html, site, {
      studioUrl: studioUrlFromEnv(),
      distDir: DIST_DIR,
      generatedAt,
    });
    return {
      status: 200,
      headers: { ...NOINDEX_HEADERS, "Content-Type": "text/html; charset=utf-8" },
      body: injected,
    };
  }

  return text(404, "Not found");
}
