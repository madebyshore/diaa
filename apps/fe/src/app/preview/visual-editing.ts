/**
 * visual-editing.ts — bridges Sanity's Presentation tool to the SPA's own
 * router and cache instead of letting Presentation force a full iframe
 * reload on every navigation and every draft save.
 *
 * Only active in the preview deployment, gated on `window.__PREVIEW__`
 * (stamped by `injectPreviewHtml()` — see
 * apps/fe/scripts/preview/inject.ts). The production bundle never even
 * requests `@sanity/visual-editing` over the network: the dynamic import
 * below only executes once the gate passes, so bundlers keep it in its own
 * lazy chunk that a prod page load never references.
 */

import { reloadPkgFromNetwork } from "@app/cache";
import { App } from "@app/context";
import { onNavigationCommitted } from "@app/controller";
import { PageManager } from "@app/page-manager";
import { hydrateFromCache, normalize, setInitialRoute } from "@app/utils";

/**
 * Enables Sanity's Visual Editing overlays when this page is served by the
 * preview deployment. A no-op everywhere else (production, local dev
 * without the preview flag) — always safe to call unconditionally from
 * boot. Never throws: every failure path is caught and logged so a preview
 * wiring problem can't take down the rest of the app.
 */
export async function maybeEnableVisualEditing(): Promise<void> {
  if (typeof window === "undefined" || !window.__PREVIEW__) return;

  console.debug("[visual-editing] preview flag detected — enabling overlays");

  try {
    const { enableVisualEditing } = await import("@sanity/visual-editing");

    enableVisualEditing({
      history: {
        update: (update) => {
          // "push"/"replace" are both regular forward navigations from the
          // SPA's perspective. Ctrl.navigate()'s existing App.mutating guard
          // silently drops a call that arrives mid-transition, which is
          // exactly the behavior we want here too — fire and forget.
          if (update.type === "pop") {
            history.back();
            return;
          }
          void App.ctrl?.navigate(update.url);
        },
        subscribe: (navigate) => {
          // Presentation's URL bar has to track BOTH native back/forward
          // (popstate) and in-iframe link clicks that go through the SPA's
          // own Ctrl.navigate() — which calls pushState directly and never
          // fires popstate. onNavigationCommitted (controller/index.ts) is
          // the generic post-pushState hook that covers the second case.
          const onPopState = (): void => {
            navigate({ type: "push", url: location.pathname });
          };
          window.addEventListener("popstate", onPopState);

          const unsubscribeCtrl = onNavigationCommitted((url) => {
            navigate({ type: "push", url });
          });

          return () => {
            window.removeEventListener("popstate", onPopState);
            unsubscribeCtrl();
          };
        },
      },
      refresh: async () => {
        await refreshDraftContent();
      },
    });

    console.debug("[visual-editing] enabled");
  } catch (err) {
    console.error("[visual-editing] failed to enable:", err);
  }
}

/**
 * Runs the refresh-on-save loop Presentation triggers after a draft
 * mutation: bust the server's memoized drafts render, pull the fresh boot
 * manifest over the network (`reloadPkgFromNetwork` — always bypasses the
 * inline `__TMHGNE__` payload `loadPkg()` prefers on first boot, since that
 * payload is now stale by definition), and rehydrate the current route in
 * place.
 *
 * Reuses `PageManager.afterIn()` — the exact `init()` + `in()` sequence a
 * normal SPA navigation runs — so the freshly-hydrated page never gets stuck
 * at the `opacity: 0` state `BasePage.init()` sets before its entrance
 * animation would otherwise reveal it.
 */
async function refreshDraftContent(): Promise<void> {
  if (App.mutating) {
    // A real navigation is already in flight — rehydrating the DOM out from
    // under it would be worse than skipping this tick. Presentation re-fires
    // refresh on the next save if this one goes stale.
    console.debug("[preview:refresh] skipped — navigation in progress");
    return;
  }

  console.debug("[preview:refresh] requesting drafts refresh…");
  const res = await fetch("/__preview/refresh", { method: "POST" });
  if (!res.ok) {
    throw new Error(`[preview:refresh] refresh endpoint returned ${res.status}`);
  }
  const { generatedAt } = (await res.json()) as { generatedAt: number };

  await reloadPkgFromNetwork(generatedAt);

  const url = normalize(location.pathname);
  setInitialRoute(url);
  hydrateFromCache(url);
  // Force initCurrentPage() to re-resolve the container from the fresh DOM
  // hydrateFromCache() just inserted, rather than reusing a now-detached node.
  App.container = null;
  await PageManager.afterIn();

  console.debug(`[preview:refresh] rehydrated ${url} at ${generatedAt}`);
}
