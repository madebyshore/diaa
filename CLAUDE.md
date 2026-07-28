# Tamahagane — CLAUDE.md

Portfolio site. **Vanilla TypeScript SPA** with custom routing, Sanity CMS, and kido-based animation. **Not Next.js, not React, not Vue.** Ignore any tooling that assumes otherwise.

---

## Project

- **Name:** Tamahagane (玉鋼)
- **Version:** 0.1.0 — building toward v1.0.0
- **Origin:** rebuilt from the `akimbo` codebase
- **Structure:** Turborepo monorepo, pnpm workspace

```
apps/
  fe/       Vite 8 SPA — the website
  be/       Sanity Studio (schemas + desk)
  editor/   WGSL shader playground (not covered here unless asked)
packages/
  kido/     Animation, scroll, reveal, text split, resize, pointer
```

---

## Absolute rules (do not violate)

1. **Never use GSAP.** All animation is `kido/anima` via `new Anima({...})` + `animaToPromise()`. No exceptions.
2. **Never hand-register a page class.** `PageManager.autoRegister()` discovers modules via `import.meta.glob("../routes/*/*.ts", { eager: true })`. Just create the folder.
3. **Never create new pages or custom transitions by hand.** Use the plop generators: `pnpm run new-page` / `pnpm run new-transition`. The generators wire up HTML, TS, sanity-content entries, transition registry entries. Edit the scaffold afterwards.
4. **Never skip the changelog.** Every commit that touches app code adds an entry under `[Unreleased]` in the root `CHANGELOG.md` (Keep a Changelog format).
5. **Never read `ak.json`.** The boot manifest is `tmhgne.json` now. Only old comments reference `ak.json`.

---

## Code style

- **Comments:** Every function and class gets a descriptive comment above its declaration explaining *what* it does and *why*. Treat comments as something a senior dev would find useful — not a restatement of the name.
- **Existing code:** When touching a file, add comments to any function/class that lacks one.
- **console.debug:** Sprinkle at meaningful lifecycle points (navigation, transition phases, page lifecycle, GPU operations). Use grep-friendly bracketed prefixes: `[router]`, `[transition:out]`, `[page:home:init]`, `[boot:phase5]`, `[gpu]`.
- **`dbg.*`:** Prefer the structured debug helpers from `@app/debug` (`dbg.page`, `dbg.ctrl`, `dbg.bootPhase`, `dbg.txOut`, etc.) where they exist. They wrap console.debug with consistent formatting.
- **Types:** Strict. No `any` unless genuinely unavoidable, and never silently. Explicit return types on functions, typed params, interfaces/types for data shapes.
- **Imports:** Use path aliases — `@app/*`, `@engine/*`, `@/*`, `@kido/*`. Kido is a bare workspace import (`import { Anima } from "kido/anima"`).

---

## Versioning & changelog

- `CHANGELOG.md` at repo root — Keep a Changelog format.
- Every commit that changes app code adds an entry under `[Unreleased]`.
- Pre-1.0 semver: `0.MINOR.PATCH` — minor for features/refactors, patch for fixes.
- Bump both `apps/fe/package.json` and the root `package.json` on meaningful milestones.

---

## Documentation

Authoritative deep-dive docs (read when you need more than this file provides):

- `apps/fe/docs/boot.md` — boot sequence (5 phases, DOM-only, see below)
- `apps/fe/docs/routing.md` — co-located routes, auto-registration
- `apps/fe/docs/controller.md` — Ctrl, TransitionManager, custom transitions (DOM-only)
- `apps/fe/docs/page-animations.md` — `in()`/`out()` hooks, Reveal zone classes, Anima usage

When you add or change a feature in `apps/fe`, update `apps/fe/README.md` and the relevant `apps/fe/docs/*.md`. If you introduce a new subsystem, create a new doc file and link it from the README.

---

## Workflow

- **Always commit between GSD workflow steps.** Don't leave uncommitted work between stages.
- Prefer a single atomic commit per logical change; never squash away a working intermediate state someone else may need.

---

# apps/fe — Frontend

Port 3000. Stack: Vite 8 (rolldown), TypeScript, Mustache, SCSS modules, kido, Sanity client (build-time only).

## Aliases

```ts
"@"       → apps/fe/src
"@app"    → apps/fe/src/app
"@engine" → apps/fe/src/engine
"@kido"   → apps/fe/src/kido  // legacy, rarely used
```

## The 5-phase boot sequence

`Application.init()` in `apps/fe/src/app/index.ts` runs these in strict order. Each phase awaits the previous. The ordering exists so pages can set their hidden initial DOM state (elements at opacity 0, split text offscreen) **before** the intro overlay wipes away — no flash of unstyled content.

1. **Intro creation** — `new Intro()`. Sets up the brand-beat overlay (no GPU, no texture loading).
2. **Controller install** — `history.scrollRestoration = "manual"`, `installController()`. Wires click + popstate event delegation.
3. **Scroller + page init** — `new NativeScroller()`, `scroller.registerRoute()` per route, `PageManager.registerFromRoutes()`, `await PageManager.initCurrentPage()`. This runs `page.init(container)` which is where the page sets DOM elements to `opacity: 0` and places split text offscreen.
4. **Intro animation** — `await intro.play()`. The DIAA mark fades in, holds, then the overlay fades out. No flash because phase 3 already applied the hidden initial state.
5. **Page entrance animations** — `await PageManager.animateCurrentPageIn()` → runs `page.in()` which fades the page container in, reveals split text, etc.

Rendering is DOM-only. There is no WebGPU, no canvas, and no GPU chunk. Desktop and mobile render identically.

## Global App singleton

`apps/fe/src/app/context.ts` exports `const App: AppState`. It's a plain object (not a class) so any module can `import { App } from "@app/context"` and access the same live reference. Fields are populated progressively during boot. Key fields:

- `App.config.routes` — `{ [url]: pageKey }` map (e.g. `"/about": "about"`). Populated from `tmhgne.json`.
- `App.route` — `{ old: {url, page}, new: {url, page} }`. Updated by `Ctrl._navigateRoute()` on every nav.
- `App.is` / `App.was` — boolean flags keyed by page key, for conditional logic in page modules.
- `App.cache` — `{ [url]: { title, html } }` — pre-rendered inner HTML for SPA navigation, loaded from the inlined `tmhgne.json` payload.
- `App.scroller` — `NativeScroller` or `Scroller`.
- `App.ctrl` — the installed `Ctrl` instance.
- `App.mutating` — transition lock. Navigation bails if true.
- `App.target` — `"back"` for popstate, otherwise the anchor element. Pages read this to decide scroll restore vs. reset.

In dev mode `window.App` is exposed for DevTools inspection.

---

## Creating a new page (the correct way)

**Always run the generator:**

```bash
cd apps/fe
pnpm run new-page
```

Prompts:

1. **Page name** — kebab-case folder name (e.g. `contact`, `case-study`).
2. **Route path** — URL path (defaults to `/{name}`).
3. **Page title** — browser tab title (defaults to PascalCase of name).
4. **Is this a CMS template route?** — if yes, the HTML file gets a `*` prefix and is rendered once per Sanity document at that template key.

What the generator creates:

- `src/routes/{name}/{name}.html` (or `*{name}.html` for CMS templates) — Mustache fragment using `{{> nav}}` and a container.
- `src/routes/{name}/{name}.ts` — `{PascalName}Page extends BasePage` with scaffolded `init()`, `in()`, `out()`.
- Appends a page entry to `scripts/sanity-content.ts`.

**After the generator runs, you:**

1. Replace the placeholder HTML with the real template. Pass dynamic data via Mustache tags (`{{title}}`, `{{#images}}{{> picture}}{{/images}}`, etc.).
2. Fill `init()` — query DOM, set hidden initial state (split text offscreen, `container.style.opacity = "0"`, etc.). **Setting hidden state here prevents a flash** because init runs before the intro overlay wipes.
3. Fill `in()` — entrance animations using `new Anima({...})` wrapped in `animaToPromise(...)`. Return a Promise that resolves when animations complete.
4. Fill `out()` — fast (200–500ms) content exit animation before the curtain wipe.
5. Update the page's entry in `scripts/sanity-content.ts` with real image/media data (localPicture or sanityPicture — see the CMS section).
6. Add any page-specific styles in `apps/fe/src/styles/pages/_{name}.module.scss` and re-export from `pages.scss`.
7. Add a link in `src/routes/partials/nav.html` if it should appear in the top nav.
8. Update `CHANGELOG.md` under `[Unreleased]`.
9. If the page introduces a new subsystem or significant behaviour, update `apps/fe/README.md` + the relevant `docs/*.md`.

**Why the generator matters:** it keeps the folder structure, the sanity-content entry, and the import paths in sync. Manual creation is a known source of drift — don't do it unless the generator physically cannot express what you need, in which case mirror its output exactly.

---

## Creating a new slice (the correct way)

A "slice" is a CMS-authored content block the editor can drop into any page. They are page-agnostic and live in **six places** that all dispatch from one Sanity `_type`:

| Location | What it is |
|---|---|
| `apps/be/schemaTypes/slices/slice<PascalName>.js` | Sanity schema. Registered in `slices/index.js`. |
| `apps/fe/scripts/slices/slice<PascalName>.ts` | Build-time resolver — GROQ `query` fragment + `resolve(raw, ctx)` transformer + `template` (partial filename). Registered in `scripts/slices/index.ts`. |
| `apps/fe/src/routes/partials/slices/slice<PascalName>.html` | Mustache partial. Section root carries `data-slice="slice<PascalName>"`. |
| `apps/fe/src/styles/slices/_<kebab-name>.module.scss` | BEM SCSS module. Re-exported in `styles/slices.scss`. |
| `apps/fe/src/app/slices/slice<PascalName>.ts` | **Only if the slice has interactive JS.** Pure-CSS slices skip this. Registered in `app/slices/index.ts`. |
| `apps/fe/src/styles/slices.scss` | Barrel — `@use` the new module. |

### Naming

- BEM classes use the slice's CMS name converted to kebab-case: `sliceFeaturedProjects` → `.slice-featured-projects` and `.slice-featured-projects__<element>`. Never use page-prefixed names like `home-*`.
- The `data-slice` attribute matches the Sanity `_type` exactly (camelCase): `data-slice="sliceFeaturedProjects"`. The runtime registry dispatches on this attribute.

### How slices get fetched + rendered

1. The slice registry in `apps/fe/scripts/slices/index.ts` is the single source of truth. `apps/fe/scripts/utils/queries.ts` walks every registered slice's `query` field and composes one `slices[] { _type, _key, ... }` projection inside `buildPageQuery()`.
2. `apps/fe/scripts/sanity-content.ts` fetches the slice-driven page query (e.g. `pageHomeSlicesQuery`), the `globals` singleton (for locations), and the `clients` singleton (for the carousel). Raw slices and singletons are persisted in the disk cache (`apps/fe/.cache/sanity-content.json`) — no Sanity refetch on dev rebuilds.
3. On every `loadSanityContent()` call the renderer cache is reset and `renderSlices(rawSlices, ctx)` walks the array, dispatching each `_type` to its registered resolver, then rendering the matching partial via Mustache. The resulting HTML string is attached to `page.data.home.slicesHtml` (or `page.data.about.slicesHtml`, etc.).
4. The page template splices it in via triple-mustache:

```mustache
{{#home}}
  {{{slicesHtml}}}
{{/home}}
```

5. At runtime, `BasePage.init()` calls `initSlices(this.container)` which walks every `[data-slice]` element and runs the matching init from `apps/fe/src/app/slices/index.ts`. Aggregated teardown runs from `BasePage.cleanup()` — listeners and timers never leak across SPA navigation.

### Slice runtime contract

```ts
// apps/fe/src/app/slices/slice<PascalName>.ts
export function initSlice<PascalName>(root: Element): (() => void) | void {
  const section = root as HTMLElement;
  // Query inside `root` only — never `document.querySelector`. A slice
  // must work on any page that contains it; multiple instances on one
  // page must each work independently.

  // ...wire listeners / timers...

  return () => {
    // removeEventListener / clearInterval / etc. The aggregated teardown
    // is invoked from BasePage.cleanup() on navigation.
  };
}
```

Register it with one line in `apps/fe/src/app/slices/index.ts`:

```ts
import { initSlice<PascalName> } from "./slice<PascalName>";

const sliceInits: Record<string, SliceInit> = {
  // ...
  slice<PascalName>: initSlice<PascalName>,
};
```

Keys must match the `data-slice` attribute. Pure-CSS slices skip the registry and are silently ignored.

### Build-time resolver contract

```ts
// apps/fe/scripts/slices/slice<PascalName>.ts
const slice<PascalName>: SliceDefinition<RawSlice<PascalName>, ResolvedSlice<PascalName>> = {
  name: "slice<PascalName>",       // matches Sanity _type
  template: "slice<PascalName>",   // matches Mustache partial filename
  query: `
    field1,
    "field2": pt::text(field2),
    "image": image.asset->url
  `,
  resolve: (raw, ctx) => ({ ... }), // raw → template data
};
```

Helpers in `apps/fe/scripts/slices/helpers.ts`:

- `pictureFromUrl(url, alt, index, width?, height?)` — builds responsive `PictureData` (avif/webp/jpg srcsets via Sanity URL params) so slice `{{> picture}}` reuses the shared partial.
- `resolveCta(raw)` — flattens a CTA object into `{ title, href, blank }`. Maps the `__home__` slug sentinel to `/`.
- `preserveLineBreaks(text)` — `\n` → `<br>` for `pt::text()` output.
- `renderPortableText(blocks, opts?)` — Portable Text → HTML. `wrap: "p"` wraps each block in `<p>`.
- `resolveLocations(globalsDoc)` — pre-resolved global locations consumed by location-aware slices.

### Rules

1. **Never query slice DOM from a page module.** Page modules own page-level concerns (entrance/exit animations, cross-slice coordination). All "click this button → toggle that data attribute" logic lives in the slice's own runtime file.
2. **Never query outside the `root` argument.** A `document.querySelector` inside a slice module breaks reusability across pages.
3. **Always return a teardown if you attached anything.** Listeners and `setInterval` handles must release or they leak across navigation.
4. **Backgrounds and theme:** use `var(--bg-theme)`, never the Sass `$bg-theme` literal, for any background that should track the page theme. The CSS var resolves at runtime; the Sass variable bakes a compile-time value.
5. **Z-index and sticky stacking belong to the page**, not the slice. Slices set their own visual identity (background, padding, layout); z-index ordering and `position: sticky / top: 0 / height: 110vh` rules live in `pages/_<page>.module.scss` scoped under the page class and target `.slice-*` instances. Keeps slices reusable.
6. **Update `CHANGELOG.md`** when adding a slice — describe the CMS name, what it renders, where it's mounted.

### Token compatibility

Slice modules `@use "@/styles/includes" as *` and reference shared tokens that exist as compatibility aliases in this project: `$font-mono`, `$font-accent`, `$color-page-bg`, plus mixins `link`, `float-cta`, `typo-eyebrow`. If a new slice needs a token outside that set, add an alias in `apps/fe/src/styles/includes/` rather than editing the slice module — keeps slices portable across projects.

---

## Page lifecycle

Every route module default-exports a class extending `BasePage` (`@app/primitives/base-page`). PageManager calls hooks in this order:

```
Navigate to /about
  ├─ PageManager.beforeOut()         (saves scroll, awaits outgoing page.out())
  ├─ callbacks.update()              (bridges to the in phase)
  ├─ callbacks.insertNew()           (old + new pages coexist in DOM)
  ├─ Promise.all(transition.out(), transition.in())   (simultaneous)
  ├─ double-RAF                      (wait for layout commit)
  ├─ 150ms delay, callbacks.removeOld()
  └─ PageManager.afterIn()           (new page.init() → page.in(), scroll restore)
```

### BasePage hook contract

```ts
class MyPage extends BasePage {
  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);            // stores container on `this.container`
    // Query DOM, set hidden initial DOM state for entrance (e.g. opacity: 0).
    // Runs BEFORE the intro overlay wipes on first boot.
  }

  async in(): Promise<void> {
    // Entrance animations. Return Promise that resolves when done.
    // BasePage's default implementation fades the container from opacity 0 to 1.
  }

  async out(): Promise<void> {
    // Content-level exit animation. Runs BEFORE the transition curtain.
    // Keep it fast (200–500ms) so the transition doesn't feel sluggish.
  }

  async cleanup(): Promise<void> {
    // Non-visual teardown: cancel timers, unsubscribe events, release resources.
  }

  onScroll?(e: ScrollEvent): void {
    // Optional. Subscribed to App.scroller in PageManager.animateCurrentPageIn.
  }
}
```

**Rule of thumb:** `init()` = query + hide. `in()` = reveal. `out()` = fast content exit. `cleanup()` = teardown.

---

## Animation — kido/anima

**Never use GSAP.** All animation goes through `Anima`:

```ts
import { Anima } from "kido/anima";
import { animaToPromise } from "@app/controller/transition-fx";

await animaToPromise(new Anima({
  el: this.heroTitle,
  d: 1000,                          // duration ms
  e: [0.16, 1, 0.3, 1],             // easing: bezier array or named preset ("oQ", "oC", "io")
  de: 100,                          // delay ms
  r: 5,                             // optional round precision
  p: {                              // animated properties
    o: [0, 1],                      // opacity
    y: [40, 0, "px"],               // translateY (unit optional, "px" default)
    x: [-20, 0, "px"],
    scale: [0.9, 1],
    scaleX: [0, 1],
  },
  u: (state) => {                   // per-frame update callback (for custom drivers)
    // state.prE = eased progress 0→1
    // Use this to drive non-CSS values each frame.
  },
  // cb fires on completion — animaToPromise uses this internally
}));
```

**Common eases** (from `DefaultTransition`):

| Shape | Bezier | Use for |
|---|---|---|
| o6 | `[0.16, 1, 0.3, 1]` | Fast start, smooth decel — page transforms |
| o4 | `[0.25, 1, 0.5, 1]` | Gentler decel — opacity overlays |
| io | `[0.76, 0, 0.2, 1]` | Ease in-out — curtain + clip reveals |
| codrops | `[0.38, 0.05, 0.65, 0.82]` | Content fades |
| `"oQ"` | (kido preset) | Split text |
| `"oC"` | (kido preset) | Div scale |

**Stagger** by passing incrementing `de` values:

```ts
for (let i = 0; i < items.length; i++) {
  anims.push(animaToPromise(new Anima({
    el: items[i], d: 900, e: [0.16, 1, 0.3, 1],
    de: 200 + i * 100,
    p: { o: [0, 1], y: [40, 0, "px"] },
  })));
}
await Promise.all(anims);
```

### Scroll-triggered reveals — zone classes

`PageManager.initCurrentPage()` auto-initialises `Reveal` from kido on every page with these selectors:

| Class | Effect |
|---|---|
| `._s` (or `.z__s`) | Split text — word-by-word slide up |
| `.z__o` | Opacity fade (children with `.o` stagger) |
| `.z__d` | Div scale — `scaleX(0→1)` |
| `.z__g` | SVG stroke-dashoffset mask reveal |

Append `-N` for stagger delay (`.z__o-2` = +200ms). Two numbers — `.z__o-1-3` — means 100ms when scrolled into view, 300ms when already in viewport on page load.

**Split text modifiers:**

```html
<h2 class="_s">Splits per word, default 100ms stagger</h2>
<p class="_s s-40">40ms stagger instead</p>
<p class="_s t-1">Adds rotateX(-30deg) tilt</p>
<h2 class="_s" data-split="br">Splits on &lt;br&gt; tags instead of words</h2>
```

The `Split` class in kido wraps each word in `<span class="s__o"><span class="s__i">` — the `.s__i` is the animated inner element.

---

## Navigation & transitions

All navigation flows through `Ctrl` in `apps/fe/src/app/controller/index.ts`. `installController()` wires event delegation on `document` for `<a>` clicks and on `window` for `popstate`. Both call `ctrl.navigate(path, target)`.

### Flow

```
Click or popstate
  ↓
Ctrl.navigate(path)
  ├─ Guard: bail if App.mutating
  ├─ Set App.mutating, start 8s safety timer
  ├─ _navigateRoute(path)                    (updates App.route.old/new, App.is, App.was)
  ├─ document.title = cache.title            (INFR-01)
  ├─ _setActiveNavLink(path)                 (ROUT-05)
  ├─ history.pushState (skipped if target === "back")
  └─ TransitionManager.out(callbacks)
      ├─ PageManager.beforeOut()             (save scroll, page.out())
      └─ callbacks.update() → Ctrl._in()
          └─ TransitionManager.in(callbacks)
              ├─ callbacks.insertNew()       (both pages in DOM)
              ├─ Promise.all(transition.out(fromEl, toEl), transition.in(fromEl, toEl))
              ├─ double-RAF                  (layout commit)
              ├─ 150ms delay, callbacks.removeOld()
              └─ PageManager.afterIn()       (page.init + page.in, scroll restore)
  → finally: clear safety timer, App.mutating = false
```

### Transition classes

Every visible transition extends `BaseTransition`:

```ts
abstract class BaseTransition {
  abstract out(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;
  abstract in(fromEl: HTMLElement, toEl: HTMLElement): Promise<void>;
  cleanup?(toEl: HTMLElement): void;
}
```

- `out()` and `in()` run **simultaneously** via `Promise.all`.
- Keep their durations roughly equal — the longer one determines total transition time.
- The default is `EmptyTransition` — a clean DOM swap where page-level `in()`/`out()` drive container opacity crossfades. Read `apps/fe/src/app/controller/transition-fx.ts` before writing a custom one.

### Creating a custom transition

**Always use the generator:**

```bash
cd apps/fe
pnpm run new-transition
```

Prompts:

1. From page (choose from existing route folders)
2. To page (choose from existing route folders)
3. Class name (defaults to `{From}{To}Transition`)

What it creates:

- `src/app/controller/transitions/{from}-to-{to}.ts` — class extending `BaseTransition` with scaffolded `out()`, `in()`, `cleanup()`.
- Adds the import and `this.registry.register("{from}", "{to}", new ...)` call in the `Ctrl` constructor in `controller/index.ts`.

**After scaffolding, implement `out()` and `in()`** using `animaToPromise(new Anima({...}))`. Always call `toEl.removeAttribute("style")` in `cleanup()` so the new page returns to normal document flow.

**Registry keys are page keys**, not URL paths. The key is the folder name (`"home"`, `"about"`, `"case-study"`). CMS-driven routes all share one page key (e.g. every `/case-study/*` URL uses `"case-study"`).

### Scroll save/restore

- **Save:** `PageManager.beforeOut()` snapshots `{cur, tar}` from the scroller.
- **Back-nav (`App.target === "back"`):** `initCurrentPage()` calls `scrollTo(snap.tar, true)` for an instant jump.
- **Forward-nav:** resets to `scrollTo(0, true)`.
- `history.scrollRestoration = "manual"` is set in boot phase 2 so the browser doesn't fight us.

---

## CMS — Sanity

**Sanity is fetched at BUILD TIME only.** There is no runtime Sanity client in the browser bundle. The flow is:

1. `scripts/sanity-content.ts` calls `loadSanityContent()` which uses `@sanity/client` to fetch with GROQ queries from `scripts/utils/queries.ts`.
2. It returns `{ pages }` — `pages` is an array of `{ path, key, title, template, data }`.
3. `scripts/routes-plugin.ts` (Vite plugin `RoutesAndBootPlugin`) receives this, renders each page's Mustache template with `data`, writes the HTML file to `dist/`, and emits `tmhgne.json` containing the route map and pre-rendered inner HTML cache.
4. At runtime, `loadPkg()` in `apps/fe/src/app/cache.ts` reads the inlined `<script id="__TMHGNE__">` payload and populates `App.config.routes` and `App.cache`.

### Sanity project

Configured in `apps/fe/project.config.ts` under `sanity: { projectId, dataset }`. The live project is `r8x2r9d9`. Env vars override:

| Variable | Purpose |
|---|---|
| `SANITY_PROJECT_ID` | Sanity project identifier |
| `SANITY_DATASET` | Sanity dataset name |
| `SANITY_READ_TOKEN` | Read token (optional for public data) |
| `SANITY_API_VERSION` | Defaults to `2023-10-10` |
| `SITE_URL` | Base URL for sitemap generation |

### Adding a new CMS-driven page

1. **Add/extend the schema** in `apps/be/schemaTypes/` — either `documents/singletons/` for a one-off page, `documents/collections/` for a repeatable type, or `documents/site/` for site-level config.
2. Register the schema in `apps/be/schemaTypes/index.js` (import + add to `schemaTypes` array).
3. Deploy the studio if needed: `cd apps/be && npx sanity deploy`.
4. **Add a GROQ query** in `apps/fe/scripts/utils/queries.ts` — look at `coverQuery` and `homePageQuery` for the pattern.
5. **Extend `loadSanityContent()`** in `scripts/sanity-content.ts` — fetch the query, build `PictureData` entries via `sanityPicture(url, alt, index)`, push a page entry:

```ts
pages.push({
  path: `/work/${slug}`,
  key: `case-${slug}`,      // used as the PageManager key
  title: cover.title,
  template: "case-study",   // matches src/routes/case-study/ folder
  data: { cover, images: pictures },
});
```

6. **If this is a new route template** (not an existing one), create the folder with a CMS template HTML (star-prefix): `src/routes/case-study/*case-study.html` and `src/routes/case-study/case-study.ts`. Use the generator (`pnpm run new-page`, answer "yes" to "Is this a CMS template route?").
7. Reference dynamic fields in the Mustache template: `{{title}}`, `{{#images}}{{> picture}}{{/images}}`, etc.

### Static page with responsive images

For static pages with local images in `public/assets/images/`:

```ts
pages.push({
  path: "/",
  key: "home",
  title: "Tamahagane",
  template: "home",
  data: {
    images: [
      localPicture("1", "Project thumbnail", 0),
      localPicture("2", "Project thumbnail", 1),
    ],
  },
});
```

`localPicture(basename, alt, index)` produces `PictureData` with srcsets pointing at `/assets/images/{basename}-{640,1024,1920}w.{avif,webp,jpg}`. The image-optimize build step (`tsx scripts/img-optimize.ts`, runs after `vite build`) generates those variants using sharp. The `index === 0` entry gets `fetchpriority="high"`; others get `loading="lazy"`.

### The `{{> picture}}` partial

`src/routes/partials/picture.html` renders a responsive `<picture>` with AVIF/WebP/JPEG sources from a `PictureData` object. Use it in any template:

```mustache
{{#images}}
  {{> picture}}
{{/images}}
```

---

## Rendering

Rendering is DOM-only. There is no WebGPU, no `<canvas>`, and no GPU bundle. Page images are responsive `<figure class="_g"><img></figure>` elements rendered via the shared `{{> picture}}` partial — the `._g` class simply sets `aspect-ratio`, `overflow: hidden`, and `img { object-fit: cover }`. The home page's text-mode hover reveal (`.home__text-gpu` / `.home__text-gpu-figure`) is a pure DOM overlay: hovering a text label toggles `.is-active` on the matching figure, fading a centered `<img>` in via CSS.

---

## Image pipeline

1. Source images live in `apps/fe/public/assets/images/` (originals only, `.jpg`).
2. `vite build` copies them to `dist/assets/images/`.
3. `tsx scripts/img-optimize.ts` runs after build and generates AVIF, WebP, JPEG variants at 640w, 1024w, 1920w using sharp.
4. `localPicture(basename, alt, index)` in `sanity-content.ts` emits the matching srcsets.
5. The `{{> picture}}` partial renders a responsive `<picture>` element with all three format sources.

---

## Styles

SCSS modules under `apps/fe/src/styles/`. Entry is `core.scss`.

- `core/` — reset, base, root, intro
- `includes/` — variables, breakpoints, colors, typography, layout, helpers, z-index
- `pages/` — per-page styles, barrelled in `pages.scss`

Breakpoint `md` = 1024px.

When adding a new page, create `pages/_{name}.module.scss` and add the import to `pages.scss`.

---

## kido — animation & DOM utilities

`packages/kido` exposes these subpaths (each is a tree-shakeable entry — verify against `packages/kido/package.json`):

| Import | What it gives you |
|---|---|
| `kido` (barrel) | `Raf, RafHub, Delay, Timer, Tab, Svg, Split, PointerMove, WheelKeys, ResizeHub, Anima, Reveal, Scroller, Sniff, Ease, cubicBezier, clamp, lerp, damp, round, bounds, queryAll, setTheme, ...` |
| `kido/anima` | `Anima`, `AnimaConfig`, `AnimaPlayOptions`, `AnimaState` |
| `kido/raf` | `Raf, RafHub, Delay, Timer, getFrameRatio` |
| `kido/utils` | `clamp, lerp, aLerp, iLerp, damp, round, queryAll, bounds, Sniff, Ease, ...` |
| `kido/split` | `Split` — text splitter |
| `kido/reveal` | `Reveal` — scroll-triggered zone reveals |
| `kido/scroller` | `Scroller` — virtual scroller |
| `kido/native-scroller` | `NativeScroller` — damped native scroll with per-route state |
| `kido/resize` | `ResizeHub` — global resize observer |
| `kido/pointer` | `PointerMove` |
| `kido/wheel` | `WheelKeys` |
| `kido/svg` | `Svg` path/line helpers |
| `kido/tab` | `Tab` visibility detection |

**kido is mutable during the refactor.** If you need a feature that kido doesn't have, you may extend it — don't copy-paste animation primitives into the fe app. Remember to bump its version and rebuild (`pnpm --filter kido build`) when consumed changes ship.

---

# apps/be — Sanity Studio

Sanity v3 + React 19. Edit schemas, deploy the studio, and the frontend picks up new content on next build.

## Layout

```
schemaTypes/
  documents/
    collections/   repeatable types (caseStudy, page)
    singletons/    one-off documents (pageHome)
    site/          site-level config (siteNav, siteOptions)
  objects/         reusable field objects (seo, internalLink, externalLink, textBlock)
  slices/          builder slices (gridBuilder, zineBuilder, zinePage)
  index.js         barrel — add new schemas here
components/        custom Sanity input components (gridBuilder, imagePositioner)
plugins/builder/   custom plugin
utils/             helper functions, internal link targets
desk.js            studio desk structure
sanity.config.js   studio config
sanity.cli.js      CLI config
```

## Adding a schema

1. Create the file under `documents/collections/` (repeatable) or `documents/singletons/` (one-off) or `objects/` (reusable field).
2. Use `defineType` + `defineField` from `sanity`. Look at `documents/singletons/pageHome.js` for the pattern — title/images/slices/seo field groups with icons from `react-icons`.
3. Import and add to `schemaTypes/index.js`.
4. If it should appear in the desk, update `desk.js`.
5. Deploy: `cd apps/be && npx sanity deploy`.
6. On the frontend side, add a GROQ query to `apps/fe/scripts/utils/queries.ts` and extend `loadSanityContent()` in `scripts/sanity-content.ts`.

---

# packages/kido

Workspace package. Published-ready (`publishConfig.access: public`) but consumed internally via `workspace:*`.

- **kido** — animation, scroll, DOM utilities. ESM, tree-shakeable, 14+ subpath exports. Refactorable.

Build kido in watch mode: `pnpm --filter kido dev`.

Run all builds: `pnpm build` at repo root (turbo).

---

# Common commands

```bash
# Install
pnpm install

# Dev — all apps
pnpm dev

# Dev — specific app
pnpm --filter fe dev                 # frontend on :3000
pnpm --filter tamahagane-be dev      # Sanity Studio

# Build
pnpm build                           # all (turbo)
pnpm --filter fe build               # fe only (lint + vite build + img-optimize)

# Test
pnpm test                            # all
pnpm --filter fe test                # fe only (vitest)

# Scaffolding (always do this instead of by-hand file creation)
cd apps/fe
pnpm run new-page
pnpm run new-transition

# Sanity deploy
cd apps/be && npx sanity deploy
```

---

# Requirements

- Node ≥ 18
- pnpm ≥ 10.20.0
- Any modern browser — rendering is DOM-only.

---

# Key file reference

| File | Role |
|---|---|
| `apps/fe/src/main.ts` | Entry — instantiates `Application` and calls `init()` |
| `apps/fe/src/app/index.ts` | `Application` class — 5-phase boot orchestrator |
| `apps/fe/src/app/context.ts` | `App` singleton + AppState types |
| `apps/fe/src/app/cache.ts` | `loadPkg()` — reads inlined `tmhgne.json` into App state |
| `apps/fe/src/app/utils.ts` | `bootstrap()`, `resetScrollPosition()`, initial route setup |
| `apps/fe/src/app/page-manager.ts` | `PageManager` singleton — auto-registration, lifecycle, scroll save/restore |
| `apps/fe/src/app/primitives/base-page.ts` | `BasePage` — init/in/out/cleanup contract |
| `apps/fe/src/app/primitives/component.ts` | `Component` — reusable animated element base class |
| `apps/fe/src/app/controller/index.ts` | `Ctrl` + `installController()` — navigation entry point |
| `apps/fe/src/app/controller/transition-manager.ts` | out/in choreography |
| `apps/fe/src/app/controller/transition-registry.ts` | `BaseTransition` + `TransitionRegistry` |
| `apps/fe/src/app/controller/transition-fx.ts` | `EmptyTransition` + `animaToPromise` |
| `apps/fe/src/app/controller/types.ts` | `TransitionCallbacks`, `NormalizedUrl` |
| `apps/fe/src/engine/boot/intro.ts` | `Intro` — brand-beat overlay animation |
| `apps/fe/src/routes/` | Co-located route folders (`{name}/{name}.html` + `{name}.ts`) |
| `apps/fe/src/routes/partials/` | Shared Mustache partials (`nav`, `meta`, `picture`, `grid`, `intro`) |
| `apps/fe/scripts/routes-plugin.ts` | Vite plugin — route discovery, Mustache rendering, `tmhgne.json` emission |
| `apps/fe/scripts/sanity-content.ts` | Build-time Sanity fetcher — emits `{ pages }` |
| `apps/fe/scripts/utils/queries.ts` | GROQ queries |
| `apps/fe/scripts/utils/image-url.ts` | Sanity image URL builder |
| `apps/fe/scripts/img-optimize.ts` | Post-build sharp variants (AVIF/WebP/JPEG) |
| `apps/fe/plopfile.mjs` | `new-page` / `new-transition` generators |
| `apps/fe/plop-templates/` | Handlebars templates used by plop |
| `apps/fe/index.html` | Shell template (wrapped around every route's rendered fragment) |
| `apps/fe/project.config.ts` | Site-level config (colors, grid, Sanity project) |
| `apps/fe/vite.config.ts` | Vite config, aliases |
| `packages/kido/src/anima.ts` | `Anima` — animation primitive |
| `packages/kido/src/reveal.ts` | `Reveal` — scroll-zone reveals |
| `packages/kido/src/split.ts` | `Split` — text word splitter |
| `packages/kido/src/native-scroller.ts` | `NativeScroller` — damped native scroll |
| `apps/be/schemaTypes/index.js` | Sanity schema barrel — register new types here |
