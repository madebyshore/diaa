/**
 * plugins/nav-direction.client.ts — tracks whether the CURRENT in-flight
 * navigation is a browser back/forward (popstate) or a normal forward click,
 * so `transitions/default.ts` can decide restore-scroll vs. reset-to-top
 * (see lib/scroll-restore.ts). Mirrors diaa's `App.target = "back"` set in
 * `installController()`'s popstate listener (apps/fe/src/app/controller/index.ts).
 *
 * Vue Router doesn't expose navigation direction natively, so this listens
 * to the raw `popstate` event directly: a one-shot flag set to "back" right
 * before the router reacts to it, defaulting to "forward" for every
 * programmatic/anchor-click navigation (pushState-based, no popstate fires).
 * `transitions/default.ts` reads and resets it once per navigation.
 */
import { navDirection } from "~/lib/scroll-restore";

export default defineNuxtPlugin(() => {
  window.addEventListener("popstate", () => {
    navDirection.value = "back";
    console.debug("[nav-direction] popstate — next nav is back");
  });
});
