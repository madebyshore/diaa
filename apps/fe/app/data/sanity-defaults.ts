/**
 * data/sanity-defaults.ts — the ONE place the Sanity project/dataset/API
 * version fallback literals live.
 *
 * Two very different call sites need these same three defaults and must
 * never resolve them differently:
 *   - `nuxt.config.ts`'s `runtimeConfig.public` — read by `data/client.ts`
 *     via `useRuntimeConfig()` during SSR / the per-route prerender render
 *     pass (a live Nuxt app context exists there).
 *   - `nuxt.config.ts`'s `prerender:routes` hook (Phase 2) — runs in the
 *     Nuxt build/CLI process, BEFORE any Nuxt app/runtime-config context
 *     exists, so it reads `process.env` directly and builds an
 *     `ExplicitSanityConfig` (see `data/client.ts`) by hand.
 *
 * Both paths apply the exact same env vars with the exact same fallbacks —
 * duplicating the literals in two places would risk the build-time route
 * list and the runtime render pass silently targeting different Sanity
 * projects/datasets after an env var typo or partial rollout.
 */

export const SANITY_DEFAULT_PROJECT_ID = "0in4i1po";
export const SANITY_DEFAULT_DATASET = "production";
export const SANITY_DEFAULT_API_VERSION = "2023-10-10";
