/**
 * server-preview/utils/preview-auth.ts — the H3/Nitro wrapper around
 * `data/preview-auth-core.ts`'s pure sign/verify logic. Everything in this
 * file assumes a live H3Event (reads the `Cookie` header, sets/deletes the
 * response cookie) — that's the entire reason it's split out from
 * `data/preview-auth-core.ts` rather than merged into it; see that file's
 * header for the full import-boundary rationale (`app/plugins/
 * content.server.ts`, a normal always-present plugin, needs the pure logic
 * WITHOUT ever depending on anything under `server-preview/`).
 *
 * Relative imports into `app/data/` (not the `~/` alias) — mirrors the
 * existing convention in `server/routes/{sitemap.xml,robots.txt}.get.ts` /
 * `server/utils/site-url.ts`, which use relative paths into `../../app/...`
 * rather than assuming Nuxt's `~` alias is wired into Nitro's own bundler
 * context for `server/`-adjacent directories. `server-preview/` sits
 * alongside `server/` at the same depth, so it inherits the same caution.
 *
 * NO explicit `import ... from "h3"` here (deliberate — this bit during
 * development, worth documenting): Nuxt's generated `.nuxt/tsconfig.*.json`
 * path-maps the bare `"h3"` specifier to a newer prerelease
 * (`h3@2.0.1-rc.26` in this toolchain snapshot) project-wide, while the
 * AMBIENT globals Nitro actually auto-imports (`H3Event`, `getCookie`,
 * `setCookie`, `deleteCookie`, `useRuntimeConfig`, ...) resolve against
 * whatever h3 version is ACTUALLY installed as nitropack's own dependency
 * (`h3@1.15.11` here) — the same version `defineEventHandler`'s inferred
 * `event` parameter carries at every call site. Importing `H3Event`
 * explicitly from `"h3"` therefore silently pulls in a DIFFERENT (and
 * structurally incompatible) `H3Event` type than the one every route
 * handler's `event` actually has, and `nuxt typecheck` fails with a
 * confusing "missing properties: url, runtime, waitUntil, fetch, ..."
 * error on every call site that passes a real `event` into a function
 * typed this way. Using the ambient globals (no import statement — they're
 * auto-imported into every file Nitro scans, same as `defineEventHandler`
 * itself) keeps this file's types consistent with every caller's, and
 * sidesteps the path-mapping mismatch entirely.
 */
import {
  buildPreviewSessionCookieValue,
  PREVIEW_SESSION_COOKIE,
  PREVIEW_SESSION_LIFETIME_MS,
  resolvePreviewSessionSecret,
  verifyPreviewSessionCookie,
} from "../../app/data/preview-auth-core";

/**
 * Local `H3Event` type alias, derived structurally from the ambient
 * `getCookie` global's own first parameter rather than an explicit
 * `import type { H3Event } from "h3"` — see the file header for why a
 * direct import silently resolves to an incompatible h3 version in this
 * toolchain. `getCookie` has a single, non-overloaded signature, so
 * `Parameters<>` extraction here is unambiguous and stays in lockstep with
 * whatever h3 version Nitro's own ambient auto-imports actually use.
 */
type H3Event = Parameters<typeof getCookie>[0];

/** Resolves this deployment's session-signing secret from runtime config —
 *  see `resolvePreviewSessionSecret()`'s doc comment for the fallback
 *  order. Takes `event` only to keep every call site in this file
 *  consistent (`isAuthorized`/`grantSession`/`revokeSession` all forward
 *  their own `event`), but deliberately calls the NO-ARG
 *  `useRuntimeConfig()` rather than `useRuntimeConfig(event)` — see this
 *  file's header comment for why passing an `event` typed via the local
 *  `H3Event` alias into `useRuntimeConfig` trips a spurious h3-version
 *  mismatch in this toolchain. The no-arg form still resolves the correct
 *  per-request runtime config via Nitro's internal async-local-storage
 *  context, so nothing is lost. */
function sessionSecret(_event: H3Event): string {
  const runtimeConfig = useRuntimeConfig();
  return resolvePreviewSessionSecret(runtimeConfig.previewSessionSecret, runtimeConfig.sanityReadToken);
}

/**
 * Verifies the current request's session cookie. Stateless — see
 * `data/preview-auth-core.ts`'s file header. Used by
 * `server-preview/middleware/noindex.ts`'s strict auth gate and by
 * `/preview/refresh` directly.
 */
export function isAuthorized(event: H3Event): boolean {
  const raw = getCookie(event, PREVIEW_SESSION_COOKIE);
  return verifyPreviewSessionCookie(raw, sessionSecret(event));
}

/**
 * Grants a new session: mints a fresh `<expiry>.<hmac>` cookie value and
 * sets it as an httpOnly, Secure, SameSite=None, Partitioned cookie.
 * SameSite=None is required because the Sanity Studio's Presentation iframe
 * is cross-origin from this preview deployment — a Lax/Strict cookie would
 * never be sent on the iframed requests. `Partitioned` (CHIPS —
 * https://github.com/privacycg/CHIPS) is the newer, complementary
 * requirement found while fixing "routing to detail pages doesn't work in
 * the Presentation tab": SameSite=None alone still leaves this cookie
 * subject to third-party-cookie blocking (Safari ITP, Firefox ETP, Chrome's
 * phased rollout) for SUBRESOURCE requests (fetch/XHR) issued from
 * `composables/usePageContentSync.ts`'s client-side content-sync guard
 * while it's iframed — a fetch a stricter browser silently drops the cookie
 * from, 401s, and (before that fix) left the SPA navigation stranded on
 * stale content. `Partitioned` opts this cookie into CHIPS' per-top-level-
 * site partitioned storage, which CHIPS-aware browsers exempt from full
 * third-party blocking — it keeps working specifically for "this cookie,
 * scoped to the ONE Studio site currently embedding it," without asking for
 * broad cross-site cookie access. `usePageContentSync.ts`'s fetch-failure
 * fallback (a real document navigation, not subject to the same
 * subresource-specific restriction) is the other half of that fix — this
 * attribute closes the gap so the FAST, no-reload SPA path also keeps
 * working in CHIPS-supporting browsers, rather than always falling back.
 * Called ONLY from `/preview/enable` after `validatePreviewUrl()` confirms
 * the request carries a Studio-issued secret.
 */
export function grantSession(event: H3Event): void {
  const expiry = Date.now() + PREVIEW_SESSION_LIFETIME_MS;
  const value = buildPreviewSessionCookieValue(expiry, sessionSecret(event));
  setCookie(event, PREVIEW_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: Math.floor(PREVIEW_SESSION_LIFETIME_MS / 1000),
  });
  console.debug("[preview:auth] session granted");
}

/** Revokes the current session cookie. Called from `/preview/disable`. */
export function revokeSession(event: H3Event): void {
  deleteCookie(event, PREVIEW_SESSION_COOKIE, { path: "/" });
  console.debug("[preview:auth] session revoked");
}
