/**
 * data/preview-auth-core.ts — pure, framework-agnostic session-cookie
 * crypto for Phase 6 preview auth. NO h3 import here (no `getCookie`,
 * `setCookie`, `H3Event`, ...) — that's the entire reason this file exists
 * separately from `server-preview/utils/preview-auth.ts`.
 *
 * Two very different callers need the exact same sign/verify logic:
 *   - `server-preview/utils/preview-auth.ts` — the real H3/Nitro wrapper
 *     used by `/preview/enable|disable|refresh` and the noindex/auth-gate
 *     middleware. Lives under `server-preview/`, which `nuxt.config.ts`
 *     structurally excludes from the module graph unless
 *     `NUXT_PUBLIC_PREVIEW_ENABLED=true` (see that file's `nitro.scanDirs`
 *     comment) — it is NEVER present in a prod build.
 *   - `app/plugins/content.server.ts` — a NORMAL, always-present Nuxt
 *     plugin (prod builds need it too, for the published-content path). It
 *     must decide per-request whether the incoming session cookie is valid
 *     so it can pick "drafts"+stega vs "published" — but it can NEVER
 *     import anything from `server-preview/`, or a prod build's module
 *     graph would pull in preview-only code by construction, defeating the
 *     whole point of the scanDirs gate.
 *
 * Putting the pure crypto here (imported by BOTH, in one direction only —
 * `server-preview/` may depend on `app/data/`, never the reverse) resolves
 * that: `content.server.ts` gets real verify logic without ever touching
 * `server-preview/`, and the H3-specific plumbing (reading the actual
 * `Cookie` header, setting/deleting it) stays out of this file so it has no
 * runtime dependency on being inside a Nitro request at all — trivially
 * unit-testable and safely importable from anywhere server-side.
 *
 * Session design is STATELESS, ported from the proven `preview`-branch
 * implementation (`apps/fe/scripts/preview/auth.ts` as of commit
 * `dcbf37c`) — nothing is stored server-side. The cookie value IS the
 * proof: an expiry timestamp plus an HMAC-SHA256 signature over that
 * timestamp, keyed by a secret only the server(s) know. Any instance
 * holding the same secret can verify any other instance's cookie without
 * coordination — required for a serverless/edge deploy target with no
 * shared memory between invocations.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Name of the session cookie set by the `/preview/enable` route / read by
 *  every gated request thereafter. */
export const PREVIEW_SESSION_COOKIE = "__preview_session";

/** Session lifetime — ~8h covers a client-editor's working session. */
export const PREVIEW_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

/**
 * Resolves the HMAC signing key. Prefers an explicit `PREVIEW_SESSION_SECRET`
 * (`previewSessionSecret` in `nuxt.config.ts`'s server-only runtimeConfig);
 * falls back to a SHA-256 hash of the Sanity read token so a preview
 * deployment that already has drafts access configured needs no additional
 * env var just to get session gating working. Takes both values in
 * explicitly (never reads `process.env`/`useRuntimeConfig()` itself) so this
 * stays a pure function usable from either caller described in the file
 * header, each of which has its own way of reaching runtime config.
 */
export function resolvePreviewSessionSecret(
  explicitSecret: string | undefined,
  sanityReadToken: string | undefined,
): string {
  if (explicitSecret) return explicitSecret;
  return createHash("sha256").update(sanityReadToken ?? "").digest("hex");
}

/** HMAC-SHA256 of the expiry timestamp — the entire "state" the cookie needs
 *  to prove, given the caller already knows `secret`. */
function sign(expiry: number, secret: string): string {
  return createHmac("sha256", secret).update(String(expiry)).digest("hex");
}

/** Builds the cookie value: `<expiryEpochMs>.<hmacHex>`. */
export function buildPreviewSessionCookieValue(expiry: number, secret: string): string {
  return `${expiry}.${sign(expiry, secret)}`;
}

/**
 * Extracts one named cookie's value from a raw `Cookie` request-header
 * string (e.g. `"a=1; __preview_session=123.abc; b=2"`). Deliberately NOT
 * using h3's own `getCookie(event, name)` helper here — see
 * `app/plugins/content.server.ts`'s file header for why: in this
 * toolchain, `.server.ts` Nuxt plugins are compiled through a different
 * build pipeline than Nitro's own server routes/utils, and neither an
 * explicit `import { getCookie } from "h3"` (resolves to an incompatible
 * h3 version there) nor the ambient auto-imported `getCookie` global
 * (isn't actually injected into that pipeline's output) works reliably
 * from a `.server.ts` plugin. Reading the raw header string and parsing it
 * by hand — a plain string operation, no h3 dependency of any kind — sidesteps
 * the whole cross-version problem. Returns `undefined` if the header is
 * absent or the named cookie isn't present.
 */
export function extractCookieValue(
  cookieHeader: string | undefined | null,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const rawValue = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return undefined;
}

/**
 * Verifies a raw session cookie VALUE (already extracted from the `Cookie`
 * header by the caller — this function never touches HTTP headers itself).
 * Stateless — recomputes the HMAC over the embedded expiry and compares it
 * in constant time via `timingSafeEqual`. Every failure mode (missing/empty
 * value, malformed shape, expired timestamp, signature mismatch, or even a
 * signature of the wrong length) collapses to `false` so callers never need
 * to distinguish why a request is rejected.
 */
export function verifyPreviewSessionCookie(
  raw: string | undefined | null,
  secret: string,
): boolean {
  if (!raw) return false;

  const dot = raw.indexOf(".");
  if (dot === -1) return false;

  const expiry = Number(raw.slice(0, dot));
  const signature = raw.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = Buffer.from(sign(expiry, secret));
  const actual = Buffer.from(signature);
  // Length check BEFORE timingSafeEqual — that function throws (rather than
  // returning false) when given buffers of different lengths, and a thrown
  // exception here would be an unhandled-rejection footgun for every caller.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
