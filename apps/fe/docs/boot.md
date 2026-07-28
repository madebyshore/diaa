# Boot Sequence

The application boot sequence in `Application.init()` runs **eight discrete phases** in strict order. Each phase awaits the previous before starting.

The key design goal: every subsystem — GPU scene, controller, scroller, and **the current page's `init()` hook** — is fully set up **before** the intro overlay fades out. Pages therefore apply their hidden initial state (GPU planes at opacity 0, split text translated offscreen, paragraphs hidden) while the overlay is still up. No flash of unstyled content.

## The Eight Phases

### Phase 1 — GPU init

```
const gpuMod = !Sniff.isMobile ? await import("./gpu") : null;
const gpu = gpuMod?.default ? new gpuMod.default() : null;
App.gpu = gpu;
if (gpu) await gpu.load();
```

**Code splitting gate.** On mobile devices the GPU bundle (tatara + katachi + WGSL shaders, ~200–400 KB) is never fetched — `import("./gpu")` is only called when `!Sniff.isMobile`. On desktop the dynamic import fires immediately for eager parallel loading. This is the primary Lighthouse mobile performance improvement.

If `gpu.load()` fails (WebGPU unsupported), `gpu.renderer` stays null and the rest of the app runs on the fallback path: intro still animates, navigation still works, but no GPU rendering.

### Phase 2 — Texture load

```
const intro = new Intro();
await new Promise<void>((resolve) => {
  new Loader({
    onComplete: () => resolve(),
  });
});
```

Creates the intro overlay animation and starts the texture preloader. The intro is a brand beat, not a loading screen — there is no counter (the GPU engine is disabled, so the loader settles immediately). The phase resolves when `Loader.onComplete` fires.

### Phase 3 — GPU scene setup

```
if (gpuAvailable && gpu) {
  gpu.intro();
  gpu.init();
}
```

Initialises the GPU scene graph for the initial route. Planes are created at opacity 1 by default — **Phase 5 will set them to 0** before the intro clears.

Skipped when `gpu.renderer` is null (fallback path).

### Phase 4 — Controller install

```
history.scrollRestoration = "manual";
const ctrl = installController();
App.ctrl = ctrl;
ctrl.registerTransitionHooks({ onBeforeOut, onAfterIn });
```

Disables browser scroll restoration (the app manages scroll itself), installs `Ctrl` with click + popstate event delegation, and registers GPU lifecycle hooks. The hooks are how the GPU participates in transitions — the controller has zero direct `App.gpu.*` calls.

The `onBeforeOut` hook calls `scene.collectDomSlots()`, `scene.updateBounds()`, and `gpu.prepareTransition(from, to)`. The `onAfterIn` hook commits the transition, reinit-s video textures on back-navigation, and requests a redraw.

### Phase 5 — Scroller + page init (before intro clears)

```
App.scroller = new NativeScroller({ container: '#app', damping: 0.09, onUpdate });
for (const route of Object.keys(App.config.routes)) App.scroller.registerRoute(route);
App.scroller.setActiveRoute(App.route.new.url);
App.scroller.start();

PageManager.registerFromRoutes();
await PageManager.initCurrentPage();
```

Creates the `NativeScroller`, registers every known route so each has independent scroll state, then runs **`PageManager.initCurrentPage()`** which:

1. Looks up the current page key from `App.route.new.page`
2. Resolves the page class via the registry (auto-populated at module load by `PageManager.autoRegister()` from `import.meta.glob("../routes/*/*.ts", { eager: true })`)
3. Instantiates the page with `{ key, App }` context
4. Sets `this.current = { key, instance }`
5. Initialises `Reveal` with the page container
6. **Awaits `page.init(container)`** — this is where the page queries DOM, sets planes to `opacity = 0`, translates split-text lines offscreen, etc.
7. Restores scroll position on back-nav or resets to top on forward-nav

At this point the page is in its hidden initial state. The intro overlay is still covering everything.

### Phase 6 — GPU render loop

```
if (gpuAvailable && gpu) {
  gpu.run();
  gpu.requestRedraw();
}
```

Starts the render loop **after** `page.init()` so the first rendered frame already reflects the page's hidden initial state (planes at opacity 0). If the render loop started before phase 5, planes would briefly flash at opacity 1 during the fade-out.

Skipped when `gpu.renderer` is null.

### Phase 7 — Intro animation

```
await intro.play();
```

Plays the brand beat: the **DIAA** mark fades in over one second, holds for half a second, then the whole white overlay fades out. The page's entrance state is already in place, so nothing flashes — the overlay clears to reveal a clean, hidden page waiting to animate in.

`App.introDone` is set true after this resolves.

### Phase 8 — Page entrance animations

```
await PageManager.animateCurrentPageIn();
```

Calls **`page.in()`** on the current instance. This is where visible entrance animations happen — split text lines slide up, paragraphs fade in with stagger, GPU planes tween from `opacity: 0 → 1` via an `Anima` with a `u` callback that writes to `plane.opacity` every frame.

After `in()` resolves, the `PageManager` subscribes the page instance's `onScroll` handler to the scroller.

## Post-init wiring

After the eight phases complete, `init()` wires a few global listeners:

- **`wireCanvasVisibility()`** — listens to `ResizeHub` and toggles `canvas.style.display` between `""` and `"none"` at the 1024px breakpoint. **Never detaches the canvas** — that would destroy the WebGPU context.
- **`createGpuHud()`** — creates the debug overlay (toggle with Ctrl+F).
- **`globalKeyboardEvents()`** — Ctrl+G toggles the dev grid overlay, Ctrl+F toggles the GPU HUD.

## IntroAnimation contract

The `Intro` class (`engine/boot/intro.ts`) implements:

```typescript
interface IntroAnimation {
  play(): Promise<void>;
}
```

It is a **pure animation** — no GPU, Loader, or Scroller dependencies. Those concerns are orchestrated by `Application.init()`, not by the intro itself. This makes the intro testable in isolation and swappable.

## Canvas visibility

On screens below 1024px, the WebGPU canvas is hidden via CSS `display: none` rather than being removed from the DOM. Detach/reattach invalidates the WebGPU context, requiring a full GPU re-init. With `display: none`, the canvas stays in the DOM tree, the WebGPU context is preserved, and the render loop continues (rendering to a hidden surface). On resize back above the breakpoint, the canvas is revealed instantly with no GPU re-init delay.

## Fallback path

When WebGPU is unavailable (`gpu.renderer === null` after `gpu.load()`, or `Sniff.isMobile` skipped the dynamic import entirely), the boot sequence:

- Skips `gpu.intro()`, `gpu.init()` (phase 3)
- Skips `gpu.run()`, `gpu.requestRedraw()` (phase 6)
- Still plays `intro.play()` (phase 7 — the overlay works without GPU)
- Still installs the controller (phase 4)
- Still sets up the scroller + page init (phase 5)
- Still runs `page.in()` (phase 8 — but any GPU plane animations are guarded by `this.planes?.length`)

Pages render as normal HTML — the GPU just doesn't add its overlay rendering.

## Why the order matters

A naïve implementation would do this:

```
1. GPU + textures + controller + scroller + intro all in parallel
2. Show page
```

…which produces a flash: the page's DOM is mounted at its default state (planes visible, text visible) for the duration of the intro, then suddenly snaps to "hidden" just before `in()` runs. The 8-phase order is what prevents that flash. Specifically: **`page.init()` must run before the render loop starts, and the render loop must start before the intro overlay fades out**.

If you ever see a flash of content during the intro, the most likely cause is that something moved out of the 8-phase ordering.
