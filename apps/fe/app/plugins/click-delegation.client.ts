/**
 * plugins/click-delegation.client.ts — global click delegation for internal
 * navigation, the missing half of diaa's `installController()` boot phase 2
 * (apps/fe/src/app/controller/index.ts). Phase 5a wired popstate direction
 * tracking (plugins/nav-direction.client.ts) and the nav-lock guard
 * (composables/useNavLock.ts), but nothing yet intercepts anchor clicks —
 * every internal `<a href>` in the ported markup (home text/image items, the
 * detail/contact/imprint `( Close )` footer, footer nav links) is a PLAIN
 * anchor, not `<NuxtLink>` (see pages/index.vue, pages/[slug].vue). Without
 * this plugin, clicking any of them triggers a full browser navigation and
 * Vue Router's `router.beforeEach`/`onBeforeLeave` never fire — which means
 * NONE of the SPA transition system runs, including Phase 5b's home→detail
 * bridge (transitions/home-to-detail.ts's bridgeOut() is dispatched from
 * `router.beforeEach`-driven state, unreachable without this).
 *
 * Found while wiring the bridge for THIS phase — the bridge is the whole
 * point of Phase 5b's build, and it is provably unreachable through a real
 * click without this fix, so it's included here as a required "5a
 * adjustment" rather than a follow-up. Fixed with a single delegated
 * listener (mirroring diaa's own `Ctrl`/`installController()` click
 * delegation model) rather than converting every ported `<a>` to
 * `<NuxtLink>` across every page — that would be broad, unscoped churn
 * against markup that intentionally mirrors the old Mustache templates
 * byte-for-byte (Phase 2's stated goal). Every ported page keeps its
 * plain-`<a>` markup unchanged; this is the only file that changes.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter();

  document.addEventListener("click", (e: MouseEvent) => {
    // Ignore already-handled clicks and anything but a plain left click.
    if (e.defaultPrevented || e.button !== 0) return;
    // Modified clicks (open in new tab/window, "save as", etc.) fall
    // through to native browser behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const anchor = (e.target as Element | null)?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    // Explicit new-tab/download targets and external origins are native
    // browser navigations, not SPA route changes.
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;
    if (anchor.origin !== window.location.origin) return;

    // A same-path hash link is an in-page anchor jump, not a route change —
    // let the browser handle native scroll-to-fragment.
    if (anchor.pathname === window.location.pathname && anchor.hash) return;

    e.preventDefault();
    console.debug("[click-delegation] intercepted →", anchor.pathname);
    void router.push(anchor.pathname + anchor.search + anchor.hash);
  });
});
