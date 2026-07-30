# Animation — controllers, transitions, boot, bridge

The imperative choreography layer: page-controller lifecycle, the sequential-timing-in-simultaneous-Vue-hooks transition, the boot/intro sequence, the home→detail image bridge, navigation locking, and Lenis. All animation goes through GSAP; kido survives only as `Raf`/`Sniff`/`ResizeHub` utilities (see root `CLAUDE.md` rule #2).

---

## Page-controller contract

`app/controllers/page-controller.ts` defines the `PageController` interface — the direct successor to the old app's `BasePage`:

```ts
interface PageController {
  onInit(root: HTMLElement): void;              // SYNCHRONOUS — must complete before paint
  onDestroy(): void;
  in(root: HTMLElement): Promise<void>;          // mandatory (not optional)
  out(root: HTMLElement): Promise<void>;         // mandatory (not optional)
  onScroll?(e: ScrollEvent): void;                // optional
}
```

Two deliberate deviations from the old `BasePage` contract:

- **`in()`/`out()` are mandatory**, not optional — every page in this app has visible content-fade timing (there's no GPU-plane-only default that could skip it).
- **`onInit` is synchronous**, not `async`. The old `init()` could `await` — this one can't. Anything that needs to be async (e.g. the dev GUI's dynamic import in `home.ts`) is fired-and-forgotten rather than awaited.

`BaseController` supplies the default: `PAGE_IN_DURATION = 1.2s`, `PAGE_OUT_DURATION = 0.8s`, `"slow"` ease, snap-then-tween opacity. `home.ts`, `detail.ts`, and `rich-text-page.ts` (shared by Contact/Imprint) extend it with page-specific choreography. Every controller is built by a **factory function** (`createHomeController()`, `createDetailController()`, `createRichTextController(pageKey)`) — a fresh closure per mount, not a module-scope singleton — registered per-mount via `usePageController()` (`app/composables/usePageController.ts`) into a `Map<route.fullPath, PageController>`.

### Controller summaries

- **`detail.ts`** — title-nav show/hide on scroll (linear ease, 0.4s), bottom-dwell auto-navigate-home (300ms dwell past the scroll limit, 2px epsilon), consumption of the home→detail image bridge in `in()`. `DETAIL_IN_DURATION=1.2s`/`DETAIL_OUT_DURATION=0.8s`/`DETAIL_IN_DELAY=0.2s`, all `"slow"` — deliberately mirrors home's timing so both pages move at the same felt speed. A mobile cover-entrance-slide variant exists in the file but is currently disabled behind a `MOBILE_COVER_ENTRANCE_SLIDE = false` flag, kept as a documented revert switch rather than deleted.
- **`rich-text-page.ts`** — `createRichTextController(pageKey)` shares the same nav-hide/bottom-dwell mechanics as Detail, parameterized by BEM block name (`.{pageKey}__nav`, `.{pageKey}__outro`) so one factory serves both Contact and Imprint.
- **`home.ts`** (~1150 lines — the highest-risk port in the whole rewrite) — text⇄image mode toggle, taxonomy filter toggle, nav hover-reveal fade-swap (a single V-shaped opacity tween, `1→0→1`, with the DOM swap happening at the midpoint, guarded by a generation counter against rapid hover thrash), mobile scroll-driven image reveal (midline-nearest-item detection), the home entrance fade (with a mobile "lag" stagger for the text pane/nav/footer), the return-to-home brand-beat replay (gated by `useNavLock().mutating` and `lib/beat-skip.ts`), pointer-hover resync after entrance (including a one-shot Safari `:hover`-staleness backstop), and the dev-GUI mount. All durations/eases are read live off `useHomeAnim()`'s reactive `homeAnim` object — never cached locally — so the dev tuning panel takes effect immediately.

`home.ts` deviates from home being an obvious module-scope-state candidate (there's only ever one home route) — it's still a factory, explicitly for **consistency**: every other controller in this app is a factory-with-closured-state, and mixing patterns would make the codebase harder to reason about even though home's factory is only ever invoked once per app lifetime.

---

## Transitions — sequential timing inside simultaneous Vue hooks

**The single trickiest piece of the rewrite**, isolated entirely in `app/transitions/default.ts`.

`<NuxtPage :transition="defaultTransition" :page-key="r => r.fullPath" />` uses `createDefaultTransition()`'s returned `TransitionProps`: `css: false`, **no `mode`**. Without a `mode`, Vue keeps both the outgoing and incoming page elements in the DOM simultaneously and fires `onLeave`/`onEnter` concurrently — which is exactly what the home→detail bridge needs (the incoming Detail page's clone has to sit on top of the still-visible home grid). But the *feel* this app wants is diaa's original: **sequential** wall-clock timing — the outgoing page's `out()` fully resolves (~800ms) and only then does the incoming page's held-then-fades `in()` (~1400ms) begin. "No mode" governs DOM coexistence, not animation timing — `default.ts`'s whole job is re-imposing that sequential *feel* inside hooks Vue would otherwise run at the same time.

### Hook-by-hook

```
onBeforeLeave(el)
  ├─ saveScroll(outgoingPath, $lenis)
  └─ if outgoing="index" & incoming="slug": bridgeOut(fromEl, incomingPath)   ← BEFORE out() fades content,
                                                                                 so the bridge clone captures a
                                                                                 fully-visible image
onLeave(el, done)                                    ┐
  ├─ controller = getPageController(outgoingPath)     │  concurrent with onBeforeEnter/onEnter below,
  ├─ unsubscribe onScroll                              │  from Vue's perspective
  ├─ await controller.out(fromEl)                       │
  ├─ resolveLeave()  ──────────────────────────────────┘  unblocks the `leaveFinished` promise
  └─ done()

onBeforeEnter(el)                                     synchronous — same tick, before Vue paints this element
  ├─ pin: position:fixed; inset:0; height:100vh; z-index:2; opacity:0
  ├─ controller.onInit(page)             ← called directly here, NOT via usePageController's onMounted guard
  ├─ add .is-controlled                   (FOUC rule — see below)
  └─ transitionInitPath.value = incomingPath    (receipt read by usePageController's onMounted)

onEnter(el, done)
  ├─ direction = takeNavDirection()
  ├─ restoreOrResetScroll(...)            ← BEFORE the entrance fade, matching the old
  │                                          initCurrentPage()'s restore-before-animate ordering
  ├─ await leaveFinished                  ← THE sequential-timing linchpin: blocks here until
  │                                          onLeave's out() has fully resolved
  ├─ $lenis?.stop()
  ├─ await controller.in(page)
  ├─ $lenis?.start()
  └─ done()

onAfterEnter(el)
  ├─ page.removeAttribute("style")        ← wipes the fixed-pin AND the class list
  ├─ re-add .is-controlled                 (CSS's `#page.is-controlled { opacity: unset }` keeps ownership)
  ├─ subscribe onScroll (if controller has it)
  └─ unlockNav()                          ← THE transition's true completion point, NOT router.afterEach
```

`leaveFinished` / `resolveLeave` is a module-scope promise pair — the mechanism that lets `onEnter` block on `onLeave`'s completion despite Vue invoking both hooks without any ordering guarantee between them.

Route identity (which page key is leaving/entering) is tracked separately: `installRouteTracking()` registers a `router.beforeEach` that populates module-scope `outgoingPath`/`incomingPath`/`outgoingName`/`incomingName`, because Vue's transition hooks only ever receive the raw DOM element — no route information.

**Why `createDefaultTransition()` is a function, not a module-scope export**: it calls `useRouter()` internally. A top-level call would crash SSR/prerender with `NUXT_E1001` (Nuxt composables aren't callable outside a component/plugin setup context). `app.vue` calls it inside its own `<script setup>`.

### FOUC handling and `.is-controlled`

`#page` defaults to `opacity: 0` in `base.module.scss`. `.is-controlled` is the class that releases that CSS ownership — added the moment JS has actually taken over the entrance animation, so a page never flashes at full opacity before its `in()` starts. It's added from exactly two places:

1. `transitions/default.ts`'s `onBeforeEnter` — synchronously, same tick as `controller.onInit()`, for a transitioned SPA navigation.
2. `usePageController.ts`'s `onMounted` guard — for the very first page load, where no transition ever runs (Vue doesn't fire enter hooks for the initially-mounted DOM).

`usePageController()` distinguishes these two paths via `transitionInitPath` (a plain `ref`, not `useState`): if it equals the current route's `fullPath` when the component's `onMounted` fires, `onInit` already ran via the transition — skip and clear the receipt. Otherwise, `onMounted` calls `controller.onInit(el)` itself.

This is a deliberate divergence from the reference codebase's convention (where `onInit` only ever runs from `onMounted`, because that app's real content lives in GPU planes that don't need pre-paint hiding): diaa's controllers are DOM-only and must set hidden initial state **before** any paint of the entering page, which for a transitioned nav means `onInit` has to run from `onBeforeEnter`, synchronously, ahead of `onMounted`.

---

## Home → Detail image bridge

`app/transitions/home-to-detail.ts`'s `bridgeOut(fromEl, toPath)`, dispatched from `default.ts`'s `onBeforeLeave` on a coarse route-name gate (`"index"` → `"slug"`), then re-verified precisely: only bridges when `useHomeMode().value === "text"`, an `.is-active` figure exists, and that figure's matching text-item anchor's `href` exactly equals `toPath` — guards against hovering item A while navigating to item B via some other path.

**Mechanism**: clone the live `.home__text-gpu-figure.is-active` element (keeps its already-decoded `<img>`/`<video>` — no re-fetch, no flash), pin the clone `position: fixed` at the figure's exact `getBoundingClientRect()`, `z-index: 100`, `transition: none` (kills the figure's own CSS opacity transition, since `detail.ts`'s `in()` now owns the fade), append to `document.body`, then set the **original figure's `visibility = "hidden"`** — not `opacity: 0`.

That `visibility` choice is the fix for a real visual bug found during the port:

> The previous approach held the cover SOLID and faded the clone out over it — two stacked copies. That reads as one for an OPAQUE cover, but a cover with transparency composites its two semi-transparent shadows into a visibly DOUBLED/darker shadow. So instead we HIDE the cover beneath the solid clone for the entire entrance and hard-swap them in a single frame at the end.

`visibility: hidden` drops the paint (and its shadow) instantly with zero visible change, because the clone already covers the exact rect. `opacity: 0` would instead fade over the figure's own transition duration, leaving the double-shadow on screen for its entire length.

The `visibility === "hidden"` flag doubles as the signal `home.ts`'s own `out()` reads (`bridging = activeFigure.style.visibility === "hidden"`) to know to fade only chrome (text labels, nav, footer) and leave `.home__text-gpu`'s container opaque so the clone underneath stays visible through the transition.

Handoff to `detail.ts` runs through `app/lib/image-bridge.ts` — a one-slot module (`setImageBridge`/`takeImageBridge`, clear-on-read) — "so neither the transition nor the page needs to know about the other." `detail.ts`'s `in()` takes the bridge element and hard-swaps it for the real cover in a single frame once its own entrance is ready.

---

## Boot & intro

Only phases 4–5 of the old app's five-phase boot have real work in `app/composables/useBoot.ts` — phases 1–3 are satisfied structurally: SSR renders `IntroOverlay` visible-by-default (no JS needed to show it), Nuxt plugins (`lenis.client.ts`, `nav-direction.client.ts`) wire scroll/nav before mount, and `usePageController`'s first-load `onMounted` branch calls `onInit()` on child components before `app.vue`'s own `onMounted` fires (Vue's child-before-parent mount ordering) — matching the old invariant that page `init()` runs before the intro overlay wipes.

`playIntro(introEl, logoEl, textEl, hasPhrase)` ports `Intro.play()` line-for-line:

1. If `hasPhrase`: fade the intro phrase in (1.2s, 0.4s delay), hold 0.4s (a targetless `gsap.to({}, {duration})` tween used purely for its promise/timing), fade out (0.8s).
2. Fade the DIAA logotype in (1.2s; 0.4s delay only if there was no phrase), hold 0.4s.
3. Fade the whole overlay out (0.8s).
4. Remove the intro element from the DOM.

All steps use `"slow"` ease. `runBoot()` (called once from `app.vue`'s `onMounted`) awaits `playIntro`, then resolves the current route's controller and runs `$lenis?.stop()` → `await controller.in(page)` → `$lenis?.start()` in a `finally`, subscribing `onScroll` only after Lenis resumes. This is the **only** place that runs the entrance fade for the very first page load — `transitions/default.ts` never fires for the initial mount, because Vue's `<Transition>` doesn't run enter hooks against DOM that was already present when the component mounted.

The intro phrase itself is picked via `useState("intro-phrase", ...)` in `IntroOverlay.vue`, not a bare `Math.random()` call — deliberately, to avoid an SSR/client hydration mismatch (a random pick made twice, once on the server and once on the client, would render different text and trigger a hydration warning/flash).

`IntroBeat.vue` — the return-to-home brand-beat overlay — lives as a sibling of `<NuxtPage>` in `app.vue`, not inside any page, so it survives every SPA navigation untouched. It's toggled by `home.ts` via a direct `document.querySelector(".intro-beat")` rather than a scoped ref, since it sits outside any page controller's own root — documented as intentional, not an oversight.

`app/lib/beat-skip.ts` — a one-shot boolean flag (`skipNextHomeBeat()` / `takeHomeBeatSkip()`) that `detail.ts`'s bottom-dwell auto-navigate-home handler sets before navigating, so `home.ts` knows to suppress the return-beat replay: the Detail page's own outro (the DIAA logotype fading in as you scroll past the content) already *is* a beat — replaying it again on arrival at home would show the mark twice back to back.

---

## Navigation lock

`app/composables/useNavLock.ts` ports the old `App.mutating` transition-lock, plus its 8-second safety valve. `mutating` is a plain `ref(false)` at **module scope**, deliberately not `useState()` — calling `useState()` at true module scope crashes prerendering with `NUXT_E1001` ("nuxt instance unavailable"); a plain `ref()` needs no Nuxt context.

`lockNav()`: idempotent guard, stops Lenis, arms an 8000ms `setTimeout` that force-resets `mutating` and restarts Lenis (with a `console.warn`) if something hangs. `unlockNav()`: clears the timer, resets `mutating`, restarts Lenis.

`useNavLock()` registers a one-time `router.beforeEach` that blocks navigation (`return false`) if already `mutating`, else locks and allows it (`return true`). **Correction from the original plan**: `unlockNav()` is called explicitly from `transitions/default.ts`'s `onAfterEnter` — not from `router.afterEach`, which fires too early (as soon as the route changes, well before the transition animation actually finishes) and would let a second click interrupt an in-flight transition.

---

## Lenis

`app/plugins/lenis.client.ts` sets `history.scrollRestoration = "manual"` unconditionally at plugin init (the old boot phase 2 equivalent). On `Sniff.isMobile`, `$lenis` is `null` — verified against the old `NativeScroller`'s touch handling, not assumed: touch input never went through the damping path at all, so mobile scrolling in this app is genuinely just the browser's native momentum scroll, and the scroller only ever mirrored position for desktop-style effects.

Desktop: `new Lenis({ autoRaf: false, lerp: 0.1 })`, ticked via `new Raf("scroller", elapsed => lenis.raf(elapsed))` (kido's `Raf`, one of the three surviving kido utilities). **`0.1`, not `0.09`**: kido's `NativeScroller` class default was `0.09`, but the old app's actual boot call constructed it with `damping: 0.1` explicitly — the real shipped desktop feel is `0.1`, and that's what's used here for true parity.

`app/composables/useLenisScroll.ts` bridges `$lenis.on("scroll", ...)` into the `ScrollEvent` shape controllers expect (`{current, target, max}`), or falls back to a native `window` scroll listener producing the same shape when `$lenis` is null (mobile). Only one subscription is active at a time. Subscription is **not** automatic on mount — controllers subscribe explicitly, and only after resume (`transitions/default.ts`'s `onAfterEnter`, `useBoot.ts`'s `runBoot()`), mirroring the old "subscribe only after resume" rule so a controller never receives scroll events mid-animation.

---

## Eases

`app/gsap/eases.ts` defines the `CustomEase` control-point table, registered in `app/plugins/ease.client.ts` via `gsap.registerPlugin(CustomEase)` + `CustomEase.create(name, curve)` per entry (idempotent — guarded by `CustomEase.get(name)`).

| Name | Curve | Status |
|---|---|---|
| `slow` | `0.192, 0.062, 0.275, 0.879` | **The only load-bearing curve.** Drives the intro brand-beat text, the home entrance fade, the return-to-home beat, mode/filter switches, and every controller's default content fade. A least-squares cubic-bezier fit of a Figma spring (stiffness 80, damping 20, mass 1) over its 600ms interaction window — slightly overdamped. |
| `o4` | `0.25, 1, 0.5, 1` | Registered, unused. |
| `io` | `0.76, 0, 0.2, 1` | Registered, unused. |
| `o6` | `0.16, 1, 0.3, 1` | Registered, unused. |

`o4`/`io`/`o6` are kept registered only for parity with the old app's `DefaultTransition`/`FadeTransition` alternates — which were themselves dead code there too (`EmptyTransition` was the live default). Nothing in the shipped Nuxt path uses them. Don't assume they're wired to anything before reusing one.

---

## Scroll save/restore

`app/lib/scroll-restore.ts` — a `Map<fullPath, number>` of per-route Lenis scroll positions. `saveScroll(path, lenis)` is a no-op when `lenis` is `null` (mobile scroll positions aren't snapshotted, matching the old app's behavior). `restoreOrResetScroll(lenis, path, direction)`: on `"back"` navigation, restores instantly (`lenis.scrollTo(y, {immediate: true, force: true})`); otherwise resets to `0`. On mobile (`lenis === null`) it ALWAYS resets to top via native `window.scrollTo(0, 0)`, regardless of direction — there is no snapshot to restore, and without the explicit reset the document keeps the outgoing page's stale scroll until the browser clamps it asynchronously, which lands after home's `in()` has already computed its scroll-driven reveal (the "wrong centre image until first scroll" bug). Direction comes from `app/plugins/nav-direction.client.ts`'s single `popstate` listener (everything else defaults to `"forward"`, since `pushState` never fires `popstate`), read via `takeNavDirection()` (read-and-reset).

## Click delegation

`app/plugins/click-delegation.client.ts` — a global delegated `document` click listener, added as a required fix discovered while building the bridge: without it, clicking a plain `<a href>` triggers a full browser navigation, and `router.beforeEach`/`onBeforeLeave` never fire at all — including the home→detail bridge, which is provably unreachable through a real click without this plugin. It guards against `defaultPrevented`, non-left-clicks, modifier keys, `target !== "_self"`, `download`, cross-origin hrefs, and same-path hash anchors; otherwise calls `e.preventDefault()` and `router.push(pathname + search + hash)`. Internal links in this app are intentionally plain `<a href>`, never `<NuxtLink>`, to keep markup byte-parity with the old Mustache templates — this plugin is what makes that safe.
