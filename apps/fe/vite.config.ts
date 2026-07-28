import fs from "node:fs";
import path from "node:path";

import { type Plugin, defineConfig } from "vite";

import { RoutesAndBootPlugin } from "./scripts/routes-plugin.js";
import log from "./scripts/utils/logger.js";

function BuildLogPlugin(): Plugin {
  let start = 0;
  return {
    name: "build-log",
    apply: "build",
    buildStart() {
      start = Date.now();
      log.nl();
      log.section("Bundle");
      log.line("vite", "starting production build");
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle);
      const entries = files.filter(
        (f) => bundle[f]?.type === "chunk" && bundle[f]?.isEntry
      ).length;
      const chunks = files.filter(
        (f) => bundle[f]?.type === "chunk" && !bundle[f]?.isEntry
      ).length;
      const assets = files.filter((f) => bundle[f]?.type === "asset").length;
      log.line(
        "rollup",
        `${entries} entries, ${chunks} chunks, ${assets} assets`
      );
    },
    writeBundle(_options, bundle) {
      log.section("Output");
      const files = Object.keys(bundle);
      for (const f of files) {
        const item = bundle[f];
        if (!item) continue;
        if (item.type === "chunk" && item.isEntry) {
          log.line("entry", f);
        } else if (item.type === "chunk") {
          log.line("chunk", f);
        } else if (item.type === "asset") {
          log.line("asset", f);
        }
      }
      log.time("bundle", Date.now() - start);
    },
  };
}

/**
 * ModulePreloadPlugin — injects <link rel="modulepreload"> for the main JS entry
 * into all built HTML files after the bundle is written.
 *
 * Vite 8 (rolldown bundler) does not auto-generate modulepreload tags for entry
 * chunks. This plugin reads the Vite manifest in closeBundle to find the hashed
 * entry filename, then injects the link tag before the closing </head> in every
 * HTML file in the output directory.
 *
 * Per PERF-07: the tag signals the browser to fetch the entry JS with high priority
 * before it is encountered as a <script>, reducing parse-blocking on first load.
 */
function ModulePreloadPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "modulepreload-inject",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir || outDir;
    },
    closeBundle() {
      try {
        const manifestPath = path.resolve(outDir, ".vite/manifest.json");
        if (!fs.existsSync(manifestPath)) return;

        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        ) as Record<string, { file?: string; isEntry?: boolean }>;

        // Find the entry chunk by isEntry flag in the manifest
        const entryFile = Object.values(manifest).find((e) => e.isEntry)?.file;
        if (!entryFile) {
          console.warn("[modulepreload] No entry found in manifest, skipping");
          return;
        }

        const tag = `<link rel="modulepreload" href="/${entryFile}" />`;
        const abs = path.resolve(outDir);
        if (!fs.existsSync(abs)) return;

        const htmlFiles = fs
          .readdirSync(abs)
          .filter((f) => f.endsWith(".html"));
        let count = 0;
        for (const f of htmlFiles) {
          const p = path.join(abs, f);
          const html = fs.readFileSync(p, "utf8");
          // Only inject if not already present
          if (html.includes('rel="modulepreload"')) continue;
          const injected = html.replace("</head>", `${tag}\n</head>`);
          if (injected !== html) {
            fs.writeFileSync(p, injected);
            count++;
          }
        }
        if (count > 0) {
          console.debug(
            `[modulepreload] injected into ${count} HTML files: ${entryFile}`
          );
        }
      } catch (e) {
        console.warn(
          "[modulepreload] inject failed:",
          (e as Error)?.message ?? String(e)
        );
      }
    },
  };
}

function HtmlStripCommentsPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "html-strip-comments",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir || outDir;
    },
    closeBundle() {
      try {
        const abs = path.resolve(outDir);
        if (!fs.existsSync(abs)) return;
        const files = fs.readdirSync(abs).filter((f) => f.endsWith(".html"));
        const commentRe = /<!--[\s\S]*?-->/g;
        let count = 0;
        for (const f of files) {
          const p = path.join(abs, f);
          const html = fs.readFileSync(p, "utf8");
          const stripped = html
            .replace(commentRe, "")
            .replace(/\n\s*\n+/g, "\n");
          fs.writeFileSync(p, stripped);
          count++;
        }
        if (count > 0)
          log.line("html", `stripped comments from ${count} files`);
      } catch (e) {
        log.warn(
          "html",
          `strip comments failed: ${(e as Error)?.message ?? String(e)}`
        );
      }
    },
  };
}

export default defineConfig({
  css: {
    preprocessorMaxWorkers: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@engine": path.resolve(import.meta.dirname, "src/engine"),
      "@app": path.resolve(import.meta.dirname, "src/app"),
    },
  },
  server: {
    port: 3000,
    host: true,
    warmup: {
      clientFiles: ["src/main.ts", "src/app/index.ts", "src/app/context.ts"],
    },
  },
  optimizeDeps: {
    include: ["mustache"],
    // Workspace packages are excluded from Vite's dep pre-bundling so
    // their many subpath exports (`kido/anima`, `kido/reveal`, ...) are
    // resolved fresh through the workspace symlink on every request.
    // Without this, Vite scans the subpaths once at startup, caches the
    // resolved `dist/*.js` paths in `node_modules/.vite`, and breaks if
    // the dist files don't yet exist or get rebuilt — which is the
    // "Failed to resolve import 'kido/anima'" error people hit when
    // running `pnpm dev` without first running `pnpm i` (the install
    // hook is what triggers each package's `prepare → tsup` build).
    // Excluding them removes the cache layer entirely so dev just works.
    exclude: ["kido"],
  },
  plugins: [
    RoutesAndBootPlugin({
      routesDir: "src/routes",
      template: "index.html",
      outDir: "dist",
    }),
    BuildLogPlugin(),
    ModulePreloadPlugin(),
    HtmlStripCommentsPlugin(),
  ],
  build: {
    outDir: "dist",
    target: "esnext",
    emptyOutDir: false,
    manifest: true,
    minify: "esbuild",
    cssMinify: "esbuild",
    reportCompressedSize: false,
    rollupOptions: {
      input: { tmhgne: "src/main.ts" },
      output: {
        codeSplitting: true,
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
