# Remove WebGPU: canvas, tatara/katachi packages, and all GPU wiring

## Context

The site does not use WebGPU. The GPU engine was already **kill-switched** in commit
`d759cef` ("all-DOM image rendering") via `const ENABLE_GPU = false` in
`apps/fe/src/app/index.ts`. That commit's message states the intent explicitly:

> "Full deletion of gpu/, the tatara/katachi packages, and the `_g`/canvas wiring is a follow-up."

This plan **is** that follow-up. Because the kill switch already routes everything through
DOM fallbacks at runtime (`App.gpu` is always `null`; every GPU call is `App.gpu?.`-guarded or
behind `if (!gpu) return`), **this is dead-code removal with zero runtime behavior change** —
nothing a user sees changes. The goal: delete the two GPU packages, the canvas, the GPU
orchestrator, and scrub every remaining GPU reference so the codebase has none left.

User decisions (confirmed): **Full scrub** (no inert `App.gpu` plumbing left behind) and
**delete the 5 unreachable `demo`/`flow-iso` transition files** (they serve routes that don't
exist — only `home`, `about`, `detail` ship).

### Two things that look like GPU but are LIVE DOM — DO NOT DELETE

Verified by reading the markup + CSS:

1. **`.home__text-gpu*`** (`home.html` lines 67–82, `_home.module.scss` 151–225). Despite the
   name, `.home__text-gpu-figure` is `opacity:0` → `&.is-active { opacity:1 }` with a real
   `<img>`. Hovering a text label toggles `.is-active` and fades that centered image in behind
   the labels. This is the current text-mode hover reveal. **Keep the markup, the CSS, the
   `textGpu`/`textGpuFigures` fields, and the `.is-active` toggles.** Only the GPU *plane* code
   around them is removed.
2. **`._g`** (`base.module.scss` 320–332; overrides in `_globals.module.scss` 146–157 and
   `slices/_shared.module.scss` 9–25). This is the base figure class for **every** detail / slice
   / flex-grid image — it sets `aspect-ratio`, `overflow`, and `img { object-fit:cover }`.
   **Keep the `_g` class on `<figure class="_g">` in `picture.html` and all `._g` layout CSS.**
   Only the dead `body.gpu-active ._g img { display:none }` rule (never triggers) is removed.

---

## Execution (phased — typecheck dependencies make most phases sequential)

### Phase 1 — Delete files/dirs

- `packages/tatara/` (whole package — WebGPU renderer)
- `packages/katachi/` (whole package — 2D GPU primitives; only consumer is the gpu/ dir)
- `apps/fe/src/app/gpu/` (whole dir — `index.ts`, `hud.ts`, `README.md`, `__tests__/`)
- `apps/fe/src/routes/partials/canvas.html`
- `apps/fe/src/engine/boot/loader.ts` (GPUTexture preloader — gutted; Phase 3 replaces its one job)
- Orphan transitions in `apps/fe/src/app/controller/transitions/`:
  `demo-to-demo-inner.ts`, `flow-iso-to-flow-iso-inner.ts`, `flow-iso-inner-to-flow-iso.ts`,
  `flow-iso-config.ts`, `flow-iso-mini-layout.ts`

### Phase 2 — Workspace & build config

- `apps/fe/package.json` — remove deps `tatara`, `katachi`, `@webgpu/types`.
- `apps/fe/vite.config.ts` — delete the `manualChunks(id)` GPU-chunk function (~lines 222–229);
  remove `tatara`, `katachi` from `optimizeDeps.exclude` (keep `kido`).
- root `package.json` — remove `@webgpu/types`; remove the `msdf-gen` script **iff**
  `scripts/msdf-gen.ts` only feeds katachi's TextObject (verify, then delete the script too).
- `packages/kido/package.json` — remove the `@webgpu/types` devDep and the dead `.wgsl` tsup
  loader entry (kido has no `.wgsl` files and no GPU export — confirmed).
- `pnpm-workspace.yaml` — remove the `@webgpu/types` override.
- Re-run `pnpm install` to refresh the lockfile after package deletions.

### Phase 3 — Boot & app state

- `apps/fe/index.html` — remove `{{> canvas}}` and its DOM-stacking comment (~lines 31–36).
- `apps/fe/src/app/index.ts` — remove `ENABLE_GPU`; GPU boot phases **1, 3, 6** (the dynamic
  `import("./gpu")`, `new GPU()`, `gpu.load/intro/init/run/requestRedraw`, the `Sniff.isMobile`
  GPU gate); the entire `registerTransitionHooks({ onBeforeOut, onAfterIn })` block and both hook
  bodies; the `GpuHud` import + `hud` field + `createGpuHud()`; the `wireCanvasVisibility()` method
  and its call; the two `App.gpu?.requestRedraw/requestBoundsUpdate` calls in the scroller
  `onUpdate`. **Phase 2 (texture load)**: replace the `new Loader({...})`-wrapped promise with a
  direct resolve — the intro still plays; nothing needs preloading once GPU is gone. Keep `Sniff`
  import only if still used elsewhere in the file.
- `apps/fe/src/engine/boot/intro.ts` — remove the two `App.gpu?.requestExtraFrames/requestBoundsUpdate`
  optional calls (~lines 119–121). Intro otherwise has zero GPU coupling.
- `apps/fe/src/app/context.ts` — remove `import type { GPURenderer } from "tatara"`; the
  `GpuInstance` interface and all GPU helper types (`TextureLayer`, `RouteTextureConfig`,
  `RouteMediaSlot`, `GpuPlaneLike`, `GpuSceneLike`, `GpuTransitionState`, etc.); the
  `gpu: GpuInstance | null` field on `AppState` and `gpu: null` in the singleton; the entire
  `App.data.gpu` block (interface + initializer).
- `apps/fe/src/app/cache.ts` — remove `PkgGpuConfig`, the `gpu?` field on `PkgPayload`, and the
  three `if (pkg.gpu?.textures/selectors/sharedScenes)` write blocks.

### Phase 4 — Controller & transitions (navigation core — verify after)

- `apps/fe/src/app/controller/index.ts` — remove the 4 orphan-transition imports and their
  `registry.register("demo"/"flow-iso", …)` calls in the `Ctrl` constructor (registry keeps its
  `EmptyTransition` default — home/about/detail use it); remove `registerTransitionHooks()` method
  and the `TransitionHooks` import.
- `apps/fe/src/app/controller/transition-manager.ts` — remove the `hooks` array, `registerHooks()`,
  the three hook-dispatch blocks, the two trailing `App.gpu?.renderer?.requestBoundsUpdate` /
  `App.gpu?.requestRedraw` calls, and the `TransitionHooks` import. (GPU was the only hook
  subscriber; the generic hook mechanism is now dead.)
- `apps/fe/src/app/controller/types.ts` — remove the `TransitionHooks` interface.
- `apps/fe/src/app/controller/transition-fx.ts` — in `DefaultTransition`, `EmptyTransition`,
  `FadeTransition`: remove the `const gpu = App.gpu` reads, the `toScene?.planes` opacity loops,
  the canvas-`zIndex` block + `_canvas` field, and the `requestRedraw`/`requestBoundsUpdate` calls.
  **Keep** the DOM container fades and the insert/remove choreography (that's the real transition).
  `animaToPromise` (exported here, used by pages) is untouched.

### Phase 5 — Pages

- `apps/fe/src/routes/home/home.ts` — remove `GpuPlaneLike` import; the `planes` field and its
  hydration (`App.gpu?.scene?.planes ?? []`); the plane-only methods `fadePlane`, `snapPlanes`,
  `snapPlanesForMode`, `fadeAllPlanesForMode`, `fadeAllPlanesTo`, `planeBaseOpacity`, `planeTarget`,
  `rebindScene`, and **all their call sites** in `init`, `applyFilter`, `switchMode`,
  `switchFilter`, `in`; every `App.gpu?.requestRedraw/scene?.*` call; `this.planes = []` in cleanup.
  **KEEP everything else**: `textGpu`/`textGpuFigures` fields, the `.is-active` hover toggles, the
  DOM pane/footer opacity fades, `applyModeDom`, `applyFilter` visibility logic, scroll restore,
  `fitTextRows`, the whole nav expand/collapse system. In the hover loops, drop the
  `const plane = …` + `if (plane) this.fadePlane(...)` lines but keep the `classList.add/remove("is-active")`.
  Update the class-header comment (lines 1–20) to describe the DOM-only text/image modes.
- `apps/fe/src/routes/detail/detail.ts` — remove `GpuPlaneLike` import, the `planes` field, the
  plane hydration + opacity loops in `init`/`in`/`out`, the `App.gpu?.requestRedraw` calls.
  **KEEP** the container-opacity `Anima` in `in()`/`out()` — that DOM crossfade is the visible
  transition. Update the file/method comments to drop plane references.

### Phase 6 — Build content pipeline (stop emitting dead GPU descriptors)

- `apps/fe/scripts/sanity-content.ts` — stop building and returning the `media[url] = { textures }`
  map (home + detail texture-layer blocks). Drop `media` from the return shape.
- `apps/fe/scripts/routes-plugin.ts` — stop constructing/emitting the `gpu` block
  (`textures`/`selectors`/`sharedScenes`) into `tmhgne.json`; drop the `media`→`gpu.textures`
  assignment and remove `gpu` from the `PkgPayload` type. (Consumers in `cache.ts`/`context.ts`
  removed in Phase 3.)
- `apps/fe/scripts/utils/queries.ts` — no GPU-specific fields exist; no change needed (verify).

### Phase 7 — Styles & misleading comments

- `apps/fe/src/styles/core/base.module.scss` — remove the `#canvas` rule (63–70), the `.gpu-hud`
  block (218–313), and the `body.gpu-active ._g img { display:none }` rule (334–338). Update the
  `#app` stacking comment (47–55) and the `._g` comment (315–319) to drop canvas/GPU language.
  **Keep** the `._g` base rule, `#app`, `#page`, everything else.
- Light comment fixes (no behavior change) where text still claims GPU rendering:
  `home.html` (67–73, 19–21, 37–38), `picture.html`, `_home.module.scss` (3–5, 151–157, 253–257,
  285–288), `slices/_shared.module.scss` (5–8). Reword to DOM terms; do not change classes/markup.

### Phase 8 — Verify, changelog, docs

- `pnpm install` clean (no tatara/katachi/@webgpu/types).
- `pnpm --filter fe build` passes (this runs lint + `tsc` + vite build + img-optimize). The tsc
  pass is the primary gate — it catches any missed GPU import/type reference.
- `pnpm --filter fe test` passes (the deleted `gpu/__tests__` is the only GPU test; confirm no
  other test imports gpu/tatara/katachi).
- Manual smoke via `pnpm --filter fe dev` (port 3000): home **text mode** (hover label → centered
  image reveal, filter buttons, nav expand/collapse), **image mode** (toggle, hover title overlay,
  filter), home→detail→back and home→about transitions (DOM crossfade), intro overlay on first load.
- `CHANGELOG.md` — add an `[Unreleased]` entry (Keep a Changelog): removed WebGPU engine
  (tatara/katachi), GPU orchestrator, canvas, and dead transition scaffolding; all rendering is DOM.
- Docs — correct the now-false GPU claims in `CLAUDE.md` (the GPU/tatara/katachi sections,
  absolute-rules 2 & 3, the 8-phase boot description), `apps/fe/README.md`, and
  `apps/fe/docs/*.md`. Scope: remove/replace GPU statements, not a full rewrite.

---

## Risks & mitigations

- **Navigation regressions** from Phase 4 (touching the transition core). Mitigation: the hook
  dispatch points were already no-ops at runtime; verify all three nav paths after.
- **Over-deletion of `_g` / `home__text-gpu`** would break image layout and the text-mode hover
  reveal. Mitigation: explicit keep-list above; these stay.
- **Build-script return-shape change** (Phase 6) must stay in sync between `sanity-content.ts` and
  `routes-plugin.ts`. Do them together; the build gate catches a mismatch.
- **`scripts/msdf-gen.ts` / `apps/editor`** may reference katachi/tatara. Verify before/after
  deleting packages; `apps/editor` (WGSL playground) is out of scope unless it imports the deleted
  packages — flag if it does rather than silently changing it.

## Files deleted (6 targets) / edited (~22)

Deleted: `packages/tatara/`, `packages/katachi/`, `apps/fe/src/app/gpu/`,
`apps/fe/src/routes/partials/canvas.html`, `apps/fe/src/engine/boot/loader.ts`, 5 transition files.
Edited: `index.html`, `app/index.ts`, `engine/boot/intro.ts`, `app/context.ts`, `app/cache.ts`,
`controller/{index,transition-manager,types,transition-fx}.ts`, `routes/{home/home,detail/detail}.ts`,
`scripts/{sanity-content,routes-plugin}.ts`, `vite.config.ts`, both `package.json`s,
`pnpm-workspace.yaml`, `kido/package.json`, `styles/core/base.module.scss`, comment-only style/markup
touch-ups, `CHANGELOG.md`, and docs.
