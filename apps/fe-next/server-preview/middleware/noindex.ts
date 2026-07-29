/**
 * server-preview/middleware/noindex.ts — runs on EVERY request this preview
 * deployment serves (Nitro middleware, no route pattern = global). Two
 * responsibilities live in one file rather than being split, and ORDER
 * matters for why:
 *
 *   1. Stamp `X-Robots-Tag: noindex` + `Cache-Control: no-store` on every
 *      response — success or failure. This deployment only ever serves
 *      draft content; neither a search crawler nor an intermediate cache
 *      should ever retain it. This is the INDEX-time layer;
 *      `server/routes/robots.txt.get.ts`'s `Disallow: /` (already
 *      `previewEnabled`-aware since Phase 4) is the independent CRAWL-time
 *      layer — a crawler that ignores robots.txt entirely still gets told
 *      not to index what it fetches.
 *   2. STRICT auth gate: 401 every request that doesn't carry a valid
 *      session cookie, with three exemptions — `/preview/enable` (the one
 *      route reachable pre-auth; it's how a session cookie gets minted in
 *      the first place, from a Studio-signed preview link), and
 *      `/sitemap.xml` / `/robots.txt`. Ported decision from the proven
 *      `preview`-branch `handler.ts` (commit `83350cd`): that
 *      implementation gated EVERYTHING except `/__preview/enable` behind
 *      `auth.isAuthorized()`. Matching that strictness here for actual
 *      CONTENT routes (rather than a softer "no cookie → serve published +
 *      noindex" fallback) protects drafts unambiguously and avoids a
 *      confusing partially-authed state — see the Phase 6 report for the
 *      explicit decision.
 *
 *      The sitemap/robots exemption is a deliberate, NARROW deviation from
 *      that 1:1 port, made necessary by this app's own architecture rather
 *      than a strictness compromise: the original preview server was a
 *      standalone catch-all handler with no sitemap.xml/robots.txt routes
 *      at all, so the question never came up there. Here, both routes are
 *      Nitro routes registered for build-time prerendering (see
 *      `nuxt.config.ts`'s `prerender:routes` hook) even in a preview
 *      build — the prerender crawler has no session cookie, so gating them
 *      would fail the BUILD, not just a runtime request (this was caught
 *      live: the first version of this file gated them and every preview
 *      build failed prerendering `/sitemap.xml`/`/robots.txt` with 401).
 *      Content-wise neither leaks anything: `robots.txt`'s
 *      `previewEnabled`-branched body is a build-time-fixed value (an env
 *      var, not per-request), and `sitemap.xml` only ever lists
 *      `loadAllRoutePaths("published", ...)` — published paths, never
 *      drafts — regardless of build mode. A crawler needs to be able to
 *      fetch `robots.txt` unauthenticated anyway, or it can't learn "you're
 *      disallowed here" in the first place.
 *
 * These two are in the SAME handler (not two separate middleware files)
 * specifically so header-stamping can never lose a race with the auth gate:
 * Nitro runs `middleware/*.ts` files in filename order, and a `401.ts` +
 * `noindex.ts` split would risk the throw happening before the headers are
 * set (or vice-versa needing careful naming to enforce order) depending on
 * alphabetical sort — bundling both into one handler makes the ordering
 * unconditionally correct: headers land first, then the gate runs, so even
 * a 401 response carries the noindex header.
 *
 * Only reachable at all in a preview build — this file lives under
 * `server-preview/`, which `nuxt.config.ts`'s `nitro.scanDirs` excludes
 * from the module graph unless `NUXT_PUBLIC_PREVIEW_ENABLED=true`.
 */
import { isAuthorized } from "../utils/preview-auth";

export default defineEventHandler((event) => {
  setResponseHeader(event, "X-Robots-Tag", "noindex");
  setResponseHeader(event, "Cache-Control", "no-store");

  const path = getRequestURL(event).pathname;

  // Reachable without a session — see the file header for why each is
  // exempt (`/preview/enable` is how a session is minted in the first
  // place; `/sitemap.xml`/`/robots.txt` carry no draft data and must
  // survive build-time prerendering, which never has a cookie to send).
  if (path === "/preview/enable" || path === "/sitemap.xml" || path === "/robots.txt") return;

  if (!isAuthorized(event)) {
    console.debug("[preview:auth] unauthorized request:", path);
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized — open this preview from a Sanity Presentation session.",
    });
  }
});
