# Tamahagane — CLAUDE.md

Portfolio site. **Nuxt 4 app** (`srcDir: app/`), Sanity CMS, GSAP + Lenis animation, kido utilities. Static production build (`nuxt generate`) plus an SSR preview deployment with Sanity Visual Editing. **Not the old vanilla-TS SPA** — that codebase (custom `Ctrl` router, 5-phase boot, Mustache prerender, kido/anima, WebGPU) was deleted wholesale in the Phase 7 cutover. Ignore any tooling, docs, or muscle memory that assumes the old architecture.

---

## Project

- **Name:** Tamahagane (玉鋼)
- **Origin:** ground-up Nuxt rewrite of the original vanilla-TS SPA (see `plans/twinkly-shimmying-marshmallow.md` for the historical build plan; the rewrite landed across Phases 0–7, all in CHANGELOG history)
- **Structure:** Turborepo monorepo, pnpm workspace

```
apps/
  fe/       Nuxt 4 SPA/SSR app — the website (srcDir: app/)
  be/       Sanity Studio (schemas + desk + presentationTool)
  editor/   WGSL shader playground (not covered here unless asked)
packages/
  kido/     Raf, Sniff, ResizeHub — survives the rewrite as utilities only
```

`apps/fe` deploys as **two separate Vercel projects** from the same codebase: a static production build (`nuxt generate`, zero server, zero Sanity drafts/tokens) and an SSR preview build (`nuxt build`, drafts perspective, stega encoding, Sanity Presentation overlays). See `apps/fe/docs/visual-editing.md` for the full split.

---

## Absolute rules (do not violate)

1. **`app/data/**` is server-only.** Every file under `apps/fe/app/data/` (Sanity client, queries, content loaders, slice resolvers, stega, preview-auth crypto) may import `@sanity/client` and may carry read tokens. It must never be imported from client-bundled code — Vue components, `.client.ts` plugins, composables that run in the browser. The only legal entry points are `.server.ts` Nuxt plugins (`app/plugins/content.server.ts`), Nitro server routes (`server/`, `server-preview/`), and `nuxt.config.ts`'s build-time `prerender:routes` hook. **Type-only imports are fine** (`import type { SiteOptionsContent } from "~/data/content"`) — composables like `usePageData`/`useSiteOptions` do exactly this to stay typed without pulling `@sanity/client` into the client graph.
2. **GSAP is the animation library.** `kido/anima` is retired for this app — kido survives only for `Raf`, `Sniff`, and `ResizeHub`. All tweens go through `gsap.to()`/`gsap.set()` (or the page-controller pattern below). Registered `CustomEase` names live in `apps/fe/app/gsap/eases.ts`: `slow`, `o4`, `io`, `o6`. **Only `slow` is load-bearing** in shipped code today (intro beat, home entrance, mode/filter switches, every controller's default content fade) — `o4`/`io`/`o6` are registered for parity with dead-code transition alternates from the old app and currently have no live caller. Don't assume all four are in active use; check before reusing one.
3. **The stega exclusion list is a living document.** `apps/fe/app/data/stega.ts`'s `EXCLUDED_RESULT_KEYS` set controls which GROQ result fields are allowed to carry Sanity's invisible stega-encoding for Visual Editing overlays. Any new query field whose value becomes a URL, an HTML attribute, a route/slug key, or a `<title>`/alt-text source **must** be added to that set, or preview builds will 404 images, mis-route slugs, or (worst case) hang the intro on a stega-bloated string — see the file's own comment block for the full mechanism, the array-index blind spot, and the intro-hang story before touching it.
4. **Preview code is structurally excluded from prod — never convert this to a runtime `if`.** Two independent gates in `apps/fe/nuxt.config.ts` keep preview-only code out of the module graph entirely (not just tree-shaken): `nitro.scanDirs` only includes `server-preview/` when `previewEnabled`, and the `plugins` array only registers `app/plugins-preview/visual-editing.client.ts` when `previewEnabled` — that file deliberately lives outside the auto-scanned `app/plugins/` directory so the array is the *only* way it's ever referenced. Verify any change here with a zero-bytes grep against a prod build: `grep -rl "visual-editing\|preview-url-secret\|stegaEncode" .output/public/_nuxt/*.js` must return nothing.
5. **Never skip the changelog.** Every commit that touches app code adds an entry under `[Unreleased]` in the root `CHANGELOG.md` (Keep a Changelog format).
6. **Class parity — controllers and styles move together.** Page/slice controllers (`apps/fe/app/controllers/**`, `apps/fe/app/transitions/**`) query DOM by the same BEM class names the SCSS modules and Vue templates define. Renaming a class in a `.vue` template or `.module.scss` file without updating the matching `querySelector`/`gsap.to()` selector in its controller silently breaks the animation with no compile-time error — touch both together.

---

## Code style

- **Comments:** Every function and class gets a descriptive comment above its declaration explaining *what* it does and *why*. The shipped code leans heavily on this — expect (and continue) long rationale comments on anything non-obvious: server/client boundaries, sequencing gotchas, framework quirks.
- **console.debug:** Sprinkle at meaningful lifecycle points (data fetch, route resolution, transition phases, boot). Bracketed prefixes: `[data]`, `[content]`, `[preview]`, `[boot]`.
- **Types:** Strict. No `any` unless genuinely unavoidable. Explicit return types on exported functions, typed params, interfaces/types for data shapes.
- **Imports:** Nuxt 4 auto-imports composables/components — no explicit import needed for `usePageData`, `<FigureBase>`, etc. `~/` resolves to `apps/fe/app/`. `kido` is a bare workspace import (`import { Raf } from "kido/raf"`).

---

## Versioning & changelog

- `CHANGELOG.md` at repo root — Keep a Changelog format.
- Every commit that changes app code adds an entry under `[Unreleased]`.
- Pre-1.0 semver on the root package: `0.MINOR.PATCH` — minor for features/refactors, patch for fixes. `apps/fe` versions independently and reset to `2.0.0` at the Nuxt cutover to mark the rewrite generation (see the CHANGELOG's docs-rewrite entry for the reasoning).

---

## Documentation

Authoritative deep-dive docs (read when you need more than this file provides):

- `apps/fe/docs/architecture.md` — data flow (queries → `content.ts` → `content.server.ts` → `useState` → pages), static vs. preview build modes, the `prerender:routes` hook
- `apps/fe/docs/animation.md` — page-controller lifecycle, transition sequencing (the sequential-timing-in-simultaneous-Vue-hooks design), boot/intro, the home→detail bridge, nav lock, Lenis
- `apps/fe/docs/visual-editing.md` — enabling preview, the stega exclusion list, env var matrix, the two-Vercel-project deploy runbook, troubleshooting

When you add or change a feature in `apps/fe`, update `apps/fe/README.md` and the relevant `apps/fe/docs/*.md`. If you introduce a new subsystem, create a new doc file and link it from the README.

---

## Workflow

- **Always commit between GSD workflow steps.** Don't leave uncommitted work between stages.
- Prefer a single atomic commit per logical change; never squash away a working intermediate state someone else may need.

---

# apps/fe — Frontend

Package name `diaa`. Nuxt 4, `srcDir: "app/"`. Stack: Vue 3, TypeScript, SCSS modules, GSAP + CustomEase, Lenis, kido (`Raf`/`Sniff`/`ResizeHub` only), `@sanity/client` (server-only), `@portabletext/vue`.

## Directory layout

```
apps/fe/
├── nuxt.config.ts            # previewEnabled gates plugins[] + nitro.scanDirs; prerender:routes hook
├── vercel.json                # STATIC PROD deploy config only (framework:null, nuxt generate output)
├── .env.example
├── public/assets/fonts/       # ported verbatim, keep the Optimo license comment
├── app/
│   ├── app.vue                 # IntroOverlay + IntroBeat (siblings of #app) + <NuxtPage :transition :page-key>
│   ├── pages/
│   │   ├── index.vue           # home — usePageController(createHomeController())
│   │   └── [slug].vue          # detail | contact | imprint, branches on content.template; 404s on no match
│   ├── components/
│   │   ├── brand/DiaaWordmark.vue
│   │   ├── intro/{IntroOverlay,IntroBeat}.vue      # SSR-visible-by-default via CSS, no v-if/ClientOnly
│   │   ├── media/FigureBase.vue                     # img|video branch; single <img>/<video>, no <picture> srcset
│   │   ├── content/RichText.vue                     # @portabletext/vue wrapper + custom marks
│   │   ├── slices/{SliceRenderer,Slice2Up,Slice3Up,SliceImage,SliceImageWithText,SliceImageSlideshow,SliceText}.vue
│   │   └── dev/HomeAnimGui.client.vue                # Ctrl+F tuning panel, .client.vue + import.meta.dev gated
│   ├── composables/
│   │   ├── useSiteOptions.ts / usePageData.ts / usePageSeo.ts   # useState hydrated by content.server.ts
│   │   ├── usePageController.ts                       # route-fullPath → controller registry
│   │   ├── useNavLock.ts                               # nav mutex: beforeEach guard + 8s safety valve
│   │   ├── useLenisScroll.ts                            # $lenis bridge, native-scroll fallback on mobile
│   │   ├── useBoot.ts                                   # playIntro() + runBoot(), first-load entrance
│   │   └── useHomeAnim.ts                               # tunables + localStorage, read live by home.ts
│   ├── controllers/                                      # imperative DOM choreography, factory-per-mount
│   │   ├── page-controller.ts                            # PageController contract + BaseController default
│   │   ├── home.ts / detail.ts / rich-text-page.ts
│   │   └── index.ts
│   ├── transitions/
│   │   ├── default.ts                                    # sequential timing inside Vue's simultaneous hooks
│   │   ├── home-to-detail.ts                             # image-bridge clone/hide handoff
│   │   └── index.ts
│   ├── lib/{image-bridge,beat-skip,scroll-restore}.ts    # one-slot / per-route module handoffs
│   ├── gsap/eases.ts                                       # CustomEase curve table
│   ├── plugins/
│   │   ├── ease.client.ts                                 # registers CustomEase curves
│   │   ├── lenis.client.ts                                # Lenis + Raf tick, history.scrollRestoration
│   │   ├── nav-direction.client.ts                        # popstate → "back" flag
│   │   ├── click-delegation.client.ts                     # global <a> click interception (SPA nav)
│   │   └── content.server.ts                              # per-request fetch → useSiteOptions/usePageData
│   ├── plugins-preview/visual-editing.client.ts            # ONLY registered when previewEnabled (see rule #4)
│   ├── data/                                                # SERVER-ONLY (rule #1)
│   │   ├── client.ts                                       # getSanityClient(perspective), published vs drafts
│   │   ├── queries.ts                                      # GROQ constants + buildSlicesProjection()
│   │   ├── content.ts                                      # loadSiteOptions / loadRouteContent / loadAllRoutePaths
│   │   ├── image-url.ts                                    # sanityPicture() / pictureFromUrl() → MediaData
│   │   ├── stega.ts                                        # buildPreviewStega(), the exclusion list (rule #3)
│   │   ├── preview-auth-core.ts                            # pure HMAC sign/verify, shared prod+preview
│   │   ├── sanity-defaults.ts                               # default projectId/dataset shared with nuxt.config.ts
│   │   └── slices/{types,registry,helpers,slice*.ts}        # SliceDefinition ports (see slice contract below)
│   └── styles/                                              # core/, includes/, pages/, slices/ — barrelled in core.scss
├── server/routes/{sitemap.xml,robots.txt}.get.ts            # always scanned; branch on previewEnabled at runtime
├── server-preview/                                          # ONLY scanned when previewEnabled (rule #4)
│   ├── routes/preview/{enable,disable,refresh}.*
│   ├── middleware/noindex.ts                                 # global 401 gate + X-Robots-Tag stamping
│   └── utils/preview-auth.ts                                 # H3/Nitro cookie wrapper around preview-auth-core.ts
└── docs/{architecture,animation,visual-editing}.md
```

## Data layer + slice registry contract

The Sanity fetch pipeline is **server-only, request-scoped** (not build-time-once like the old Vite pipeline). `app/plugins/content.server.ts` runs once per SSR request or prerendered route, resolves the perspective (published vs. an authenticated drafts session), fetches the site-wide singleton and the current route's content in parallel via `data/content.ts`, and writes both into `useState` (`usePageData()`, `useSiteOptions()`) for every component on that render to read without re-fetching. See `apps/fe/docs/architecture.md` for the full flow diagram.

### Adding a new slice

A "slice" is a CMS-authored content block droppable into any Detail page. Six exist today: `sliceImage`, `sliceImageWithText`, `sliceImageSlideshow`, `slice2Up`, `slice3Up`, `sliceText`. A new one touches:

| Location | What it is |
|---|---|
| `apps/be/schemaTypes/slices/slice<PascalName>.js` | Sanity schema. Registered in `slices/index.js`'s `sliceList` array (controls Studio "Add item" order — independent of the frontend registry's order; the two are not required to match, but check both when adding one). |
| `apps/fe/app/data/slices/slice<PascalName>.ts` | Build-time-shape resolver: a `SliceDefinition` object — `name` (matches the Sanity `_type`), `query` (GROQ fragment, no `_type`/`_key` — those are added by the projection wrapper), `resolve(raw, ctx): TResolved`. Register it in `app/data/slices/registry.ts`'s `sliceRegistry` array. **`resolve()` does not pre-render HTML** — return raw Portable Text blocks where the field is rich text; `<RichText>` renders them client-side (this is a real change from the old pipeline, which pre-rendered HTML strings at build time). |
| `apps/fe/app/components/slices/Slice<PascalName>.vue` | Vue component taking a `data` prop — exactly the `resolve()` output, already transformed server-side. **Never** import `data/**` or re-resolve raw Sanity fields here — `SliceRenderer.vue` guarantees `resolve()` already ran exactly once, server-side. Register the component in `SliceRenderer.vue`'s local `sliceComponents` map, keyed by `_type`. |
| `apps/fe/app/styles/slices/_<kebab-name>.module.scss` | BEM SCSS module, `.slice-<kebab-name>` root + `.slice-<kebab-name>__<element>` children. Re-export from `apps/fe/app/styles/slices.scss`. |
| `apps/fe/app/data/queries.ts` | Nothing to add by hand — `buildSlicesProjection()` composes every registered slice's `query` field into one GROQ `slices[] {...}` projection automatically. |

Helpers available in `apps/fe/app/data/slices/helpers.ts`: `richTextQuery(field)` (resolves internal-link markDefs to hrefs), `resolveCta(raw)` (flattens a CTA object, maps the `__home__` slug sentinel → `/`), `mediaFromUrls(...)` (builds `MediaData` for an image/video pair), `resolveCaptionedImages(...)` (2Up/3Up caption arrays), `resolveLocations(...)`, `hasPortableTextContent(blocks)` (non-whitespace check, replaces the old `renderPortableText().length` idiom).

### Slice rules

1. **Never query slice DOM from a page controller.** A slice's own interactivity (the slideshow's `activeIndex`, click handlers) lives in the slice's own `<script setup>` — see `SliceImageSlideshow.vue` for the one interactive slice today.
2. **Never call `resolve()` from a Vue component.** The raw-Sanity → props transform runs exactly once, server-side, in `resolveSlices()` (`data/slices/registry.ts`). Components are pure props-in/DOM-out.
3. **Any new field that becomes a URL, href, or route key must be added to `data/stega.ts`'s exclusion set** — see absolute rule #3.
4. **Update `CHANGELOG.md`** — CMS name, what it renders, where it's mounted.

## Page-controller + transition contract

Every route's imperative animation (as opposed to declarative CSS) goes through a **`PageController`** (`app/controllers/page-controller.ts`): `onInit(root)` (synchronous — must complete before any paint), `onDestroy()`, `in(root): Promise<void>`, `out(root): Promise<void>` (both mandatory, GSAP-driven), optional `onScroll?(e)`. `BaseController` supplies the default 1.2s-in/0.8s-out `"slow"`-eased content fade; `home.ts`/`detail.ts`/`rich-text-page.ts` extend it with page-specific choreography. Controllers are **factories** (`createHomeController()`, not a singleton), registered per-mount via `usePageController()` into a `route.fullPath`-keyed map.

Route transitions run through `<NuxtPage :transition="defaultTransition">` (`app/transitions/default.ts`) — `css: false`, **no `mode`**, so outgoing and incoming pages coexist in the DOM (required for the home→detail image bridge). The file re-imposes diaa's real *sequential* wall-clock timing (out fully resolves, then in starts) inside Vue transition hooks that would otherwise run `onLeave`/`onEnter` concurrently, using a module-scope promise (`leaveFinished`) that `onEnter` awaits before starting the incoming controller's `in()`. Full mechanics, the FOUC-critical `.is-controlled` synchronization, and the home→detail bridge's "hide beneath a solid clone" fix (not fade — avoids a double-shadow composite) are documented in `apps/fe/docs/animation.md`.

## Visual editing / preview

Enabled via `NUXT_PUBLIC_PREVIEW_ENABLED=true` at build time, which structurally includes `server-preview/**` and the `visual-editing.client.ts` plugin (see rule #4). Auth is a stateless HMAC session cookie set by `/preview/enable` (validated against Sanity's `previewUrlSecret`), read on every request by `app/plugins/content.server.ts` to decide published vs. drafts perspective. Full enable flow, the stega exclusion mechanism, the env var matrix, and the two-Vercel-project deploy runbook (including the dashboard checklist and the h3-import / scanDirs gotchas) live in `apps/fe/docs/visual-editing.md`.

---

# apps/be — Sanity Studio

Sanity v3 + React 19, package `diaa-be`. Includes `presentationTool` for Visual Editing, configured in `apps/be/sanity.config.js` with `previewMode.enable: '/preview/enable'` (the Nuxt app's route, not a standalone preview server) and `resolve.locations` bodies for `pageHome`, `detail`, `pageContact`, `pageImprint`.

## Layout

```
schemaTypes/
  documents/
    collections/   detail, taxonomy
    singletons/    pageHome, pageContact, pageImprint
    site/          siteOptions
  objects/         seo, internalLink, externalLink, cta, textBlock, richText, imageWithCaption
  slices/          slice2Up, slice3Up, sliceImage, sliceImageSlideshow, sliceImageWithText, sliceText
  index.js         barrel — add new schemas here
sanity.config.js    studio config incl. presentationTool
desk.js             studio desk structure
```

## Adding a schema

1. Create the file under `documents/collections/` (repeatable), `documents/singletons/` (one-off), or `objects/` (reusable field).
2. Import and add to `schemaTypes/index.js`.
3. If it should appear in the desk, update `desk.js`.
4. Deploy: `cd apps/be && npx sanity deploy`.
5. On the frontend: add a GROQ query fragment to `apps/fe/app/data/queries.ts`, extend `apps/fe/app/data/content.ts`'s loaders, and (for slices) follow the slice contract above.

---

# packages/kido

Workspace package, `workspace:*` in `apps/fe/package.json`. Post-rewrite, `apps/fe` consumes only `Raf`, `Sniff`, and `ResizeHub` — the Lenis scroll tick and mobile-detection utilities. `kido/anima`, `Reveal`, `Split`, `Scroller`/`NativeScroller` are no longer imported by `apps/fe` (GSAP + Lenis replaced them) but remain in the package for any other consumer.

Build kido in watch mode: `pnpm --filter kido dev`.

---

# Common commands

```bash
# Install
pnpm install

# Dev — all apps
pnpm dev

# Dev — specific app
pnpm --filter diaa dev                # frontend (Nuxt dev server)
pnpm --filter diaa-be dev             # Sanity Studio

# Build
pnpm build                            # all (turbo)
pnpm --filter diaa build              # nuxt generate — static prod output → apps/fe/.output/public
pnpm --filter diaa build:ssr          # nuxt build — SSR output, used by the preview deploy
pnpm --filter diaa check-types        # nuxt typecheck
pnpm --filter diaa lint               # eslint .

# Sanity
cd apps/be && npx sanity dev          # Studio dev server
cd apps/be && npx sanity deploy       # deploy hosted Studio
```

---

# Requirements

- Node ≥ 18
- pnpm ≥ 10.20.0
- Any modern browser.

---

# Key file reference

| File | Role |
|---|---|
| `apps/fe/nuxt.config.ts` | Config, `previewEnabled` gating, `prerender:routes` hook |
| `apps/fe/app/app.vue` | Root component — Intro overlay/beat, `<NuxtPage>` + transition wiring, boot kickoff |
| `apps/fe/app/plugins/content.server.ts` | Per-request Sanity fetch → `useState` hydration |
| `apps/fe/app/data/content.ts` | `loadSiteOptions` / `loadRouteContent` / `loadAllRoutePaths` — the published/drafts seam |
| `apps/fe/app/data/client.ts` | Sanity client factory (published vs. drafts perspective) |
| `apps/fe/app/data/stega.ts` | Stega exclusion filter — see absolute rule #3 |
| `apps/fe/app/data/slices/registry.ts` | Slice registry — `sliceRegistry`, `resolveSlices()` |
| `apps/fe/app/data/queries.ts` | GROQ query constants, `buildSlicesProjection()` |
| `apps/fe/app/composables/usePageData.ts` / `useSiteOptions.ts` | `useState` reads of server-fetched content |
| `apps/fe/app/composables/usePageController.ts` | Route-fullPath → `PageController` registry |
| `apps/fe/app/composables/useNavLock.ts` | Navigation mutex + 8s safety valve |
| `apps/fe/app/composables/useBoot.ts` | Intro playback + first-load entrance |
| `apps/fe/app/controllers/page-controller.ts` | `PageController` contract + `BaseController` default |
| `apps/fe/app/controllers/home.ts` | Home page choreography (mode/filter toggles, hover reveal, brand beat) |
| `apps/fe/app/controllers/detail.ts` | Detail page choreography + bridge consumption |
| `apps/fe/app/transitions/default.ts` | Sequential-timing-in-simultaneous-hooks transition |
| `apps/fe/app/transitions/home-to-detail.ts` | Home→detail image bridge |
| `apps/fe/app/gsap/eases.ts` | `CustomEase` curve table |
| `apps/fe/app/plugins/lenis.client.ts` | Lenis instance, Raf tick, `$lenis` (null on mobile) |
| `apps/fe/app/plugins-preview/visual-editing.client.ts` | Sanity overlay runtime (preview builds only) |
| `apps/fe/server-preview/routes/preview/enable.get.ts` | Preview session grant (HMAC cookie) |
| `apps/fe/server-preview/middleware/noindex.ts` | Preview auth gate + `X-Robots-Tag: noindex` |
| `apps/fe/vercel.json` | Static prod deploy config |
| `apps/be/sanity.config.js` | Studio config incl. `presentationTool` |
| `apps/be/schemaTypes/index.js` | Sanity schema barrel |
| `packages/kido/src/raf.ts` | `Raf`/`RafHub` — ticks Lenis |
