/**
 * preview-server.ts — local development entrypoint for the Sanity
 * Presentation preview loop (`pnpm preview:cms`).
 *
 * A thin `node:http` wrapper around the host-agnostic `handlePreviewRequest()`
 * core (scripts/preview/handler.ts): it streams built static assets directly
 * from `dist/` (the exact bytes a production build ships — hashed JS/CSS
 * under /assets/, plus fonts/og-image/favicon/etc.) and delegates everything
 * else — page HTML, /tmhgne.json, the refresh/enable preview routes — to the
 * shared handler. In Phase 5, `apps/preview/api/[[...path]].ts` wraps the
 * exact same `handlePreviewRequest()` in a Vercel serverless function instead
 * of this file — this script never runs in production.
 *
 * This script does NOT run `vite build` itself — draft content changes far
 * more often than the JS bundle does, and re-bundling on every request would
 * defeat the whole point of a memoized, fast-refreshing preview. Run
 * `pnpm --filter diaa build` once beforehand (and again after any code
 * change) and this server picks up the resulting `dist/` on every request.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { handlePreviewRequest, type PreviewRequest } from "./preview/handler.js";
import { DIST_DIR } from "./preview/render.js";

const PORT = Number(process.env.PORT) || 8080;

/** Minimal extension → Content-Type map for the static files this server
 *  streams directly from `dist/` (hashed JS/CSS, fonts, og image, favicon, …). */
const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Extensions this server must NEVER intercept — these are always
 *  dynamically (re)rendered from the drafts memo rather than served from a
 *  potentially stale on-disk copy left over from the last `vite build`. */
const DYNAMIC_EXTENSIONS = new Set([".html", ".json"]);

/**
 * True when `pathname` names a file that should stream straight from
 * `dist/`: anything under `/assets/` (the hashed JS/CSS bundle), or any
 * other extensioned static file (fonts, og image, favicon, …). Extensionless
 * paths (SPA routes) and `.html`/`.json` (always dynamic — see
 * `DYNAMIC_EXTENSIONS`) are excluded so they fall through to the drafts
 * render pipeline instead.
 */
function isStaticCandidate(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) return true;
  const ext = path.extname(pathname).toLowerCase();
  if (!ext || DYNAMIC_EXTENSIONS.has(ext)) return false;
  return true;
}

/** Streams a static file from `dist/` with a best-guess Content-Type. */
function serveStatic(res: http.ServerResponse, absPath: string): void {
  const ext = path.extname(absPath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  createReadStream(absPath).pipe(res);
}

/** Splits a raw `req.url` (path + optional query) into `[pathname, search]`. */
function splitUrl(rawUrl: string): [string, string] {
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) return [rawUrl, ""];
  return [rawUrl.slice(0, qIndex), rawUrl.slice(qIndex)];
}

/** Collapses Node's `IncomingHttpHeaders` (`string | string[] | undefined`)
 *  down to the plain string map `handlePreviewRequest()` expects —
 *  multi-value headers (rare for the ones this handler reads: Cookie) are
 *  joined with `", "`. */
function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

if (!existsSync(DIST_DIR)) {
  console.error(
    `[preview] dist/ not found at ${DIST_DIR}.\n` +
      "[preview] This server streams built JS/CSS/static assets straight from dist/ " +
      "and never runs `vite build` itself.\n" +
      "[preview] Run `pnpm --filter diaa build` once first, then restart `pnpm preview:cms`.",
  );
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      const rawUrl = req.url ?? "/";
      const [pathname, search] = splitUrl(rawUrl);

      if (req.method === "GET" && isStaticCandidate(pathname)) {
        const abs = path.join(DIST_DIR, pathname);
        if (existsSync(abs) && statSync(abs).isFile()) {
          serveStatic(res, abs);
          return;
        }
      }

      const previewReq: PreviewRequest = {
        method: req.method ?? "GET",
        path: pathname,
        search,
        headers: flattenHeaders(req.headers),
      };
      const result = await handlePreviewRequest(previewReq);

      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (err) {
      console.error("[preview] request handling failed:", err);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `Internal preview server error: ${(err as Error)?.message ?? String(err)}\n` +
          "Check the terminal running `pnpm preview:cms` for the full stack trace.",
      );
    }
  })();
});

server.listen(PORT, () => {
  console.debug(`[preview] listening on http://localhost:${PORT}`);
  if (!process.env.SANITY_READ_TOKEN) {
    console.warn(
      "[preview] SANITY_READ_TOKEN is not set — the first request that renders drafts " +
        "will fail with an actionable error. Set it in apps/fe/.env or your shell.",
    );
  }
});
