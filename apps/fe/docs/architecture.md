# Architecture — data flow & build modes

How content gets from Sanity to the rendered page, and how the same codebase produces two different deployable outputs (static production, SSR preview).

---

## The published/drafts seam

Every Sanity read goes through `app/data/client.ts`'s `getSanityClient(perspective, config, stega?)`. There are exactly two perspectives, with deliberately different trust levels:

| Perspective | CDN | Auth | Stega | Used by |
|---|---|---|---|---|
| `"published"` | Yes (`useCdn: true`) | Anonymous | Hardcoded `false` — not configurable | `nuxt generate` prod, and any preview request without a valid session |
| `"drafts"` | No (`useCdn: false`) | `SANITY_READ_TOKEN` (Viewer-scoped) required | Enabled, via `buildPreviewStega()` | Authenticated SSR preview requests only |

`stega: false` is hardcoded on the `"published"` branch in `client.ts` — there is no config flag that turns it back on for published output, by design. Stega-encoding published HTML would leak Studio edit-intent metadata into the public site.

Every function in `app/data/content.ts` takes `config: SanityClientConfig` as an explicit parameter rather than calling `useRuntimeConfig()` itself. Two very different callers need this config from two different sources:

- `app/plugins/content.server.ts` — a live Nuxt plugin, has `useRuntimeConfig()` available.
- `nuxt.config.ts`'s `prerender:routes` hook — runs in the Nuxt build/CLI process, **before any Nuxt app instance exists**. `useRuntimeConfig()` isn't callable there; it builds the same shape from `process.env` directly.

Keeping `data/*.ts` free of any `useRuntimeConfig()` call is also what keeps the module typecheckable from `nuxt.config.ts` — that file's TS program doesn't carry Nuxt's ambient auto-import types, so a bare `useRuntimeConfig()` reference inside an imported module fails `nuxt typecheck` even if never called at runtime.

## Request-scoped fetch, not build-time-once

The old vanilla-TS pipeline (`scripts/sanity-content.ts`) fetched everything once, at build time, into one manifest object. The Nuxt data layer is **request/route-scoped**: `app/plugins/content.server.ts` runs once per SSR request (or once per route during `nuxt generate`'s prerender crawl), and does the following, every time:

```
plugins/content.server.ts (runs server-side only, never client-bundled)
  │
  ├─ resolve perspective
  │    session cookie present + valid (data/preview-auth-core.ts) → "drafts"
  │    otherwise                                                  → "published"
  │
  ├─ build stega config (drafts only)
  │    buildPreviewStega(requireStudioUrl(SANITY_STUDIO_URL))
  │
  ├─ Promise.all([
  │      loadSiteOptions(perspective, config, stega)     ─┐
  │      loadRouteContent(route.path, perspective, ...)  ─┤  data/content.ts
  │    ])                                                 ┘
  │
  ├─ useSiteOptions().value = siteOptions
  └─ usePageData().value    = pageContent
```

`loadRouteContent(path, ...)` (`app/data/content.ts`) resolves one route's content by trying, in order: home (`"/"` only) → Detail by slug → Contact → Imprint. Returns `null` if nothing matches (the page 404s). Each branch does its own Sanity fetch; there's no shared "fetch everything, filter client-side" step.

`useSiteOptions()`/`usePageData()` are plain `useState()` calls — Nuxt's SSR-safe shared-per-request state. Every component downstream (nav, footer, the page template, `<title>` composition) reads from these instead of fetching independently. Both composables import `app/data/content.ts` **type-only** (`import type { SiteOptionsContent } from "~/data/content"`) so `@sanity/client` never reaches the client bundle even though the *shape* is shared.

```
queries.ts ──▶ content.ts (loaders) ──▶ content.server.ts (plugin) ──▶ useState ──▶ pages/components
 (GROQ)         (published/drafts        (per-request fetch,           (usePageData,   (index.vue,
                  seam, slice                resolves perspective        useSiteOptions)  [slug].vue,
                  resolution)                from session cookie)                          SliceRenderer)
```

## Route resolution & the discriminated union

`loadRouteContent()` returns a `RouteContent` discriminated union — `HomeRouteContent | DetailRouteContent | RichTextRouteContent` — tagged by `.template`. `app/pages/[slug].vue` branches on that tag with `v-if`/`v-else-if`:

- `template === "detail"` → detail template, `createDetailController()`
- `template === "contact" | "imprint"` → shared rich-text template, `createRichTextController(template)` (the template string doubles as the controller's BEM-scoping key)
- `null`, or `template === "home"` reached through `/:slug` → `createError({ statusCode: 404, fatal: true })`

`app/pages/index.vue` is a separate route (`/`) entirely, always resolving `HomeRouteContent`.

## Slice resolution

Detail pages carry a `slices[]` array. `resolveSlices(rawSlices, ctx)` (`app/data/slices/registry.ts`) walks it once, server-side, dispatching each raw item's `_type` to its registered `SliceDefinition.resolve()`. Unregistered types are dropped with a `console.debug` warning, not an error — a schema addition on the Studio side that hasn't shipped a frontend resolver yet degrades gracefully instead of breaking the page.

Unlike the old build-time pipeline, `resolve()` **does not pre-render HTML**. Rich-text fields pass through as raw Portable Text blocks; `<RichText>` (`@portabletext/vue`) renders them client-side (and server-side, for SSR/prerender — it's a normal Vue component, not a template-string builder). This matters for stega: encoded zero-width characters need to survive as literal characters in rendered text nodes, which a build-time HTML-string-concat step would have been more likely to mangle.

`app/data/queries.ts`'s `buildSlicesProjection()` composes every registered slice's `query` fragment into one GROQ projection (`slices[] { _type, _key, <union of every slice's fields> }`) automatically — adding a slice never requires touching the Detail query by hand.

## Static vs. preview build modes

Both modes build from the same `apps/fe` codebase; the only difference is the `NUXT_PUBLIC_PREVIEW_ENABLED` env var at build time and which `nuxt` command runs.

| | Static prod (`nuxt generate`) | SSR preview (`nuxt build`) |
|---|---|---|
| `NUXT_PUBLIC_PREVIEW_ENABLED` | unset | `true` |
| Output | Fully static HTML in `.output/public`, zero server | Nitro server in `.output/server`, deployed as Vercel functions (`NITRO_PRESET=vercel`) |
| Content perspective | Always `"published"` | `"drafts"` for authenticated sessions, `"published"` fallback otherwise |
| `server-preview/**` | Not scanned by Nitro at all (`nitro.scanDirs`) | Scanned — preview auth routes exist |
| `plugins-preview/visual-editing.client.ts` | Not in the `plugins` array — never imported | Registered |
| Content routes prerendered? | Yes — every Detail/Contact/Imprint path is baked to static HTML at build time | No — content routes render dynamically per request (see below) |

### Why content routes are never prerendered in a preview build

Nitro's prerenderer runs during `nuxt build` too, not only `nuxt generate` — this was discovered the hard way when an early preview build 500'd on every content route. If `/`, `/:slug`, `/contact`, `/imprint` were baked to static HTML at build time in a preview build, that HTML would freeze whatever the crawler saw *then* (always "published" — no session cookie exists at build time), and Nitro would serve that frozen file at runtime **instead of ever invoking `content.server.ts`'s per-request drafts+stega branch** — silently defeating preview for every content route.

`nuxt.config.ts`'s `prerender:routes` hook therefore only registers content routes (via `loadAllRoutePaths("published", config)`) when `!previewEnabled`. In a preview build, content routes render dynamically per request, exactly like any other SSR route. `/sitemap.xml` and `/robots.txt` are registered for prerendering in **both** modes — they're hand-rolled Nitro routes the crawler can't discover on its own, and `previewEnabled` is a build-time-fixed value (an env var, not per-request), so their bodies can't go stale the way a content route's drafts-perspective render could.

### Route discovery for `nuxt generate`

Nuxt's crawler only finds pages linked in the SSR'd DOM. The home page links every routable Detail via `<a href="/{slug}">`, so those get crawled naturally — but Contact/Imprint links only live in the footer, and relying on crawl discovery would silently drop a page the moment a link goes missing or is JS-gated. Instead, `prerender:routes` explicitly registers every path from `loadAllRoutePaths()` — the **same function** `loadRouteContent()`'s route-matching logic is built from (Detail paths are derived from `loadHomeContent()`'s already-deduped `gridItems`, not a separate listing query), so the crawled route list can never drift out of sync with what actually renders.

## Nitro's `scanDirs` merge behavior

`nuxt.config.ts`'s `nitro.scanDirs` array is **additive**, not a replacement — Nuxt always scans its own default `server/` dir regardless of what's in this array (Nuxt/Nitro merge via `defu`, which concatenates arrays rather than overwriting them). The array in this config therefore only controls whether `server-preview/` is *also* scanned — `server/routes/sitemap.xml.get.ts` and `robots.txt.get.ts` ship in every build unconditionally.

`scanDirs` entries must be **absolute paths** — Nitro silently skips entries it can't resolve rather than erroring. `nuxt.config.ts` uses `fileURLToPath(new URL("./server-preview", import.meta.url))` rather than a bare relative string for this reason (caught the hard way: a bare `"server-preview"` string produced a build with zero preview routes bundled, no error).

See `apps/fe/docs/visual-editing.md` for the full preview auth flow, the stega mechanism, and the deploy runbook.
