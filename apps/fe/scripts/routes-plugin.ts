/**
 * routes-plugin.ts — Vite plugin for route generation and tmhgne.json output.
 *
 * At build start and during dev server hot-reload, this plugin:
 *   1. Scans src/routes/ for route folders (each folder = one route).
 *   2. Renders each route's HTML template through Mustache using shared partials.
 *   3. Wraps rendered content in the shell index.html template.
 *   4. Writes per-route HTML files to the output directory.
 *   5. Emits tmhgne.json — the boot manifest containing the route map, cache
 *      entries (pre-rendered inner HTML), and GPU asset descriptors.
 *   6. Generates sitemap.xml for SEO.
 *   7. In closeBundle, rewrites HTML files to inject hashed JS/CSS asset tags.
 *
 * CMS-driven routes (Sanity content) are handled in the Sanity page loop —
 * they use a template HTML file identified by a star-prefix filename convention
 * (e.g., *case-study.html inside the case-study/ folder).
 */

import fs from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { loadSanityContent } from "./sanity-content.js";
import log from "./utils/logger.js";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options accepted by the RoutesAndBootPlugin factory function.
 */
interface RoutesPluginOptions {
  routesDir?: string;
  template?: string;
  outDir?: string;
}

/**
 * A single entry in the tmhgne.json cache map.
 * Contains the page title and the pre-rendered inner HTML of the #app container.
 */
interface RouteCacheEntry {
  title: string;
  html: string;
}

/**
 * The full shape of the tmhgne.json boot manifest file.
 * Loaded by the SPA at runtime to avoid a round-trip to the server on navigation.
 */
interface PkgPayload {
  generatedAt: string;
  routes: Record<string, string>;
  cache: Record<string, RouteCacheEntry>;
}

/**
 * A single entry in the Vite build manifest (`.vite/manifest.json`).
 * Used by closeBundle to locate hashed JS and CSS asset filenames.
 */
interface ManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

/**
 * The shape returned by getRouteFolders() for each discovered route folder.
 * Exported for testability.
 */
export interface RouteFolderEntry {
  /** The folder name, which becomes the route key (e.g., "home", "about"). */
  name: string;
  /** Absolute path to the route's HTML or Mustache template file. */
  htmlFile: string;
  /**
   * True when the HTML filename has a star prefix (e.g., *case-study.html),
   * indicating it is a CMS-driven template rendered once per Sanity page.
   */
  isCmsTemplate: boolean;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Derives a route key from a URL pathname.
 * "/" maps to "home"; any other path has its leading/trailing slashes stripped.
 */
function buildKeyFor(pathname: string): string {
  if (pathname === "/") return "home";
  const name = pathname.replace(/^\//, "").replace(/\/$/, "");
  return name || "page";
}

// ---------------------------------------------------------------------------
// Core: folder discovery (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Scans the given routes directory for route folders and returns metadata for
 * each one. A "route folder" is any subdirectory that contains an HTML or
 * Mustache file matching either `{name}.html` (static route) or
 * `*{name}.html` (CMS template). The `partials` directory is always skipped.
 *
 * Rules:
 * - Only subdirectories are considered — loose files at root level are ignored.
 * - The `partials` directory is reserved for shared Mustache partials and is
 *   excluded from route discovery.
 * - A static HTML file takes precedence over a CMS template file when both
 *   exist in the same folder (edge case; prefer determinism).
 * - A folder with no matching HTML file is silently skipped (e.g., a folder
 *   that only contains a .ts file is not treated as a route).
 *
 * @param absRoutesDir - Absolute path to the routes directory.
 * @returns Array of route folder metadata objects.
 */
export function getRouteFolders(absRoutesDir: string): RouteFolderEntry[] {
  if (!fs.existsSync(absRoutesDir)) return [];

  const entries = fs.readdirSync(absRoutesDir, { withFileTypes: true });
  const result: RouteFolderEntry[] = [];

  for (const entry of entries) {
    // Skip non-directories and the reserved partials directory
    if (!entry.isDirectory()) continue;
    if (entry.name === "partials") {
      console.debug("[routes-plugin] skipping partials/");
      continue;
    }

    const folderName = entry.name;
    const folderPath = path.join(absRoutesDir, folderName);
    const folderFiles = fs.readdirSync(folderPath);

    // Look for a static route HTML: {name}.html or {name}.mustache
    const staticHtml = folderFiles.find(
      (f) => f === `${folderName}.html` || f === `${folderName}.mustache`
    );

    // Look for a CMS template HTML: *{name}.html or *{name}.mustache
    const cmsHtml = folderFiles.find(
      (f) => f === `*${folderName}.html` || f === `*${folderName}.mustache`
    );

    if (staticHtml != null) {
      // Static route takes precedence over CMS template
      result.push({
        name: folderName,
        htmlFile: path.join(folderPath, staticHtml),
        isCmsTemplate: false,
      });
    } else if (cmsHtml != null) {
      console.debug(`[routes-plugin] CMS template: ${folderName}`);
      result.push({
        name: folderName,
        htmlFile: path.join(folderPath, cmsHtml),
        isCmsTemplate: true,
      });
    }
    // No matching HTML file — folder is not a route, silently skip
  }

  console.debug(`[routes-plugin] discovered ${result.length} route folders`);
  return result;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * RoutesAndBootPlugin — Vite plugin that emits per-route HTML files and the
 * tmhgne.json boot manifest from co-located route folders.
 *
 * @param opts - Optional configuration for routes dir, template path, and output dir.
 */
export function RoutesAndBootPlugin(opts: RoutesPluginOptions = {}): Plugin {
  const routesDir = opts.routesDir || "src/routes";
  const template = opts.template || "index.html";
  const outDir = opts.outDir || "dist";
  const absRoutesDir = path.resolve(routesDir);
  const absTemplate = path.resolve(template);
  const absOutDir = path.resolve(outDir);
  let isBuild = false;
  // Cached site title from the Sanity Global doc. Captured during
  // emitRoutesAndBoot and reused by transformIndexHtml so the dev-server
  // shell render gets the same title without re-fetching Sanity each tick.
  let cachedSiteTitle = "";
  // Cached intro phrases from the Global doc, same dev-server reuse rationale
  // as cachedSiteTitle. Serialized into the intro overlay; the runtime intro
  // picks one at random per load.
  let cachedIntroPhrases: string[] = [];

  /**
   * Reads all Mustache partial files from src/routes/partials/ and returns
   * them as a name→content map for use in Mustache.render() calls.
   */
  function loadPartials(): Record<string, string> {
    const partialsDir = path.join(absRoutesDir, "partials");
    const map: Record<string, string> = {};
    if (!fs.existsSync(partialsDir)) return map;
    const files = fs
      .readdirSync(partialsDir)
      .filter((f) => /\.(html|mustache)$/i.test(f));
    for (const f of files) {
      const name = f.replace(/\.(html|mustache)$/i, "");
      const abs = path.join(partialsDir, f);
      map[name] = fs.readFileSync(abs, "utf8");
    }
    return map;
  }

  /**
   * Reads the shell HTML template (index.html) that wraps every route's
   * rendered content. Throws if the template file does not exist.
   */
  function readTemplate(): string {
    if (!fs.existsSync(absTemplate))
      throw new Error(`[routes] Missing template: ${absTemplate}`);
    return fs.readFileSync(absTemplate, "utf8");
  }

  /**
   * Main emit function: discovers route folders, renders each template,
   * writes output HTML files, and writes tmhgne.json + sitemap.xml.
   *
   * Called at buildStart (production build) and at dev server startup / on
   * file changes. The CMS Sanity loop is attempted after static routes; it
   * gracefully skips if Sanity credentials are unavailable.
   */
  async function emitRoutesAndBoot(): Promise<void> {
    const t = readTemplate();
    const routeFolders = getRouteFolders(absRoutesDir);

    fs.mkdirSync(outDir, { recursive: true });

    const routes: Record<string, string> = {};
    const cache: Record<string, RouteCacheEntry> = {};

    const partials = loadPartials();

    // Load Sanity content first so page data (images, site title, etc.) is
    // available for both static and CMS-driven route templates.
    let sanityPages: Awaited<ReturnType<typeof loadSanityContent>>["pages"] =
      [];
    let siteTitle = cachedSiteTitle;
    let introPhrases = cachedIntroPhrases;
    try {
      const content = await loadSanityContent();
      sanityPages = content.pages;
      siteTitle = content.siteTitle || cachedSiteTitle;
      cachedSiteTitle = siteTitle;
      introPhrases = content.introPhrases?.length
        ? content.introPhrases
        : cachedIntroPhrases;
      cachedIntroPhrases = introPhrases;
    } catch (e) {
      const err = e as Error;
      log.line("cms", `skipped: ${err?.message || e}`);
    }

    /**
     * Wraps rendered inner HTML in the shell template. `siteTitle` is
     * threaded in so the shell <title> and meta.html share the value.
     * The `dev` flag toggles dev-only template branches.
     */
    // Intro phrases serialized for the shell. Every "<" is replaced with its
    // unicode JSON escape so the payload — rendered unescaped inside the intro's
    // <script type="application/json"> — can never emit a literal closing script
    // tag and end the block early. `hasIntroPhrases` gates the intro markup so
    // the text/JSON only render when the CMS provided phrases.
    const introPhrasesJson = JSON.stringify(introPhrases).replace(
      /</g,
      "\\u003c",
    );
    const hasIntroPhrases = introPhrases.length > 0;

    const wrap = (inner: string): string =>
      Mustache.render(
        t,
        {
          content: inner,
          dev: !isBuild,
          siteTitle,
          introPhrasesJson,
          hasIntroPhrases,
        },
        partials,
      );

    // Build a lookup from route key → page data so static templates can
    // access data defined in sanity-content (e.g. responsive image arrays).
    const pageDataByKey: Record<string, Record<string, unknown>> = {};
    for (const page of sanityPages) {
      pageDataByKey[page.key] = (page.data ?? {}) as Record<string, unknown>;
    }

    // Process static (non-CMS) route folders
    for (const folder of routeFolders) {
      // CMS template folders are handled in the Sanity loop below
      if (folder.isCmsTemplate) continue;

      const name = folder.name;
      const raw = fs.readFileSync(folder.htmlFile, "utf8");
      // Pass page data from sanity-content to the template so Mustache
      // can render dynamic content (e.g. responsive image arrays).
      const data = pageDataByKey[name] ?? {};
      const rendered = Mustache.render(raw, data, partials);
      let html = wrap(rendered);

      let routePath: string;
      let outPath: string;
      let title: string;

      // The shell <title> is a bare `{{siteTitle}}` ("Diaa") for every static
      // page, so the regex below yields "Diaa" for all of them. When
      // sanity-content has composed a richer title for this route (e.g.
      // "Diaa - Contact" / "Diaa - Imprint" — see sanity-content.ts), prefer it
      // so both the runtime tab title (cache) and the baked <title> (hard load /
      // crawlers) match the detail pages. Routes whose Sanity title is still the
      // plain capitalised folder name (e.g. About) fall through to the shell
      // title unchanged — no behaviour change for those.
      const bareName = name.charAt(0).toUpperCase() + name.slice(1);
      const sanityTitle = sanityPages.find((p) => p.key === name)?.title;
      const customTitle =
        sanityTitle && sanityTitle !== bareName ? sanityTitle : undefined;

      if (name === "home") {
        routePath = "/";
        outPath = path.join(outDir, "index.html");
        title = customTitle || /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] || "Home";
      } else {
        routePath = `/${name}`;
        outPath = path.join(outDir, `${name}.html`);
        title =
          customTitle ||
          /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ||
          bareName;
      }

      // Rewrite the baked shell <title> so a hard load / no-JS crawler sees the
      // composed title too (the runtime overwrites document.title from the cache
      // on hydrate, but this avoids a "Diaa" → "Diaa - Contact" flash on load).
      if (customTitle) {
        html = html.replace(
          /<title>[\s\S]*?<\/title>/,
          `<title>${customTitle}</title>`,
        );
      }

      // Remove legacy directory-based routes (e.g., /about/index.html) to prevent
      // routing conflicts with the flat file approach
      if (name && name !== "home") {
        const legacyDir = path.join(outDir, name);
        const legacyIndex = path.join(legacyDir, "index.html");
        try {
          if (fs.existsSync(legacyIndex)) fs.unlinkSync(legacyIndex);
          if (fs.existsSync(legacyDir)) fs.rmdirSync(legacyDir);
        } catch { }
      }

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, "utf8");

      routes[routePath] = name;

      // Extract the inner content of <main id="app"> for SPA cache pre-population.
      // If no #app container found, fall back to the raw rendered fragment.
      const appMatch = /<main id=["']app["'][^>]*>([\s\S]*?)<\/main>/i.exec(
        html
      );
      const inner = appMatch?.[1]?.trim() ?? rendered.trim();
      cache[routePath] = { title, html: inner };
    }

    // Process CMS-driven routes (pages from sanity-content that use a
    // star-prefixed template file, e.g. case studies from Sanity CMS).
    // Content was already loaded above; only CMS-template pages are
    // rendered here — static pages (home, about) were handled above.
    try {
      // Filter to only CMS-template pages (those whose template matches
      // a star-prefixed folder). Static pages already rendered above.
      const cmsPages = sanityPages.filter((p) =>
        routeFolders.some((f) => f.isCmsTemplate && f.name === p.template)
      );

      for (const page of cmsPages) {
        // After migration: CMS templates live in a subdirectory named after the
        // template. Search inside that subdirectory for the template HTML file.
        // Fallback candidates include both {name}.html and *{name}.html variants
        // (and .mustache equivalents) inside the template's own folder.
        const templateFolder = path.join(absRoutesDir, page.template);
        const candidates = [
          path.join(templateFolder, `${page.template}.html`),
          path.join(templateFolder, `${page.template}.mustache`),
          path.join(templateFolder, `*${page.template}.html`),
          path.join(templateFolder, `*${page.template}.mustache`),
        ];
        let tplPath: string | null = null;
        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            tplPath = cand;
            break;
          }
        }
        if (!tplPath) {
          log.warn("template", `missing ${page.template}`);
          continue;
        }
        const raw = fs.readFileSync(tplPath, "utf8");
        const rendered = Mustache.render(
          raw,
          (page.data ?? {}) as Record<string, unknown>,
          partials
        );
        const html = wrap(rendered);

        const name = page.path === "/" ? "index" : page.path.replace(/^\//, "");
        const outPath =
          page.path === "/"
            ? path.join(outDir, "index.html")
            : path.join(outDir, `${name}.html`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html, "utf8");

        routes[page.path] = page.key || buildKeyFor(page.path);
        const appMatch = /<main id=["']app["'][^>]*>([\s\S]*?)<\/main>/i.exec(
          html
        );
        const inner = appMatch?.[1]?.trim() ?? rendered.trim();
        cache[page.path] = { title: page.title || "", html: inner };
      }
    } catch (e) {
      const err = e as Error;
      log.line("cms", `skipped: ${err?.message || e}`);
    }

    // Scan any pre-existing HTML files in the output dir that weren't covered
    // above (e.g., from a previous build). This populates the cache for those
    // routes so SPA navigation works on first load.
    try {
      const filesOut = fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith(".html"));
      for (const f of filesOut) {
        const isIndex = f === "index.html";
        const name = f.replace(/\.html$/, "");
        const routePath = isIndex ? "/" : `/${name}`;
        if (!cache[routePath]) {
          const htmlFull = fs.readFileSync(path.join(outDir, f), "utf8");
          const title = /<title>([\s\S]*?)<\/title>/i.exec(htmlFull)?.[1] || "";
          const appMatch = /<main id=["']app["'][^>]*>([\s\S]*?)<\/main>/i.exec(
            htmlFull
          );
          const inner = appMatch?.[1]?.trim() ?? "";
          if (inner) {
            cache[routePath] = { title, html: inner };
            routes[routePath] = routes[routePath] || buildKeyFor(routePath);
          }
        }
      }
    } catch (e) {
      const err = e as Error;
      log.line("cache", `skipped: ${err?.message || e}`);
    }

    const pkg: PkgPayload = {
      generatedAt: new Date().toISOString(),
      routes,
      cache,
    };
    fs.writeFileSync(
      path.join(outDir, "tmhgne.json"),
      JSON.stringify(pkg, null, 2)
    );
    log.section("Routes");
    log.line("tmhgne", `generated ${Object.keys(routes).length} routes`);

    // Generate sitemap.xml for SEO crawlers
    try {
      const baseEnv = process.env.SITE_URL || process.env.VERCEL_URL || "";
      const baseUrl = baseEnv
        ? baseEnv.startsWith("http")
          ? baseEnv.replace(/\/$/, "")
          : `https://${String(baseEnv).replace(/\/$/, "")}`
        : "";
      const routePaths = Object.keys(routes || {});
      const urlEntries = routePaths
        .sort()
        .map((p) => {
          const loc = baseUrl
            ? `${baseUrl}${p === "/" ? "" : p}`
            : `${p === "/" ? "/" : p}`;
          return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
        })
        .join("\n");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;
      fs.writeFileSync(path.join(outDir, "sitemap.xml"), xml, "utf8");
      log.line("sitemap", "generated sitemap.xml");
    } catch (e) {
      const err = e as Error;
      log.warn("sitemap", `failed: ${err?.message || e}`);
    }
  }

  return {
    name: "routes-and-boot",
    enforce: "pre",

    /**
     * Detects whether this is a production build (isBuild flag) so the
     * `dev` variable in Mustache templates is set correctly.
     */
    configResolved(cfg: ResolvedConfig) {
      isBuild = cfg.command === "build";
    },

    /**
     * Dev-server HTML transform: applies Mustache partials to the root
     * index.html so shared partials (nav, meta, etc.) are resolved during
     * development without running the full emitRoutesAndBoot pipeline.
     */
    transformIndexHtml(html: string): string {
      try {
        const partials = loadPartials();
        return Mustache.render(
          html,
          {
            content: "",
            dev: !isBuild,
            siteTitle: cachedSiteTitle,
            introPhrasesJson: JSON.stringify(cachedIntroPhrases).replace(
              /</g,
              "\\u003c",
            ),
            hasIntroPhrases: cachedIntroPhrases.length > 0,
          },
          partials,
        );
      } catch {
        return html;
      }
    },

    /**
     * Production build: runs the full route emission pipeline before Vite
     * begins bundling. This ensures all route HTML files exist in dist/ before
     * asset injection in closeBundle.
     */
    async buildStart() {
      await emitRoutesAndBoot();
    },

    /**
     * Post-bundle step: rewrites each output HTML file to inject the
     * hashed JS entry tag and CSS link tags from the Vite build manifest.
     * Also embeds the tmhgne.json payload inline as a script tag for zero
     * round-trip SPA boot.
     */
    async closeBundle() {
      try {
        let manifestPath = path.resolve(outDir, ".vite/manifest.json");
        if (!fs.existsSync(manifestPath)) {
          const legacy = path.resolve(outDir, "manifest.json");
          manifestPath = fs.existsSync(legacy) ? legacy : manifestPath;
        }
        if (!fs.existsSync(manifestPath)) {
          log.warn("manifest", "not found, skipping html rewrites");
          return;
        }
        const manifest: Record<string, ManifestEntry> = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        );

        let entry: ManifestEntry | undefined =
          manifest["tmhgne"] || manifest["src/main.ts"];
        if (!entry) {
          entry = Object.values(manifest).find((m) => m && m.isEntry);
        }
        if (!entry || !entry.file) {
          log.warn("manifest", "no entry found, skipping html rewrites");
          return;
        }

        const jsTag = `<script type="module" src="/${entry.file}"></script>`;
        const cssTags = Array.isArray(entry.css)
          ? entry.css.map((c) => `<link rel="stylesheet" href="/${c}">`)
          : [];

        const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".html"));

        const akPath = path.join(outDir, "tmhgne.json");
        let akJsonText: string | null = null;
        try {
          if (fs.existsSync(akPath)) {
            const raw = fs.readFileSync(akPath, "utf8");
            try {
              akJsonText = JSON.stringify(JSON.parse(raw));
            } catch {
              akJsonText = raw;
            }
          }
        } catch { }

        for (const file of files) {
          const p = path.join(outDir, file);
          let html = fs.readFileSync(p, "utf8");

          // Remove the dev-mode script tag if it leaked into the output
          const devScriptAnyRe =
            /<script\s+type=["']module["']\s+src=["']\s*src\/main\.(?:ts|js)\s*["'][^>]*>\s*<\/script>/gi;
          html = html.replace(devScriptAnyRe, "");

          // Remove any preload link tags for the JSON manifest (will be inlined instead)
          const akPreloadRe =
            /<link[^>]+rel=["']preload["'][^>]+href=["']\/?tmhgne\.json["'][^>]*>\s*/gi;
          html = html.replace(akPreloadRe, "");

          if (cssTags.length > 0) {
            for (const tag of cssTags) {
              if (!html.includes(tag)) {
                if (/<\/head>/i.test(html)) {
                  html = html.replace(/<\/head>/i, `${tag}\n</head>`);
                } else {
                  html = `${tag}\n${html}`;
                }
              }
            }
          }

          if (!html.includes(jsTag)) {
            html = html.replace(/<\/body>/i, `${jsTag}\n</body>`);
          }

          // Inline the tmhgne.json payload so the SPA can boot without a
          // network request for the manifest
          if (akJsonText && !/id=["']__TMHGNE__["']/.test(html)) {
            const safeJson = akJsonText.replace(
              /<\/-?script>/gi,
              "<\\/script>"
            );
            const akTag = `<script id="__TMHGNE__" type="application/json">${safeJson}</script>`;
            if (/<\/body>/i.test(html)) {
              html = html.replace(/<\/body>/i, `${akTag}\n</body>`);
            } else {
              html = `${html}${akTag}`;
            }
          }

          fs.writeFileSync(p, html, "utf8");
        }
        log.section("HTML");
        log.line("rewrite", `linked assets in ${files.length} files`);
      } catch (e) {
        const err = e as Error;
        log.warn("rewrite", `failed: ${err?.message || e}`);
      }
    },

    /**
     * Dev server: watches the routes directory and shell template for changes.
     * Any add/change/unlink event triggers a debounced full rebuild + browser
     * full-reload so the dev experience stays hot.
     */
    configureServer(server: ViteDevServer) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pendingLabel: string | null = null;

      const scheduleRebuild = (evt = "change", file: string | null = null) => {
        const rel = file ? path.relative(process.cwd(), file) : null;
        pendingLabel = rel ? `${evt}: ${rel}` : evt;
        if (timer) return;
        timer = setTimeout(async () => {
          const label = pendingLabel || "change";
          timer = null;
          pendingLabel = null;
          try {
            log.line("routes", `rebuilding (${label})`);
            await emitRoutesAndBoot();
            server.ws.send({ type: "full-reload" });
          } catch (e) {
            log.error("routes", String(e));
          }
        }, 20);
      };

      /**
       * Returns true if the given file path is relevant to route generation —
       * i.e., is the shell template or inside the routes directory.
       * Files inside the output directory are excluded to avoid rebuild loops.
       */
      const isRelevant = (file: string): boolean => {
        if (!file) return false;
        const abs = path.resolve(file);
        if (abs.startsWith(absOutDir + path.sep)) return false;
        return abs === absTemplate || abs.startsWith(absRoutesDir + path.sep);
      };

      server.watcher.add(absRoutesDir);
      server.watcher.add(absTemplate);
      scheduleRebuild("initial");
      server.watcher.on(
        "add",
        (f: string) => isRelevant(f) && scheduleRebuild("add", f)
      );
      server.watcher.on(
        "change",
        (f: string) => isRelevant(f) && scheduleRebuild("change", f)
      );
      server.watcher.on(
        "unlink",
        (f: string) => isRelevant(f) && scheduleRebuild("unlink", f)
      );

      /**
       * Serves tmhgne.json from the output directory. If the file doesn't
       * exist yet (e.g., first load before buildStart), runs emit first.
       */
      server.middlewares.use(async (req, res, next) => {
        if (!req || !req.url) return next();
        if (req.url === "/tmhgne.json") {
          try {
            const akPath = path.resolve(outDir, "tmhgne.json");
            if (!fs.existsSync(akPath)) {
              await emitRoutesAndBoot();
            }
            const data = fs.readFileSync(akPath);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.statusCode = 200;
            res.end(data);
            return;
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Failed to read tmhgne.json" }));
            return;
          }
        }
        next();
      });
    },
  };
}
