/**
 * cms-refresh.ts — standalone Sanity refetch.
 *
 * Run via `pnpm run cms:refresh` from apps/fe/. Fetches fresh content from
 * Sanity (siteOptions, pageHome, Details, Taxonomies, Contact, Imprint) via
 * `loadSanityContent()` and logs the resolved page count. There is no disk
 * cache — every dev-server boot and `vite build` run fetches Sanity live via
 * the routes plugin; this script exists as a quick standalone way to confirm
 * credentials work and see what the current content resolves to.
 */

import { refreshSanityCache } from "./sanity-content.js";

/**
 * CLI entry point — forces a single Sanity refetch and writes the disk cache.
 * Exits with code 1 on unexpected failure so CI can catch broken credentials.
 */
async function main(): Promise<void> {
  const started = Date.now();
  console.log("[cms:refresh] fetching Sanity content...");
  const { pages } = await refreshSanityCache();
  const ms = Date.now() - started;
  console.log(`[cms:refresh] done in ${ms}ms — ${pages.length} pages`);
}

main().catch((err) => {
  console.error("[cms:refresh] failed:", err);
  process.exit(1);
});
