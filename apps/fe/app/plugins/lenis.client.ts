/**
 * plugins/lenis.client.ts — Lenis smooth-scroll instance, ticked by kido's
 * Raf hub, replacing diaa's kido NativeScroller (apps/fe/src/app/index.ts
 * boot phase 3). Provides `$lenis` to the whole app, on desktop AND mobile.
 *
 * MOBILE TOUCH IS NATIVE AGAIN (the syncTouch + touchMultiplier experiment
 * is reverted): without `syncTouch`, Lenis ignores touchmove entirely and
 * the browser's own momentum/rubber-band scrolling drives the page — 1:1
 * finger travel, no speed multiplier, the original diaa feel. The instance
 * is still created on mobile (NOT reverted to the old `$lenis = null`)
 * because it costs nothing — Lenis passively mirrors native scroll via its
 * own scroll listener and emits `scroll` events for subscribers — and two
 * consumers depend on it existing:
 *   - lib/scroll-restore.ts snapshots `lenis.scroll` and restores via
 *     `lenis.scrollTo(..., {immediate: true})`, which is what makes the
 *     Close-as-back home-scroll restore on mobile/tablet work
 *     (transitions/default.ts's slug→home direction upgrade).
 *   - composables/useLenisScroll.ts subscribes controllers' onScroll through
 *     `$lenis.on("scroll")` — native scrolls are re-emitted by Lenis, so the
 *     mobile scroll-driven home reveal keeps ticking.
 * Trade-off of dropping syncTouch: `$lenis?.stop()/start()` (nav lock, boot)
 * no longer freezes mobile touch scrolling during transitions/the intro —
 * native scroll can't be stopped without intercepting touch. That is the
 * original pre-syncTouch behaviour, shipped and accepted.
 */
import { Sniff } from "kido/utils";
import { Raf } from "kido/raf";
import Lenis from "lenis";

export default defineNuxtPlugin((nuxtApp) => {
  // Disable browser scroll restoration before any route change so back/
  // forward navigation never fights our own restore logic (lib/scroll-restore.ts)
  // — same as diaa boot phase 2 (`history.scrollRestoration = "manual"`).
  if (typeof history !== "undefined") history.scrollRestoration = "manual";

  // NOTE on damping value: kido's NativeScroller class DEFAULT is 0.09
  // (native-scroller.ts `this._damping = config.damping ?? 0.09`), but
  // diaa's actual boot call (apps/fe/src/app/index.ts) constructs it with
  // `damping: 0.1` explicitly — the REAL shipped desktop feel is 0.1, not
  // 0.09. Use 0.1 here for true parity. On mobile this lerp only touches the
  // rare wheel/trackpad input; touch never enters Lenis (no syncTouch).
  const lenis = markRaw(new Lenis({ autoRaf: false, lerp: 0.1 }));

  const scroller = new Raf("scroller", (elapsed: number) => lenis.raf(elapsed));
  scroller.run();

  console.debug(
    Sniff.isMobile
      ? "[lenis] mobile Lenis instance created (passive mirror — native touch scroll, no syncTouch)"
      : "[lenis] desktop Lenis instance created, lerp=0.1, ticked via kido Raf",
  );
  nuxtApp.provide("lenis", lenis);
});

declare module "#app" {
  interface NuxtApp {
    $lenis: Lenis | null;
  }
}
declare module "vue" {
  interface ComponentCustomProperties {
    $lenis: Lenis | null;
  }
}
