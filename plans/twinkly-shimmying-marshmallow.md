# Rewrite apps/fe as a Nuxt 4 app (branch `nuxt`)

## Context

The client site (Diaa portfolio) is a bespoke vanilla-TS Vite SPA: custom router (`Ctrl`), 5-phase boot with brand intro, kido-driven choreography, Mustache prerender, build-time-only Sanity. The user wants it rewritten as a **Nuxt 4 app** on a new branch `nuxt` (off `main`), modeled on their reference build at `~/Documents/bnpne/tamahagane-nuxt/apps/fe`, with **seamless Visual Editing** — replacing the custom preview server built on the `preview` branch with Nuxt-native SSR preview.

**Locked decisions (user-confirmed):**
- Branch `nuxt` off `main` (main has no visual-editing code; the Studio has no presentationTool on main).
- **Static prod + SSR preview**: production is `nuxt generate` (fully static, published content, zero runtime Sanity). The same codebase deploys again as SSR with drafts + stega + overlays for the Presentation tool.
- **Full parity** with current design/animation.
- **GSAP replaces kido/anima** (tamahagane-nuxt convention; register `CustomEase`). kido stays for `Raf`/`Sniff`/`ResizeHub` utilities only.
- **Lenis replaces the kido NativeScroller** — `new Lenis({ autoRaf: false, lerp: 0.1 })` ticked by kido `Raf("scroller")`; **0.1, not 0.09** (diaa's boot passes `damping: 0.1` explicitly; the reference repo's 0.09 is the kido default, not diaa's shipped feel). `$lenis` is `null` on mobile (verified faithful: diaa's mobile scroll is native, the scroller only mirrors position).
- **pnpm stays** (tamahagane-nuxt uses bun; diaa repo doesn't switch). Turborepo/root tooling needs no changes (root configs are already identical to the reference repo's).

**Two load-bearing findings from planning:**
1. **The kido Reveal/Split zone system (`._s`, `.z__o/d/g`) is dormant** — zero matches in any live template/partial. It is NOT ported. (Extension point documented: IntersectionObserver + GSAP SplitText if CMS content needs reveals later.)
2. **`DefaultTransition`/`FadeTransition` are dead code** — the live default is `EmptyTransition` (pages own all visual work). Only that behavior is ported.

## Target structure (`apps/fe`, Nuxt 4, `srcDir: "app/"`)

```
apps/fe/
├── nuxt.config.ts            # previewEnabled const gates plugins + nitro.scanDirs (see Visual Editing)
├── package.json              # deps below; scripts: dev / build(=generate) / lint
├── public/assets/fonts/      # ported verbatim — KEEP the Optimo license comment
├── app/
│   ├── app.vue               # IntroOverlay + IntroBeat (outside <main>) + <NuxtPage :transition="defaultTransition" :page-key="r => r.fullPath" /> (NO mode)
│   ├── pages/
│   │   ├── index.vue         # home — wires usePageController(homeController)
│   │   └── [slug].vue        # detail OR contact OR imprint — resolver returns a `template` discriminant; template branches on it (keeps CMS-editable slugs honest)
│   ├── components/
│   │   ├── layout/{NavBase,FooterBase}.vue
│   │   ├── intro/{IntroOverlay,IntroBeat}.vue        # SSR-rendered, CSS-visible/-hidden by default (FOUC rules below)
│   │   ├── media/FigureBase.vue                       # img|video branch, eager/fetchpriority/lazy, aspect from coverSize — ports picture.html + coverMedia()
│   │   ├── content/RichText.vue                       # @portabletext/vue wrapper; decorators strong/em/underline/code/serif/mono + resolved-href link mark
│   │   ├── slices/{SliceRenderer,SliceImage,SliceImageWithText,SliceImageSlideshow,Slice2Up,Slice3Up,SliceText}.vue
│   │   └── dev/{DevGrid,HomeAnimGui.client}.vue       # Ctrl+G grid; Ctrl+F anim panel (dev only)
│   ├── composables/
│   │   ├── useSiteOptions.ts / usePageData.ts         # useState hydrated by content.server.ts plugin
│   │   ├── usePageController.ts                       # route-path → controller registry (tamahagane-nuxt pattern)
│   │   ├── useNavLock.ts                              # App.mutating port: beforeEach lock + 8s safety valve + lenis.stop/start; unlocked from transition onAfterEnter (NOT router.afterEach — fires too early)
│   │   ├── useLenisScroll.ts                          # lenis.on("scroll") bridge, native-scroll fallback on mobile, auto-cleanup
│   │   ├── useBoot.ts                                 # intro timeline (playIntro) + boot orchestration from app.vue onMounted
│   │   └── useHomeAnim.ts                             # homeAnim tunables + localStorage (port of components/home-anim.ts)
│   ├── controllers/                                    # imperative DOM choreography — module-scope state (reference repo's own precedent)
│   │   ├── page-controller.ts                          # contract: onInit(root)/onDestroy/in(root)/out(root)/onScroll? + BaseController default 1200/800ms "slow" container fade
│   │   ├── home.ts / detail.ts / rich-text-page.ts    # mechanical ports (Anima→gsap.to 1:1) of home.ts(1109L)/detail.ts/rich-text-page.ts
│   │   └── index.ts
│   ├── transitions/
│   │   ├── default.ts                                  # EmptyTransition + TransitionManager sequencing in Vue hooks (see below)
│   │   └── home-to-detail.ts                           # bridge clone (no Anima in source — near-verbatim; double-shadow comments MUST survive)
│   ├── lib/{image-bridge,beat-skip,scroll-restore}.ts # verbatim one-slot modules + per-route scroll snapshots
│   ├── gsap/eases.ts + plugins/ease.client.ts          # CustomEase: slow=0.192,0.062,0.275,0.879 (the only load-bearing one) + o4/io/o6
│   ├── plugins/
│   │   ├── lenis.client.ts                             # Lenis + Raf tick + history.scrollRestoration="manual"; provide $lenis (null mobile)
│   │   ├── content.server.ts                           # one per-request fetch → useSiteOptions/usePageData
│   │   └── visual-editing.client.ts                    # ONLY in preview build (config-gated, see below)
│   ├── data/                                           # SERVER-ONLY (convention: never imported from client-only code)
│   │   ├── client.ts                                   # getSanityClient(perspective) memoized; prod path hardcodes stega:false
│   │   ├── queries.ts                                  # ports scripts/utils/queries.ts + buildSlicesProjection() from registry
│   │   ├── content.ts                                  # loadSiteOptions()/loadRouteContent(path) — the single published/drafts seam
│   │   ├── image-url.ts                                # urlFor via @sanity/image-url (hotspot/crop aware)
│   │   └── slices/{types,registry,slice*.ts}           # SliceDefinition ports of scripts/slices/* (resolve() no longer pre-renders HTML — Portable Text passes through as blocks for stega)
│   └── styles/                                         # ported ~verbatim (core/, includes/ with :export, pages/, slices/); vite additionalData injects @/styles/includes
├── server/routes/{sitemap.xml,robots.txt}.get.ts       # hand-rolled, prerendered for prod; robots disallows all when previewEnabled
├── server-preview/routes/preview/{enable,disable,refresh}.* + utils/preview-auth.ts
│                                                        # in a dir Nitro does NOT scan for prod (nitro.scanDirs gated by previewEnabled)
└── .env.example
```

**Deps**: `@sanity/client ^7.23`, `@sanity/image-url ^2.1`, `@portabletext/vue`, `@sanity/visual-editing`, `@sanity/preview-url-secret ^4.1.2`, `gsap ^3.15`, `lenis ^1.3.25`, `kido workspace:*`; dev: `nuxt ^4.4.8`, `vue ^3.5`, `@nuxt/eslint`, `sass`, `vue-tsc`. Dropped: mustache, plop, sharp, vitest, lightningcss, standalone vite.

## Key mechanics (the hard parts, resolved in planning)

**Transition sequencing** — diaa's timing is *sequential in wall-clock* (out ~800ms fully resolves, then in ~1400ms) while both elements *coexist in DOM* (required by the bridge). Vue `<Transition>` without `mode` gives DOM coexistence; the sequencing is re-imposed inside hooks: `onLeave` awaits `controller.out()` and resolves a `leaveFinished` promise; `onBeforeEnter` **synchronously** pins the entering page (`position:fixed; opacity:0`) AND calls `controller.onInit(root)` in the same tick (before any paint — the FOUC-critical deviation from the reference repo, needs a code comment); `onEnter` does scroll restore → `await leaveFinished` → `lenis.stop()` → `await controller.in()` → `lenis.start()`; `onAfterEnter` clears inline styles, subscribes `onScroll`, and releases `useNavLock`.

**Home→detail bridge** — dispatched from `onBeforeLeave` on route-pair check (`index` → `slug` + text mode + active figure), clone/hide via `visibility` (double-shadow comments preserved verbatim), one-slot module handoff, hard-swap in detail's `in()`.

**Boot/FOUC** — `.intro` overlay SSR-rendered visible by default in CSS (no v-if/ClientOnly — must cover content before JS); page roots default `opacity: 0` in CSS, released by an `.is-controlled` class added synchronously in `onInit` (avoids the "in() clears inline opacity → CSS re-hides page" trap); intro timeline (`playIntro`) is a line-for-line GSAP port of `Intro.play()` (phrase beat → logo beat → overlay fade, `slow` ease, holds as targetless gsap tweens); brand-beat replay + `beat-skip` port verbatim, `.intro-beat` in app.vue outside `<NuxtPage>`.

**Scroll** — per-route snapshot map keyed by fullPath; back/forward direction via a popstate-set `useState` flag (diaa's `App.target === "back"` equivalent); restore-or-reset before entrance. Detail bottom-dwell translates to `scroll >= limit - 2` on Lenis events (no separate current/target — verified equivalent).

## Visual editing (Nuxt-native; replaces the `preview`-branch server)

- **Perspective seam**: `data/content.ts` resolves published vs drafts per request: prod/generate = `published` + CDN + `stega:false` hardcoded; preview SSR = `drafts` + token + `buildPreviewStega(studioUrl)`.
- **Stega filter**: ported from the proven `preview`-branch `stega.ts` (via `git show 83350cd:apps/fe/scripts/preview/stega.ts` + the fix commit `dcbf37c`) — exclusion set `slug, href, image, video, coverImage, coverVideo, url, introText, title, name`, **including the last-string-segment walk** (array-of-strings resultPath ends in a numeric index) and the intro-hang/bloat rationale comments.
- **Zero bytes in prod, guaranteed structurally** (not tree-shaking): `plugins: previewEnabled ? [visual-editing.client] : []` and `nitro.scanDirs` excludes `server-preview/` unless `previewEnabled` — the modules are never in the prod graph. Mandatory verification: grep `.output/public/_nuxt/*.js` for `visual-editing|preview-url-secret` → zero.
- **Overlay plugin**: `enableVisualEditing({ history: { subscribe: router.afterEach → navigate, update: push/replace/back }, refresh: POST /preview/refresh → usePageData().value = fresh })` — Vue reactivity replaces all the manual rehydration the old preview server needed.
- **Auth**: Nitro routes `/preview/enable` (validatePreviewUrl → stateless HMAC cookie `<expiry>.<hmac>`, secret = `PREVIEW_SESSION_SECRET` or hash of read token, 8h, SameSite=None) + `/preview/disable`; server middleware stamps `X-Robots-Tag: noindex` on every preview response.
- **Studio (`apps/be`)**: re-type (don't cherry-pick) `presentationTool` with `77d8305`'s `resolve.locations` bodies but `previewMode.enable: '/preview/enable'` (the old `/__preview/` prefix was an artifact of the old catch-all function). No new Studio dependency.

## Build order (branch buildable at every commit; changelog entry per commit)

0. `git switch -c nuxt main`. Scaffold Nuxt app under `apps/fe-next/` (old app untouched until cutover). Verify dev boots + `nuxt generate` emits HTML. Add Studio `presentationTool` (independent of frontend progress).
1. **Data layer**: `data/*` (client/queries/slices registry/content/image-url) + `content.server.ts` + composables. Verify fetched shapes match what `scripts/sanity-content.ts` logs today.
2. **Pages skeleton**: `index.vue` grid + `[slug].vue` detail (slices as placeholders), `FigureBase`, `prerender:routes` hook (queries detail/contact/imprint slugs via HTTP GROQ — reference-repo pattern). Verify generate emits one HTML per route with correct `<title>` (`"<siteTitle> - <pageTitle>"`).
3. **Slices + RichText**: all 6 components + `@portabletext/vue` + contact/imprint resolution. Verify against real content exercising every slice.
4. **Styles/SEO/fonts**: port SCSS tree + fonts (license comment!), `useSeoMeta`, sitemap/robots routes. Visual diff vs live site close enough to layer animation on.
5. **Animation layer**: eases plugin, Lenis plugin, nav lock, transition system, controllers (home/detail/rich-text — mechanical Anima→GSAP ports), intro/boot, brand beat, bridge, scroll restore, slideshow slice interactivity, dev GUIs. The big one — split into multiple commits (per controller).
6. **Visual editing + preview deploy**: preview routes/auth/stega/plugin + `diaa-nuxt-preview` Vercel project (SSR, `NITRO_PRESET=vercel`, env below) + prod project switched to `nuxt generate` output (`.output/public`, verify NO functions deployed for prod). Presentation E2E.
7. **Cutover**: `git mv apps/fe-next → apps/fe` replacing the old app wholesale; delete `scripts/**`, plop, `index.html`, old vite/vercel configs, root `img-optimize` script (confirmed dead — `localPicture` is voided, nothing else references it). Full turbo build green.
8. **Docs**: rewrite `CLAUDE.md` for the Nuxt architecture (drop GSAP ban + plop rules; add server-only-data-boundary rule), replace `apps/fe/docs/*`, changelog + version bump (this is 1.x-scale: bump minor at least; discuss 2.0.0 with user at the end).

## Env / deploy matrix

| Var | Prod (static) | Preview (SSR) | Local dev |
|---|---|---|---|
| SANITY_PROJECT_ID / DATASET | 0in4i1po / production | same | same |
| SANITY_READ_TOKEN | **unset** | required (Viewer) | only when testing preview |
| SANITY_STUDIO_URL | unset | required — hard-fail if missing (lesson from `4ae9ff8`) | http://localhost:3333 |
| NUXT_PUBLIC_PREVIEW_ENABLED | unset | `true` | opt-in |
| PREVIEW_SESSION_SECRET | unset | optional (falls back to token hash) | optional |
| NITRO_PRESET | (generate) | `vercel` | — |
| Studio: SANITY_STUDIO_PREVIEW_ORIGIN | n/a | preview URL | http://localhost:3000 |

Vercel: prod project builds `nuxt generate`, output `apps/fe/.output/public`, immutable cache on `/_nuxt/*`; preview project builds `nuxt build` SSR with Deployment Protection OFF (gated by preview-url-secret cookie instead).

## Verification

- Per-phase gates above, plus final: prod grep for zero visual-editing bytes; Presentation E2E (overlays resolve fields, draft save refreshes iframe reactively, URL bar tracks navigation, `/preview/enable` without secret → 401, noindex on all preview responses); stega spot-check (hrefs/slugs clean, body copy encoded).
- **Side-by-side feel QA** (old site vs port, two windows): intro sequence; home entrance timing (200ms hold + 1200ms `slow`); mode/filter switch V-fades with scroll preserved; nav V-fold; home→detail bridge (zero shadow-doubling, zero white-bleed at hard swap — test opaque AND transparent covers); return-beat plays on nav-click home but NOT after bottom-dwell auto-nav; detail in/out timings + nav fade at outro 50% + 300ms bottom dwell; mobile scroll-reveal single-active handoff; scroll damping feel (0.1); rapid double-click nav no-ops; 8s safety valve; back restores scroll instantly, forward resets to top; Ctrl+F/Ctrl+G dev tools in dev only.

## Risks

- **Sequential-timing-in-simultaneous-hooks** (transition port) is the single trickiest piece — isolated in `transitions/default.ts`, verified by feel QA.
- **home.ts (1109 lines)** is the highest-risk mechanical port (freeze flags, generation counters) — port method-by-method, keep names.
- **Static/SSR drift**: one code path per concern must work under both `generate` and SSR; test both modes per phase, not at the end.
- **Studio↔frontend route-rule duplication** (`resolve.locations` vs `content.ts`) remains hand-synced — noted in both files.
- **Icon/favicon files referenced by meta don't exist in public/** (pre-existing gap) — generate before launch.
