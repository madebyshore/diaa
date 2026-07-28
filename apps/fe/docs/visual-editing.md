# Visual Editing

Sanity's Presentation tool lets an editor open the Studio, see the live site
in an iframe, click any piece of copy to jump straight to the field that
produced it, and watch a draft save show up in the iframe a couple seconds
later. None of that runs against production. **Production stays a pure
static build** — `apps/fe` fetches Sanity once at build time, pre-renders
every route to HTML via Mustache, and ships a static `dist/` with zero
runtime Sanity access. Everything in this document is a second,
parallel deployment that renders **drafts** on demand; the production
deployment is untouched by any of it.

## Architecture

```
Studio (apps/be)
  presentationTool ──iframe──▶ Preview deployment
                                 ├─ Vercel project "diaa-preview" (apps/preview), or
                                 └─ local `pnpm --filter diaa preview:cms` (port 8080)
                                      │
                                      ▼
                                Shared preview core (apps/fe/scripts/preview/*)
                                      │
                                      ▼
                                renderSite({ perspective: "drafts", stega: ON })
                                (apps/fe/scripts/routes-plugin.ts — the same
                                 in-memory renderer the production build's
                                 emitRoutesAndBoot() also calls, with
                                 perspective: "published" and stega off)
                                      │
                                      ▼
                                Injected HTML + inline __TMHGNE__ payload
                                      │
                                      ▼
                                SPA overlay runtime
                                (src/app/preview/visual-editing.ts)
                                      │
                                      ▼
                                @sanity/visual-editing overlays in the iframe

Production (apps/fe on Vercel) ── vite build → static dist/ ── completely separate,
                                                                  no drafts, no stega,
                                                                  no visual-editing code path
```

The preview core is **host-agnostic**: it's a set of pure functions with no
HTTP framework baked in. Two thin adapters wrap the exact same core —
`apps/fe/scripts/preview-server.ts` (a `node:http` server for local dev) and
`apps/preview/api/[[...path]].ts` (a Vercel catch-all Function). Neither
adapter contains routing, auth, or rendering logic of its own; they only
translate their host's request/response shape into the framework-agnostic
`PreviewRequest`/`PreviewResponse` the core speaks.

## The preview core (`apps/fe/scripts/preview/`)

| File | What it does and why |
|---|---|
| `render.ts` | `getPreviewSite()` — the memoized drafts render at the center of everything. Resolves `FE_ROOT` from three candidates (`PREVIEW_FE_ROOT` env override → the derived `apps/fe` path from `import.meta.url` → a `.preview-runtime/` fallback for the deployed Vercel function), then wraps `renderSite({ perspective: "drafts", stega })` with a memo, a TTL, and an in-flight guard (see below). Throws a hard, actionable error if `SANITY_READ_TOKEN` is missing rather than silently falling back to an empty render. |
| `stega.ts` | `buildPreviewStega(studioUrl)` — builds the `StegaConfig` (and its field-exclusion `filter`) passed into the drafts `renderSite()` call. See [Stega](#stega) below. |
| `inject.ts` | `injectPreviewHtml(html, site, opts)` — turns one page's in-memory drafts HTML into a preview-ready document: strips the dev-mode `<script src="src/main.ts">` tag, injects the real hashed JS/CSS tags from the `dist/` build manifest (via the Phase-1-exported `findHashedAssets()`/`injectAssetTags()` in `routes-plugin.ts`), inlines the boot manifest as `__TMHGNE__`, and stamps `window.__PREVIEW__` + `window.__SANITY_STUDIO_URL__`. |
| `auth.ts` | The draft-access gate. `handleEnableRequest()` validates a Studio-issued `/__preview/enable?sanity-preview-secret=…` link via `@sanity/preview-url-secret`'s `validatePreviewUrl()` and, on success, mints a stateless session cookie. `isAuthorized()` verifies that cookie on every other request. See [Auth](#auth). |
| `handler.ts` | `handlePreviewRequest(req)` — the framework-agnostic route table both entrypoints share (see below). Stamps `X-Robots-Tag: noindex` and `Cache-Control: no-store` on every response, success or failure. |
| `preview-server.ts` (one level up, `apps/fe/scripts/`) | Local dev entrypoint — `pnpm --filter diaa preview:cms`, port 8080. A thin `node:http` wrapper: streams `dist/` static files (hashed JS/CSS, fonts, images) directly, and delegates everything else to `handlePreviewRequest()`. It never runs `vite build` itself — run `pnpm --filter diaa build` first (and again after any code change). |

### Route table (`handler.ts`)

| Method + path | Handled by |
|---|---|
| `GET /__preview/enable` | `auth.handleEnableRequest()` — the only route reachable **without** a session, since it's how the session gets created |
| *(everything else)* | 401 unless `auth.isAuthorized()` passes |
| `POST /__preview/refresh` | `bustPreviewSite()` then re-render; responds `{ ok, generatedAt }` |
| `GET /tmhgne.json` | The memoized boot manifest as JSON (accepts `?fresh=<epochMs>`, see below) |
| `GET <any other path>` | The memoized, preview-injected page HTML for that route |

### Memo / TTL / in-flight model

`getPreviewSite()` (`render.ts`) keeps a single module-scope memo:

- **Memoized**, stamped with an epoch-ms `generatedAt` — a warm instance (or
  the local dev server, which stays warm for the life of the process) never
  re-fetches Sanity on every request.
- **30-second TTL** (`MAX_AGE_MS`) — a cross-instance staleness bound.
  Vercel Fluid compute can keep multiple instances warm with independent
  memos; the TTL puts a ceiling on how stale any one of them can get without
  an explicit refresh.
- **In-flight promise guard** — concurrent requests that all observe a
  stale/absent memo share exactly one render instead of racing N parallel
  Sanity fetches.
- **`forceFreshSince`** — `/tmhgne.json?fresh=<generatedAt>` (the timestamp a
  `/__preview/refresh` call just returned) forces any instance whose memo
  predates that timestamp to re-render, even if it's still within the normal
  TTL. This is what lets a refresh triggered on one warm instance guarantee
  a fresh result even if the client's follow-up fetch lands on a *different*
  warm instance.

### Auth

The session is intentionally **stateless** — nothing is stored server-side,
because Vercel Fluid compute has no shared memory between instances. The
cookie value *is* the proof: `<expiryEpochMs>.<hmacHex>`, where the HMAC is
SHA-256 over the expiry, keyed by `PREVIEW_SESSION_SECRET` (or, if unset, a
SHA-256 hash of `SANITY_READ_TOKEN` — already required for drafts rendering,
so a working deployment never needs a second secret just to gate sessions).
Any instance holding the same secret can verify any other instance's cookie
without coordination. Verification (`isAuthorized()`) recomputes the HMAC
and compares it in constant time (`timingSafeEqual`); every failure mode
(missing cookie, malformed value, expired timestamp, bad signature) collapses
to `false`.

The cookie set on a successful `/__preview/enable` is:

```
__preview_session=<expiry>.<hmac>; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=28800
```

`SameSite=None` requires `Secure`, which in turn strictly requires HTTPS —
**except** modern browsers (Chrome, Firefox) treat `http://localhost`
specifically as a "potentially trustworthy origin," so the `Secure` cookie
is still set and read correctly against the local `preview:cms` server at
`http://localhost:8080`. It will **not** work if you swap in any other
non-HTTPS hostname (a LAN IP, a custom `/etc/hosts` entry, etc.) — only
`localhost` gets the exception.

Session lifetime is 8 hours (`SESSION_LIFETIME_MS`), matched to a client
editor's working session.

Every response — success, 401, or error — carries `X-Robots-Tag: noindex`
and `Cache-Control: no-store`. This server only ever serves draft content;
neither a search crawler nor an intermediate cache should retain it.

## SPA runtime (`src/app/preview/visual-editing.ts`)

`maybeEnableVisualEditing()` is called once, fire-and-forget, right after
`installController()` in boot phase 2 (`src/app/index.ts`). It returns
immediately unless `window.__PREVIEW__` is `true` — a flag `injectPreviewHtml()`
stamps onto preview HTML and that **never appears in a production build**.
Because the gate is checked before the `import()` runs, bundlers keep
`@sanity/visual-editing` in its own lazy chunk that a production page load
never even requests over the network.

Two pieces of `Window` are declared in `src/global.d.ts`:

```ts
interface Window {
  __PREVIEW__?: boolean;
  __SANITY_STUDIO_URL__?: string;
}
```

### History bridge

Presentation needs to (a) drive the iframe's URL when an editor clicks a
result in its own navigator, and (b) know when the iframe navigates on its
own (an in-page link click). `enableVisualEditing({ history })` covers both:

- **`update(update)`** — Presentation asking the iframe to navigate.
  `"push"`/`"replace"` both route through `App.ctrl.navigate(update.url)`;
  `"pop"` calls `history.back()`. `Ctrl.navigate()`'s existing
  `App.mutating` guard silently drops a call that arrives mid-transition —
  exactly the behavior wanted here too, so no extra queuing was added.
- **`subscribe(navigate)`** — the SPA telling Presentation's own URL bar
  what just happened. It has to cover **two** distinct paths: native
  `popstate` (back/forward), and an in-iframe link click, which goes through
  `Ctrl.navigate()`'s own `history.pushState()` and never fires `popstate`.
  The second path needed a new, deliberately generic hook —
  `onNavigationCommitted()` (`src/app/controller/index.ts`) — a
  subscriber set that fires with the new pathname immediately after every
  `pushState()` call inside `Ctrl.navigate()` (skipped for `"back"`
  navigations, which don't `pushState`). It's not preview-specific by
  design: any future subsystem that needs to mirror SPA navigations
  (analytics, etc.) can subscribe there too, instead of `Ctrl` growing a
  bespoke hook per consumer. Every observer invocation is wrapped in
  try/catch at the call site so a throwing subscriber can never break
  navigation.

### Refresh flow

`enableVisualEditing({ refresh })` is called by Presentation right after a
draft save. The handler (`refreshDraftContent()`):

1. Bails out (logs, does nothing) if `App.mutating` — a real navigation is
   already in flight, and rehydrating the DOM under it would be worse than
   skipping this tick. Presentation re-fires refresh on the next save if
   this one goes stale.
2. `POST /__preview/refresh` → busts the server's memo, awaits the fresh
   render, gets back `{ generatedAt }`.
3. `reloadPkgFromNetwork(generatedAt)` (`src/app/cache.ts`) — re-fetches
   `/tmhgne.json?fresh=<generatedAt>` over the network and replaces
   `App.config.routes` / `App.cache` in place. This is a **separate**
   function from `loadPkg()`: `loadPkg()` prefers the inline `#__TMHGNE__`
   payload baked into the page at first boot, which is exactly the stale
   payload a refresh needs to bypass. `?fresh=` also guarantees this fetch
   can never land on a pre-refresh memo even on a different warm server
   instance (see the TTL section above).
4. Rehydrates the current route in place: `normalize()` + `setInitialRoute()`
   + `hydrateFromCache()` swap in the fresh HTML, `App.container` is reset to
   `null` so `PageManager.afterIn()` re-resolves the container from the DOM
   `hydrateFromCache()` just inserted (instead of reusing a now-detached
   node), then `PageManager.afterIn()` runs the normal `init()` + `in()`
   sequence — the same one a regular SPA navigation runs. Because it reuses
   that sequence, the page never gets stuck at the `opacity: 0` state
   `BasePage.init()` sets before an entrance animation would otherwise
   reveal it, and there is **no intro-overlay flash** — the boot intro only
   ever plays once, at first load.

## Stega

Stega is `@sanity/client`'s built-in trick for round-tripping edits: it walks
every string leaf in a GROQ result and, when enabled, invisibly embeds
zero-width metadata into it, so Sanity's Presentation tool can map rendered
text back to the Studio field that produced it. That's exactly what's wanted
for visible copy — titles, Portable Text bodies — and actively harmful for
any string that ends up as a **route key, filename, URL, or HTML attribute
value**: the invisible characters corrupt the value (a stega-tagged image
URL 404s; a stega-tagged slug never matches an entry in `App.config.routes`).

`buildPreviewStega()` (`apps/fe/scripts/preview/stega.ts`) builds a filter
that excludes exactly those fields, matched on the **last segment of
`resultPath`** — the alias name each GROQ query gives the field, not its
underlying Studio schema path. This matters because GROQ aliases (e.g.
`"image": image.asset->url`) determine the actual key a value arrives under,
not the schema field name.

| Excluded key | Where it comes from | Why it must stay clean |
|---|---|---|
| `slug` | `pageHomeQuery` grid items, `allDetailsQuery`, `pageContactQuery`/`pageImprintQuery` (`scripts/utils/queries.ts`) | Becomes the route path and an `App.config.routes` key |
| `href` | `siteOptionsQuery.footerLinks[]` and every internal-link markDef from `richBodyProjection`/`richTextQuery()` (contact/imprint bodies, `sliceText`, `sliceImageWithText`) | Rendered as an `<a href>` attribute |
| `image` | `sliceImage.ts` / `sliceImageWithText.ts` — `"image": image.asset->url` | Consumed by `mediaFromUrls()`/`pictureFromUrl()`, which does `url.split("?")[0]` — a stega-tagged URL breaks that split and 404s |
| `video` | `sliceImage.ts` / `sliceImageWithText.ts` — `"video": video.asset->url` | Same URL-splitting concern as `image` |
| `coverImage` | `pageHomeQuery` grid items, `allDetailsQuery` → `coverMedia()`/`sanityPicture()` in `sanity-content.ts` | Also splits on `?` |
| `coverVideo` | `pageHomeQuery` grid items, `allDetailsQuery` | Same as `coverImage` |
| `url` | The array-item alias in `sliceImageSlideshow.ts` (`images[]{ "url": asset->url }`), `slice2Up.ts`, `slice3Up.ts` (`images[]{ "url": image.asset->url, caption }`) | Consumed by `pictureFromUrl()`/`resolveCaptionedImages()` |

Explicitly **not** excluded — these stay stega-encoded by design:
`title`, `stylizedTitle`, `text`, `caption`, `quoteAuthor`, `name`
(`siteOptions`), `introText`. All of them are rendered as visible text or
Portable Text, and `escapeHtml()` (`scripts/utils/portable-text.ts`) only
touches `&<>"'` — the zero-width stega characters survive into the DOM
untouched, which is exactly what Presentation's click-to-edit overlays need
to find and decode.

> **This is a living document, and so is the filter.** Any new slice
> resolver, singleton, or GROQ query field that ends up rendered as a route
> key, a filename, a URL, or an HTML attribute value **must** be added to
> `EXCLUDED_RESULT_KEYS` in `apps/fe/scripts/preview/stega.ts` — and to the
> table above — before it ships. A field that's missed doesn't fail loudly;
> it silently 404s an image or breaks a route match only on the *preview*
> deployment, which is easy to miss since production never runs stega at
> all.

## Local dev recipe

Two terminals.

**Terminal 1 — build once, then start the preview server:**

```bash
pnpm --filter diaa build
SANITY_READ_TOKEN=<viewer-token> SANITY_STUDIO_URL=http://localhost:3333 pnpm --filter diaa preview:cms
```

Both variables are required — the server refuses to start rendering without
either one (`SANITY_STUDIO_URL` points at wherever the Studio you're using
runs; `http://localhost:3333` is `sanity dev`'s default).

`preview:cms` runs `tsx apps/fe/scripts/preview-server.ts` on port 8080. It
streams static assets straight from `apps/fe/dist/` and never re-bundles —
re-run `pnpm --filter diaa build` after any code change (draft *content*
changes are picked up live; the JS/CSS bundle is not).

**Terminal 2 — start the Studio pointed at that local preview:**

```bash
cd apps/be && SANITY_STUDIO_PREVIEW_ORIGIN=http://localhost:8080 pnpm dev
```

Then open the Studio and click the **Presentation** tab.

**On `.env`:** `render.ts`'s missing-token error message (and
`apps/preview/README.md`) both point at `apps/fe/.env` as a place to set
`SANITY_READ_TOKEN`. As of this writing there is **no `dotenv`/`loadEnv`
loader wired into these scripts** — `preview-server.ts` runs under plain
`tsx` and reads `process.env` directly, so a `apps/fe/.env` file is not
actually auto-loaded by `pnpm preview:cms` today. Until that's added, export
the variables in your shell (or prefix the command, as above) rather than
relying on a `.env` file being picked up automatically.

## Deploy runbook

### Vercel project — `diaa-preview`

| Setting | Value |
|---|---|
| Root Directory | `apps/preview` |
| Framework Preset | **Other** (a plain Node.js Function project, not a framework build) |
| Deployment Protection | **Off** — see below |
| Build Command | (from `apps/preview/vercel.json`) `cd ../.. && pnpm --filter diaa build && node apps/preview/scripts/copy-assets.mjs` |

**Why Deployment Protection is off, and it's still safe:** the Studio
iframes this deployment directly, and Vercel's own auth wall would block
that iframe load outright. Access is instead gated entirely by the
`@sanity/preview-url-secret`-validated session cookie described in
[Auth](#auth) — every route except `/__preview/enable` 401s without a valid
cookie, and only a Studio editor with access to the Presentation tool can
mint one.

### Environment variables (mirrors `apps/preview/README.md`)

| Variable | Purpose |
|---|---|
| `SANITY_READ_TOKEN` | **Required.** A Sanity **Viewer** token — least-privilege read access to drafts. |
| `SANITY_STUDIO_URL` | **Required.** The Studio's URL (`http://localhost:3333` for a local `sanity dev`, or the deployed Studio URL) — stega deep-links back into the Studio. The server refuses to render without it: an empty `studioUrl` passes `@sanity/client`'s constructor but throws inside stega encoding on every fetch, which would otherwise silently serve an empty site. |
| `SANITY_PROJECT_ID` / `SANITY_DATASET` | Optional — override `apps/fe/project.config.ts`'s defaults (`0in4i1po` / `production`). |
| `PREVIEW_SESSION_SECRET` | Optional — HMAC key for the session cookie. Falls back to a hash of `SANITY_READ_TOKEN` if unset. |
| `PREVIEW_FE_ROOT` | Optional override — normally not needed anywhere. The render core auto-detects the copied `.preview-runtime/` tree on a deployed function and falls back to `apps/fe` locally; set only to force a nonstandard path. |

### Sanity Manage steps

1. **API → Tokens** — create a **Viewer** token (read-only, least
   privilege — this is what powers drafts rendering). Set it as
   `SANITY_READ_TOKEN` on the `diaa-preview` Vercel project and in your
   local shell for `preview:cms`.
2. **API → CORS Origins** — add both the deployed `diaa-preview` URL and
   `http://localhost:8080` (local dev needs its own CORS entry — the Studio
   and the preview server are different origins even in local dev).

### Redeploy the Studio

```bash
cd apps/be && SANITY_STUDIO_PREVIEW_ORIGIN=<preview URL> npx sanity deploy
```

`presentationTool`'s `previewUrl.origin` (`apps/be/sanity.config.js`) reads
`SANITY_STUDIO_PREVIEW_ORIGIN` at `sanity dev`/`sanity deploy` time,
defaulting to `http://localhost:8080` when unset.

## Troubleshooting

| Symptom | Check |
|---|---|
| No click-to-edit overlays in the iframe | Is `window.__PREVIEW__` actually `true` on the served page (view-source, look for the `injectPreviewHtml()` globals script)? Is stega actually enabled server-side (`SANITY_READ_TOKEN` set, so `renderFreshSite()` didn't throw before ever calling `buildPreviewStega()`)? Is the session cookie present at all (see the 401 row below — no cookie means every page 401s, which looks like "nothing rendered," not an overlay problem)? |
| 401 loop / can never get past `/__preview/enable` | Confirm the secret in the Presentation-generated URL is fresh (they're short-lived and single-purpose) and that `SANITY_READ_TOKEN`/project id/dataset are configured server-side (`resolveProjectConfig()` in `auth.ts` needs all three or the enable route itself 500s, not 401s). If the cookie *is* being set (check DevTools → Application → Cookies for `__preview_session`) but every subsequent request still 401s, check the host: `SameSite=None; Secure` cookies are only honored on HTTPS **or** `http://localhost` specifically (see [Auth](#auth)) — a LAN IP, a custom hostname, or any other non-HTTPS origin will silently drop the cookie. |
| Presentation's links go dead / clicking anything does nothing | `App.mutating` may be stuck `true` from a hung transition — `Ctrl.navigate()`'s 8s safety timer should self-clear this, but if it hasn't, a hard reload of the iframe is the fastest recovery. This also blocks the refresh flow (`refreshDraftContent()` no-ops while `App.mutating` is true) — a save that lands mid-navigation is silently skipped, and the next save retries. |
| Content looks stale after a save | The memo has a 30s TTL and the refresh flow busts it explicitly — if a manual `/tmhgne.json` fetch (no `?fresh=`) still shows old content, check whether the request landed on a *different* warm serverless instance than the one that served `/__preview/refresh`; pass the `generatedAt` the refresh call returned as `?fresh=` to force that instance to re-render too. |
| Future: a Content-Security-Policy gets added to the site | Any `frame-ancestors` directive must explicitly allow the Studio's origin, or the browser will refuse to let the Studio iframe this deployment at all — neither `dist/` nor the preview core sets one today, but this is the first thing to check if overlays start failing after a CSP is introduced. |

## Scaling note

`getPreviewSite()` re-renders the **entire site** on every refresh, not just
the document that changed — there's no per-document invalidation. At the
current content size this completes well within the ~1–3s target and is
simple to reason about. If the site's page count grows enough that a
full-site render becomes the bottleneck, that's the point to revisit this
(document-scoped re-render, or a longer TTL with a lower-latency budget) —
not before.
