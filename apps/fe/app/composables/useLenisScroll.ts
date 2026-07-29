import type { ScrollEvent } from "~/controllers/page-controller";

/**
 * composables/useLenisScroll.ts — subscribe to $lenis scroll events (or a
 * native-scroll fallback on mobile, where $lenis is null), auto-cleaned-up
 * on unmount. Bridges to the PageController.onScroll shape ({current,
 * target, max}) every controller expects.
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
    // Mobile: no Lenis — bridge native scroll directly (matching how
    // NativeScroller mirrors native scroll for onScroll subscribers there).
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
