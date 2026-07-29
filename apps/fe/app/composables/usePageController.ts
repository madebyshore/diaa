import type { PageController } from "~/controllers/page-controller";

/**
 * composables/usePageController.ts — route-path → controller registry,
 * mirroring tamahagane-nuxt's own usePageController.ts convention, WITH one
 * deliberate deviation (see the usePageController() doc comment below).
 */
const registry = new Map<string, PageController>();

/** The route fullPath that `transitions/default.ts`'s onBeforeEnter already
 *  called onInit for, synchronously, in the same tick it pinned the entering
 *  page hidden — BEFORE this composable's onMounted ever runs. Consumed
 *  exactly once by usePageController()'s onMounted guard below so onInit is
 *  never called twice for the same navigation. Exported as a plain ref (not
 *  useState) — it's a same-tab-only synchronous handoff, never needs SSR
 *  serialization. */
export const transitionInitPath = ref<string | null>(null);

export function registerPageController(path: string, controller: PageController): void {
  registry.set(path, controller);
}

export function getPageController(path: string): PageController | undefined {
  return registry.get(path);
}

export function unregisterPageController(path: string): void {
  registry.delete(path);
}

/**
 * Register `controller` for the CURRENT route, called once from a page
 * component's `<script setup>` (e.g. `usePageController(homeController)` in
 * pages/index.vue). Registration itself happens synchronously (not in
 * onMounted) so transitions/default.ts's onBeforeEnter — which runs before
 * this component's onMounted — can already find it via getPageController().
 *
 * DEVIATION from tamahagane-nuxt's own convention (documented in
 * plans — anim-plan.md §2): tamahagane-nuxt's PageController.onInit only
 * ever runs from this composable's onMounted, because their real content
 * lives in GPU planes, not DOM — ordering relative to Vue's mount doesn't
 * matter for them. Diaa's controllers are DOM-only and need onInit to run
 * BEFORE any paint of the entering page (scroll-restore prep, mode restore,
 * mobile-cover pre-measurement) — so for a transitioned SPA navigation,
 * `transitions/default.ts`'s onBeforeEnter calls `controller.onInit(root)`
 * directly, synchronously, in the same tick it pins the page hidden, and
 * sets `transitionInitPath.value` to the route's fullPath as a receipt. This
 * composable's onMounted becomes a call-once GUARD: if the receipt matches
 * the current route, onInit already ran — skip and clear it. If it doesn't
 * match (first page load: Vue transitions never fire enter on initial
 * mount, so no onBeforeEnter ever ran), this composable calls onInit itself
 * using the mounted component's root DOM element.
 */
export function usePageController(controller: PageController): void {
  const route = useRoute();
  registerPageController(route.fullPath, controller);

  onMounted(() => {
    if (transitionInitPath.value === route.fullPath) {
      console.debug("[page-controller] onInit already ran via transition for", route.fullPath);
      transitionInitPath.value = null;
      return;
    }
    const el = getCurrentInstance()?.proxy?.$el as HTMLElement | undefined;
    if (el instanceof HTMLElement) {
      console.debug("[page-controller] first-load onInit for", route.fullPath);
      controller.onInit(el);
      // Mirrors transitions/default.ts's onBeforeEnter, which adds this class
      // in the same synchronous tick it calls onInit for a transitioned nav
      // (see the FOUC rule on #page in styles/core/base.module.scss) — first
      // load never runs that transition hook, so this branch is the only
      // place that releases the CSS-default opacity:0 hide for the initial
      // page render.
      el.classList.add("is-controlled");
    } else {
      console.warn("[page-controller] could not resolve root element for", route.fullPath);
    }
  });

  onUnmounted(() => {
    controller.onDestroy();
    unregisterPageController(route.fullPath);
  });
}
