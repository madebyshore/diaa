# Home → Detail: live-image bridge transition + hero re-layout

## Context

On the home page in **text mode**, hovering a project label reveals that
project's cover image, centered in the viewport behind the labels
(`.home__text-gpu-figure.is-active`, `position: fixed`, CSS opacity fade).
Clicking the label (`<a href="/{slug}">`) navigates to that project's detail
page, whose hero (`.detail__cover`) is **the same image at the same size** — the
detail SCSS was deliberately built to match the home reveal geometry.

Today the navigation runs the default `EmptyTransition`: `HomePage.out()` fades
the **entire** home `<section>` (image included) to 0, then `DetailPage.in()`
fades the detail container up. The revealed image blinks out and back — the
continuity the matching geometry was designed for is lost.

This change has **two coupled parts**:

1. **Detail hero re-layout** — currently the hero lives in a 1:1 box (≈viewport
   height on typical screens, so it reads as ~100vh) with the figure centered in
   it and lots of empty space above/below. Re-layout so: the figure's **center
   sits at 50vh** (the same vertical position the home reveal image holds), the
   **bottom of the figure is the bottom of `.detail__cover`** (crop the empty
   space below), and the slices begin **14.2rem under the figure**.
2. **Live-image bridge transition** — when (and only when) leaving home for a
   detail page **in text mode with an image actively revealed**, fade out the
   text/nav/footer but keep that image visible and stationary, then cross-fade
   the detail page in over it.

The two parts reinforce each other: with the hero re-layout, the detail hero
lands at the exact viewport position the held image occupies, so the cross-fade
is **pixel-aligned and seamless** (the image literally does not move).

**Confirmed with the user:**
- Bridge resolves by **hold-in-place + cross-fade** (image stays put; detail
  fades in; held image fades out in lockstep). Not a position morph.
- Home exit: **fade text labels + top nav + footer**, sparing the image.
- Scope: **home → detail only**. Back-nav (detail → home) is out of scope.

---

## Part A — Detail hero re-layout (`apps/fe/src/styles/pages/_detail.module.scss`)

Goal geometry (at scroll top): figure center at `50vh`; `.detail__cover` bottom =
figure bottom; existing `gap: var(--XL)` (= 14.2rem) then gives the 14.2rem to the
first slice for free.

Required values:
- `cover height = top-space + figure-height`, where `top-space = 50vh − H/2`
  (the home image's viewport-centred top offset) and `H` = figure height.
- `H` is a fixed % of the **centre-8 box width**, identical to home
  (`4x3 → 43.74%`, `3x4 → 58.35%`). The centre-8 width is derived from the grid
  tokens so it adapts at every breakpoint.

Rewrite the cover block (replacing current `_detail.module.scss:87–135`). Keep the
existing `.detail__cover-inner--{coverSize}` classes on the inner (no template
change) and read them on the parent via `:has()`:

```scss
.detail__cover {
  // Centre-8 box width, mirroring the 12-col grid math exactly (1fr accounts for
  // the 11 inter-column gaps; centre-8 spans cols 3→10 = 8 tracks + 7 gaps).
  // Uses the responsive grid tokens, so this tracks every breakpoint.
  --col-w: calc(
    (100vw - 2 * var(--container-padding) - (var(--columns) - 1) * var(--column-gap))
    / var(--columns)
  );
  --centre-8: calc(8 * var(--col-w) + 7 * var(--column-gap));
  // --hero-h (the figure height) is set per coverSize below.

  display: grid;
  grid-template-columns: repeat(var(--columns), 1fr);
  gap: var(--column-gap);
  padding: 0 var(--container-padding);
  // Top space = the home reveal image's viewport-centred top offset, so the
  // bridged image lands exactly in place. No bottom space → cover ends at the
  // figure bottom; the container's `gap: var(--XL)` (14.2rem) then sits below it.
  padding-top: calc(50vh - var(--hero-h) / 2);
  align-items: start;
  flex-shrink: 0;
}

// Figure height as a % of centre-8 — same %s as `.home__text-gpu-figure`.
.detail__cover:has(.detail__cover-inner--4x3-sm),
.detail__cover:has(.detail__cover-inner--4x3-lg) { --hero-h: calc(0.4374 * var(--centre-8)); }
.detail__cover:has(.detail__cover-inner--3x4-sm),
.detail__cover:has(.detail__cover-inner--3x4-lg) { --hero-h: calc(0.5835 * var(--centre-8)); }

// Inner is now the figure box itself (height = the figure height), not a 1:1
// reference box. Width still spans centre-8; the figure width % is unchanged.
.detail__cover-inner {
  grid-column: 3 / span 8;
  position: relative;
  width: 100%;
  height: var(--hero-h);
}
.detail__cover-inner ._g {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  height: 100%;
  margin: 0;
  aspect-ratio: auto;
  overflow: hidden;
}
.detail__cover-inner--4x3-sm ._g,
.detail__cover-inner--4x3-lg ._g { width: 58.35%; }
.detail__cover-inner--3x4-sm ._g,
.detail__cover-inner--3x4-lg ._g { width: 43.74%; }
.detail__cover-inner ._g img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

Notes / why this matches home exactly:
- For `4x3`: figure `width: 58.35%` of centre-8, `height: --hero-h = 0.4374 ×
  centre-8` → same px dimensions and 4:3 aspect as `.home__text-gpu-figure`.
- `--XL` (root token) **is** `14.2rem`; `.detail__container { gap: var(--XL) }`
  is unchanged, so cropping the bottom is all that's needed for "14.2rem under
  the hero." **No `.detail__container` change.**
- No template/HTML change (the `:has()` selectors read the existing inner
  variant class). If `:has()` is ever a concern, the alternative is to add
  `detail__cover--{{coverSize}}` to the cover `<div>` in `*detail.html` and set
  `--hero-h` on those classes instead.
- `50vh` matches home's unit (home uses `100vh` for the fixed `.home__text-gpu`),
  so both pages compute the centre identically.

---

## Part B — Live-image bridge transition

### Timing constraint that drives the design
Per `transition-manager.ts`:
1. `PageManager.beforeOut()` → **`HomePage.out()` runs fully** (awaited) — *before* any transition `out`/`in`.
2. `Promise.all(transition.out(fromEl,toEl), transition.in(fromEl,toEl))` — home section **still in DOM**.
3. double-RAF → `setActiveRoute` → **150 ms** → `removeOld()` (home removed).
4. `transition.cleanup(toEl)`.
5. `PageManager.afterIn()` → `DetailPage.init()` (pins detail opacity 0) → **`DetailPage.in()`** (owns the reveal fade).

Consequences:
- The image is in the home container, so keeping it alive means **`HomePage.out()`
  must not fade it** in the bridge case.
- The home `<section>` is removed at step 3 → the image must be **promoted to a
  `position: fixed` clone on `document.body`** during step 2 to survive.
- The detail reveal is owned by `DetailPage.in()` (step 5, after the transition
  returns) → the **cross-fade is driven from `DetailPage.in()`**; a shared handle
  passes the clone from the transition to the page.

Detection needs no new persistent state: `App.route.new.page === "detail"`,
`App.home.mode === "text"`, and a `.home__text-gpu-figure.is-active` in the home
section are all readable when needed (`App.route`/`App.home` are set before
`HomePage.out()`).

### B1. New shared handle — `apps/fe/src/app/controller/image-bridge.ts`
```ts
let bridge: HTMLElement | null = null;
export function setImageBridge(el: HTMLElement | null): void { bridge = el; }
/** Take + clear (null on normal navs). DetailPage.in() consumes it. */
export function takeImageBridge(): HTMLElement | null { const b = bridge; bridge = null; return b; }
```

### B2. New transition — `apps/fe/src/app/controller/transitions/home-to-detail.ts`
Scaffold to satisfy the project rule, then complete (the generator's wiring step
is known-broken — see B4):
```bash
cd apps/fe && pnpm run new-transition   # from: home, to: detail
```
Implement `HomeDetailTransition extends BaseTransition`:
- **`out(fromEl, toEl)`** — `bridging = App.home.mode === "text" &&
  fromEl.querySelector(".home__text-gpu-figure.is-active")`. If not bridging →
  no-op (matches `EmptyTransition.out`). If bridging → measure
  `activeFigure.getBoundingClientRect()`, build a clone appended to
  `document.body`:
  - `position: fixed` at the measured `top/left/width/height`; `transform: none`;
    `margin: 0`; `transition: none` (kill the `.home__text-gpu-figure` 800 ms
    opacity transition so our Anima owns opacity); `overflow: hidden`; inner
    `<img>` at `width/height: 100%; object-fit: cover`; high `z-index` (above the
    incoming page); `opacity: 1`; `pointer-events: none`.
  - Clone the whole `<figure>` (`cloneNode(true)`) so the decoded `<img>` comes
    along (no re-fetch / flash), then override positioning as above.
  - `setImageBridge(clone)`.
- **`in(fromEl, toEl)`** — pin the incoming page exactly like `EmptyTransition.in`
  (`fixed; top/left:0; width:100%; height:100vh; z-index:2; opacity:0`).
- **`cleanup(toEl)`** — mirror `EmptyTransition.cleanup` (scroll top, strip
  styles, re-pin `opacity:0`). **Do not** remove the bridge — `DetailPage.in()`
  owns it.

### B3. `HomePage.out()` — spare the image when bridging (`home.ts:575`)
```ts
async out(): Promise<void> {
  dbg.page("home:out");
  for (const a of this.hoverAnimas) a?.pause();

  const activeFigure = this.textGpu?.querySelector<HTMLElement>(
    ".home__text-gpu-figure.is-active",
  );
  const bridging =
    App.route.new.page === "detail" && App.home.mode === "text" && !!activeFigure;

  if (bridging) {
    // Keep the revealed image alive for the HomeDetailTransition bridge: fade
    // only the chrome (text pane + top nav + footer); leave the container (and
    // .home__text-gpu) opaque so the active figure stays visible. The transition
    // promotes that figure to a fixed body clone that survives removeOld().
    const targets = [this.textPane, this.navEl, this.footer].filter(
      (el): el is HTMLElement => !!el,
    );
    await animaToPromise(new Anima({
      el: window, d: MODE_SWITCH_DURATION, e: MODE_SWITCH_EASE,
      u: (s: AnimaState) => { const o = String(1 - s.prE); for (const el of targets) el.style.opacity = o; },
    }));
    return;
  }
  await this.fadeContainer(0);   // unchanged default path
}
```
`this.navEl` = top `.global-nav`; `this.footer` = `.global-nav--footer`; both
captured in `init()`. `AnimaState` is already imported.

### B4. Register the transition (`controller/index.ts`)
The plop generator injects by matching `DefaultTransition`, but this controller
uses `EmptyTransition`, so both injections silently fail — add manually:
- Import near line 32: `import { HomeDetailTransition } from "./transitions/home-to-detail";`
- After `this.registry = new TransitionRegistry(new EmptyTransition());` (line 110):
  `this.registry.register("home", "detail", new HomeDetailTransition());`

### B5. `DetailPage.in()` — cross-fade against the bridge (`detail.ts:124`)
```ts
async in(): Promise<void> {
  dbg.page("detail:in");
  const bridge = takeImageBridge();          // null on normal navs → unchanged path
  if (bridge) {
    const container = this.container as HTMLElement;
    await animaToPromise(new Anima({
      el: window, d: DETAIL_IN_DURATION, e: DETAIL_IN_EASE, de: DETAIL_IN_DELAY,
      u: (s: AnimaState) => {
        container.style.opacity = String(s.prE);   // detail 0→1
        bridge.style.opacity = String(1 - s.prE);  // held image 1→0, in lockstep
      },
    }));
    container.style.opacity = "";
    bridge.remove();
    return;
  }
  await this.fadeContainer(1, DETAIL_IN_DURATION, { e: DETAIL_IN_EASE, de: DETAIL_IN_DELAY });
}
```
Import `takeImageBridge` from `@app/controller/image-bridge`. With Part A in
place, the detail hero is at the same viewport position/size as `bridge`, so this
cross-fade is seamless.

---

## Why this is safe / contained
- The special path is gated by `mode === "text"` + an active figure + target
  `detail`. Image-mode clicks, keyboard activation without hover, and every other
  route pair fall through to the existing `EmptyTransition` +
  `HomePage.out()`/`DetailPage.in()` behavior unchanged.
- `takeImageBridge()` returns `null` on any non-bridging nav, so `DetailPage.in()`
  is byte-for-byte current behavior there.
- The bridge is self-cleaning (consumed + removed by `DetailPage.in()`). Harden
  during impl: if a bridge is set but `DetailPage.in()` never runs (aborted nav),
  clear it on `App.mutating` reset / in `HomeDetailTransition.cleanup` as a
  failsafe so no stale fixed clone lingers.
- Part A is a standalone layout improvement: on direct loads / mobile (no hover,
  no bridge) the hero simply renders centered at 50vh with 14.2rem to the slices.

## Files
| File | Change |
|---|---|
| `apps/fe/src/styles/pages/_detail.module.scss` | **Part A** — re-layout `.detail__cover*` (centre-8 calc, 50vh top, crop bottom) |
| `apps/fe/src/app/controller/image-bridge.ts` | **new** — `setImageBridge` / `takeImageBridge` |
| `apps/fe/src/app/controller/transitions/home-to-detail.ts` | **new** — `HomeDetailTransition` (scaffold via generator, then implement) |
| `apps/fe/src/routes/home/home.ts` | `out()` — spare the image, fade chrome only, when bridging |
| `apps/fe/src/app/controller/index.ts` | import + `registry.register("home","detail", …)` (manual; generator regex won't match) |
| `apps/fe/src/routes/detail/detail.ts` | `in()` — cross-fade bridge ↔ container when present |
| `CHANGELOG.md` | `[Unreleased]` entries (one per commit) |
| `apps/fe/docs/controller.md` | document the registered transition + bridge handle |

No `*detail.html` change (Part A reads the existing inner variant class via
`:has()`). No `.detail__container` change (`--XL` is already 14.2rem).

## Suggested commits (commit between steps, per project workflow)
1. `feat(detail): hero centred at 50vh, cover cropped to image bottom` (Part A).
2. `feat(transition): keep the active home image live across home→detail` (Part B).

## Verification
1. `pnpm --filter fe dev`, open `http://localhost:3000`.
2. **Part A (any nav / direct load):** open a detail URL directly. Hero figure
   centered at ~50vh, cover ends at the image bottom, first slice 14.2rem below
   the image; cover no longer reads as ~100vh. Check `4x3` and `3x4` covers and a
   narrow (`md`) width — figure size/aspect match the home reveal at each.
3. **Part B (text mode):** hover a project label so its image reveals → click it.
   Labels/nav/footer fade out, the image **stays put** at viewport centre, the
   detail page cross-fades in, and the image lands exactly on the detail hero
   (seamless — no jump/blink).
4. **Regression — no active image:** focus a label via keyboard + Enter (no
   hover) → normal whole-page crossfade; no stray fixed image left on screen.
5. **Regression — image mode:** switch to Image mode, click a tile → unchanged
   default transition.
6. **Regression — back nav:** from detail, click "( Close )" → home enters
   normally; confirm no leftover fixed clone
   (`document.querySelectorAll('body > figure')` is empty after).
7. Watch `[page:home:out]`, `[tx…]`, `[page:detail:in]` logs for the expected
   order; confirm the bridge `<figure>` is removed after `detail:in`.
8. `pnpm --filter fe build` (lint + typecheck) passes.
