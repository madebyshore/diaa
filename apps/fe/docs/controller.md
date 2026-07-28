# Controller & Transitions

The controller system handles all page navigation in a single, centralized flow. It replaces the old 4-file split (`router/index.ts`, `controller.ts`, `engine/router/transition.ts`).

## How It Works

Four pieces work together like a relay:

### 1. Ctrl (`controller/index.ts`)

The entry point for all navigation. When someone clicks a link or hits back/forward:

1. Checks the `App.mutating` lock — if a transition is already running, bail
2. Sets the lock + starts an 8-second safety timer
3. Updates route state (`App.route.old` / `App.route.new`)
4. Updates `document.title` and active nav link classes
5. Calls `history.pushState` (skipped for back navigation)
6. Builds a callbacks object and hands it to TransitionManager
7. Waits for the full out→in sequence, then clears the lock

### 2. TransitionManager (`controller/transition-manager.ts`)

The choreographer that coordinates DOM, animation, and hook timing:

**`out(callbacks)`:**
1. Resolves which `BaseTransition` to use from the registry (based on the from/to route pair)
2. Fires `onBeforeOut` hooks — GPU prepares for transition here (via registered hooks, not direct calls)
3. Calls `PageManager.beforeOut()` so the old page can clean up and save scroll position
4. Calls `callbacks.update()` — this bridges to the `in()` phase

**`in(callbacks)`:**
1. Calls `callbacks.insertNew()` — both old and new pages now coexist in the DOM
2. Runs `transition.out(fromEl, toEl)` and `transition.in(fromEl, toEl)` **simultaneously** via `Promise.all`
3. Waits two rAF frames (double-RAF) for the browser to fully lay out the new DOM before measuring bounds
4. Fires `onAfterIn` hooks — GPU commits the transition and reinits video textures on back-nav
5. After 150ms, calls `callbacks.removeOld()` to remove the old page
6. Calls `PageManager.afterIn()` for post-mount hooks and scroll restore

### 3. TransitionHooks (`controller/types.ts`)

Lifecycle hooks that external subsystems register to participate in navigation without the TransitionManager knowing about them:

```typescript
interface TransitionHooks {
  onBeforeOut?(fromUrl: string, toUrl: string): void;
  onAfterOut?(): void;
  onBeforeIn?(): void;
  onAfterIn?(): void;
}
```

Register hooks via `Ctrl.registerTransitionHooks()`:

```typescript
const ctrl = installController();
ctrl.registerTransitionHooks({
  onBeforeOut: (from, to) => { /* prepare GPU scene swap */ },
  onAfterIn: () => { /* commit GPU transition, update bounds */ },
});
```

GPU is wired as a hook consumer in boot phase 4 — TransitionManager has zero direct `App.gpu.*` calls. This means the GPU subsystem can be swapped, disabled, or extended without modifying the controller.

### 4. BaseTransition (`controller/transition-registry.ts`)

The abstract class every transition animation extends:

```typescript
abstract class BaseTransition {
  abstract out(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;
  abstract in(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;
}
```

- `out()` = make the old stuff disappear
- `in()` = make the new stuff appear
- Both receive the old and new page container elements
- Both return a Promise — do whatever you want inside

## The Full Flow

```
User clicks link
  → Ctrl.navigate(path)
    → lock on, update route/title/nav
    → TransitionManager.out(callbacks)
      → fire onBeforeOut hooks (GPU prepares scene swap)
      → PageManager.beforeOut() (save scroll, page.out())
      → callbacks.update()  ← bridges to in() phase
    → TransitionManager.in(callbacks)
      → callbacks.insertNew()  ← both pages now in DOM
      → Promise.all(transition.out(fromEl, toEl), transition.in(fromEl, toEl))
      → double-RAF → fire onAfterIn hooks (GPU commit, video reinit)
      → 150ms delay → callbacks.removeOld()
      → PageManager.afterIn() (page.init + page.in, scroll restore)
    → lock off
```

The important thing: `transition.out()` and `transition.in()` run **at the same time**. The old page animates away while the new page animates in — that overlap is what makes transitions feel smooth.

**GPU plane animation:** All GPU plane opacity is controlled from the transition and page modules, not the GPU's internal crossfade. `DefaultTransition.out()` drives `fromScene.planes[*].opacity` from 1→0 alongside the page recede (via the pageAnim's `u` callback), with per-frame bounds updates so planes track the transforming DOM. `DefaultTransition.in()` sets `toScene.planes[*].opacity` to 0 so they're hidden behind the curtain. After the transition completes, each page module's `in()` hook animates `App.gpu.scene.planes[*].opacity` from 0→1 alongside the text reveals.

**Why double-RAF?** A single `requestAnimationFrame` fires before the browser has fully laid out newly inserted DOM. The second frame guarantees layout is complete, so GPU bounds calculations and DOM measurements are accurate.

---

## Scroll Save/Restore

Scroll position is automatically managed during navigation (ROUT-04):

- **Save:** `PageManager.beforeOut()` captures `{ cur, tar }` from the scroller before the out animation
- **Restore (back-nav):** `PageManager.afterIn()` calls `scrollTo(snap.tar, true)` for an immediate jump to the saved position
- **Reset (forward-nav):** `PageManager.afterIn()` calls `scrollTo(0, true)` to start at the top
- **`history.scrollRestoration = "manual"`** is set in boot phase 4 so the browser doesn't fight with our custom scroll management

### Scroll lock during navigation

User scroll input is locked for the **entire mutation window**: `Ctrl.navigate()` calls `App.scroller.pause()` the moment `App.mutating` is set, and `resume()` runs wherever the lock clears — `_in()`'s `finally` and the safety-valve timeout. `PageManager.animateCurrentPageIn()` holds its own inner pause around `page.in()` so first-boot entrances (phase 5, no navigation) are covered too; pause/resume are idempotent booleans so the nesting is harmless.

While paused, `NativeScroller` actively blocks every input path — wheel / touchmove / keyboard are `preventDefault()`ed (an early return alone would let the browser's native default scroll through), and un-preventable native scroll (scrollbar drag, trackpad momentum) is snapped back to the held position from the `scroll` event handler. Programmatic `scrollTo(pos, true)` bypasses the pause, so the save/restore above still works mid-lock.

---

## Creating Custom Transitions

To add a custom transition, you do two things:

1. Create a class that extends `BaseTransition`
2. Register it for specific route pairs

### Step 1: Create the Transition Class

Create a file in `src/app/controller/transitions/` (or wherever makes sense for your project).

Both `out()` and `in()` receive:
- `fromEl` — the old page's container element
- `toEl` — the new page's container element

You also have access to `App.gpu` for WebGPU scene manipulation.

```typescript
import { Anima } from "kido/anima";
import { App } from "../../context";
import { BaseTransition } from "../transition-registry";
import { animaToPromise } from "../transition-fx";

export class HomeToProjectTransition extends BaseTransition {
  /**
   * OUT: Home page leaves.
   * Fade out DOM elements and fade out WebGPU planes simultaneously.
   */
  async out(fromEl: HTMLElement, _toEl: HTMLElement): Promise<void> {
    const gpu = App.gpu;

    // Fade out the DOM content
    const domFade = animaToPromise(new Anima({
      el: fromEl,
      d: 600,
      e: [0.38, 0.05, 0.65, 0.82],
      p: { o: [1, 0] },
    }));

    // Fade out the GPU planes
    let gpuFade = Promise.resolve();
    if (gpu?.scene) {
      gpuFade = this.fadeOutPlanes(gpu.scene, 600);
    }

    await Promise.all([domFade, gpuFade]);
  }

  /**
   * IN: Project page enters.
   * Fade in DOM elements while new scene planes fly up from the bottom.
   */
  async in(_fromEl: HTMLElement, toEl: HTMLElement): Promise<void> {
    const gpu = App.gpu;
    const vh = App.win.h || window.innerHeight;

    toEl.style.opacity = "0";

    const domFadeIn = animaToPromise(new Anima({
      el: toEl,
      d: 700,
      e: [0.38, 0.05, 0.65, 0.82],
      p: { o: [0, 1] },
    }));

    let planesFlyIn = Promise.resolve();
    if (gpu?.scene) {
      planesFlyIn = this.flyInPlanes(gpu.scene, vh, 700);
    }

    await Promise.all([domFadeIn, planesFlyIn]);
  }

  private fadeOutPlanes(_scene: unknown, duration: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, duration); // placeholder — replace with real GPU logic
    });
  }

  private flyInPlanes(_scene: unknown, _vh: number, duration: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, duration); // placeholder — replace with real GPU logic
    });
  }
}
```

### Step 2: Register It

After calling `installController()`, register your transition for the route pair it applies to. The keys are the **page keys** from your route config (`App.config.routes`), not the URL paths.

```typescript
import { HomeToProjectTransition } from "./controller/transitions/home-to-project";

const ctrl = installController();

// "home" → "project" uses the custom transition
ctrl.registry.register("home", "project", new HomeToProjectTransition());

// You can register different transitions for different directions
ctrl.registry.register("project", "home", new ProjectToHomeTransition());
```

Any route pair that **isn't** registered falls back to the `DefaultTransition` (slide-up).

### What You Can Do Inside `out()` and `in()`

Anything async. Some patterns:

| What | How |
|------|-----|
| Animate DOM elements | `animaToPromise(new Anima({ ... }))` |
| Animate GPU planes | Access `App.gpu.scene.planes`, tween uniforms or positions |
| Run DOM + GPU in parallel | `await Promise.all([domAnim, gpuAnim])` |
| Stagger elements | Create multiple Anima instances with different delays |
| Coordinate shared elements | Both `fromEl` and `toEl` are available in both methods |
| Access route info | `App.route.old.page` and `App.route.new.page` |

### Tips

- **Duration**: Keep `out()` and `in()` roughly the same length — they run simultaneously, so the longer one determines the total transition time.
- **Cleanup**: Clear any inline styles you set on `toEl` at the end of `in()` so the page flows normally after the transition.
- **GPU timing**: TransitionManager fires `onBeforeOut` hooks (which call `gpu.prepareTransition()`) before your `out()` and `onAfterIn` hooks (which call `gpu.commitTransition()`) after your `in()`. You don't need to call those yourself — just animate the planes/uniforms.
- **animaToPromise**: Use this helper to wrap any `Anima` instance in a Promise. It bridges kido's callback API to the async lifecycle.
- **Easing**: The codrops easing `[0.38, 0.05, 0.65, 0.82]` is available as `"codrops"` in the kido `Ease` map, or pass the array directly to Anima.

---

## File Reference

| File | What it does |
|------|-------------|
| `controller/index.ts` | `Ctrl` class + `installController()` — navigation entry point |
| `controller/transition-manager.ts` | `TransitionManager` — out/in choreography + hook dispatch |
| `controller/transition-registry.ts` | `BaseTransition` abstract class + `TransitionRegistry` |
| `controller/transition-fx.ts` | `DefaultTransition` (slide-up) + `animaToPromise` helper |
| `controller/types.ts` | `TransitionCallbacks`, `TransitionHooks`, `NormalizedUrl`, `PageLifecycleCallbacks` |
