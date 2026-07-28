/**
 * auth.ts — draft-access gate for the preview server.
 *
 * Two jobs:
 *   1. Turn a Studio-issued preview link (`/__preview/enable?sanity-preview-secret=…`)
 *      into a signed session cookie, by validating the secret against
 *      Sanity via `@sanity/preview-url-secret`'s `validatePreviewUrl()`.
 *   2. Verify that cookie on every subsequent request (`isAuthorized()`).
 *
 * The session is intentionally STATELESS — nothing is stored server-side —
 * because the eventual preview deployment target (Vercel Fluid compute) has
 * no shared memory between instances. The cookie value IS the proof: an
 * expiry timestamp plus an HMAC-SHA256 signature over that timestamp, keyed
 * by `PREVIEW_SESSION_SECRET` (or, if that's unset, a hash of
 * `SANITY_READ_TOKEN` — already required for drafts rendering, see
 * render.ts — so a working preview deployment never needs a second secret
 * configured just to gate sessions). Any instance holding the same secret
 * can verify any other instance's cookie without coordination.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@sanity/client";
import { validatePreviewUrl } from "@sanity/preview-url-secret";

/** Name of the session cookie set by `handleEnableRequest()` / read by `isAuthorized()`. */
const COOKIE_NAME = "__preview_session";

/** Session lifetime — matches the plan's "~8h" target for a client-editor sitting. */
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

/**
 * Resolve the HMAC signing key. Prefers an explicit `PREVIEW_SESSION_SECRET`;
 * falls back to a SHA-256 hash of `SANITY_READ_TOKEN` so a preview
 * deployment that already has a read token configured needs no additional
 * env var to get session gating working.
 */
function sessionSecret(): string {
  const explicit = process.env.PREVIEW_SESSION_SECRET;
  if (explicit) return explicit;
  return createHash("sha256").update(process.env.SANITY_READ_TOKEN ?? "").digest("hex");
}

/** HMAC-SHA256 of the expiry timestamp — the entire "state" the cookie needs to prove. */
function sign(expiry: number): string {
  return createHmac("sha256", sessionSecret()).update(String(expiry)).digest("hex");
}

/** Builds the cookie value: `<expiryEpochMs>.<hmacHex>`. */
function buildCookieValue(expiry: number): string {
  return `${expiry}.${sign(expiry)}`;
}

/** Parses a raw `Cookie` request header into a plain name→value map. */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const rawValue = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
  }
  return out;
}

/**
 * Verifies the session cookie from a raw `Cookie` request header. Stateless
 * — recomputes the HMAC over the embedded expiry and compares it in
 * constant time via `timingSafeEqual`. Every failure mode (missing cookie,
 * malformed value, expired timestamp, signature mismatch) collapses to
 * `false` so callers never need to distinguish why a request is rejected.
 *
 * @param cookieHeader - The raw `Cookie` header value from the request, if any.
 */
export function isAuthorized(cookieHeader: string | undefined): boolean {
  const raw = parseCookieHeader(cookieHeader)[COOKIE_NAME];
  if (!raw) return false;

  const dot = raw.indexOf(".");
  if (dot === -1) return false;

  const expiry = Number(raw.slice(0, dot));
  const signature = raw.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = Buffer.from(sign(expiry));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Result of `handleEnableRequest()` — framework-agnostic so `handler.ts` can
 *  map it onto whatever host response shape (node:http, a Vercel function)
 *  is serving it. */
export interface EnableRequestResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Resolves the Sanity project/dataset the preview client should read from.
 * Prefers env vars (the preview deployment's own configuration surface);
 * falls back to `apps/fe/project.config.ts` — the same fallback order
 * `sanity-content.ts` uses — via a dynamic import so a misconfigured or
 * missing config file never crashes module load, only this one request.
 */
async function resolveProjectConfig(): Promise<{
  projectId: string | undefined;
  dataset: string | undefined;
}> {
  let cfgProjectId: string | undefined;
  let cfgDataset: string | undefined;
  try {
    const cfgMod = (await import("../../project.config.js")) as {
      default?: { sanity?: { projectId?: string; dataset?: string } };
    };
    cfgProjectId = cfgMod.default?.sanity?.projectId;
    cfgDataset = cfgMod.default?.sanity?.dataset;
  } catch {
    // No project config on disk — env vars are the only source, handled below.
  }
  return {
    projectId: process.env.SANITY_PROJECT_ID || cfgProjectId,
    dataset: process.env.SANITY_DATASET || cfgDataset,
  };
}

/**
 * Handles `GET /__preview/enable?sanity-preview-secret=…` — the link a
 * Studio editor's Presentation tool opens to grant this browser draft
 * access. Validates the secret against Sanity via
 * `@sanity/preview-url-secret`'s `validatePreviewUrl()`, and on success sets
 * the stateless session cookie and redirects to the path the Studio asked
 * to preview.
 *
 * @param requestUrl - The request's path + query string (or a full URL —
 *   `validatePreviewUrl()` parses it against an internal placeholder origin,
 *   so only the search params actually matter).
 */
export async function handleEnableRequest(requestUrl: string): Promise<EnableRequestResult> {
  const { projectId, dataset } = await resolveProjectConfig();
  const token = process.env.SANITY_READ_TOKEN;

  if (!projectId || !dataset || !token) {
    console.debug("[preview:auth] enable request rejected — Sanity client not configured");
    return {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Preview server misconfigured: SANITY_READ_TOKEN (and project id / dataset) are required.",
    };
  }

  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: process.env.SANITY_API_VERSION || "2023-10-10",
    useCdn: false,
    perspective: "drafts",
  });

  const result = await validatePreviewUrl(client, requestUrl);
  if (!result.isValid) {
    console.debug("[preview:auth] invalid or expired preview secret");
    return {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Invalid or expired preview link.",
    };
  }

  const expiry = Date.now() + SESSION_LIFETIME_MS;
  const cookie = [
    `${COOKIE_NAME}=${buildCookieValue(expiry)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
  ].join("; ");

  const redirectTo = result.redirectTo || "/";
  console.debug("[preview:auth] session granted — redirecting to", redirectTo);

  return {
    status: 302,
    headers: { "Set-Cookie": cookie, Location: redirectTo },
    body: "",
  };
}
