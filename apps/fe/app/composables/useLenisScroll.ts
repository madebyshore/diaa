import type { ScrollEvent } from "~/controllers/page-controller";

/**
 * composables/useLenisScroll.ts — subscribe to $lenis scroll events,
 * auto-cleaned-up on unmount. Bridges to the PageController.onScroll shape
 * ({current, target, max}) every controller expects.
 *
 * Mobile runs Lenis too — as a passive mirror of native touch scroll, no
 * syncTouch (plugins/lenis.client.ts): Lenis re-emits native scrolls as its
 * own "scroll" events, so the $lenis branch is the live path everywhere; the
 * native-scroll fallback below is dormant, kept for the case where mobile
 * Lenis is ever disabled again.
 *
 * NOT auto-subscribed on mount — transitions/default.ts's onAfterEnter calls
 * `subscribeOnScroll(controller)` (a plain function export below) explicitly,
 * mirroring diaa's PageManager.animateCurrentPageIn ("subscribe only after
 * resume, so onScroll never fires mid-entrance"). The composable form here
 * is a convenience for callers that want reactive-lifecycle auto-cleanup
 * (e.g. a component wanting supplementary scroll behavior); the page-
 * controller wiring itself uses the plain functions.
 */
let currentUnsub: (() => void) | null = null;

/** Subscribe `cb` to scroll events for the CURRENT page only — replaces any
 *  previous subscription (there is only ever one active page's onScroll at
 *  a time). Returns an unsubscribe function; also stored internally so
 *  `unsubscribeOnScroll()` can be called without holding the reference. */
export function subscribeOnScroll(cb: (e: ScrollEvent) => void): () => void {
  unsubscribeOnScroll();

  const { $lenis } = useNuxtApp();
  let off: () => void;

  if ($lenis) {
    const handler = (e: { scroll: number; targetScroll?: number; limit: number }) => {
      cb({ current: e.scroll, target: e.targetScroll ?? e.scroll, max: e.limit });
    };
    $lenis.on("scroll", handler);
    off = () => $lenis.off("scroll", handler);
  } else {
    // Dormant fallback (mobile now runs Lenis — see the header note): bridge
    // native scroll directly, matching how NativeScroller mirrored native
    // scroll for onScroll subscribers in the original diaa mobile build.
    const onScroll = () => {
      cb({
        current: window.scrollY,
        target: window.scrollY,
        max: document.documentElement.scrollHeight - window.innerHeight,
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    off = () => window.removeEventListener("scroll", onScroll);
  }

  currentUnsub = off;
  return off;
}

/** Unsubscribe the current page's onScroll (if any). Safe to call when
 *  nothing is subscribed. */
export function unsubscribeOnScroll(): void {
  currentUnsub?.();
  currentUnsub = null;
}

/**
 * Composable form — auto-subscribes on mount, auto-unsubscribes on unmount.
 * Provided for components (not page-controllers) that want scroll data with
 * standard Vue lifecycle cleanup.
 */
export function useLenisScroll(cb: (e: ScrollEvent) => void): void {
  let off: (() => void) | null = null;
  onMounted(() => {
    off = subscribeOnScroll(cb);
  });
  onUnmounted(() => {
    off?.();
  });
}
