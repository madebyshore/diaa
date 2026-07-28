/**
 * api/[[...path]].ts — the Vercel catch-all Node.js Function that serves
 * the entire `diaa-preview` deployment.
 *
 * This is a thin adapter, not a second implementation: every route
 * (auth/enable, refresh, tmhgne.json, page HTML) is decided by the same
 * `handlePreviewRequest()` core that `apps/fe/scripts/preview-server.ts`
 * wraps locally (see that file's doc comment for the shared-core rationale).
 * This function only translates between Vercel's Web-standard
 * `Request`/`Response` and the host-agnostic `PreviewRequest`/
 * `PreviewResponse` shapes `handlePreviewRequest()` speaks.
 *
 * Static assets (`/assets/*`, `sitemap.xml`, …) never reach this function —
 * Vercel's filesystem serving of `apps/preview/public/` (populated at build
 * time by `scripts/copy-assets.mjs` from the real `apps/fe` production
 * build) takes precedence over the `vercel.json` catch-all rewrite. Every
 * other path — including `/`, `/about`, `/__preview/enable`, and
 * `/tmhgne.json` — is rewritten to `/api/$1` (see vercel.json) and lands
 * here.
 *
 * Uses the "fetch Web Standard" function export
 * (https://vercel.com/docs/functions/runtimes/node-js) rather than the
 * legacy `(req, res)` signature — Node.js Functions on Vercel support it
 * natively, and it maps cleanly onto `PreviewRequest`/`PreviewResponse`
 * without an extra `@vercel/node` type dependency.
 */

import {
  handlePreviewRequest,
  type PreviewRequest,
  type PreviewResponse,
} from "../../fe/scripts/preview/handler.js";

/**
 * Converts an incoming Vercel-routed `Request` into the framework-agnostic
 * `PreviewRequest` shape `handlePreviewRequest()` expects.
 *
 * `vercel.json`'s catch-all rewrite (`"/(.*)" -> "/api/$1"`) means the
 * pathname this function observes is prefixed with `/api` — e.g. a request
 * for `/about` arrives here as `/api/about`, and `/` arrives as `/api/`
 * (the capture group is empty). That prefix is an artifact of routing this
 * one function to every path, not part of the site's own path space, so it
 * is stripped before handing the path to the shared handler.
 */
function toPreviewRequest(request: Request): PreviewRequest {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api/, "") || "/";

  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    method: request.method,
    path: pathname,
    search: url.search,
    headers,
  };
}

/**
 * Converts `handlePreviewRequest()`'s framework-agnostic `PreviewResponse`
 * into a Web-standard `Response`. `body` is already a `string | Buffer` —
 * both are valid `BodyInit` (Node's `Buffer` is a `Uint8Array`), so no
 * further conversion is needed.
 */
function toWebResponse(res: PreviewResponse): Response {
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export default {
  /**
   * Handles every method/path routed to this function. Delegates entirely
   * to `handlePreviewRequest()` — this function's only job is the
   * Request/Response ⇄ PreviewRequest/PreviewResponse translation above.
   */
  async fetch(request: Request): Promise<Response> {
    console.debug(`[preview:vercel] ${request.method} ${request.url}`);
    try {
      const result = await handlePreviewRequest(toPreviewRequest(request));
      return toWebResponse(result);
    } catch (err) {
      console.error("[preview:vercel] request handling failed:", err);
      const message = (err as Error)?.message ?? String(err);
      return new Response(`Internal preview server error: ${message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
