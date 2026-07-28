# Tamahagane — Frontend

Portfolio site rebuilt from the akimbo codebase. SPA with WebGPU rendering, custom page transitions, and kido-based animation.

## Architecture Docs

- [Boot Sequence](./docs/boot.md) — 5-phase init pipeline, IntroAnimation, canvas visibility, GPU fallback
- [Controller & Transitions](./docs/controller.md) — Navigation controller, TransitionHooks, transition choreography, custom transition API
- [Page Animations](./docs/page-animations.md) — Content entrance/exit animations, scroll-triggered reveals, Anima usage, Reveal zone classes
- [Routing](./docs/routing.md) — Co-located route folders, auto-registration, page lifecycle API, scroll save/restore
- [GPU Rendering](./docs/gpu.md) — WebGPU scene system, planes, and shaders *(planned)*

## Directory Structure

```
src/
  app/
    controller/          # Navigation controller (Ctrl, TransitionManager, TransitionHooks)
    gpu/                 # WebGPU rendering engine
    primitives/          # Base classes (BasePage with lifecycle hooks)
    components/          # Shared UI components
    context.ts           # App singleton state (AppState, GPU/scene/media types)
    cache.ts             # Page HTML cache
    index.ts             # Application class — 5-phase boot sequence
    page-manager.ts      # Auto-registration via import.meta.glob + lifecycle + scroll restore
  routes/                # Co-located route folders (HTML + TS per route)
    partials/            # Shared Mustache partials (nav, meta, ...)
    home/                # Home route: home.html + home.ts
    contact/             # Contact route: CMS singleton rich-text page (contact.html + contact.ts)
    imprint/             # Imprint route: CMS singleton rich-text page (imprint.html + imprint.ts)
    sanity/              # Sanity CMS test route: sanity.html + sanity.ts
    case-study/          # CMS template: *case-study.html + case-study.ts
  engine/
    boot/                # Intro animation (pure — no GPU deps) + Loader texture preloader
packages/
  kido/                  # Animation (Anima), scroller, GPU renderer primitives
```

## Boot Sequence

`Application.init()` runs five discrete phases in order:

1. **GPU Init** — `new GPU()` + `gpu.load()` (WebGPU device + shader compile)
2. **Texture Load** — `new Intro()` + `new Loader()` (counter display + texture preload)
3. **Scene Setup** — `gpu.intro/init/run()` + `intro.play()` (skipped if no WebGPU)
4. **Controller** — `installController()` + GPU transition hooks + `App.ctrl` set
5. **Scroller** — `new NativeScroller()` + `PageManager.registerFromRoutes()` + `afterIn()`

For details, see [docs/boot.md](./docs/boot.md).

## Routes

Routes are co-located folders under `src/routes/`. Each folder contains an HTML template and a TypeScript page module:

```
src/routes/{name}/
  {name}.html    <- Mustache template fragment rendered by the Vite plugin
  {name}.ts      <- Default-exports a class extending BasePage
```

**Adding a new route:** Create a folder, add an HTML file and a TS module. No other files need to change — `PageManager` auto-discovers the module via `import.meta.glob` and registers it at build time.

**CMS template routes** use a star-prefix on the HTML filename: `*{name}.html`. The Vite plugin renders the template once per Sanity CMS page. All CMS-driven pages at that template share a single page class.

For full details, see [docs/routing.md](./docs/routing.md).

**CMS singleton rich-text pages:** `contact` and `imprint` are Sanity-authored singleton pages (title + rich-text body) sharing a common abstract `RichTextPage` (`src/app/primitives/rich-text-page.ts`) that owns the entrance/exit fades and the detail-style title/`( Close )` nav hover swap — each page's `.ts` file is a two-line subclass. See [docs/page-animations.md](./docs/page-animations.md#richtextpage-shared-primitive).

**Home animation tweak panel (dev only):** in `pnpm dev`, the home page mounts a bottom-right panel with sliders and toggles for every home animation duration (brand beat, entrance, exit, mode/filter switch), backed by the `homeAnim` config in `src/app/components/home-anim.ts`. Edits apply live and persist across reloads; production always runs the defaults. See [docs/page-animations.md](./docs/page-animations.md#page-fade-contract--the-home-animation-tweak-panel).

### Page Lifecycle

Route modules export a class extending `BasePage`:

```typescript
import { BasePage } from "@app/primitives/base-page";

export default class PortfolioPage extends BasePage {
  async init(container: Element | null): Promise<void> { /* query DOM */ }
  async in(): Promise<void> { /* enter animations (kido/anima) */ }
  async out(): Promise<void> { /* exit animations */ }
  async cleanup(): Promise<void> { /* teardown */ }
}
```

## Navigation & Transitions

All navigation flows through `Ctrl.navigate()`:

- **Event delegation:** clicks on `<a>` elements and `popstate` events are intercepted automatically
- **Transition lock:** prevents concurrent navigation; 8s safety timeout
- **TransitionHooks:** GPU and other subsystems register lifecycle hooks (`onBeforeOut`, `onAfterIn`) — the controller never calls GPU directly
- **Scroll restore:** back-nav restores saved scroll position; forward-nav resets to top
- **Custom transitions:** extend `BaseTransition` and register for specific route pairs

For details, see [docs/controller.md](./docs/controller.md).

## Canvas Visibility

On mobile (below 1024px), the WebGPU canvas is hidden via CSS `display:none` rather than DOM removal. This preserves the WebGPU context — DOM detach would cause context loss.

## Scaffolding Generators

Plop-based generators for creating new pages and transitions from the terminal.

### Create a new page

```sh
pnpm run new-page
```

Walks you through:

1. **Page name** — kebab-case folder name (e.g. `contact`, `case-study`)
2. **Route path** — URL path (defaults to `/{name}`)
3. **Page title** — browser tab title (defaults to PascalCase of name)
4. **CMS template?** — if yes, uses star-prefix HTML filename (`*{name}.html`)

What it creates:

- `src/routes/{name}/{name}.html` — Mustache template with `{{> nav}}` partial and a container
- `src/routes/{name}/{name}.ts` — Page class extending `BasePage` with scaffolded lifecycle hooks
- Appends a page entry + media entry to `scripts/sanity-content.ts`

The page class is auto-discovered by `PageManager` via `import.meta.glob` — no manual registration needed.

### Create a custom transition

```sh
pnpm run new-transition
```

Walks you through:

1. **From page** — select from existing routes
2. **To page** — select from existing routes
3. **Class name** — defaults to `{From}{To}Transition`

What it creates:

- `src/app/controller/transitions/{from}-to-{to}.ts` — Transition class extending `BaseTransition` with scaffolded `out()`, `in()`, and `cleanup()` methods
- Adds import and `registry.register()` call in `src/app/controller/index.ts`

The transition is automatically resolved by the `TransitionRegistry` when navigating between the specified pages. All other route pairs continue to use `DefaultTransition`.

### After scaffolding

- **New page:** Replace placeholder content in the HTML template, add entrance animations in `in()`, and update the media URLs in `sanity-content.ts`
- **New transition:** Implement the `out()` and `in()` animation methods using `kido/anima` + `animaToPromise()`

## Image Pipeline

Source images live in `public/assets/images/` (originals only). At build time:

1. `vite build` copies originals to `dist/assets/images/`
2. `tsx scripts/img-optimize.ts` generates AVIF/WebP/JPEG variants at 640w, 1024w, and 1920w

HTML templates use a shared `{{> picture}}` Mustache partial that renders responsive `<picture>` elements with all three format srcsets. Image metadata is defined in `scripts/sanity-content.ts`:

- **Local images** — `localPicture()` builds paths like `/assets/images/1-640w.avif`
- **Sanity images** — `sanityPicture()` builds Sanity CDN URLs with `?w=640&fm=webp` params

**Cover video (MP4).** A Detail can carry an optional `coverVideo` (Sanity `file`, MP4-only) alongside its `coverImage`. When present, `coverMedia()` in `scripts/sanity-content.ts` produces a shared `CoverMedia` shape (`{ ...PictureData, hasVideo, video }`) and the `{{> picture}}` partial (and the home hover-reveal figure) render a looping `<video autoplay loop muted playsinline>` instead of `<img>`, with the cover image as the `poster`. This applies everywhere the cover appears — home grid, text-mode hover reveal, and the detail-page cover — and the home→detail image bridge carries the live video across the swap. `<video>` is styled `object-fit: cover` identically to `<img>` so the two are interchangeable.

The GPU texture loader (`src/engine/boot/loader.ts`) negotiates the best format at runtime (AVIF > WebP > JPEG) via `resolveOptimizedUrl()`. In dev mode, it serves originals directly.

## Sanity CMS

Connected to Sanity project `r8x2r9d9` (configured in `project.config.ts`). The `/sanity` test route fetches the `pageHome` document's images array and renders them through the same responsive picture pipeline.

The backend schema lives in `apps/be/` — deploy with `cd apps/be && npx sanity deploy`.

### Content cache — zero refetch by default

Sanity fetches are expensive (API quota + wall-clock during the dev-server rebuild loop, which re-runs on every file change). `loadSanityContent()` therefore persists the Sanity-derived `{pages, media}` slice to `apps/fe/.cache/sanity-content.json` (gitignored) on the first call, and reads from that file on every subsequent call. Static page entries (home, etc.) are always rebuilt from code — only the CMS slice is cached.

**The cache is the single source of truth for CMS content.** New dev sessions and production builds never touch the Sanity API until you explicitly invalidate the cache. This is intentional: Sanity content changes happen in bursts, and we don't want the dev loop burning quota.

**To pull fresh content from Sanity:**

```bash
cd apps/fe
pnpm run cms:refresh
```

That runs `scripts/cms-refresh.ts`, which does a one-shot GROQ fetch and overwrites the cache file. The next `pnpm dev` or `pnpm build` picks up the new content automatically.

**Alternatives:**

- `SANITY_REFRESH=1 pnpm dev` — force a refetch during a single dev session or build.
- Delete `apps/fe/.cache/sanity-content.json` — the next call will detect the missing cache and refetch once.

## Key Dependencies

- **kido/anima** — All animation. Never use GSAP.
- **WebGPU** — Rendering engine in `src/app/gpu/`
- **Vite** — Build tooling with custom route generation plugin (`scripts/routes-plugin.ts`)
- **Mustache** — HTML template rendering in the Vite plugin
- **Sanity** — CMS for case-study and homepage content
- **sharp** — Build-time image optimization (AVIF/WebP/JPEG variants)
