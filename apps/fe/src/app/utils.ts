import { getFromCache } from "./cache";
import { App } from "./context";

export type NormalizedUrl = "/" | `/${string}`;

// Normalize url string
export function normalize(pathname: string): NormalizedUrl {
  if (pathname === "/") return "/";
  return (pathname.replace(/\/$/, "") || "/") as NormalizedUrl;
}

// Function to reset scroll position
export function resetScrollPosition(): void {
  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  } catch {
  }
}

// Sets initial route in App context
export function setInitialRoute(url: NormalizedUrl): void {
  const pageKey = App.config.routes[url] ?? null;
  App.route.new = { url, page: pageKey };

  if (pageKey) App.is[pageKey] = true;
}

// Hydrates the html for current route
export function hydrateFromCache(url: NormalizedUrl): void {
  const entry = getFromCache(url);
  if (!entry) return;

  const app = document.getElementById("app");
  if (entry.html && app) app.innerHTML = entry.html;
  if (entry.title) document.title = entry.title;
}

// Bootstrap function to set initial route,
// hydrate the cache,
// and initiate the app HTML
export async function bootstrap(url: string): Promise<void> {
  const currentUrl = normalize(url);
  setInitialRoute(currentUrl);
  hydrateFromCache(currentUrl);
  App.app = (document.getElementById("app") as HTMLElement | null) || null;
  App.container =
    (document.getElementById("page") as HTMLElement | null) || null;
}
