# Page Animations

Content-level entrance and exit animations that run inside the page lifecycle — separate from the page transition (the curtain wipe between pages).

There are two layers: **immediate reveals** for hero/above-the-fold content, and **scroll-triggered reveals** for everything below the fold.

## How It Fits Into Navigation

```
Transition.in() completes (curtain reveal)
  → PageManager.afterIn()
    → Reveal.init()         ← scroll-triggered zones are set up
    → page.init(container)  ← query DOM elements, set initial hidden state
    → page.in()             ← immediate entrance animations (hero, above-the-fold)
    → scroll restore
    ...user scrolls...
    → Reveal.loop()          ← scroll-triggered zones fire as they enter viewport
```

The transition system (curtain wipe) handles the page-level overlay animation. Content animations are the responsibility of the page class (`BasePage.in()`) and the Reveal system.

---

## Layer 1: Immediate Reveals (`page.in()`)

Use the `in()` hook on your `BasePage` subclass for choreographed hero entrances — elements that should animate as soon as the transition curtain finishes.

### Pattern

1. **Query elements** in `init()` and set their initial hidden state
2. **Animate them** in `in()` using `Anima` + `animaToPromise`
3. The returned Promise keeps the lifecycle waiting until animations complete

```typescript
import { Anima } from "kido/anima";
import { animaToPromise } from "@app/controller/transition-fx";
import { queryAll } from "kido/utils";
import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

export default class HomePage extends BasePage {
  private heroTitle: HTMLElement | null = null;
  private heroItems: HTMLElement[] = [];

  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    const root = container as HTMLElement;

    // Query elements
    this.heroTitle = root.querySelector(".hero__title");
    this.heroItems = queryAll(root, ".hero__item");

    // Set initial hidden state before the transition curtain lifts
    if (this.heroTitle) this.heroTitle.style.opacity = "0";
    for (const el of this.heroItems) {
      (el as HTMLElement).style.opacity = "0";
      (el as HTMLElement).style.transform = "translate3d(0, 40px, 0)";
    }

    dbg.page("home:init — hero elements hidden");
  }

  async in(): Promise<void> {
    dbg.page("home:in — hero reveal");

    const anims: Promise<void>[] = [];

    // Title fade in
    if (this.heroTitle) {
      anims.push(animaToPromise(new Anima({
        el: this.heroTitle,
        d: 800,
        e: [0.16, 1, 0.3, 1],
        de: 100,
        p: { o: [0, 1] },
      })));
    }

    // Staggered items — slide up + fade in
    for (let i = 0; i < this.heroItems.length; i++) {
      const el = this.heroItems[i];
      if (!el) continue;
      anims.push(animaToPromise(new Anima({
        el,
        d: 900,
        e: [0.16, 1, 0.3, 1],
        de: 200 + i * 100,
        p: {
          o: [0, 1],
          y: [40, 0, "px"],
        },
      })));
    }

    await Promise.all(anims);
  }
}
```

### Anima Properties

`Anima` is the animation primitive from kido. Key config options:

| Option | Type | Description |
|--------|------|-------------|
| `el` | `Element` | Target element |
| `d` | `number` | Duration in ms |
| `e` | `string \| number[]` | Easing — named preset (`"oQ"`, `"oC"`) or cubic-bezier array `[x1, y1, x2, y2]` |
| `de` | `number` | Delay in ms before the animation starts |
| `p` | `object` | Animated properties — `{ o: [0, 1], y: [40, 0, "px"], scale: [0.9, 1] }` |
| `cb` | `() => void` | Completion callback (used internally by `animaToPromise`) |
| `u` | `(state) => void` | Per-frame update callback for custom property driving |

Property format: `{ propName: [from, to, unit?] }`. Common properties:
- `o` — opacity
- `y` — translateY
- `x` — translateX
- `scale` — uniform scale
- `scaleX` / `scaleY` — axis scale

### Easing Reference

Named presets from the DefaultTransition:

| Name | Bezier | Character |
|------|--------|-----------|
| `[0.16, 1, 0.3, 1]` | o6 | Fast start, smooth decel — page transform |
| `[0.25, 1, 0.5, 1]` | o4 | Gentler decel — overlay opacity |
| `[0.76, 0, 0.2, 1]` | io | Ease in-out — curtain + clip |
| `"oQ"` | — | kido preset — split text |
| `"oC"` | — | kido preset — div scale |

### Exit Animations (`page.out()`)

The `out()` hook fires before the transition curtain starts. Use it for content-level exit animations (fading out text, sliding elements away) that should happen before the page-level wipe:

```typescript
async out(): Promise<void> {
  dbg.page("home:out — hero dismiss");

  if (this.heroTitle) {
    await animaToPromise(new Anima({
      el: this.heroTitle,
      d: 400,
      e: [0.38, 0.05, 0.65, 0.82],
      p: { o: [1, 0] },
    }));
  }
}
```

Note: `out()` is called by `PageManager.beforeOut()` which runs before the transition. The curtain wipe then covers the page, so exit animations should be fast (200-500ms).

### Return-to-home brand beat

`HomePage.in()` has a special case: on every SPA navigation **back to home**, it replays a compressed version of the boot intro before revealing the page — the DIAA mark on a blank field, held briefly, then faded out.

How it works:

- A persistent, hidden `.intro-beat` overlay (white field + DIAA SVG) lives on the `<body>` in the shell (`index.html`), styled by `core/intro-beat.module.scss`. Unlike the boot `.intro` overlay it is **not** removed after boot — it is reused on every return to home.
- The beat is gated on `App.mutating`, which is `true` only during a controller navigation and `false` in first-boot phase 5. This cleanly distinguishes a return-to-home (play the beat) from the first paint after the real intro (skip it — never double the intro).
- `HomePage.in()` adds `.is-active` to cover the swap. **Home stays hidden** (`opacity: 0`, as the transition's cleanup left it) for the entire beat — the beat plays entirely on the cover, exactly like the boot intro, and home is revealed only *after* the cover is gone. The swap window is already on the white html background (`var(--bg-theme)`), so the white overlay appearing is seamless — the DIAA mark (hidden by default via CSS `opacity: 0`, like `.intro__logo`) then **fades in** over it.
- It runs two Animas mirroring `Intro.play()`, both `p: { o }` opacity tweens with `r: 3` on the `"slow"` ease: (1) fade the mark in over `BEAT_FADE_IN`; (2) hold the mark (the fade-out Anima's `de: BEAT_HOLD` holds the cover at full opacity), then fade the whole cover (white field + mark) out over `BEAT_FADE_OUT` — to the blank white background, *not* to home. The overlay is then re-hidden and its inline opacities cleared.
- **Only then** does home fade in (`fadeContainer(1, …)`) — the same sequence as the intro (overlay out, *then* page in; never a crossfade), which is why the DIAA is fully gone before home appears.

Timings live in the tweakable `homeAnim` config (`src/app/components/home-anim.ts`: `beatFadeIn`, `beatHold`, `beatFadeOut` — shipped defaults 1200ms fade-in, 400ms hold, 800ms fade-out; the ease stays the `BEAT_EASE` constant in `home.ts`). No custom transition is involved — the default `EmptyTransition` still handles the DOM swap; the beat is purely a `page.in()` concern.

### Page fade contract & the home animation tweak panel

Every page enters over **1200ms** and exits over **800ms**, both on the `"slow"` spring-fit ease. The defaults live in `BasePage` (`PAGE_IN_DURATION` / `PAGE_OUT_DURATION` / `PAGE_FADE_EASE` drive `fadeContainer()` and the default `in()`/`out()` hooks — About inherits them as-is); pages that override the hooks (home, detail, contact/imprint) pin their own constants to the same values. Keep new pages on this rhythm.

The home page goes one step further: all of its durations live in the mutable `homeAnim` config (`src/app/components/home-anim.ts`) — beat fade-in/hold/fade-out, entrance duration/delay, exit duration, and the mode/filter switch fade — read at animation time, never cached. In dev builds, `HomePage.init()` mounts a tweak panel (bottom-right; `src/app/components/home-anim-gui.ts`) with a slider + number input per duration and an enable checkbox per group (off = skip that animation entirely). Edits apply to the next animation run and persist to localStorage across reloads; **Reset** restores the defaults. To ship a settled tuning, copy the values into `HOME_ANIM_DEFAULTS` in `home-anim.ts` — that object is the production behaviour (the panel and storage never load outside dev).

### RichTextPage shared primitive

`RichTextPage` (`src/app/primitives/rich-text-page.ts`, `RichTextPage extends BasePage`) is a shared abstract base for CMS singleton pages whose content is just a title + rich-text body — currently `ContactPage` and `ImprintPage`. It owns the whole content-lifecycle both pages need so their route `.ts` files only supply `pageKey` and `navSelector`:

- **`init()`** pins the container to `opacity: 0`, matching `BasePage`'s default hidden-state contract.
- **`in()`** runs a 1200ms entrance fade on the `"slow"` ease with a 200ms delay — the same rhythm as home's and detail's entrance.
- **`out()`** runs an 800ms exit fade on the same ease before the swap.
- **The title nav is a passive heading** — same model as the detail page: there is no hover title ⇄ `( Close )` swap; closing lives in a persistent fixed `( Close )` footer (`.contact__footer` / `.imprint__footer`) on every tier.
- **Desktop outro choreography** — shared with the detail page: the title nav fades out over 400ms (linear) once the DIAA outro enters the viewport and back in above it, and resting at the very bottom for 300ms auto-navigates home (suppressing the return-home brand beat via `beat-skip`, since the outro the user is dwelling on IS the brand moment).

`DetailPage` (`src/routes/detail/detail.ts`) does **not** subclass `RichTextPage` — its `in()` has an extra branch to cross-fade the home→detail image bridge clone (see "Home→detail bridge" above) that doesn't apply to the simpler Contact/Imprint pages, plus the cover-slide machinery. If a third rich-text-style page is added, extend `RichTextPage`; if it needs bridge-style coordination, follow `DetailPage`'s pattern instead.

---

## Layer 2: Scroll-Triggered Reveals (`Reveal`)

The `Reveal` system from kido handles below-the-fold content. It is initialized automatically by `PageManager.afterIn()` on every navigation — no setup needed in your page class.

### Usage

Add CSS zone classes to HTML elements. Reveal finds them, hides them, and animates them in when they scroll into the viewport.

### Zone Classes

| Class | Effect | Mechanism |
|-------|--------|-----------|
| `._s` or `.z__s` | Split text reveal | Word-by-word slide up from below |
| `.z__o` | Opacity fade | Children fade in with stagger |
| `.z__d` | Div scale | `scaleX(0 → 1)` reveal |
| `.z__g` | SVG mask | Stroke-dashoffset path reveal |

### Delay Modifiers

Append `-N` to the zone class to add stagger delay:

```html
<!-- 200ms extra delay (N * 100ms step) -->
<p class="z__o-2">Fades in after 200ms extra</p>

<!-- Different delays for scroll vs. already-in-viewport -->
<h2 class="z__o-1-3">
  <!-- -1 = 100ms extra delay when scrolled into view -->
  <!-- -3 = 300ms extra delay when already in viewport on page load -->
</h2>
```

The base delay (default 200ms) is added automatically. Modifier delays stack on top.

### Split Text Example

```html
<section>
  <h2 class="_s">This text reveals word by word</h2>
  <p class="_s s-40">This text uses a shorter 40ms stagger between words</p>
  <p class="_s t-1">This text also tilts on the X axis as it slides up</p>
</section>
```

The `Split` class from kido handles the word wrapping automatically. Each word gets wrapped in `<span class="s__o"><span class="s__i">` elements that are animated individually.

### Split text modifiers

| Class | Effect |
|-------|--------|
| `s-40` | Use 40ms stagger between words instead of the default 100ms |
| `t-1` | Add `rotateX(-30deg)` tilt during the slide-up |
| `data-split="br"` | Split on `<br>` tags instead of words |

### Opacity Fade Example

```html
<div class="z__o">
  <span class="o">Item 1</span>
  <span class="o">Item 2</span>
  <span class="o">Item 3</span>
</div>
```

Children with class `.o` are staggered with 100ms between each. If no `.o` children exist, the zone element itself fades in.

### Div Scale Example

```html
<div class="z__d">
  <div class="line"></div>
</div>
```

The child divs animate `scaleX(0 → 1)` with 300ms stagger. `transform-origin` defaults to `0% 50%` (left edge) if not set.

### Custom Selectors

The Reveal system is initialized by PageManager with `{ split: "._s" }` as the selector override. The full default selectors are:

```typescript
{
  opacity: ".z__o",  // Opacity fade zones
  split:   "._s",    // Split text zones (overridden from default ".z__s")
  div:     ".z__d",  // Div scale zones
  svg:     ".z__g",  // SVG mask zones
}
```

---

## Combining Both Layers

A typical page uses `in()` for the hero section and zone classes for everything below:

```html
<!-- Hero — animated by page.in() -->
<section class="hero">
  <h1 class="hero__title">Portfolio</h1>
  <div class="hero__item">Design</div>
  <div class="hero__item">Development</div>
</section>

<!-- Below the fold — animated by Reveal on scroll -->
<section class="about">
  <h2 class="_s">About the work</h2>
  <p class="z__o-1">Details that fade in as you scroll down.</p>
</section>

<section class="projects">
  <div class="z__d">
    <div class="divider"></div>
  </div>
  <h3 class="_s">Selected Projects</h3>
</section>
```

The hero elements are hidden in `init()`, revealed in `in()`. Everything with zone classes is handled automatically by Reveal as the user scrolls.

---

## Component-Based Animations

For reusable animated elements (not page-specific), extend the `Component` base class from `src/app/primitives/component.ts`. Components have their own lifecycle:

```typescript
import { Component } from "@app/primitives/component";

class AnimatedCounter extends Component {
  init(container: Element | null, selector: string): void {
    super.init(container, selector);
    this.componentName = "counter";
    this.computeTrigger();  // Calculate scroll trigger point
  }

  play(): void {
    // Triggered when the component scrolls into view
    this.hasPlayed = true;
    this.startLoop();
  }

  loop(): void {
    // Per-frame animation logic
  }

  destroy(): void {
    super.destroy();
  }
}
```

Components are instantiated and managed by the page class that uses them, typically in `init()` and destroyed in `cleanup()`.

---

## File Reference

| File | Role |
|------|------|
| `primitives/base-page.ts` | `BasePage` — lifecycle hooks (`init`, `in`, `out`, `cleanup`) |
| `primitives/component.ts` | `Component` — reusable animated element base class |
| `controller/transition-fx.ts` | `animaToPromise` helper + `DefaultTransition` |
| `page-manager.ts` | Calls `Reveal.init()` and `page.in()` after navigation |
| `kido/src/reveal.ts` | `Reveal` — scroll-triggered zone animation system |
| `kido/src/anima.ts` | `Anima` — animation primitive |
| `kido/src/split.ts` | `Split` — word-wrapping for split text reveals |
