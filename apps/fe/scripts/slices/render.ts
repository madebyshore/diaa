/**
 * Build-time slice renderer — loads the slice partial templates and turns
 * a raw `slices[]` array from Sanity into a single HTML string ready to
 * splice into a page template via triple-mustache.
 *
 * Each slice is rendered with the union of:
 *   - the global partials directory (`partials/`) so {{> picture}} etc work
 *   - the slice partials directory (`partials/slices/`)
 *
 * Unknown slice types log a warning and are skipped — that way an
 * out-of-date frontend doesn't crash the whole build when a new slice
 * type lands in Sanity before the FE catches up.
 */

import fs from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import log from "../utils/logger";
import { sliceByName } from "./index";
import type { RawSlice, SliceContext } from "./types";

/** Path to the routes partials directory used by routes-plugin. */
const PARTIALS_DIR = path.resolve("src/routes/partials");
const SLICE_PARTIALS_DIR = path.join(PARTIALS_DIR, "slices");

let cachedPartials: Record<string, string> | null = null;

/**
 * Load all top-level partials + every slice partial into a single name→content
 * map. Cached for the lifetime of the build process; refreshed on each
 * dev-server tick because `loadPartials()` in routes-plugin already invalidates
 * its own cache on watcher events and the renderer is called fresh from
 * loadSanityContent().
 */
function loadAllPartials(): Record<string, string> {
  if (cachedPartials) return cachedPartials;
  const map: Record<string, string> = {};

  // Top-level partials (nav, picture, meta, intro, canvas, grid, …)
  if (fs.existsSync(PARTIALS_DIR)) {
    for (const f of fs.readdirSync(PARTIALS_DIR)) {
      if (!/\.(html|mustache)$/i.test(f)) continue;
      const name = f.replace(/\.(html|mustache)$/i, "");
      map[name] = fs.readFileSync(path.join(PARTIALS_DIR, f), "utf8");
    }
  }

  // Slice partials — registered under their bare filename so a slice's
  // `template` field matches one of these keys.
  if (fs.existsSync(SLICE_PARTIALS_DIR)) {
    for (const f of fs.readdirSync(SLICE_PARTIALS_DIR)) {
      if (!/\.(html|mustache)$/i.test(f)) continue;
      const name = f.replace(/\.(html|mustache)$/i, "");
      map[name] = fs.readFileSync(path.join(SLICE_PARTIALS_DIR, f), "utf8");
    }
  }

  cachedPartials = map;
  return map;
}

/** Force the partials cache to drop — used by dev-server watcher integration. */
export function resetPartialCache(): void {
  cachedPartials = null;
}

/**
 * Render a single slice to HTML. Returns an empty string (and logs) when
 * the slice's `_type` is not in the registry.
 */
export function renderSlice(slice: RawSlice, ctx: SliceContext): string {
  const def = sliceByName[slice._type];
  if (!def) {
    log.warn("slices", `unknown slice type "${slice._type}" — skipping`);
    return "";
  }
  const partials = loadAllPartials();
  const tpl = partials[def.template];
  if (!tpl) {
    log.warn(
      "slices",
      `missing template "${def.template}" for slice "${def.name}"`
    );
    return "";
  }
  const data = def.resolve(slice, ctx);
  return Mustache.render(tpl, data, partials);
}

/**
 * Render every slice in a page's `slices[]` array. Returns the concatenated
 * HTML — pages splice this into their template via `{{{slicesHtml}}}`.
 */
export function renderSlices(slices: RawSlice[] | undefined, ctx: SliceContext): string {
  if (!slices || slices.length === 0) return "";
  return slices.map((s) => renderSlice(s, ctx)).join("\n");
}

/**
 * Collect the ordered asset URLs every slice in `slices[]` renders as a `_g`
 * GPU plane — the order matches the DOM order the slice partials emit their
 * `{{> picture}}` figures, so `media.main[N]` lines up with the Nth `_g` on
 * the page. Slices without a `media` resolver (image-less, e.g. Text) and
 * null URLs (absent images, which render no `_g`) are dropped, keeping the
 * list 1:1 with the figures that actually exist.
 */
export function collectSliceMedia(slices: RawSlice[] | undefined): string[] {
  if (!slices || slices.length === 0) return [];
  const urls: Array<string | null> = [];
  for (const slice of slices) {
    const def = sliceByName[slice._type];
    if (!def?.media) continue;
    urls.push(...def.media(slice));
  }
  return urls.filter((u): u is string => !!u);
}
