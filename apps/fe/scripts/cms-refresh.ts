/**
 * cms-refresh.ts — standalone Sanity refetch.
 *
 * Run via `pnpm run cms:refresh` from apps/fe/. Force-fetches case-study and
 * homePage content from Sanity and overwrites apps/fe/.cache/sanity-content.json.
 * Subsequent dev-server boots and `vite build` runs read from the cache file
 * and never hit the Sanity API until this script is run again.
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
