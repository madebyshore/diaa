# Tamahagane 玉鋼

A creative portfolio site built with **Nuxt 4**, Sanity CMS, and GSAP + Lenis animation. Turborepo monorepo, pnpm workspace.

This is the ground-up Nuxt rewrite of the original vanilla-TS/WebGPU SPA — the old architecture (custom `Ctrl` router, Mustache prerender, tatara/katachi WebGPU engine) was deleted wholesale at the Phase 7 cutover.

## Apps

| App | Description | Stack |
|-----|-------------|-------|
| `apps/fe` | Frontend website (`diaa`) | Nuxt 4 (`srcDir: app/`), Vue 3, TypeScript, SCSS modules, GSAP + CustomEase, Lenis, `@sanity/client` (server-only), `@portabletext/vue` |
| `apps/be` | Sanity Content Studio (`diaa-be`) | Sanity v3, React 19, `presentationTool` for Visual Editing |

## Packages

| Package | Description |
|---------|-------------|
| `packages/kido` | Utility survivors of the rewrite: `Raf`/`RafHub` (ticks Lenis), `Sniff` (device detection), `ResizeHub`. The rest of the package (Anima, Reveal, Split, Scroller, …) is no longer consumed by `apps/fe` — GSAP + Lenis replaced it |
| `packages/sanity-deploy` | Sanity Studio plugin — trigger Vercel Deploy Hooks from the Studio |

## Getting started

```bash
# Install dependencies
pnpm install

# Run all apps
pnpm dev

# Run a specific app
pnpm --filter diaa dev        # Frontend (Nuxt dev server, port 3000)
pnpm --filter diaa-be dev     # Sanity Studio (port 3333)

# Build
pnpm build                    # all (turbo)
pnpm --filter diaa build      # nuxt generate — static prod output
pnpm --filter diaa build:ssr  # nuxt build — SSR output (preview deploy)

# Quality
pnpm --filter diaa check-types
pnpm --filter diaa lint
```

## Project structure

```
tamahagane/
├── apps/
│   ├── fe/                        Frontend (Nuxt 4, srcDir: app/)
│   │   ├── app/
│   │   │   ├── pages/             index.vue (home), [slug].vue (detail | contact | imprint)
│   │   │   ├── components/        brand/, intro/, media/, content/, slices/, dev/
│   │   │   ├── composables/       usePageData, useSiteOptions, usePageController, useNavLock, useBoot, …
│   │   │   ├── controllers/       imperative page choreography (home.ts, detail.ts, rich-text-page.ts)
│   │   │   ├── transitions/       default.ts (route transition), home-to-detail.ts (image bridge)
│   │   │   ├── data/              SERVER-ONLY: Sanity client, GROQ queries, content loaders, slice registry, stega
│   │   │   ├── plugins/           content.server.ts, lenis.client.ts, ease.client.ts, …
│   │   │   ├── plugins-preview/   visual-editing.client.ts — preview builds only
│   │   │   └── styles/            SCSS modules (core/, includes/, pages/, slices/)
│   │   ├── server/                always-scanned Nitro routes (sitemap.xml, robots.txt)
│   │   ├── server-preview/        preview-only Nitro routes/middleware (structurally excluded from prod)
│   │   ├── docs/                  architecture.md, animation.md, visual-editing.md
│   │   └── vercel.json            shared deploy config — buildCommand branches on NUXT_PUBLIC_PREVIEW_ENABLED
│   │
│   └── be/                        Sanity Content Studio (v3)
│       ├── schemaTypes/           documents/ (collections, singletons, site), objects/, slices/
│       ├── desk.js                Studio desk structure
│       ├── sanity.config.js       incl. presentationTool (Visual Editing)
│       └── vercel.json            Studio deploy config (sanity build → dist, SPA rewrite)
│
├── packages/
│   ├── kido/                      Raf, Sniff, ResizeHub utilities
│   └── sanity-deploy/             Vercel Deploy Hook trigger plugin for the Studio
│
├── CLAUDE.md                      AI assistant instructions (comprehensive)
├── CHANGELOG.md                   Keep a Changelog format
├── turbo.json                     Turborepo task config
└── pnpm-workspace.yaml            Workspace definition
```

## Architecture

- **Server-only data layer** — everything under `apps/fe/app/data/` (Sanity client, queries, loaders, stega) runs only in `.server.ts` plugins, Nitro routes, and the build-time prerender hook. It is never client-bundled; components read server-fetched content from `useState` via `usePageData()`/`useSiteOptions()`.
- **Page controllers + transitions** — every route's imperative animation goes through a `PageController` factory (`onInit`/`in`/`out`/`onDestroy`, GSAP-driven). Route transitions run mode-less so outgoing and incoming pages coexist, enabling the home→detail image bridge.
- **Slices** — CMS-authored content blocks (`sliceImage`, `sliceText`, `slice2Up`, …) with a registry contract spanning Sanity schema → GROQ fragment → server-side `resolve()` → Vue component.
- **Visual Editing** — an SSR preview deployment with Sanity Presentation overlays, gated behind a stateless HMAC session cookie. Preview code is *structurally* excluded from the static prod build (scanDirs + plugin-array gates), not just tree-shaken.

Deep-dive docs: [`apps/fe/docs/architecture.md`](apps/fe/docs/architecture.md), [`apps/fe/docs/animation.md`](apps/fe/docs/animation.md), [`apps/fe/docs/visual-editing.md`](apps/fe/docs/visual-editing.md).

## Deployment — three Vercel projects (Shore team)

| Project | Root | Build | Notes |
|---|---|---|---|
| `diaa` | `apps/fe` | `nuxt generate` (static) | Production site. No env vars — always the `published` perspective |
| `diaa-preview` | `apps/fe` | `nuxt build` (SSR) | Visual Editing preview. `NUXT_PUBLIC_PREVIEW_ENABLED=true` flips the shared `vercel.json` buildCommand to SSR |
| `diaa-be` | `apps/be` | `sanity build` | Hosted Studio |

Full runbook, env var matrix, and troubleshooting: [`apps/fe/docs/visual-editing.md`](apps/fe/docs/visual-editing.md).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `SANITY_PROJECT_ID` / `SANITY_DATASET` / `SANITY_API_VERSION` | Sanity project (defaults in `apps/fe/app/data/sanity-defaults.ts`) |
| `SANITY_READ_TOKEN` | Viewer-scoped token — preview deploy only |
| `SANITY_STUDIO_URL` | Studio URL stega overlays point back to — preview deploy only |
| `NUXT_PUBLIC_PREVIEW_ENABLED` | Enables preview plugins/routes + the SSR build branch — preview deploy only |
| `PREVIEW_SESSION_SECRET` | HMAC secret for the preview session cookie (optional — falls back to a hash of the read token) |
| `NITRO_PRESET` | `vercel` on the preview deploy |
| `SANITY_STUDIO_PREVIEW_ORIGIN` | (Studio) the preview deploy's URL — what the Presentation tab iframes |

See `apps/fe/.env.example` for the annotated set.

## Requirements

- Node.js >= 20.19
- pnpm >= 10.20
- Any modern browser
