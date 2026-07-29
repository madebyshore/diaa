/**
 * data/client.ts — Sanity read-client factory.
 *
 * SERVER-ONLY. This module pulls in `@sanity/client` and (on the drafts
 * path) carries the read token, so it must NEVER be imported from
 * client-only code — reach it only through `content.ts`, which is itself
 * only ever called from `.server.ts` plugins / server routes. A stray
 * client-side import of this file (or of `content.ts`) would leak
 * `@sanity/client` and the read token into the browser bundle.
 *
 * Two perspectives, two very different trust levels:
 *   - "published" — the prod/`nuxt generate` path. CDN-backed, anonymous,
 *     published content only. `stega: false` is HARDCODED here (not read
 *     from config) because stega-encoding published output would leak
 *     Studio edit-intent metadata into the public site's HTML/JSON — there
 *     is no config flag that can turn this back on for the published
 *     perspective, by design.
 *   - "drafts" — the Phase 6 SSR preview path. Bypasses the CDN (drafts are
 *     never CDN-cached), requires a viewer-scoped read token, and is where
 *     stega encoding actually happens — see the `stega` param below.
 */
import { createClient, type SanityClient, type StegaConfig } from "@sanity/client";

/** Which content pipeline a request/build is fetching through. */
export type SanityPerspective = "published" | "drafts";

// Memoized per perspective — each is a distinct client (different useCdn/
// token/stega config), so a single module-scope client would be wrong.
const clients: Partial<Record<SanityPerspective, SanityClient>> = {};

/**
 * Returns a memoized Sanity read client for the given perspective, built
 * from `useRuntimeConfig()`. Must be called within Nuxt context (a
 * `.server.ts` plugin, a server route, or `useAsyncData`'s handler) because
 * it reads runtime config.
 *
 * `stega` is accepted but unused today — Phase 6 will pass
 * `buildPreviewStega(studioUrl)` here for the "drafts" perspective so
 * overlay metadata gets encoded into string fields. It defaults to
 * `undefined` (no stega) for both perspectives until then. Passing it for
 * "published" is intentionally a no-op: see the hardcoded `stega: false`
 * below.
 */
export function getSanityClient(
  perspective: SanityPerspective,
  stega?: StegaConfig,
): SanityClient {
  const existing = clients[perspective];
  if (existing) return existing;

  const config = useRuntimeConfig();
  const projectId = config.public.sanityProjectId;
  const dataset = config.public.sanityDataset;
  const apiVersion = config.public.sanityApiVersion;

  if (!projectId || !dataset) {
    throw new Error(
      "[data/client] missing Sanity projectId/dataset — set SANITY_PROJECT_ID and SANITY_DATASET",
    );
  }

  let client: SanityClient;

  if (perspective === "published") {
    client = createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn: true,
      stega: false,
    });
  } else {
    const token = config.sanityReadToken;
    if (!token) {
      throw new Error(
        "[data/client] drafts perspective requires SANITY_READ_TOKEN — set it (a Viewer-scoped token) before requesting drafts content. Unset NUXT_PUBLIC_PREVIEW_ENABLED (or don't request the drafts perspective) if you don't need preview.",
      );
    }
    client = createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn: false,
      token,
      perspective: "drafts",
      // Phase 6 hookup: pass `stega` (built from SANITY_STUDIO_URL via
      // buildPreviewStega()) here so drafts responses carry overlay
      // metadata. Left undefined until then.
      stega,
    });
  }

  clients[perspective] = client;
  console.debug(`[data] sanity client created — perspective=${perspective}, useCdn=${perspective === "published"}`);
  return client;
}
