#!/usr/bin/env node
/**
 * copy-assets.mjs — build-time bridge between the real `apps/fe` production
 * build and this Vercel project's two static surfaces.
 *
 * Runs as the second half of `vercel.json`'s `buildCommand`, right after
 * `pnpm --filter diaa build` produces `apps/fe/dist/` (byte-identical to the
 * production deployment — see apps/fe/vercel.json). It copies exactly two
 * things, for two different reasons:
 *
 *   1. `apps/fe/dist/assets/**` (+ any other non-.html, non-tmhgne.json
 *      top-level file, e.g. `sitemap.xml`) → `apps/preview/public/`. This is
 *      what Vercel serves as static files — same bytes the production
 *      deployment ships, so hashed JS/CSS, fonts, and optimized images are
 *      never re-rendered or re-fetched by the preview function.
 *
 *   2. A small runtime-read subset (Mustache route templates, the shell
 *      `index.html`, and the Vite build manifest) → `apps/preview/.preview-
 *      runtime/`, mirroring `apps/fe`'s own relative layout. This exists
 *      because `renderSite()` and `findHashedAssets()` (apps/fe/scripts/
 *      routes-plugin.ts) read these via `fs.readFileSync()` with computed
 *      paths, not `import`/`require` — so Vercel's static import-tracer can't
 *      discover them, and `functions.includeFiles` glob patterns are not
 *      reliably able to escape this project's root directory (`apps/
 *      preview`) to reach sibling `apps/fe` files directly. Copying the
 *      handful of files actually read at runtime into an in-root directory
 *      sidesteps that entirely — `vercel.json`'s `includeFiles` then only
 *      needs an ordinary in-root glob (`.preview-runtime/**`), and
 *      `apps/fe/scripts/preview/render.ts` picks up the copy via the
 *      `PREVIEW_FE_ROOT` env var (set in `vercel.json`) instead of deriving
 *      its `FE_ROOT` from `import.meta.url`.
 *
 * Local dev (`pnpm --filter diaa-preview build`, or the `vercel build` smoke
 * test) exercises the exact same script Vercel's build runs — no
 * environment-specific branching.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This script's own directory — `apps/preview/scripts/`. */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** `apps/preview/` — this project's root. */
const PREVIEW_ROOT = path.resolve(SCRIPT_DIR, "..");
/** `apps/fe/` — the sibling package whose real build output we're mirroring. */
const FE_ROOT = path.resolve(PREVIEW_ROOT, "../fe");

const FE_DIST = path.join(FE_ROOT, "dist");
const PUBLIC_DIR = path.join(PREVIEW_ROOT, "public");
const RUNTIME_DIR = path.join(PREVIEW_ROOT, ".preview-runtime");

/** Top-level `dist/` entries that are never copied into `public/` — every
 *  page is rendered dynamically (drafts, not the static build), and the
 *  boot manifest is inlined per-request by `injectPreviewHtml()` rather
 *  than served as a static file. */
const SKIP_TOP_LEVEL = new Set(["tmhgne.json"]);

/** Recursively copies `src` to `dest`, creating parent directories as
 *  needed. Thin wrapper around `fs.cp` for a consistent debug log. */
async function copyTree(src, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  console.debug(`[preview:build] copied ${path.relative(PREVIEW_ROOT, src)} -> ${path.relative(PREVIEW_ROOT, dest)}`);
}

/**
 * Copies `apps/fe/dist/assets/` and every other top-level static file
 * (anything that isn't an `.html` page or `tmhgne.json`) into
 * `apps/preview/public/`, so Vercel serves them as real static files ahead
 * of the catch-all rewrite.
 */
async function copyStaticAssets() {
  if (!existsSync(FE_DIST)) {
    throw new Error(
      `[preview:build] ${FE_DIST} not found — run \`pnpm --filter diaa build\` before copy-assets.mjs.`,
    );
  }

  await mkdir(PUBLIC_DIR, { recursive: true });

  const entries = await readdir(FE_DIST, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue; // .vite/ — handled separately, see copyRuntimeSubset()
    if (name.endsWith(".html")) continue; // pages are rendered from drafts, never served statically
    if (SKIP_TOP_LEVEL.has(name)) continue;

    await copyTree(path.join(FE_DIST, name), path.join(PUBLIC_DIR, name));
  }
}

/**
 * Copies the handful of files `renderSite()`/`findHashedAssets()` read from
 * disk at request time — Mustache templates, the shell template, and the
 * build manifest — into `apps/preview/.preview-runtime/`, mirroring
 * `apps/fe`'s own relative directory layout so `PREVIEW_FE_ROOT` (see
 * render.ts) can point straight at this directory.
 */
async function copyRuntimeSubset() {
  await mkdir(RUNTIME_DIR, { recursive: true });

  // Shell template (index.html) — wraps every rendered route.
  await copyTree(path.join(FE_ROOT, "index.html"), path.join(RUNTIME_DIR, "index.html"));

  // Route templates + partials — only .html/.mustache files matter to
  // renderSite(); route .ts modules are the SPA's concern, not the
  // server-side render's, and are skipped to keep this copy small.
  await copyRouteTemplates(path.join(FE_ROOT, "src/routes"), path.join(RUNTIME_DIR, "src/routes"));

  // Vite build manifest — the only file findHashedAssets() reads from
  // `distDir`. The actual hashed asset bytes are served statically from
  // public/assets/ (copyStaticAssets(), above); only the manifest that maps
  // entry -> hashed filename needs to be readable at request time.
  const manifestSrc = path.join(FE_DIST, ".vite/manifest.json");
  if (existsSync(manifestSrc)) {
    await copyTree(manifestSrc, path.join(RUNTIME_DIR, "dist/.vite/manifest.json"));
  } else {
    console.warn(
      `[preview:build] ${manifestSrc} not found — injectPreviewHtml() will skip hashed asset tags at runtime.`,
    );
  }
}

/**
 * Recursively walks `srcDir` (apps/fe/src/routes), copying only `.html` and
 * `.mustache` files (including the star-prefixed CMS template convention)
 * into the matching path under `destDir`. Mirrors the directory structure
 * exactly — `getRouteFolders()`/`loadPartials()` (routes-plugin.ts) key off
 * folder names and the reserved `partials/` folder name, so structure must
 * be preserved even though most file types inside are skipped.
 */
async function copyRouteTemplates(srcDir, destDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyRouteTemplates(srcPath, destPath);
      continue;
    }
    if (/\.(html|mustache)$/i.test(entry.name)) {
      await mkdir(destDir, { recursive: true });
      await cp(srcPath, destPath, { force: true });
    }
  }
  console.debug(`[preview:build] copied route templates ${path.relative(PREVIEW_ROOT, srcDir)} -> ${path.relative(PREVIEW_ROOT, destDir)}`);
}

/** Entry point — runs both copy phases in sequence, failing the build loudly
 *  (non-zero exit) if either one throws, e.g. a missing `apps/fe/dist/`. */
async function main() {
  console.debug("[preview:build] copying fe build output into apps/preview…");
  await copyStaticAssets();
  await copyRuntimeSubset();
  console.debug("[preview:build] done.");
}

main().catch((err) => {
  console.error("[preview:build] failed:", err?.message ?? err);
  process.exitCode = 1;
});
