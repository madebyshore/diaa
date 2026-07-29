# Visual editing — preview, stega, and the deploy runbook

How Sanity Presentation-style Visual Editing works in this app, replacing the old vanilla-TS build's standalone `preview`-branch server with Nuxt-native SSR preview infrastructure.

---

## Enable flow

```
GET /preview/enable?sanity-preview-secret=...&preview=/some-path
  │
  ├─ build a drafts-perspective Sanity client (useCdn:false, perspective:"drafts")
  ├─ validatePreviewUrl(client, pathname+search)   ← @sanity/preview-url-secret
  │    invalid/expired → 401 "Invalid or expired preview link."
  │    valid           → grantSession(event)  ──▶  sets __preview_session cookie
  │                        (httpOnly, secure, sameSite:"none", 8h maxAge)
  └─ 302 redirect → result.redirectTo || "/"
```

`/preview/enable` is the **only** preview route reachable without an existing session — everything else requires the cookie. It's ported from the proven `preview`-branch implementation (`auth.ts`'s `handleEnableRequest()`, commit `dcbf37c`).

The session itself is a **stateless HMAC cookie** — `<expiryEpochMs>.<hmacHex>` — verified server-side per request with no session store. `/preview/disable` clears it (`revokeSession()` + `deleteCookie`) and redirects to `/`; there's no unauthenticated disable path, since a session that's already invalid has nothing to revoke.

Once a session is active, every SSR request runs `app/plugins/content.server.ts`, which:

1. Reads the cookie, verifies it (`app/data/preview-auth-core.ts`'s `verifyPreviewSessionCookie()`).
2. If valid → `perspective = "drafts"`, and builds `buildPreviewStega(requireStudioUrl(SANITY_STUDIO_URL))` to pass through to the fetch.
3. If invalid or absent → `perspective = "published"`, no stega — the safe fallback, never drafts to an unauthenticated visitor.

`server-preview/middleware/noindex.ts` already 401s any unauthenticated request in a preview build before Nuxt's renderer (and therefore this plugin) ever runs, so in practice this check is defense-in-depth: if that middleware gate is ever bypassed or misconfigured, the plugin still falls back to published content rather than leaking drafts.

### Live-editing refresh

`app/plugins-preview/visual-editing.client.ts` wires `@sanity/visual-editing`'s `enableVisualEditing()`:

- **History adapter** — `subscribe` fires `navigate()` from `router.afterEach` (only after a navigation has actually landed, not before a transition starts). `update` routes Presentation-initiated navigation through `router.push()`/`.replace()`/`.back()` rather than raw History API calls, so the same `beforeEach`-installed nav lock, 8-second safety valve, and transition choreography that gate every other navigation in this app (see `docs/animation.md`) also gate a Presentation-driven one.
- **`refresh()`** — POSTs the current path to `/preview/refresh`, writes the fresh `RouteContent` into `usePageData().value`, `await nextTick()`s for Vue's reactive patch, then does a **full controller re-init**: `controller.onDestroy()` → `controller.onInit(root)` → force `opacity: 1`. This is not a transition — no `in()`/`out()` runs and no nav lock engages, because the route hasn't changed. `BaseController.onInit()` normally pins the root to `opacity: 0` on the assumption a subsequent `in()` will fade it back — since no `in()` runs on a content refresh, that pin is force-corrected immediately rather than left invisible.

A real bug fixed while wiring this: `app/pages/[slug].vue` originally destructured `usePageData().value` into a plain `const content` at setup time — captured once, never reactive to a later `.value =` write. `pages/index.vue` (home) already used `computed()` for this reason; `[slug].vue` (every *other* route — Detail, Contact, Imprint) didn't, which would have made live refresh a silent no-op for the majority of routes. Fixed by converting `content` to a `computed()` reading `pageData.value`.

---

## Stega — the exclusion list is a living document

`app/data/stega.ts`'s `buildPreviewStega(studioUrl)` is ported near-verbatim from the proven `preview`-branch implementation (fixed at commit `dcbf37c`). `@sanity/client`'s stega encoder walks every string leaf in a GROQ result and, when enabled, invisibly embeds zero-width metadata so Presentation can map rendered text back to its Studio field. That's exactly right for visible copy — but actively harmful for a string that ends up as a route key, filename, URL, or HTML attribute.

**`EXCLUDED_RESULT_KEYS`** — matched against the *last string segment* of each value's `resultPath`:

```
slug, href, image, video, coverImage, coverVideo, url, introText, title, name
```

Each is dangerous for a specific reason (full rationale is in the file's own header comment — read it before touching this set):

- `image`/`video`/`coverImage`/`coverVideo`/`url` — become Sanity CDN URLs; `data/image-url.ts`'s helpers split on `"?"`, and a stega-tagged URL breaks that split → 404.
- `slug`/`href` — become route paths or `<a href>` values; a stega-tagged slug never matches a route this app serves.
- `title`/`name` — feed `<title>` composition and image `alt` text on **every** page; stega-encoding these is the single biggest bloat contributor (duplicated across every generated page).
- `introText` — the intro overlay's phrase text; see the intro-hang mechanism below.

**Explicitly NOT excluded** (stays stega-encoded by design): `stylizedTitle`, `text`, `caption`, `quoteAuthor` — visible Portable Text / plain body copy rendered via `<RichText>`, with no attribute or routing role. This is exactly where Presentation's click-to-edit overlays need to find and decode zero-width markers.

### The array-index blind spot

A value inside a bare `string[]` field (no wrapping object — e.g. `siteOptions.introText`) reaches the filter with a `resultPath` like `["introText", 0]`: the true last segment is a **number** (the array index), not the field name. Matching only the raw last segment would silently exclude nothing for such fields. `lastStringSegment()` walks the path from the end and skips any trailing numeric (or Sanity keyed-segment `{_key, _index}`) entry, returning the nearest actual string key. Fields that are arrays of *objects* (`footerLinks[]`, `grid[]`, slice `images[]`) never hit this — their leaf value's path already ends in the object's own property name (`["footerLinks", 0, "href"]`).

**Check this whenever adding an exclusion for a field that is (or becomes) a bare string array.**

### The intro-hang mechanism (why `introText` had to be excluded)

Inherited rationale from the original vanilla-TS build, preserved because the underlying browser mechanism can recur here too: a stega-tagged phrase turns a few visible words into a single string carrying tens of thousands of invisible zero-width characters (ZWSP/ZWNJ/ZWJ/word-joiner). Setting that string as text content forces the browser to run line-breaking/bidi/grapheme-cluster analysis over the whole run on first layout — dense ZWJ runs in particular are not linear-time for shaping engines. That analysis can block the main thread for seconds to minutes, so anything awaiting the intro's completion (this app's `useBoot.ts`) either takes far longer than expected or the tab appears hung, and the Presentation iframe looks dead.

### Adding a new query field

Per root `CLAUDE.md` rule #3: **any new GROQ field whose value becomes a URL, HTML attribute, route/slug key, or `<title>`/alt-text source must be added to `EXCLUDED_RESULT_KEYS`.** Forgetting this doesn't fail loudly — it degrades into 404'd images, dead links, or (for high-visibility fields) a hung intro on the preview deploy specifically, which is easy to miss if you only test the static prod build.

---

## Structural exclusion — verifying zero preview bytes in prod

Preview code is excluded from the prod bundle **structurally**, not by tree-shaking — see root `CLAUDE.md` rule #4 for the two gates (`nitro.scanDirs`, the `plugins` array). Verification commands, run after any change touching preview infra:

```bash
# Prod static build — must be empty
grep -rl "visual-editing\|preview-url-secret\|stegaEncode" .output/public/_nuxt/*.js

# Prod static build — must find nothing
find .output/public -iname "*preview*"

# Preview SSR build — server-preview chunks SHOULD be present
find .output/server -iname "*preview*"
```

### Two gotchas documented in code, worth knowing before you go looking for them

- **The h3-import gotcha** (`server-preview/utils/preview-auth.ts`'s file header) — this toolchain's Nuxt-generated tsconfig path-maps the bare `"h3"` specifier to a different (prerelease) h3 package than the one Nitro's own ambient auto-imports (`getCookie`, `setCookie`, `H3Event`, ...) actually resolve against. An explicit `import { H3Event } from "h3"` therefore silently pulls in a structurally incompatible type, and `nuxt typecheck` fails with a confusing "missing properties: url, runtime, waitUntil, fetch, ..." error. The fix in this codebase: `type H3Event = Parameters<typeof getCookie>[0]` — a structural alias off the ambient global instead of an explicit import. A second, related bug: `.server.ts` Nuxt plugins (`app/plugins/content.server.ts`) compile through a *different* build pipeline than Nitro's own server routes, and neither an explicit h3 import nor the ambient `getCookie` global works reliably from inside one — that's why `app/data/preview-auth-core.ts`'s `extractCookieValue()` hand-parses `event.node.req.headers.cookie` as a plain string instead of calling any h3 cookie helper.
- **Why the auth crypto is split across two files** — `server-preview/utils/preview-auth.ts` (H3/Nitro wrapper: cookie get/set, `httpOnly`/`secure`/`sameSite` options) vs. `app/data/preview-auth-core.ts` (pure HMAC sign/verify, no h3 dependency at all). The split exists because two very different callers need the *same* verify logic: `server-preview/utils/preview-auth.ts` lives under a directory that's structurally excluded from prod — never present in a prod build — while `app/plugins/content.server.ts` is a normal, always-present plugin that needs to decide per-request whether a session cookie is valid, in **every** build, prod included. `content.server.ts` can never import anything from `server-preview/` without defeating the whole scanDirs gate, so the pure crypto lives in `app/data/` (a directory that's part of every build) and both callers import it — one direction only: `server-preview/` may depend on `app/data/`, never the reverse.
- **`nitro.scanDirs` requires absolute paths** — see `docs/architecture.md`'s "Nitro's `scanDirs` merge behavior" section. A bare relative string silently produces zero bundled preview routes with no error.
- **The prerenderer runs for `nuxt build` too** — see `docs/architecture.md`'s "Why content routes are never prerendered in a preview build" section. This is the reason content-route registration in `prerender:routes` is gated on `!previewEnabled`.

---

## Env var matrix

| Var | Static prod | SSR preview | Local dev |
|---|---|---|---|
| `SANITY_PROJECT_ID` | set (or default in `data/sanity-defaults.ts`) | same | same |
| `SANITY_DATASET` | set (or default) | same | same |
| `SANITY_API_VERSION` | set (or default `2023-10-10`) | same | same |
| `SANITY_READ_TOKEN` | **unset** | required (Viewer-scoped) | only when testing preview locally |
| `SANITY_STUDIO_URL` | unset | **required** — `requireStudioUrl()` hard-fails immediately if missing, rather than letting `@sanity/client` accept an empty value and fail later mid-fetch as an empty/partial render | `http://localhost:3333` |
| `NUXT_PUBLIC_PREVIEW_ENABLED` | unset | `true` | opt-in |
| `PREVIEW_SESSION_SECRET` | unset | optional — falls back to a hash of `SANITY_READ_TOKEN` if unset | optional |
| `NITRO_PRESET` | unset (static output) | `vercel` | — |
| Studio: `SANITY_STUDIO_PREVIEW_ORIGIN` | n/a | the preview deploy's URL | `http://localhost:3000` |

`apps/fe/.env.example` documents the same set with the preview-only vars commented out.

---

## Deploy runbook — two Vercel projects, same codebase

This app deploys as **two separate Vercel projects**:

Both frontend projects share root directory `apps/fe`, which means they share the committed `apps/fe/vercel.json` — and `vercel.json` settings **override the dashboard**, so the preview project cannot simply set a different build command in its dashboard. The committed `buildCommand` therefore branches on the preview flag:

```json
"buildCommand": "if [ \"$NUXT_PUBLIC_PREVIEW_ENABLED\" = \"true\" ]; then pnpm run build:ssr; else pnpm run build; fi"
```

Prod (flag unset) runs `nuxt generate` exactly as before; the preview project (flag set in its dashboard env) runs `nuxt build`. With `NITRO_PRESET=vercel`, Nitro emits a Build Output API bundle at `.vercel/output` (serverless function + static assets), which Vercel deploys in place of the static `outputDirectory`.

### 1. Existing `diaa` project — production (static)

`apps/fe/vercel.json` covers this project fully: `framework: null` (opts the project out of Vercel's Nuxt SSR-function auto-detection — this deploy must stay pure static), the branching `buildCommand` above (resolves to `pnpm run build` == `nuxt generate` because the preview flag is unset), `outputDirectory: ".output/public"`, `cleanUrls: true`, `trailingSlash: false`, and immutable 1-year cache headers on `/_nuxt/(.*)` and `/assets/(.*)`.

**Dashboard checklist:**
- Confirm Framework Preset is set to "Other" (or otherwise deferring to `vercel.json`'s `framework: null`) — Vercel's Nuxt auto-detection would otherwise override the checked-in build command/output directory.
- No env vars needed — prod always fetches the `"published"` perspective off the public dataset, `stega: false` hardcoded in `data/client.ts`. In particular `NUXT_PUBLIC_PREVIEW_ENABLED` must stay unset here, or the shared `buildCommand` would flip this project to SSR.

### 2. `diaa-preview` project — SSR

Same repo, same root directory `apps/fe`. All configuration is env vars — the build command comes from the shared `vercel.json` branch above.

**Dashboard checklist (env vars, Production scope):**
- `NUXT_PUBLIC_PREVIEW_ENABLED=true` — flips the shared `buildCommand` to `nuxt build` *and* gates the preview plugins/scanDirs into the bundle.
- `NITRO_PRESET=vercel`
- `SANITY_READ_TOKEN` — required at build **and** runtime (Viewer-scoped).
- `SANITY_STUDIO_URL` — required; the build hard-fails without it.
- Deployment Protection: **off**. The app gates preview access itself via the `/preview/enable` HMAC-cookie flow — Vercel's own protection would be redundant and would interfere with Sanity Presentation's iframe.

**First-deploy verification:** unauthenticated `GET /` must return 401 + `X-Robots-Tag: noindex` (not a rendered page), and `/preview/enable` without a secret must 401 — a 404 there means the SSR function didn't deploy (the build fell through to the static branch).

### 3. `diaa-be` project — Sanity Studio

Root directory `apps/be`. `apps/be/vercel.json` is committed and covers the build: `framework: null`, `buildCommand: "pnpm run build"` (== `sanity build`), `outputDirectory: "dist"`, and an SPA rewrite of every path to `/index.html` (the Studio is a client-routed SPA).

**Dashboard checklist:**
- `SANITY_STUDIO_PREVIEW_ORIGIN` — the `diaa-preview` deploy's URL; baked in at build time (it's what the Presentation tab iframes).
- Deployment Protection: **off** — editors sign in with their Sanity accounts; Vercel's auth layer would just lock them out.
- Add the Studio's deployed origin to the Sanity project's **CORS origins (allow credentials)** at sanity.io/manage, or the Studio can't talk to the API.

### Studio (`apps/be`) side

`sanity.config.js`'s `presentationTool`:

```js
presentationTool({
  previewUrl: {
    origin: process.env.SANITY_STUDIO_PREVIEW_ORIGIN || 'http://localhost:3000',
    previewMode: { enable: '/preview/enable' },
  },
  resolve: { locations: { pageHome, detail, pageContact, pageImprint } },
})
```

`previewMode.enable` is `/preview/enable` — the Nuxt app's own route, **not** the old standalone preview server's `/__preview/` prefix (that prefix was an artifact of the old catch-all function and doesn't apply here). `SANITY_STUDIO_PREVIEW_ORIGIN` must point at whichever URL the preview Vercel project ends up at.

There's no `mainDocuments` config: `detail`/`pageContact`/`pageImprint` all resolve to single-segment root paths (`/some-slug`) built from freeform slugs, so a route pattern alone can't disambiguate which document type produced a given path without also fetching and comparing live slugs — `resolve.locations` handles this per-document instead.

---

## Verification checklist (what was confirmed working at cutover)

- Prod `nuxt generate`: zero matches for `grep -rl "visual-editing\|preview-url-secret\|stegaEncode" .output/public/_nuxt/*.js`; no `*preview*` files anywhere under `.output/public`; `robots.txt` allow-all.
- Preview `nuxt build` (SSR): `server-preview/**` chunks present in `.output/server`.
- Unauthenticated `GET /` on a preview deploy → 401 + `X-Robots-Tag: noindex`.
- `GET /preview/enable` without a valid secret → 401.
- With a valid session cookie: `GET /` → 200; every `href`/`src`/`data-taxonomy` attribute sampled came back stega-clean; visible body copy carried stega zero-width characters as expected.
- `POST /preview/refresh` with a valid cookie → 200 `RouteContent` JSON; without → 401.
- `GET /preview/disable` with a valid cookie → 302 to `/`, cookie cleared (`Max-Age=0`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `nuxt typecheck` fails with "missing properties: url, runtime, waitUntil, fetch, ..." on an h3 type | An explicit `import { H3Event } from "h3"` (or similar) — see the h3-import gotcha above. Use a structural alias off an ambient global instead. |
| `event.node.req.headers.get is not a function` at runtime | Calling `getCookie()` (imported or ambient) from inside a `.server.ts` plugin — see the h3-import gotcha's second half. Hand-parse `event.node.req.headers.cookie` instead. |
| Preview build 500s on every content route, or serves stale content forever | Content routes got registered for prerendering in a preview build — check the `!previewEnabled` gate on `prerender:routes`'s content-route registration. |
| A preview build ships with zero preview routes | `nitro.scanDirs` entry used a relative path instead of `fileURLToPath(new URL(...))`. |
| An image 404s, a link goes dead, or a slug stops routing — only in preview | A query field that reaches an href/URL/slug isn't in `data/stega.ts`'s `EXCLUDED_RESULT_KEYS` — check whether it's a bare string array hitting the array-index blind spot. |
| The preview tab hangs or never becomes interactive | A stega-tagged string reached `useBoot.ts`'s intro phrase rendering — see the intro-hang mechanism above. Almost certainly an unexcluded string-array field. |
| `nuxt.config.ts` fails to typecheck after touching `data/client.ts` or `data/content.ts` | A `useRuntimeConfig()` call leaked into one of those files — they must stay free of Nuxt ambient calls so `nuxt.config.ts` (a different TS program) can still import them. |
