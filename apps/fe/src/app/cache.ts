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
