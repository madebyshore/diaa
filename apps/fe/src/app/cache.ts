import {
  App,
  type RouteCacheEntry,
} from "@app/context";

export interface PkgPayload {
  routes?: Record<string, string>;
  cache?: Record<string, RouteCacheEntry>;
}

const AK_URL = "/tmhgne.json";

export async function loadPkg(): Promise<PkgPayload> {
  let pkg: PkgPayload | null = null;

  const inlineScript = document.getElementById("__TMHGNE__");
  if (inlineScript?.textContent) {
    try {
      pkg = JSON.parse(inlineScript.textContent) as PkgPayload;
    } catch {}
  }

  if (!pkg) {
    const response = await fetch(AK_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("tmhgne.json not found; run build/dev once.");
    }
    pkg = (await response.json()) as PkgPayload;
  }

  App.config.routes = (pkg.routes || Object.create(null)) as Record<
    string,
    string
  >;
  App.cache = (pkg.cache || Object.create(null)) as Record<
    string,
    RouteCacheEntry
  >;
  return pkg;
}

export function getFromCache(url: string): RouteCacheEntry | null {
  const normalized = url !== "/" ? url.replace(/\/$/, "") : "/";
  return App.cache[normalized] || null;
}

/**
 * Re-fetches tmhgne.json over the network and replaces `App.config.routes` /
 * `App.cache` with the result — bypassing the inline `#__TMHGNE__` payload
 * `loadPkg()` prefers on first boot, which is exactly the point: this is
 * used by the preview runtime's refresh-on-save loop
 * (`src/app/preview/visual-editing.ts`), which always wants whatever the
 * server just re-rendered, never the stale payload baked into the page at
 * initial load.
 *
 * Kept here (rather than duplicating fetch+assign in the preview module) so
 * tmhgne.json payload parsing has exactly one implementation.
 *
 * @param fresh - Epoch-ms timestamp to pass as `?fresh=`, forcing the server
 *   to skip a memo older than this (see the preview server's staleness
 *   guard) — pass the `generatedAt` a `/__preview/refresh` call just
 *   returned so this fetch can never land on a pre-refresh memo, even on a
 *   different warm server instance.
 */
export async function reloadPkgFromNetwork(fresh?: number): Promise<PkgPayload> {
  const url = fresh != null ? `${AK_URL}?fresh=${fresh}` : AK_URL;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`[cache] failed to reload ${url}: ${response.status}`);
  }
  const pkg = (await response.json()) as PkgPayload;

  App.config.routes = (pkg.routes || Object.create(null)) as Record<
    string,
    string
  >;
  App.cache = (pkg.cache || Object.create(null)) as Record<
    string,
    RouteCacheEntry
  >;
  return pkg;
}
