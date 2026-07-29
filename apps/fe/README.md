# Tamahagane — Frontend

Portfolio site. Nuxt 4 app (`srcDir: app/`), Sanity CMS, GSAP + Lenis animation. Deploys as two Vercel projects from one codebase: a static production build and an SSR preview build with Sanity Visual Editing.

See the root `CLAUDE.md` for the full absolute-rules list (server-only data boundary, GSAP-only animation, the stega living document, structural preview exclusion) and command reference.

## Architecture docs

- [Architecture](./docs/architecture.md) — data flow (queries → `content.ts` → `content.server.ts` → `useState` → pages), static vs. preview build modes, route prerendering
- [Animation](./docs/animation.md) — page-controller lifecycle, the sequential-timing-in-simultaneous-hooks transition system, boot/intro, the home→detail image bridge, nav lock, Lenis
- [Visual editing](./docs/visual-editing.md) — enabling preview, the stega exclusion list, env var matrix, the two-Vercel-project deploy runbook, troubleshooting

## Directory structure

```
app/
  pages/            index.vue (home), [slug].vue (detail | contact | imprint)
  components/       brand/, intro/, media/, content/, slices/, dev/
  composables/      useSiteOptions, usePageData, usePageController, useNavLock, useLenisScroll, useBoot, useHomeAnim
  controllers/      imperative page choreography (page-controller.ts, home.ts, detail.ts, rich-text-page.ts)
  transitions/       default.ts (route transition), home-to-detail.ts (image bridge)
  lib/               one-slot/per-route module handoffs (image-bridge, beat-skip, scroll-restore)
  gsap/eases.ts      CustomEase curve table
  plugins/           lenis.client.ts, ease.client.ts, nav-direction.client.ts, click-delegation.client.ts, content.server.ts
  plugins-preview/   visual-editing.client.ts — preview builds only
  data/              SERVER-ONLY: Sanity client, queries, content loaders, slice registry, stega
  styles/            core/, includes/, pages/, slices/ (SCSS modules)
server/               always-scanned Nitro routes (sitemap.xml, robots.txt)
server-preview/       preview-only Nitro routes/middleware, scanned only when NUXT_PUBLIC_PREVIEW_ENABLED=true
docs/                 architecture.md, animation.md, visual-editing.md
```

## Commands

```bash
pnpm --filter diaa dev          # Nuxt dev server
pnpm --filter diaa build        # nuxt generate — static prod output → .output/public
pnpm --filter diaa build:ssr    # nuxt build — SSR output, used by the preview deploy
pnpm --filter diaa check-types  # nuxt typecheck
pnpm --filter diaa lint
```
