# Routing

Co-located route folder structure, auto-registration, and page lifecycle API.

---

## Folder Structure

Each route is a self-contained folder under `src/routes/`. The folder name becomes the page key.

```
src/routes/
├── partials/               # Shared Mustache partials (nav.html, meta.html, …)
├── home/
│   ├── home.html           # Mustache template for this route
│   └── home.ts             # Default-exports HomePage extends BasePage
├── about/
│   ├── about.html
│   └── about.ts
└── case-study/             # CMS template folder
    ├── *case-study.html    # Star-prefix = CMS template (rendered per Sanity page)
    └── case-study.ts       # Default-exports CaseStudyPage extends BasePage
```

**Rules:**
- A folder with an HTML file (or `*.mustache`) is a route. No HTML = not a route.
- The folder name is the page key used by `PageManager` and `App.config.routes`.
- `partials/` is skipped by the Vite plugin — it is not a route folder.

---

## Adding a New Route

1. Create `src/routes/{name}/` folder.
2. Add `{name}.html` — the Mustache template fragment for this page.
3. Add `{name}.ts` — default-export a class extending `BasePage`.
4. Done. Vite picks up the new template. `PageManager` auto-discovers the module.

No edits to any other file are required.

```
src/routes/
└── portfolio/
    ├── portfolio.html   ← Mustache fragment (used by routes-plugin.ts)
    └── portfolio.ts     ← PortfolioPage class auto-registered by PageManager
```

```typescript
// src/routes/portfolio/portfolio.ts
import { BasePage } from "@app/primitives/base-page";

/**
 * PortfolioPage — manages lifecycle for the /portfolio route.
 */
export default class PortfolioPage extends BasePage {
  async init(container: Element | null): Promise<void> {
    await super.init(container);
    console.debug("[page:portfolio] init");
  }

  async in(): Promise<void> {
    console.debug("[page:portfolio] in");
  }

  async out(): Promise<void> {
    console.debug("[page:portfolio] out");
  }
}
```

---

## CMS Template Routes

Routes driven by Sanity CMS data use the star-prefix convention on the HTML filename.

```
src/routes/case-study/
├── *case-study.html    ← Star-prefix marks this as a CMS template
└── case-study.ts       ← Shared class for all /case-study/* URLs
```

The Vite plugin (`scripts/routes-plugin.ts`) reads Sanity data at build time and renders
`*case-study.html` once per Sanity page, substituting `{{title}}`, `{{slug}}`, etc. via
Mustache. All resulting pages share `CaseStudyPage` as their page class — individual
case-study URLs are differentiated by Sanity content, not by separate TypeScript classes.

---

## Page Lifecycle API

Every route module default-exports a class extending `BasePage`. PageManager calls
the lifecycle hooks in this order during navigation:

```
Navigate to /about
  ↓ onBeforeOut hooks fire (GPU prepares scene swap)
  ↓ beforeOut()  → saves scroll position, calls out() on outgoing page
  ↓ callbacks.update()  → bridges to in() phase
  ↓ callbacks.insertNew()  → both old + new pages coexist in DOM
  ↓ Promise.all(transition.out(), transition.in())  → simultaneous animations
  ↓ double-RAF → onAfterIn hooks (GPU commit, video reinit)
  ↓ callbacks.removeOld()  → old page removed from DOM
  ↓ afterIn()  → calls init(container) + in() on incoming page + scroll restore
```

### BasePage lifecycle hooks

```typescript
export class BasePage {
  /**
   * Called when the route's DOM container is in the document.
   * Query DOM elements here. Always call super.init(container) first.
   */
  async init(container: Element | null): Promise<void>;

  /**
   * Enter animation. Called after init() when the page is ready to animate in.
   * Use kido/anima — never GSAP.
   */
  async in(): Promise<void>;

  /**
   * Exit animation. Called before the page's DOM is removed.
   * Run content-level exit animations here.
   */
  async out(): Promise<void>;

  /**
   * Teardown hook. Called after out() completes.
   * Cancel timers, remove event listeners, release resources.
   */
  async cleanup(): Promise<void>;

  /**
   * Optional scroll callback. Invoked by NativeScroller on each tick
   * if the page subscribes. Implement for parallax or scroll-triggered effects.
   */
  onScroll?(e: ScrollEvent): void;
}
```

---

## Auto-Registration

`PageManager` uses Vite's `import.meta.glob` to discover all route modules at build time:

```typescript
// src/app/page-manager.ts (module scope)
const routeModules = import.meta.glob<{ default: PageConstructor }>(
  "../routes/*/*.ts",
  { eager: true }
);

// Called once after PageManager singleton is created
PageManager.autoRegister();
```

`autoRegister()` extracts the folder name from each glob path (e.g. `"../routes/about/about.ts"` → key `"about"`) and registers the module's default export as the page class for that key.

**Result:** `PageManager.ensure("about")` returns an `AboutPage` instance, not a plain `BasePage`.

---

## Vite Plugin Discovery

`scripts/routes-plugin.ts` exports `getRouteFolders(absRoutesDir)` which scans
`src/routes/` at build time:

- Reads each subdirectory with `fs.readdirSync({ withFileTypes: true })`
- Skips `partials/` and non-directory entries
- Inside each folder, looks for `{name}.html`, `{name}.mustache` (static route) or `*{name}.html`, `*{name}.mustache` (CMS template)
- Returns an array of `{ name, htmlFile, isCmsTemplate }` entries used to emit `tmhgne.json`

`getRouteFolders()` is a named export so it can be tested independently of the full Vite plugin lifecycle (see `src/__tests__/routes-plugin.test.ts`).

---

## Partials

Shared Mustache partials live in `src/routes/partials/`. Route HTML templates include them as `{{{partial}}}`:

```html
<!-- src/routes/home/home.html -->
{{{nav}}}
<main class="page home">
  <section class="s__c">…</section>
</main>
```

**Important:** Keep all partials in `src/routes/partials/`. Do not create route-scoped `partials/` subfolders — the plugin reads from a single partials directory.

---

## Route → Page Key Mapping

`App.config.routes` maps URL paths to page keys. This object is populated at runtime from `tmhgne.json`:

```javascript
// App.config.routes example
{
  "/": "home",
  "/about": "about",
  "/case-study/client-name": "case-study"
}
```

`PageManager` uses the page key (not the URL) to look up the page class. CMS-driven case-study pages all map to the `"case-study"` key, which resolves to `CaseStudyPage`.

**CMS singleton routes** (`contact`, `imprint`) are a variant of this: the page key is a fixed string (`"contact"` / `"imprint"`, matching the route folder), but the URL path is not — it comes from the singleton's own CMS slug field at build time, falling back to `/contact` / `/imprint` respectively when no slug is set. `sanity-content.ts` pushes both pages unconditionally (with static fallback content when Sanity is unavailable), so the routes always exist regardless of CMS state.
