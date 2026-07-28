# Tamahagane 玉鋼

A creative portfolio site built with vanilla TypeScript, WebGPU rendering, and Sanity CMS. Turborepo monorepo.

## Apps

| App | Description | Stack |
|-----|-------------|-------|
| `apps/fe` | Frontend website | Vite 5, TypeScript, WebGPU, SCSS, Mustache |
| `apps/be` | Sanity Content Studio | Sanity v3, React 19 |
| `apps/editor` | WGSL shader editor | Vite 6, CodeMirror 6, WebGPU |

## Packages

| Package | Description |
|---------|-------------|
| `packages/kido` | Animation, scroll, and DOM utility library (ESM, tree-shakeable). Anima, Raf, Reveal, Split, Scroller, NativeScroller, ResizeHub, PointerMove, WheelKeys, Svg, Sniff, Ease, utils |
| `packages/tatara` | WebGPU rendering engine — device, pipeline, renderer (batched textured quads), camera, uniforms, texture, video, post-processing, WebGL fallback |
| `packages/katachi` | Typed 2D GPU primitives on top of tatara — MSDF text, SDF shapes, noise, plane/text objects, scene graph |

## Getting Started

```bash
# Install dependencies
pnpm install

# Run all apps
pnpm dev

# Run specific app
pnpm --filter fe dev        # Frontend (port 3000)
pnpm --filter tamahagane-be dev  # Sanity Studio

# Build
pnpm build

# Test
pnpm test
```

## Project Structure

```
tamahagane/
├── apps/
│   ├── fe/                                  Frontend website (Vite 8 SPA)
│   │   ├── scripts/                         Build-time tooling
│   │   │   ├── routes-plugin.ts             Vite plugin: route HTML generation + tmhgne.json manifest
│   │   │   ├── sanity-content.ts            Sanity CMS data fetcher (build-time only)
│   │   │   ├── img-optimize.ts              Post-build image variants (AVIF/WebP/JPEG via sharp)
│   │   │   ├── init.ts                      Project bootstrap script
│   │   │   ├── mustache.d.ts                Mustache type declarations
│   │   │   └── utils/
│   │   │       ├── queries.ts               Sanity GROQ queries
│   │   │       ├── image-url.ts             Sanity image URL builder
│   │   │       └── logger.ts                Build-time logger with sections/timing
│   │   ├── src/
│   │   │   ├── main.ts                      Entry — instantiates Application and calls init()
│   │   │   ├── app/                         Application layer (domain logic)
│   │   │   │   ├── index.ts                 Application class — the 8-phase boot orchestrator
│   │   │   │   ├── context.ts               App singleton (global mutable state + types)
│   │   │   │   ├── cache.ts                 loadPkg(): read inlined tmhgne.json → populate App
│   │   │   │   ├── page-manager.ts          PageManager singleton — auto-registration + lifecycle + scroll restore
│   │   │   │   ├── utils.ts                 bootstrap(), resetScrollPosition(), initial route setup
│   │   │   │   ├── debug.ts                 Structured debug helpers (dbg.page, dbg.ctrl, dbg.bootPhase, …)
│   │   │   │   ├── controller/              Centralised navigation controller
│   │   │   │   │   ├── index.ts             Ctrl class + installController() — event delegation, nav lifecycle
│   │   │   │   │   ├── transition-manager.ts   out/in choreography + TransitionHooks dispatch
│   │   │   │   │   ├── transition-registry.ts  BaseTransition abstract class + TransitionRegistry
│   │   │   │   │   ├── transition-fx.ts     DefaultTransition (curtain reveal) + animaToPromise helper
│   │   │   │   │   └── types.ts             TransitionCallbacks, TransitionHooks, NormalizedUrl
│   │   │   │   ├── gpu/                     Frontend GPU orchestrator (lazy-loaded chunk)
│   │   │   │   │   ├── index.ts             GPU class (WebGPU device + scene + render loop)
│   │   │   │   │   ├── hud.ts               GpuHud debug overlay (Ctrl+F)
│   │   │   │   │   └── README.md            GPU module notes
│   │   │   │   ├── primitives/
│   │   │   │   │   ├── base-page.ts         BasePage (init/in/out/cleanup lifecycle)
│   │   │   │   │   ├── component.ts         Component (section base class with RAF + resize)
│   │   │   │   │   └── morph-svg.ts         Morph-SVG primitive (for the /morph route)
│   │   │   │   └── components/
│   │   │   │       └── test.ts              Example component
│   │   │   ├── engine/                      Framework layer — boot subsystem
│   │   │   │   ├── index.ts                 Re-exports: Intro, Loader
│   │   │   │   └── boot/
│   │   │   │       ├── intro.ts             Intro — pure loading animation (no GPU deps)
│   │   │   │       └── loader.ts            Loader — image → GPUTexture preloader
│   │   │   ├── routes/                      Co-located route folders — each folder = one route
│   │   │   │   ├── home/                    home.html + home.ts
│   │   │   │   ├── about/                   about.html + about.ts
│   │   │   │   ├── sanity/                  sanity.html + sanity.ts (CMS test page)
│   │   │   │   ├── morph/                   morph.html + morph.ts (shared-scene GPU demo)
│   │   │   │   ├── case-study/              *case-study.html + case-study.ts (CMS template)
│   │   │   │   ├── test-monitor/            Dev test route
│   │   │   │   ├── test-noise/              Dev test route
│   │   │   │   ├── test-shapes/             Dev test route
│   │   │   │   ├── test-text/               Dev test route
│   │   │   │   └── partials/                Shared Mustache partials
│   │   │   │       ├── canvas.html          GPU canvas element
│   │   │   │       ├── grid.html            Dev grid overlay
│   │   │   │       ├── intro.html           Loading/intro screen
│   │   │   │       ├── meta.html            <head> metadata
│   │   │   │       ├── nav.html             Navigation bar
│   │   │   │       └── picture.html         Responsive <picture> partial (AVIF/WebP/JPEG)
│   │   │   ├── styles/
│   │   │   │   ├── core.scss                Global entry (imports core modules)
│   │   │   │   ├── includes.scss            Shared SCSS partials barrel
│   │   │   │   ├── pages.scss               Page-specific styles barrel
│   │   │   │   ├── core/                    reset, base, root, intro
│   │   │   │   ├── includes/                _breakpoints, _colors, _eases, _typography, _layout, …
│   │   │   │   └── pages/                   Per-page SCSS modules
│   │   │   └── types/
│   │   │       └── modules.d.ts             Module declarations (WGSL, SCSS)
│   │   ├── public/                          Static assets
│   │   │   └── assets/
│   │   │       ├── fonts/                   WOFF2 web fonts
│   │   │       ├── images/                  Static images (originals; variants generated at build)
│   │   │       └── videos/                  Video textures
│   │   ├── docs/                            Architecture docs (boot, controller, routing, page-animations)
│   │   ├── plop-templates/                  Handlebars scaffolds for new-page / new-transition
│   │   ├── plopfile.mjs                     Plop generator config
│   │   ├── __tests__/                       Vitest tests (loader, routing, route-transition)
│   │   ├── index.html                       Mustache shell template
│   │   ├── project.config.ts                Site-level config (colors, grid, Sanity project)
│   │   ├── vite.config.ts                   Vite config + RoutesAndBootPlugin + manual GPU chunk
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   ├── eslint.config.js
│   │   └── vercel.json                      Vercel deployment config
│   │
│   ├── be/                                  Sanity Content Studio (v3)
│   │   ├── schemaTypes/
│   │   │   ├── documents/
│   │   │   │   ├── collections/             caseStudy, page (repeatable types)
│   │   │   │   ├── singletons/              pageHome (one-off documents)
│   │   │   │   └── site/                    siteNav, siteOptions
│   │   │   ├── objects/                     externalLink, internalLink, seo, textBlock
│   │   │   ├── slices/                      gridBuilder, zineBuilder, zinePage
│   │   │   └── index.js                     Schema type barrel — register new schemas here
│   │   ├── components/                      Custom Sanity input components
│   │   ├── plugins/builder/                 Custom builder plugin
│   │   ├── utils/                           Helper functions, internal link targets
│   │   ├── desk.js                          Studio desk structure
│   │   ├── sanity.config.js
│   │   └── sanity.cli.js
│   │
│   └── editor/                              WGSL shader editor
│       └── src/                             CodeMirror 6 + WebGPU shader preview
│
├── packages/
│   ├── kido/                                Animation, scroll, DOM utilities
│   │   ├── src/
│   │   │   ├── index.ts                     Barrel export
│   │   │   ├── anima.ts                     Anima — property animator with easing
│   │   │   ├── raf.ts                       Raf, RafHub, Delay, Timer
│   │   │   ├── resize.ts                    ResizeHub — global resize observer
│   │   │   ├── native-scroller.ts           NativeScroller — damped native scroll, per-route state
│   │   │   ├── scroller.ts                  Scroller — virtual scroller
│   │   │   ├── reveal.ts                    Reveal — scroll-triggered zone animations
│   │   │   ├── split.ts                     Split — text word splitter
│   │   │   ├── pointer.ts                   PointerMove tracking
│   │   │   ├── wheel.ts                     WheelKeys
│   │   │   ├── tab.ts                       Tab visibility detection
│   │   │   ├── svg.ts                       Svg path/line helpers
│   │   │   ├── utils.ts                     clamp, lerp, damp, bounds, queryAll, setTheme, Sniff, Ease, …
│   │   │   └── types.ts
│   │   ├── tsup.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json                     14 subpath exports (kido, kido/anima, kido/reveal, …)
│   │
│   ├── tatara/                              WebGPU rendering engine
│   │   ├── src/
│   │   │   ├── index.ts                     Barrel (GPURenderer, device, camera, uniforms, …)
│   │   │   ├── renderer.ts                  GPURenderer — batched textured quads
│   │   │   ├── device.ts                    GPUDevice initialization
│   │   │   ├── pipeline.ts                  Render pipeline creation
│   │   │   ├── geometry.ts                  Vertex buffer management
│   │   │   ├── texture.ts                   Image texture management
│   │   │   ├── video.ts                     VideoTexture (video frame upload)
│   │   │   ├── uniforms.ts                  Uniform buffer management
│   │   │   ├── camera.ts                    Camera transforms
│   │   │   ├── layouts.ts                   Bind group layouts
│   │   │   ├── monitor.ts                   Stats/performance monitor (stats-gl)
│   │   │   ├── post/                        Post-processing pipeline + effect shaders
│   │   │   ├── gl/                          WebGL fallback renderer
│   │   │   ├── shaders/                     Engine shaders
│   │   │   └── types.ts
│   │   ├── tsup.config.ts
│   │   └── package.json
│   │
│   └── katachi/                             Typed 2D GPU primitives on top of tatara
│       ├── src/
│       │   ├── index.ts                     Barrel
│       │   ├── scene.ts                     Scene graph primitive
│       │   ├── plane-object.ts              Plane primitive
│       │   ├── text-object.ts               MSDF text primitive
│       │   ├── glyph-points.ts              Font glyph tessellation
│       │   ├── msdf-layouts.ts              MSDF atlas layouts
│       │   ├── instancing-helper.ts         Instanced draw helper
│       │   ├── sdf-shapes/                  SDF shape primitives
│       │   ├── noise/                       Noise texture generators
│       │   ├── shaders/                     Primitive shaders
│       │   └── types.ts
│       ├── tsup.config.ts
│       └── package.json
│
├── scripts/                                 Repo-wide scripts
│   ├── img-optimize.ts
│   └── msdf-gen.ts                          MSDF atlas generator for katachi
├── .planning/                               GSD workflow planning docs
├── CLAUDE.md                                AI assistant instructions (comprehensive)
├── CHANGELOG.md                             Keep a Changelog format
├── turbo.json                               Turborepo task config
├── pnpm-workspace.yaml                      Workspace definition
├── package.json                             Root package.json
├── pnpm-lock.yaml
├── .prettierrc
├── .npmrc
└── .gitignore
```

## Architecture

The frontend is a custom SPA framework (no React/Vue). Key systems:

- **WebGPU Renderer** — GPU-rendered texture planes synchronized to DOM positions via `tatara` (engine) and `katachi` (2D primitives). Lazy-loaded as a single chunk, skipped on mobile (`Sniff.isMobile`) to keep first paint fast.
- **Centralised Navigation Controller** — `Ctrl` in `apps/fe/src/app/controller/` owns the full nav lifecycle: click + popstate delegation, `App.mutating` lock, route state updates, `TransitionManager` choreography, and `TransitionHooks` so GPU (or any other subsystem) participates without the controller knowing about it.
- **Page Lifecycle** — `BasePage` class with `init()`, `in()`, `out()`, `cleanup()` hooks. Pages are auto-discovered by `PageManager` via `import.meta.glob("../routes/*/*.ts", { eager: true })` — no manual registration.
- **Content Pipeline** — Sanity CMS fetched at **build time** in `scripts/sanity-content.ts`, rendered via Mustache templates, baked into `tmhgne.json` (inlined in every HTML file as `<script id="__TMHGNE__">` so the SPA boots with zero round-trips).
- **Texture Preloader** — images uploaded as `GPUTexture` at boot (`src/engine/boot/loader.ts`) with progress tracking driving the intro counter.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SANITY_PROJECT_ID` | Sanity project identifier |
| `SANITY_DATASET` | Sanity dataset name |
| `SANITY_READ_TOKEN` | Sanity read token (optional for public data) |
| `SITE_URL` | Base URL for sitemap generation |

## Requirements

- Node.js >= 18
- pnpm 10.20.0+
- WebGPU-capable browser (Chrome 113+, Edge 113+, Safari 18+)
