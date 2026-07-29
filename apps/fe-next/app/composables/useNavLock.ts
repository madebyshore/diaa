/**
 * composables/useNavLock.ts — ports diaa's `App.mutating` transition lock +
 * 8-second safety valve (apps/fe/src/app/controller/index.ts `Ctrl.navigate`)
 * to Vue Router.
 *
 * CORRECTED design (see anim-plan.md §5.3): `router.beforeEach` calls
 * `lock()` (blocks concurrent navigation, stops Lenis, starts the 8s safety
 * timer) — but the unlock must NOT happen from `router.afterEach`, because
 * that fires as soon as the ROUTE resolves, not when the transition
 * animation finishes. `unlock()` is instead called explicitly from
 * `transitions/default.ts`'s onAfterEnter — the transition's true
 * completion point, mirroring diaa's `Ctrl._in()` finally-block reset.
 */
const SAFETY_TIMEOUT_MS = 8000;

// Plain module-scope ref, NOT useState — this flag is a pure client-runtime
// concern (SPA nav locking never happens during SSR/prerender) and has no
// business in the SSR payload. useState() ties its FIRST call to whichever
// request context happened to be active at that moment (module state is a
// process-lifetime singleton, but useState's underlying storage is keyed off
// the active Nuxt app instance) — calling it at true module scope crashes
// prerendering with "nuxt instance unavailable" (E1001) the moment this
// module is imported outside of an active request (e.g. via a client-only
// composable chain evaluated during the server build graph). A plain ref()
// needs no such context and is exactly as shareable across this module's
// other functions.
const mutating = ref(false);
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let beforeEachRegistered = false;

/** Block concurrent navigation, stop Lenis for the whole mutation window
 *  (not just the entrance — matches diaa's whole-nav scroller.pause()), and
 *  arm the 8s safety valve. Idempotent: calling lock() while already locked
 *  is a no-op (the beforeEach guard below prevents that path anyway). */
export function lockNav(): void {
  if (mutating.value) return;
  mutating.value = true;
  const { $lenis } = useNuxtApp();
  $lenis?.stop();

  safetyTimer = setTimeout(() => {
    if (mutating.value) {
      console.warn("[nav-lock] navigation timeout — force-resetting lock");
      mutating.value = false;
      $lenis?.start();
    }
  }, SAFETY_TIMEOUT_MS);
}

/** Release the lock, clear the safety timer, and resume Lenis. Called from
 *  transitions/default.ts's onAfterEnter — the transition's real completion
 *  point (NOT router.afterEach, which fires too early — see file header). */
export function unlockNav(): void {
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  mutating.value = false;
  const { $lenis } = useNuxtApp();
  $lenis?.start();
  console.debug("[nav-lock] unlocked");
}

/**
 * Composable entry point — call once (from app.vue) to wire the
 * router.beforeEach guard. Registration is idempotent (module-level flag)
 * so calling this more than once is harmless. Returns the reactive
 * `mutating` flag for components that need to read lock state.
 */
export function useNavLock() {
  const router = useRouter();

  if (!beforeEachRegistered) {
    beforeEachRegistered = true;
    router.beforeEach((to, from) => {
      if (mutating.value) {
        console.warn("[nav-lock] navigation blocked — already mutating", to.fullPath);
        return false;
      }
      console.debug("[nav-lock] locking for nav", from.fullPath, "→", to.fullPath);
      lockNav();
      return true;
    });
  }

  return { mutating };
}
