/**
 * init.ts — Tamahagane project bootstrap.
 *
 * This script wipes the demo content out of `apps/fe` and leaves you with a
 * clean two-page scaffold (home + about) that's ready to build on. It is
 * INTENTIONALLY DESTRUCTIVE — it deletes every route folder except
 * `partials/`, deletes every page style module, and rewrites a handful of
 * config-derived files. Only run it on a fresh checkout (or when you really
 * want to throw away the demo state).
 *
 * What it does, in order:
 *
 *   A. Walks you through `project.config.ts` interactively. Each prompt
 *      shows the current value as the default — press Enter to keep it.
 *      The new config is written back to `project.config.ts`.
 *
 *   B. Clears `src/routes/` of every folder except `partials/`. Anything
 *      else (home, about, demo, morph, sanity, test-*) is removed.
 *
 *   C. Clears `src/styles/pages/` entirely. The home + about modules are
 *      regenerated in step D.
 *
 *   C2. Clears `apps/fe/learnings/` of every entry. The folder is kept (and
 *       recreated if missing) so future writes have a target.
 *
 *   C3. Removes the repo-root `.planning/` directory entirely (GSD workflow
 *       state — phases, milestones, research, ROADMAP.md, PROJECT.md, etc).
 *       Re-running `/gsd:new-project` recreates it from scratch.
 *
 *   C4. (Optional) Removes the sibling `apps/sandbox/` WGSL playground app.
 *       Prompted during the walkthrough with a default of "no", so the
 *       playground is preserved unless the user opts in.
 *
 *   D. Scaffolds blank home + about pages — HTML, TS, SCSS module — with
 *      the nav partial included so the user can navigate between them.
 *
 *   E. Rewrites `partials/nav.html` so it only links to home + about.
 *
 *   F. Rewrites `src/styles/pages.scss` so it only imports the new
 *      `_home.module` and `_about.module`.
 *
 *   G. Regenerates `_colors.module.scss` + `_variables.module.scss` from
 *      the new project.config values.
 *
 *   H. Rewrites `partials/meta.html` from the new title/description/url.
 *
 *   I. Renames the package via `package.json#name`.
 *
 *   J. Rewrites `scripts/sanity-content.ts` as a clean blank scaffold —
 *      no fetched content, no demo data, just two blank page entries
 *      (`/` and `/about`) and extensive comments showing how to plug
 *      Sanity content (or static images) in later.
 *
 * What it does NOT do:
 *
 *   - Touch `public/assets/images/` (your originals are safe).
 *   - Touch `partials/` (nav is rewritten, but the folder itself stays).
 *   - Run install, build, or test steps.
 *
 * Usage:
 *
 *   pnpm --filter tamahagane-fe init
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/** Absolute path to apps/fe — every other path is resolved against this. */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Folders we never delete from `src/routes/` during cleanup. Anything not
 * in this set is wiped, even if it's the home or about folder — those get
 * re-scaffolded fresh in step D.
 */
const KEEP_ROUTE_FOLDERS = new Set(["partials"]);

// ─────────────────────────────────────────────────────────────────────────────
// Project config — TypeScript shape mirroring project.config.ts
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectConfig {
  name: string;
  title: string;
  description: string;
  url: string;
  ogImage: string;
  twitter: string;
  sanity: { projectId: string; dataset: string };
  colors: {
    black: string;
    white: string;
    stone: string;
    darkStone: string;
    accent: string;
    theme: string;
    bgTheme: string;
  };
  grid: {
    columns: number;
    columnsSm: number;
    columnsMd: number;
    containerPadding: string;
    columnGap: string;
  };
  scroller: { damping: number };
}

/**
 * Dynamically import the existing project.config.ts so we can show its
 * current values as prompt defaults. tsx resolves the .ts extension at
 * runtime — no separate compile step needed.
 */
async function loadConfig(): Promise<ProjectConfig> {
  const mod = (await import("../project.config")) as { default: ProjectConfig };
  return mod.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Interactive walkthrough of project.config.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prompt the user for a string value. Pressing Enter without typing keeps
 * the current value (shown in square brackets). Trailing whitespace is
 * trimmed so accidental spaces don't sneak in.
 */
async function ask(rl: readline.Interface, label: string, current: string): Promise<string> {
  const answer = (await rl.question(`  ${label} [${current}]: `)).trim();
  return answer === "" ? current : answer;
}

/**
 * Prompt for a numeric value. Empty input or unparseable strings fall back
 * to the current value, so the user can never accidentally write NaN.
 */
async function askNumber(
  rl: readline.Interface,
  label: string,
  current: number,
): Promise<number> {
  const answer = (await rl.question(`  ${label} [${current}]: `)).trim();
  if (answer === "") return current;
  const parsed = Number(answer);
  return Number.isFinite(parsed) ? parsed : current;
}

/**
 * Prompt for a yes/no answer. Pressing Enter without typing keeps the
 * supplied default. Accepts y/yes/n/no in any casing; anything else falls
 * back to the default rather than re-prompting (init is one-shot).
 */
async function askYesNo(
  rl: readline.Interface,
  label: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`  ${label} [${hint}]: `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return defaultYes;
}

/**
 * Bundle of decisions captured by the interactive walkthrough. The config
 * itself is the primary output, but the walkthrough also collects a small
 * set of one-shot cleanup toggles (e.g. removing `apps/sandbox/`) that the
 * main flow consults later during the destructive phases.
 */
interface WalkthroughResult {
  config: ProjectConfig;
  removeSandbox: boolean;
}

/**
 * Walk the user through every meaningful field on project.config.ts and
 * any one-shot cleanup toggles. Returns a brand-new ProjectConfig built
 * from the user's answers plus the cleanup flags captured at the end.
 */
async function walkthroughConfig(current: ProjectConfig): Promise<WalkthroughResult> {
  const rl = readline.createInterface({ input, output });

  console.log("\n┌──────────────────────────────────────────────");
  console.log("│ project.config.ts walkthrough");
  console.log("│ Press Enter to keep the [current] value");
  console.log("└──────────────────────────────────────────────\n");

  console.log("• Identity");
  const name = await ask(rl, "package name (kebab-case)", current.name);
  const title = await ask(rl, "site title", current.title);
  const description = await ask(rl, "site description", current.description);
  const url = await ask(rl, "canonical URL", current.url);
  const ogImage = await ask(rl, "Open Graph image path", current.ogImage);
  const twitter = await ask(rl, "twitter handle (optional)", current.twitter);

  console.log("\n• Sanity CMS");
  const projectId = await ask(rl, "Sanity project ID", current.sanity.projectId);
  const dataset = await ask(rl, "Sanity dataset", current.sanity.dataset);

  console.log("\n• Colors (RGB triples like \"255, 255, 255\")");
  const black = await ask(rl, "black", current.colors.black);
  const white = await ask(rl, "white", current.colors.white);
  const stone = await ask(rl, "stone", current.colors.stone);
  const darkStone = await ask(rl, "dark-stone", current.colors.darkStone);
  const accent = await ask(rl, "accent", current.colors.accent);
  const theme = await ask(rl, "theme color (foreground)", current.colors.theme);
  const bgTheme = await ask(rl, "background theme color", current.colors.bgTheme);

  console.log("\n• Grid");
  const columns = await askNumber(rl, "columns (desktop)", current.grid.columns);
  const columnsSm = await askNumber(rl, "columns (small)", current.grid.columnsSm);
  const columnsMd = await askNumber(rl, "columns (medium)", current.grid.columnsMd);
  const containerPadding = await ask(rl, "container padding", current.grid.containerPadding);
  const columnGap = await ask(rl, "column gap", current.grid.columnGap);

  console.log("\n• Scroller");
  const damping = await askNumber(rl, "damping (0-1)", current.scroller.damping);

  // Cleanup toggles — yes/no decisions about removing optional pieces of
  // the monorepo. Defaults err on the side of "no" so an accidental Enter
  // never wipes a sibling app the user wanted to keep.
  console.log("\n• Cleanup");
  const removeSandbox = await askYesNo(
    rl,
    "remove apps/sandbox/ (the WGSL playground app)?",
    false,
  );

  rl.close();

  return {
    config: {
      name,
      title,
      description,
      url,
      ogImage,
      twitter,
      sanity: { projectId, dataset },
      colors: { black, white, stone, darkStone, accent, theme, bgTheme },
      grid: { columns, columnsSm, columnsMd, containerPadding, columnGap },
      scroller: { damping },
    },
    removeSandbox,
  };
}

/**
 * Serialise the new config back to project.config.ts. Hand-written rather
 * than `JSON.stringify`'d so the output stays as a TypeScript module with
 * the same shape and indentation as the original.
 */
function writeConfig(config: ProjectConfig): void {
  const ts = `export default {
  name: ${JSON.stringify(config.name)},
  title: ${JSON.stringify(config.title)},
  description: ${JSON.stringify(config.description)},
  url: ${JSON.stringify(config.url)},
  ogImage: ${JSON.stringify(config.ogImage)},
  twitter: ${JSON.stringify(config.twitter)},

  sanity: {
    projectId: ${JSON.stringify(config.sanity.projectId)},
    dataset: ${JSON.stringify(config.sanity.dataset)},
  },

  colors: {
    black: ${JSON.stringify(config.colors.black)},
    white: ${JSON.stringify(config.colors.white)},
    stone: ${JSON.stringify(config.colors.stone)},
    darkStone: ${JSON.stringify(config.colors.darkStone)},
    accent: ${JSON.stringify(config.colors.accent)},
    theme: ${JSON.stringify(config.colors.theme)},
    bgTheme: ${JSON.stringify(config.colors.bgTheme)},
  },

  grid: {
    columns: ${config.grid.columns},
    columnsSm: ${config.grid.columnsSm},
    columnsMd: ${config.grid.columnsMd},
    containerPadding: ${JSON.stringify(config.grid.containerPadding)},
    columnGap: ${JSON.stringify(config.grid.columnGap)},
  },

  scroller: {
    damping: ${config.scroller.damping},
  },
}
`;
  fs.writeFileSync(path.join(ROOT, "project.config.ts"), ts);
  console.log("  rewrote: project.config.ts");
}

// ─────────────────────────────────────────────────────────────────────────────
// B. Clear src/routes/ down to partials/
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wipe every folder under src/routes/ except those in KEEP_ROUTE_FOLDERS.
 * Home and about are NOT in the keep set — they're rebuilt fresh in step D.
 */
function clearRoutes(): void {
  const routesDir = path.join(ROOT, "src/routes");
  for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (KEEP_ROUTE_FOLDERS.has(entry.name)) continue;
    fs.rmSync(path.join(routesDir, entry.name), { recursive: true, force: true });
    console.log(`  removed route: ${entry.name}/`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Clear src/styles/pages/ entirely
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wipe every page-level SCSS module. Step D recreates _home + _about.
 */
function clearPageStyles(): void {
  const pagesDir = path.join(ROOT, "src/styles/pages");
  if (!fs.existsSync(pagesDir)) return;
  for (const entry of fs.readdirSync(pagesDir)) {
    fs.rmSync(path.join(pagesDir, entry), { force: true });
    console.log(`  removed style: pages/${entry}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C2. Clear learnings/ entirely
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wipe every file in `apps/fe/learnings/`. The folder itself is left in
 * place (and recreated if missing) so future writes have a target — only
 * its contents are demo cruft that should not survive an init.
 */
function clearLearnings(): void {
  const learningsDir = path.join(ROOT, "learnings");
  if (!fs.existsSync(learningsDir)) {
    fs.mkdirSync(learningsDir, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(learningsDir)) {
    fs.rmSync(path.join(learningsDir, entry), { recursive: true, force: true });
    console.log(`  removed learning: ${entry}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C3. Clear .planning/ (GSD workflow state) at the repo root
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wipe the repo-root `.planning/` directory — GSD workflow state (PROJECT.md,
 * ROADMAP.md, phases/, milestones/, research/, codebase/). An init resets the
 * project to a fresh-template state, so the previous project's GSD history
 * should not leak into whatever the user is building next. The directory is
 * removed entirely; re-running `/gsd:new-project` will recreate it.
 *
 * `ROOT` points at `apps/fe`, so we climb two levels (`apps/fe` → `apps` →
 * repo root) to locate the planning directory.
 */
function clearPlanning(): void {
  const repoRoot = path.resolve(ROOT, "../..");
  const planningDir = path.join(repoRoot, ".planning");
  if (!fs.existsSync(planningDir)) return;
  fs.rmSync(planningDir, { recursive: true, force: true });
  console.log(`  removed: .planning/ (GSD workflow state)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// C4. Optional: remove apps/sandbox/ (the WGSL playground app)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete the sibling `apps/sandbox/` app entirely. Only runs when the
 * walkthrough toggle (`removeSandbox`) is set — sandbox is the WGSL shader
 * playground and may be wanted on a fresh project even though `apps/fe`
 * never imports from it.
 *
 * `pnpm-workspace.yaml` uses an `apps/*` glob, so removing the directory
 * is enough — no manifest edit required. `turbo.json` and the root
 * `package.json` do not name the package explicitly. Historical references
 * inside `.planning/` are wiped by `clearPlanning()` in the same run.
 */
function clearSandbox(): void {
  const repoRoot = path.resolve(ROOT, "../..");
  const sandboxDir = path.join(repoRoot, "apps/sandbox");
  if (!fs.existsSync(sandboxDir)) {
    console.log("  skipped: apps/sandbox/ (already absent)");
    return;
  }
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  console.log("  removed: apps/sandbox/ (WGSL playground app)");
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Scaffold blank home + about pages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create src/routes/home/{home.html, home.ts} and the matching SCSS module.
 * The HTML is intentionally empty except for the nav partial. The TS file
 * is a stub BasePage subclass with empty lifecycle hooks and instructional
 * comments pointing at the contract.
 */
function scaffoldHome(): void {
  const html = `<section id="page" class="home">
  {{> nav}}
  <div class="home-container">
    <!--
      Home page content goes here. This is the entry point of the site —
      keep it focused. The {{> nav}} partial above already provides the
      Home/About links so you don't need to write anchors yourself.
    -->
  </div>
</section>
`;

  const ts = `/**
 * HomePage — manages lifecycle for the / route.
 *
 * Auto-discovered by PageManager via import.meta.glob — the folder name
 * ("home") becomes the page key. No manual registration required.
 *
 * Lifecycle hooks (override as needed):
 *   - init(container): query DOM, set hidden initial state for entrance
 *                      animations. Runs BEFORE the intro overlay wipes,
 *                      so anything you hide here won't flash.
 *   - in():            entrance animations. Use kido/anima — never GSAP.
 *   - out():           fast (200–500ms) content exit before the curtain.
 *   - cleanup():       teardown (cancel timers, unsubscribe, drop refs).
 */

import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

export default class HomePage extends BasePage {
  /**
   * Initialise the home page when its DOM container is available.
   * Query elements and set hidden initial state here.
   */
  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    dbg.page("home:init");
  }

  /**
   * Entrance animation hook — reveal content with kido/anima.
   */
  async in(): Promise<void> {
    dbg.page("home:in");
  }

  /**
   * Exit animation hook — fast content fade-out before the page curtain.
   */
  async out(): Promise<void> {
    dbg.page("home:out");
  }
}
`;

  const scss = `@use "@/styles/includes" as *;

.home {
  position: relative;
  width: 100%;
  min-height: 100vh;
}

.home-container {
  position: relative;
  padding: 0 var(--container-padding);
  width: 100%;
  min-height: 100vh;
}
`;

  const dir = path.join(ROOT, "src/routes/home");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "home.html"), html);
  fs.writeFileSync(path.join(dir, "home.ts"), ts);
  fs.mkdirSync(path.join(ROOT, "src/styles/pages"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "src/styles/pages/_home.module.scss"), scss);
  console.log("  scaffolded: routes/home/{home.html, home.ts}");
  console.log("  scaffolded: styles/pages/_home.module.scss");
}

/**
 * Create src/routes/about/{about.html, about.ts} and its SCSS module.
 * Same shape as the home scaffold — blank container plus nav.
 */
function scaffoldAbout(): void {
  const html = `<section id="page" class="about">
  {{> nav}}
  <div class="about-container">
    <!--
      About page content goes here. The {{> nav}} partial provides a link
      back home. Replace this comment with whatever you want to say.
    -->
  </div>
</section>
`;

  const ts = `/**
 * AboutPage — manages lifecycle for the /about route.
 *
 * Auto-discovered by PageManager via import.meta.glob — the folder name
 * ("about") becomes the page key. No manual registration required.
 *
 * See HomePage for the lifecycle hook contract.
 */

import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

export default class AboutPage extends BasePage {
  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    dbg.page("about:init");
  }

  async in(): Promise<void> {
    dbg.page("about:in");
  }

  async out(): Promise<void> {
    dbg.page("about:out");
  }
}
`;

  const scss = `@use "@/styles/includes" as *;

.about {
  position: relative;
  width: 100%;
  min-height: 100vh;
}

.about-container {
  position: relative;
  padding: 0 var(--container-padding);
  width: 100%;
  min-height: 100vh;
}
`;

  const dir = path.join(ROOT, "src/routes/about");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "about.html"), html);
  fs.writeFileSync(path.join(dir, "about.ts"), ts);
  fs.writeFileSync(path.join(ROOT, "src/styles/pages/_about.module.scss"), scss);
  console.log("  scaffolded: routes/about/{about.html, about.ts}");
  console.log("  scaffolded: styles/pages/_about.module.scss");
}

// ─────────────────────────────────────────────────────────────────────────────
// E. Rewrite partials/nav.html
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the nav partial with a minimal home/about link bar. Brand on the
 * left, page links on the right — same shape as the original, just trimmed
 * down to two routes.
 */
function rewriteNav(config: ProjectConfig): void {
  const brand = config.title || "tamahagane";
  const html = `<header id="nav">
  <div class="nav--home">
    <a href="/">${brand}</a>
  </div>
  <div class="nav--group">
    <nav class="nav--group__nav">
      <a href="/" class="nav-link">home</a>
      <a href="/about" class="nav-link">about</a>
    </nav>
  </div>
</header>
`;
  fs.writeFileSync(path.join(ROOT, "src/routes/partials/nav.html"), html);
  console.log("  rewrote: partials/nav.html");
}

// ─────────────────────────────────────────────────────────────────────────────
// F. Rewrite src/styles/pages.scss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace pages.scss with imports for only the two scaffolded modules.
 */
function rewritePagesScss(): void {
  const scss = `@use "./pages/_home.module";
@use "./pages/_about.module";
`;
  fs.writeFileSync(path.join(ROOT, "src/styles/pages.scss"), scss);
  console.log("  rewrote: styles/pages.scss");
}

// ─────────────────────────────────────────────────────────────────────────────
// G. Regenerate _colors.module.scss + _variables.module.scss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite _colors.module.scss from the new config.colors values. The file
 * stores raw RGB triples in `$-color-*` variables, derives `rgb()` colors
 * from them for SCSS use, and re-exports the raw values via `:export` so
 * JS modules can read them via SCSS module imports.
 */
function rewriteColors(config: ProjectConfig): void {
  const colors = config.colors;
  const colorMap: Record<string, string> = {
    black: colors.black,
    white: colors.white,
    stone: colors.stone,
    "dark-stone": colors.darkStone,
    accent: colors.accent,
  };

  const themeColor = `$color-${colors.theme}`;
  const bgThemeColor = `$color-${colors.bgTheme}`;

  let scss = `// 1. Store raw RGB values in variables\n`;
  for (const [name, value] of Object.entries(colorMap)) {
    scss += `$-color-${name}: ${value};\n`;
  }
  scss += `\n// 2. For local SCSS usage automatically convert them to avoid needing further\n`;
  scss += `// conversion in rest of app where we use them\n`;
  for (const name of Object.keys(colorMap)) {
    scss += `$color-${name}: rgb($-color-${name}...);\n`;
  }
  scss += `\n$color-theme: ${themeColor};\n`;
  scss += `$bg-theme: ${bgThemeColor};\n`;
  scss += `\n// 3. Finally we export them for global usage - but here we export the raw\n`;
  scss += `// values. We do so as this allows \`rgba\` usage i.e. \`rgba(var(--foo), 0.5)\`.\n`;
  scss += `// If these values were hex the example wouldn't work\n`;
  scss += `:export {\n`;
  for (const name of Object.keys(colorMap)) {
    scss += `  color-${name}: $-color-${name};\n`;
  }
  scss += `}\n`;

  fs.writeFileSync(
    path.join(ROOT, "src/styles/includes/_colors.module.scss"),
    scss,
  );
  console.log("  rewrote: includes/_colors.module.scss");
}

/**
 * Rewrite _variables.module.scss from the new config.grid values. Defines
 * column counts, container padding, and column gaps for sm/md/lg, plus the
 * global golden-ratio knobs used by the layout helpers.
 */
function rewriteVariables(config: ProjectConfig): void {
  const grid = config.grid;
  let scss = `$scroll-margin-top: 150px;\n\n`;
  scss += `$columns: ${grid.columns};\n`;
  scss += `$columns-sm: ${grid.columnsSm};\n`;
  scss += `$columns-md: ${grid.columnsMd};\n\n`;
  scss += `$container-padding: ${grid.containerPadding};\n`;
  scss += `$container-padding-sm: ${grid.containerPadding};\n`;
  scss += `$container-padding-md: ${grid.containerPadding};\n\n`;
  scss += `$column-gap: ${grid.columnGap};\n`;
  scss += `$column-gap-sm: ${grid.columnGap};\n`;
  scss += `$column-gap-md: ${grid.columnGap};\n\n`;
  scss += `$g-ratio: 1.618;\n`;
  scss += `$g-steps: 5;\n`;
  scss += `$g-start: 70vw;\n`;
  scss += `$g-start-sm: 37vw;\n\n`;
  scss += `:export {\n`;
  scss += `  g-start: $g-start;\n`;
  scss += `  g-start-sm: $g-start-sm;\n`;
  scss += `  columns: $columns;\n`;
  scss += `  columns-sm: $columns-sm;\n`;
  scss += `  columns-md: $columns-md;\n`;
  scss += `  container-padding: $container-padding;\n`;
  scss += `  container-padding-sm: $container-padding-sm;\n`;
  scss += `  container-padding-md: $container-padding-md;\n`;
  scss += `}\n`;

  fs.writeFileSync(
    path.join(ROOT, "src/styles/includes/_variables.module.scss"),
    scss,
  );
  console.log("  rewrote: includes/_variables.module.scss");
}

// ─────────────────────────────────────────────────────────────────────────────
// H. Rewrite partials/meta.html
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite the meta partial with the new title/description/URL. Twitter card
 * is left commented out unless the user supplied a handle in the config.
 */
function rewriteMeta(config: ProjectConfig): void {
  const twitterLine = config.twitter
    ? `<meta name="twitter:site" content="${config.twitter}" />`
    : `<!-- <meta name="twitter:site" content="@handle" /> -->`;

  const html = `<!-- Primary SEO -->
<meta name="description" content="${config.description}" />
<link rel="canonical" href="${config.url}" />
<meta name="robots" content="index,follow" />

<!-- Open Graph (Facebook/LinkedIn, etc.) -->
<meta property="og:title" content="${config.title}" />
<meta property="og:description" content="${config.description}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${config.url}" />
<meta property="og:image" content="${config.url}${config.ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name" content="${config.title}" />
<meta property="og:locale" content="en_US" />

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image" />
${twitterLine}
<meta name="twitter:title" content="${config.title}" />
<meta name="twitter:description" content="${config.description}" />
<meta name="twitter:image" content="${config.url}${config.ogImage}" />

<!-- Icons (served from this origin) -->
<link rel="shortcut icon" href="/favicon.ico" type="image/x-icon" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link
  rel="icon"
  type="image/png"
  sizes="192x192"
  href="/android-chrome-192x192.png"
/>
<link
  rel="icon"
  type="image/png"
  sizes="512x512"
  href="/android-chrome-512x512.png"
/>

<!-- Theme / Color Scheme -->
<meta content="#ffffff" data-react-helmet="true" name="theme-color" />
<meta name="color-scheme" content="light dark" />
`;

  fs.writeFileSync(path.join(ROOT, "src/routes/partials/meta.html"), html);
  console.log("  rewrote: partials/meta.html");
}

// ─────────────────────────────────────────────────────────────────────────────
// I. Rewrite package.json#name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply the new package name. Everything else in package.json is left alone
 * because turbo, scripts, and dependency lists are stable across projects.
 */
function rewritePackageJson(config: ProjectConfig): void {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  pkg.name = config.name;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("  rewrote: package.json");
}

// ─────────────────────────────────────────────────────────────────────────────
// J. Rewrite scripts/sanity-content.ts as a clean blank scaffold
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace the entire `scripts/sanity-content.ts` with a clean scaffold that:
 *   - Defines all the supporting types (PictureData, PageEntry, MediaEntry).
 *   - Wires up the optional Sanity client + project.config loader.
 *   - Returns just two blank pages (`/` and `/about`) with no data.
 *   - Includes EXTENSIVE comments showing where to plug Sanity content
 *     and static images in.
 *
 * The body of the file is hand-written (not derived from the existing one)
 * so the user gets a clean starting point regardless of how mangled the
 * current sanity-content.ts is.
 */
function rewriteSanityContent(): void {
  const ts = `/**
 * sanity-content.ts — build-time content loader.
 *
 * Tamahagane fetches Sanity content at BUILD TIME only. There is NO
 * runtime Sanity client in the browser bundle. The flow is:
 *
 *   1. \`scripts/routes-plugin.ts\` (Vite plugin) calls \`loadSanityContent()\`
 *      during build.
 *   2. This function returns \`{ pages, media }\` — \`pages\` is the array
 *      of page entries the route plugin renders into HTML files, and
 *      \`media\` maps route paths to GPU texture descriptors.
 *   3. The route plugin emits \`tmhgne.json\` containing the route map,
 *      pre-rendered inner HTML cache, and GPU texture descriptors.
 *   4. At runtime, \`loadPkg()\` in \`apps/fe/src/app/cache.ts\` reads the
 *      inlined manifest into \`App.config.routes\`, \`App.cache\`, and
 *      \`App.data.gpu.*\`.
 *
 * RIGHT NOW this file is a blank scaffold — it returns just the home and
 * about pages with no content. Add real content by following the steps
 * inside \`loadSanityContent()\` below.
 *
 * ── Adding a Sanity-driven page ──────────────────────────────────────────
 *
 *  1. Define a schema in \`apps/be/schemaTypes/\` and register it in
 *     \`apps/be/schemaTypes/index.js\`.
 *  2. Deploy the studio: \`cd apps/be && npx sanity deploy\`.
 *  3. Add a GROQ query in \`apps/fe/scripts/utils/queries.ts\`.
 *  4. Inside \`loadSanityContent()\`, fetch the query via the \`sanityClient\`
 *     factory (uncomment the block below to wire it).
 *  5. Push a \`PageEntry\` for each document and a \`MediaEntry\` if it
 *     should bind GPU textures.
 *  6. Run \`pnpm --filter tamahagane-fe new-page\` to scaffold the route
 *     module that consumes the data.
 *
 * ── Adding a static (local-image) page ───────────────────────────────────
 *
 *  1. Drop your originals in \`apps/fe/public/assets/images/\` (e.g. \`1.jpg\`).
 *  2. The build pipeline (\`scripts/img-optimize.ts\`) generates AVIF/WebP/JPEG
 *     variants at 640w/1024w/1920w automatically after \`vite build\`.
 *  3. Use \`localPicture(basename, alt, index)\` (defined below) to build a
 *     \`PictureData\` entry per image.
 *  4. Push a \`PageEntry\` with \`data: { images: [...] }\` so the Mustache
 *     template can render \`{{#images}}{{> picture}}{{/images}}\`.
 *
 * ── PictureData shape ────────────────────────────────────────────────────
 *
 *  Every responsive image passed to a Mustache template is shaped like:
 *    { avifSrcset, webpSrcset, jpgSrcset, src, alt, sizes, width, height, isFirst }
 *  The \`isFirst\` flag drives \`fetchpriority="high"\` on the LCP image and
 *  \`loading="lazy"\` on every other image.
 */

interface SanityClient {
  fetch: <T>(query: string) => Promise<T>;
  config: () => { projectId?: string; dataset?: string };
}

interface SanityClientFactory {
  (config: {
    projectId: string;
    dataset: string;
    apiVersion: string;
    useCdn: boolean;
    token?: string;
  }): SanityClient;
}

interface SanityConfig {
  dataset?: string;
  projectId?: string;
  token?: string;
  apiVersion?: string;
}

/** Responsive picture data passed to Mustache templates. */
interface PictureData {
  avifSrcset: string;
  webpSrcset: string;
  jpgSrcset: string;
  src: string;
  alt: string;
  sizes: string;
  width: number;
  height: number;
  isFirst: boolean;
}

/** A single page emitted by the build — rendered to HTML by routes-plugin. */
interface PageEntry {
  path: string;
  key: string;
  title: string;
  template: string;
  data: Record<string, unknown>;
}

/** A single texture layer entry — one image or video source for a GPU plane. */
interface TextureLayer {
  url: string | null;
  id: string;
  type?: "image" | "video";
}

/** GPU media descriptor for a single route — bound to \`._g\` figures. */
interface MediaEntry {
  textures: Record<string, TextureLayer[][]>;
}

interface SanityContentResult {
  pages: PageEntry[];
  media: Record<string, MediaEntry>;
}

interface SanityContentOptions {
  dataset?: string;
  projectId?: string;
  token?: string;
  apiVersion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Responsive image helpers
// ─────────────────────────────────────────────────────────────────────────────

const WIDTHS = [640, 1024, 1920] as const;
const SIZES = "(max-width: 640px) 640px, (max-width: 1024px) 1024px, 1920px";

/**
 * Build responsive PictureData for a local image in public/assets/images/.
 * The img-optimize build step generates the actual variant files; this
 * function only emits the URLs the HTML templates reference.
 *
 * @param basename - Filename without extension (e.g. "1", "10")
 * @param alt - Alt text for the image
 * @param index - Position in the image list (0 = first → fetchpriority="high")
 */
function localPicture(basename: string, alt: string, index: number): PictureData {
  const base = \`/assets/images/\${basename}\`;
  return {
    avifSrcset: WIDTHS.map((w) => \`\${base}-\${w}w.avif \${w}w\`).join(", "),
    webpSrcset: WIDTHS.map((w) => \`\${base}-\${w}w.webp \${w}w\`).join(", "),
    jpgSrcset: WIDTHS.map((w) => \`\${base}-\${w}w.jpg \${w}w\`).join(", "),
    src: \`\${base}-640w.jpg\`,
    alt,
    sizes: SIZES,
    width: 640,
    height: 853,
    isFirst: index === 0,
  };
}

/**
 * Build responsive PictureData from a Sanity CDN URL. Uses Sanity's URL
 * transform params (\`?w=&fm=&q=\`) instead of local variant files.
 */
function sanityPicture(sanityUrl: string, alt: string, index: number): PictureData {
  const baseUrl = sanityUrl.split("?")[0];
  return {
    avifSrcset: WIDTHS.map((w) => \`\${baseUrl}?w=\${w}&fm=webp&q=65 \${w}w\`).join(", "),
    webpSrcset: WIDTHS.map((w) => \`\${baseUrl}?w=\${w}&fm=webp&q=75 \${w}w\`).join(", "),
    jpgSrcset: WIDTHS.map((w) => \`\${baseUrl}?w=\${w}&q=80 \${w}w\`).join(", "),
    src: \`\${baseUrl}?w=640&q=80\`,
    alt,
    sizes: SIZES,
    width: 640,
    height: 853,
    isFirst: index === 0,
  };
}

// Optional Sanity client — only loaded if @sanity/client is installed
// AND project.config.ts has a \`sanity.projectId\` set.
let sanityClient: SanityClientFactory | null = null;
let userConfig: SanityConfig = {};

try {
  const mod = await import("@sanity/client");
  sanityClient =
    (mod as { createClient?: SanityClientFactory }).createClient ||
    (mod as { default?: { createClient?: SanityClientFactory } }).default
      ?.createClient ||
    (mod.default as SanityClientFactory);
} catch {
  // @sanity/client is not installed — that's fine; static pages still work.
}

try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const cfgMod = await import("../project.config");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cfg = cfgMod.default?.sanity || {};
  userConfig = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    projectId: cfg.projectId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    dataset: cfg.dataset,
  };
} catch {
  // No project config; fall back to env vars below.
}

/**
 * Build the page + media manifest for the build pipeline.
 *
 * Right now this scaffolds two blank routes: \`/\` (home) and \`/about\`.
 * Both have empty \`data\` and no \`media\` entries. Add real content by:
 *
 *   1. Wiring the Sanity client (uncomment the block below) and pushing
 *      page entries from your GROQ query results, OR
 *   2. Calling \`localPicture()\` to attach static images to a page entry.
 *
 * Each \`PageEntry\` must have:
 *   - \`path\`:     URL the route plugin renders to (e.g. "/", "/work/foo")
 *   - \`key\`:      page key matching the \`src/routes/<key>/\` folder name
 *   - \`title\`:    \`<title>\` for the rendered HTML shell
 *   - \`template\`: \`src/routes/<template>/\` folder used to render this entry
 *                   (usually same as \`key\`; differs only for CMS templates)
 *   - \`data\`:     object passed to Mustache when rendering the template
 *
 * Each \`media[path]\` entry tells the GPU scene system which textures to
 * load for that route. Leave it empty if the page has no GPU planes.
 */
export async function loadSanityContent(
  opts: SanityContentOptions = {},
): Promise<SanityContentResult> {
  let { dataset, projectId, token, apiVersion } = opts;

  dataset = dataset || userConfig.dataset || process.env.SANITY_DATASET;
  projectId = projectId || userConfig.projectId || process.env.SANITY_PROJECT_ID;
  token = token || userConfig.token || process.env.SANITY_READ_TOKEN;
  apiVersion =
    apiVersion ||
    userConfig.apiVersion ||
    process.env.SANITY_API_VERSION ||
    "2023-10-10";

  const pages: PageEntry[] = [];
  const media: Record<string, MediaEntry> = {};

  // ── Sanity client — uncomment to start fetching from your dataset ────────
  //
  // if (sanityClient && projectId && dataset) {
  //   const client = sanityClient({
  //     projectId,
  //     dataset,
  //     apiVersion: apiVersion ?? "2023-10-10",
  //     useCdn: !token,
  //     ...(token ? { token } : {}),
  //   });
  //
  //   // Fetch your GROQ query and build PageEntry/MediaEntry objects.
  //   //
  //   //   const docs = await client.fetch<MyDocType[]>(myQuery);
  //   //   for (const doc of docs) {
  //   //     pages.push({
  //   //       path: \`/work/\${doc.slug}\`,
  //   //       key: \`case-\${doc.slug}\`,
  //   //       title: doc.title,
  //   //       template: "case-study",
  //   //       data: { ... },
  //   //     });
  //   //   }
  // }

  // ─────────────────────────────────────────────────────────────────────────
  // Home page — blank scaffold. Add Mustache data via \`data: { ... }\`. Set
  // \`media["/"]\` if the home page binds GPU planes.
  // ─────────────────────────────────────────────────────────────────────────
  pages.push({
    path: "/",
    key: "home",
    title: "Home",
    template: "home",
    data: {},
  });

  // ─────────────────────────────────────────────────────────────────────────
  // About page — blank scaffold.
  // ─────────────────────────────────────────────────────────────────────────
  pages.push({
    path: "/about",
    key: "about",
    title: "About",
    template: "about",
    data: {},
  });

  return { pages, media };
}
`;
  fs.writeFileSync(path.join(ROOT, "scripts/sanity-content.ts"), ts);
  console.log("  rewrote: scripts/sanity-content.ts");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrate the full init flow. Each step is named and printed so you can
 * see what's happening as it runs. Steps are sequential (not parallel)
 * because later steps depend on the freshly-written config from step A.
 */
async function main(): Promise<void> {
  console.log("\n🔧 Tamahagane init — fresh start");
  console.log("This script will overwrite project.config.ts, wipe src/routes/");
  console.log("(except partials/), wipe src/styles/pages/, and rewrite a");
  console.log("handful of config-derived files. Public assets are untouched.\n");

  // A. Walk through project.config.ts + cleanup toggles
  const current = await loadConfig();
  const { config: next, removeSandbox } = await walkthroughConfig(current);
  writeConfig(next);

  // B + C. Clear routes, page styles, learnings, and GSD planning state.
  // `clearSandbox()` is opt-in — only runs if the walkthrough toggle was set.
  console.log("\nClearing routes, page styles, learnings, and .planning/…");
  clearRoutes();
  clearPageStyles();
  clearLearnings();
  clearPlanning();
  if (removeSandbox) clearSandbox();

  // D. Scaffold blank home + about pages
  console.log("\nScaffolding home + about…");
  scaffoldHome();
  scaffoldAbout();

  // E + F. Rewrite nav and pages.scss
  console.log("\nRewriting partials and aggregate stylesheets…");
  rewriteNav(next);
  rewritePagesScss();

  // G + H + I. Regenerate config-derived files
  console.log("\nRegenerating config-derived files…");
  rewriteColors(next);
  rewriteVariables(next);
  rewriteMeta(next);
  rewritePackageJson(next);

  // J. Rewrite sanity-content.ts as a blank scaffold
  console.log("\nRewriting scripts/sanity-content.ts…");
  rewriteSanityContent();

  console.log("\n✅ Init complete.");
  console.log("   Next: pnpm --filter tamahagane-fe dev\n");
}

main().catch((err) => {
  console.error("Init failed:", err);
  process.exit(1);
});
