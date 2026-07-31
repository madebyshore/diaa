/**
 * plugins/lenis.client.ts — Lenis smooth-scroll instance, ticked by kido's
 * Raf hub, replacing diaa's kido NativeScroller (apps/fe/src/app/index.ts
 * boot phase 3). Provides `$lenis` to the whole app — on DESKTOP and, since
 * the syncTouch change, on MOBILE too.
 *
 * MOBILE NOW RUNS LENIS (a deliberate departure from the original diaa
 * behavior, which left mobile on pure native momentum scroll): `syncTouch`
 * makes Lenis intercept touchmove and drive the scroll itself, which is the
 * only way a speed multiplier can exist on touch — native scrolling has no
 * speed knob. `MOBILE_TOUCH_MULTIPLIER` scales finger travel; raise/lower it
 * to taste. Trade-off accepted: the platform's native momentum/rubber-band
 * feel is replaced by Lenis's synthetic touch inertia.
 *
 * Ripple effects of `$lenis` being non-null on mobile (all verified against
 * the consumers, all desirable):
 *   - useNavLock/useBoot's `$lenis?.stop()/start()` now actually freeze
 *     mobile scrolling during transitions and the intro (previously native
 *     scroll stayed live underneath).
 *   - lib/scroll-restore.ts now snapshots + restores mobile scroll on
 *     back-nav exactly like desktop (its window.scrollTo(0,0) mobile-reset
 *     branch and useLenisScroll's native-scroll fallback become dormant —
 *     kept as fallbacks should mobile Lenis ever be disabled again).
 *   - controllers/home.ts's filter-switch mobile top-reset uses native
 *     `window.scrollTo`, which Lenis observes via its own native scroll
 *     listener and re-syncs from — still correct under syncTouch.
 */
import { Sniff } from "kido/utils";
import { Raf } from "kido/raf";
import Lenis from "lenis";

/**
 * Touch scroll speed multiplier for the syncTouch path — 1 is finger-exact,
 * >1 scrolls further than the finger travels. Applied on mobile only (the
 * desktop instance never sets syncTouch, so wheel behavior is untouched).
 */
const MOBILE_TOUCH_MULTIPLIER = 1.5;

export default defineNuxtPlugin((nuxtApp) => {
  // Disable browser scroll restoration before any route change so back/
  // forward navigation never fights our own restore logic (lib/scroll-restore.ts)
  // — same as diaa boot phase 2 (`history.scrollRestoration = "manual"`).
  if (typeof history !== "undefined") history.scrollRestoration = "manual";

  // NOTE on damping value: kido's NativeScroller class DEFAULT is 0.09
  // (native-scroller.ts `this._damping = config.damping ?? 0.09`), but
  // diaa's actual boot call (apps/fe/src/app/index.ts) constructs it with
  // `damping: 0.1` explicitly — the REAL shipped desktop feel is 0.1, not
  // 0.09. Use 0.1 here for true parity. Mobile keeps the same lerp for the
  // rare wheel/trackpad input; touch goes through syncTouch's own
  // `syncTouchLerp` catch-up (Lenis default), not this lerp.
  const lenis = markRaw(
    new Lenis(
      Sniff.isMobile
        ? {
            autoRaf: false,
            lerp: 0.1,
            syncTouch: true,
            touchMultiplier: MOBILE_TOUCH_MULTIPLIER,
          }
        : { autoRaf: false, lerp: 0.1 },
    ),
  );

  const scroller = new Raf("scroller", (elapsed: number) => lenis.raf(elapsed));
  scroller.run();

  console.debug(
    Sniff.isMobile
      ? `[lenis] mobile Lenis instance created, syncTouch on, touchMultiplier=${MOBILE_TOUCH_MULTIPLIER}`
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
