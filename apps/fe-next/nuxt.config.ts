// https://nuxt.com/docs/api/configuration/nuxt-config
//
// Phase 0 scaffold only — see plans/twinkly-shimmying-marshmallow.md for the
// full build order. This config grows in later phases (data layer, styles,
// animation, visual editing); keep this file's shape close to the reference
// build at ~/Documents/bnpne/tamahagane-nuxt/apps/fe/nuxt.config.ts so future
// diffs stay easy to reason about.

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

    public: {
      // projectId + dataset are inherently public — they appear in every
      // cdn.sanity.io image URL baked into the static HTML, so there's no
      // secret to hide by keeping them server-only.
      sanityProjectId: process.env.SANITY_PROJECT_ID || "0in4i1po",
      sanityDataset: process.env.SANITY_DATASET || "production",
      sanityApiVersion: process.env.SANITY_API_VERSION || "2023-10-10",
      // Drives the Phase 6 gating: `plugins: previewEnabled ? [...] : []` and
      // `nitro.scanDirs` excluding server-preview/ unless this is true, so a
      // `nuxt generate` prod build structurally cannot ship preview code —
      // not just tree-shake it away.
      previewEnabled,
    },
  },
});
