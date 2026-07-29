// https://nuxt.com/docs/api/configuration/nuxt-config
//
// Phase 2 grows this past the Phase 0 scaffold with the `prerender:routes`
// hook (below). See plans/twinkly-shimmying-marshmallow.md for the full
// build order. This config keeps growing in later phases (styles, animation,
// visual editing); keep this file's shape close to the reference build at
// ~/Documents/bnpne/tamahagane-nuxt/apps/fe/nuxt.config.ts so future diffs
// stay easy to reason about.

// Relative imports only (not the `~`/`@` aliases used inside app/) — this
// file is loaded by Nuxt's CLI/build process via jiti, not through the
// Vite/webpack module graph, so those aliases don't resolve here. Both
// `data/content.ts` and `data/client.ts` are alias-free internally (they
// only ever import each other via relative paths), which is what makes them
// safely importable from this file in the first place — see the
// `prerender:routes` hook comment below for why that matters.
import { fileURLToPath } from "node:url";

import { loadAllRoutePaths } from "./app/data/content";
import type { SanityClientConfig } from "./app/data/client";
import {
  SANITY_DEFAULT_API_VERSION,
  SANITY_DEFAULT_DATASET,
  SANITY_DEFAULT_PROJECT_ID,
} from "./app/data/sanity-defaults";

// Gates the visual-editing plugin + the preview Nitro routes so preview code
// never ships in a `nuxt generate` prod build. Wired into runtimeConfig below;
// the actual plugins/scanDirs gating (Phase 6) will read this same const —
// this file just establishes where that switch lives.
const previewEnabled = process.env.NUXT_PUBLIC_PREVIEW_ENABLED === "true";

export default defineNuxtConfig({
  // Pin the Nitro/Nuxt compatibility behavior to a fixed date so upgrading
  // dependencies doesn't silently change runtime behavior underneath us.
  compatibilityDate: "2026-07-28",
  devtools: false,

  // Source lives under app/ (Nuxt 4 default) rather than the repo root, so
  // this can sit alongside non-Nuxt tooling (public/, server/) without them
  // getting swept into the app's module-resolution root.
  srcDir: "app/",

  // Single global stylesheet entry point — mirrors apps/fe's `core.scss`
  // barrel pattern so the eventual SCSS port (Phase 4) is a straight copy.
  css: ["~/styles/core.scss"],

  // @nuxt/eslint auto-generates a flat config fragment (.nuxt/eslint.config.mjs)
  // that this app's eslint.config.mjs extends — keeps lint rules in sync with
  // Nuxt's own generated types/aliases without hand-maintaining them.
  modules: ["@nuxt/eslint"],

  // Components live in nested subfolders (components/media/FigureBase.vue,
  // components/brand/DiaaWordmark.vue, and Phase 3+'s components/{content,
  // slices,layout,intro,dev}/*) — Nuxt's default auto-import behavior
  // prefixes nested components with their directory name (e.g.
  // `MediaFigureBase`), which the target structure in
  // plans/twinkly-shimmying-marshmallow.md doesn't intend (it expects plain
  // `<FigureBase>`, `<SliceImage>`, etc.). `pathPrefix: false` auto-imports
  // every component under `~/components` by its own filename, regardless of
  // which subfolder it lives in.
  components: [{ path: "~/components", pathPrefix: false }],

  app: {
    head: {
      // Old shell (`index.html`) declared `<html lang="en">` directly.
      htmlAttrs: { lang: "en" },
      // Font preloads, ported verbatim from `index.html`'s two `<link
      // rel="preload">` tags. Only the two "Upright" weight-VF files are
      // preloaded (the pair actually used above the fold on first paint —
      // Italic variants and Rand load on demand); `crossorigin: "anonymous"`
      // is required even though these are same-origin requests, or the
      // browser treats the preload and the actual @font-face fetch as two
      // different requests and loads the file twice.
      link: [
        {
          rel: "preload",
          href: "/assets/fonts/HWBeaujonTextVF-Upright.ttf",
          as: "font",
          type: "font/ttf",
          crossorigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/assets/fonts/HWBeaujonVF-Upright.ttf",
          as: "font",
          type: "font/ttf",
          crossorigin: "anonymous",
        },
      ],
    },
  },

  // Static-generate route discovery. Nuxt's crawler only finds pages linked
  // in the SSR'd DOM — the home page links every routable Detail via
  // `<a href="/{slug}">` in both mode panes, so those WOULD be crawled, but
  // Contact/Imprint links only ever live in the (not-yet-ported, Phase 5)
  // footer, and relying on crawl discovery would silently drop pages the
  // moment a link is missing or JS-gated. Register every prerenderable path
  // explicitly instead, from the same `loadAllRoutePaths()` `loadRouteContent()`
  // itself resolves against — the two can never drift apart.
  //
  // This hook runs in the Nuxt build/CLI process, BEFORE any Nuxt app
  // instance exists — `useRuntimeConfig()` (which `content.server.ts` uses
  // at request time) isn't available here. So this builds a
  // `SanityClientConfig` straight from `process.env` (mirroring the
  // reference build's own `prerender:routes` hook) and passes it through
  // `loadAllRoutePaths()` — the SAME function `content.server.ts` calls
  // (via `loadRouteContent()`/`loadSiteOptions()`) for path derivation, so
  // the crawled route list can never drift out of sync with what actually
  // renders.
  hooks: {
    async "prerender:routes"(ctx) {
      // Phase 6 split: `nuxt build` (SSR — both a plain SSR run AND the
      // preview deployment) still runs Nitro's prerenderer for whatever
      // routes get registered here — it is NOT exclusive to
      // `nuxt generate`, discovered the hard way when a previewEnabled
      // SSR build 500'd on every content route. Baking `/`, `/:slug`,
      // `/contact`, `/imprint` as static HTML at build time would freeze
      // them at whatever the crawler saw THEN (always "published", no
      // session cookie exists at build time) and — worse — means Nitro
      // serves that frozen file at runtime instead of ever invoking
      // `plugins/content.server.ts`'s per-request drafts+stega branch,
      // silently defeating preview for every content route. So content
      // routes are ONLY registered for prerendering in the prod
      // (`!previewEnabled`) build; a preview build renders every content
      // route dynamically, per request, same as any other SSR route.
      if (!previewEnabled) {
        const config: SanityClientConfig = {
          projectId: process.env.SANITY_PROJECT_ID || SANITY_DEFAULT_PROJECT_ID,
          dataset: process.env.SANITY_DATASET || SANITY_DEFAULT_DATASET,
          apiVersion: process.env.SANITY_API_VERSION || SANITY_DEFAULT_API_VERSION,
          sanityReadToken: process.env.SANITY_READ_TOKEN,
        };

        // Prod/`nuxt generate` always crawls the "published" perspective —
        // preview's SSR build never runs `generate`, so there is no drafts
        // branch to thread through here.
        const paths = await loadAllRoutePaths("published", config);
        for (const path of paths) {
          ctx.routes.add(path);
        }
        console.info(`[prerender:routes] registered ${paths.length} content route(s)`);
      } else {
        console.info("[prerender:routes] previewEnabled — skipping content-route prerendering (served dynamically)");
      }

      // Hand-rolled Nitro routes (server/routes/*.get.ts) aren't discovered
      // by the crawler either — they're server handlers, not linked pages —
      // so they need the same explicit registration as the CMS routes above
      // or `nuxt generate`/`nuxt build` would never call them and no static
      // file would exist for them in the output. Safe to prerender in BOTH
      // modes: `previewEnabled` is a build-time-fixed value (an env var),
      // not a per-request one, so robots.txt's previewEnabled-branched body
      // and sitemap.xml's always-"published" route list can't go stale
      // between "what the crawler saw" and "what a live request would get"
      // the way a content route's drafts-perspective render could.
      ctx.routes.add("/sitemap.xml");
      ctx.routes.add("/robots.txt");
    },
  },

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          // Every SCSS module gets the shared tokens (colors, breakpoints,
          // easing, z-index, ...) injected automatically — avoids a manual
          // `@use "@/styles/includes"` at the top of every single file.
          additionalData: '@use "@/styles/includes" as *;',
        },
      },
    },
    optimizeDeps: {
      // kido ships pre-built ESM and its own internal RAF/scroll timing —
      // letting Vite's dep optimizer re-bundle it has caused subtle timing
      // drift in the reference build. Exclude it from pre-bundling.
      exclude: ["kido"],
    },
  },

  runtimeConfig: {
    // Server-only — never serialized into the client bundle. Populated in
    // Phase 1 by data/client.ts (Sanity client) and the preview-auth routes.
    sanityReadToken: process.env.SANITY_READ_TOKEN,
    previewSessionSecret: process.env.PREVIEW_SESSION_SECRET,
    // Phase 6: where the Sanity Studio lives — feeds `buildPreviewStega()`'s
    // `studioUrl` (data/stega.ts) so encoded overlay metadata can deep-link
    // back into the Studio. Server-only (never needed client-side — the
    // `@sanity/visual-editing` overlay runtime derives everything it needs
    // from the stega-encoded metadata already embedded in the rendered
    // HTML, not from a separate config value). `data/stega.ts`'s
    // `requireStudioUrl()` hard-fails if this is empty wherever it's
    // actually consumed, rather than silently degrading — see that
    // function's doc comment for the lesson behind that.
    sanityStudioUrl: process.env.SANITY_STUDIO_URL,

    public: {
      // projectId + dataset are inherently public — they appear in every
      // cdn.sanity.io image URL baked into the static HTML, so there's no
      // secret to hide by keeping them server-only. Defaults are shared with
      // the `prerender:routes` hook above via `data/sanity-defaults.ts` so
      // the two paths can never silently diverge.
      sanityProjectId: process.env.SANITY_PROJECT_ID || SANITY_DEFAULT_PROJECT_ID,
      sanityDataset: process.env.SANITY_DATASET || SANITY_DEFAULT_DATASET,
      sanityApiVersion: process.env.SANITY_API_VERSION || SANITY_DEFAULT_API_VERSION,
      // Drives the Phase 6 gating: `plugins: previewEnabled ? [...] : []` and
      // `nitro.scanDirs` excluding server-preview/ unless this is true, so a
      // `nuxt generate` prod build structurally cannot ship preview code —
      // not just tree-shake it away.
      previewEnabled,
    },
  },

  // Phase 6 structural-exclusion gate #1 — Nitro server routes. Additive,
  // NOT a replacement: Nuxt builds its own `nitro.scanDirs` internally
  // (always includes this app's `server/` dir) and merges the user-supplied
  // config on top via `defu`, which concatenates array values rather than
  // overwriting them (`node_modules/.../defu/dist/defu.mjs`'s `_defu()`:
  // `Array.isArray(value) && Array.isArray(object[key])` → `[...value,
  // ...object[key]]`) — verified against the installed nitropack@2.13.4 /
  // nuxt@4.5.1 pair in this repo's lockfile before relying on it here.
  // `server/` therefore stays scanned in EVERY build regardless of this
  // array's contents; the only thing this line controls is whether
  // `server-preview/` (preview-only Nitro routes: `/preview/enable|
  // disable|refresh`, the noindex/auth-gate middleware) is ALSO scanned.
  // When `previewEnabled` is false (every `nuxt generate` prod build), that
  // directory is never scanned at all — not tree-shaken post-bundle, never
  // in the module graph to begin with. Verify with:
  //   grep -r "preview" .output/server/chunks/**/*.mjs  (prod build → none)
  nitro: {
    // ABSOLUTE path required — Nitro silently skips scanDirs entries it
    // can't resolve rather than erroring, so a bare relative string here
    // ("server-preview") looked correct but produced a build with zero
    // preview routes/middleware actually bundled (caught by this phase's
    // own verification: `find .output/server -iname "*preview*"` came back
    // empty on the first attempt). `fileURLToPath(new URL(...))` resolves
    // relative to THIS file, exactly like Nuxt's own internal scanDirs
    // entries (e.g. `join(rootDir, 'server')`) are always absolute too.
    scanDirs: previewEnabled
      ? [fileURLToPath(new URL("./server-preview", import.meta.url))]
      : [],
  },

  // Phase 6 structural-exclusion gate #2 — the visual-editing client plugin.
  // Unlike Nitro's scanDirs, Nuxt's own directory-based plugin auto-scan
  // (`app/plugins/**`) is NOT conditionally toggleable by this `plugins`
  // array — that array is ADDITIVE to the directory scan, not a switch for
  // it, so a file living inside `app/plugins/` would be auto-registered
  // regardless of what's pushed here. That's why the actual plugin source
  // lives at `app/plugins-preview/visual-editing.client.ts` — a directory
  // Nuxt does NOT auto-scan — and is registered EXCLUSIVELY through this
  // array. When `previewEnabled` is false, the array is empty and that file
  // is never imported by anything; when true, this is the only place it's
  // referenced. Verify with:
  //   grep -r "visual-editing\|preview-url-secret\|stegaEncode" .output/public/_nuxt/*.js
  //   (prod build → zero matches)
  plugins: previewEnabled ? ["~/plugins-preview/visual-editing.client"] : [],
});
