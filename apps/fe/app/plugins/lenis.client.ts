/**
 * plugins/lenis.client.ts — Lenis smooth-scroll instance, ticked by kido's
 * Raf hub, replacing diaa's kido NativeScroller (apps/fe/src/app/index.ts
 * boot phase 3). Provides `$lenis` (null on mobile) to the whole app.
 */
import { Sniff } from "kido/utils";
import { Raf } from "kido/raf";
import Lenis from "lenis";

export default defineNuxtPlugin((nuxtApp) => {
  // Disable browser scroll restoration before any route change so back/
  // forward navigation never fights our own restore logic (lib/scroll-restore.ts)
  // — same as diaa boot phase 2 (`history.scrollRestoration = "manual"`).
  if (typeof history !== "undefined") history.scrollRestoration = "manual";

  if (Sniff.isMobile) {
    // Diaa's own mobile behavior, verified against native-scroller.ts: touch
    // input does NOT go through the damping path at all — onTouchMove only
    // intercepts when `syncTouch` is true, which NativeScroller never sets
    // (defaults false, never overridden by app/index.ts's construction call).
    // Mobile scrolling in diaa is really just the BROWSER's native momentum
    // scroll, with NativeScroller passively mirroring position via the
    // native "scroll" event for onScroll subscribers (bottom-dwell, mobile
    // reveal) — it does not damp or drive touch scroll itself. So Lenis-null
    // + plain native scrolling on mobile is a FAITHFUL match, not a
    // compromise — confirmed by reading native-scroller.ts's onTouchMove/
    // onWheel split, not assumed.
    console.debug("[lenis] mobile detected — native scroll only, $lenis = null");
    nuxtApp.provide("lenis", null);
    return;
  }

  // NOTE on damping value: kido's NativeScroller class DEFAULT is 0.09
  // (native-scroller.ts `this._damping = config.damping ?? 0.09`), but
  // diaa's actual boot call (apps/fe/src/app/index.ts) constructs it with
  // `damping: 0.1` explicitly — the REAL shipped desktop feel is 0.1, not
  // 0.09. Use 0.1 here for true parity.
  const lenis = markRaw(
    new Lenis({ autoRaf: false, lerp: 0.1 }),
  );

  const scroller = new Raf("scroller", (elapsed: number) => lenis.raf(elapsed));
  scroller.run();

  console.debug("[lenis] desktop Lenis instance created, lerp=0.1, ticked via kido Raf");
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
