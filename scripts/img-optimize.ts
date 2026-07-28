/**
 * Image optimization build script for Tamahagane project assets.
 *
 * Generates responsive AVIF, WebP, and JPEG variants from source JPEGs at
 * three widths (640, 1024, 1920). These optimized variants are used by the
 * frontend to serve the smallest image format each browser supports.
 *
 * Usage: pnpm img-optimize
 *
 * Output:
 *   apps/fe/public/assets/images/{n}-{width}w.avif   — AVIF variants (smallest)
 *   apps/fe/public/assets/images/{n}-{width}w.webp   — WebP variants
 *   apps/fe/public/assets/images/{n}-{width}w.jpg    — JPEG variants (fallback)
 *
 * Quality / effort tradeoffs:
 *   AVIF:  quality 65, effort 4  — effort 4 is the sweet spot: ~3x faster than
 *          effort 9 with negligible quality loss at quality 65. AVIF at q65
 *          is typically 40-60% smaller than JPEG at q85 for the same content.
 *   WebP:  quality 80            — standard quality level; ~25-35% smaller than
 *          equivalent JPEG for photographic content.
 *   JPEG:  quality 85, progressive — highest fallback quality; progressive
 *          rendering improves perceived performance on slow connections.
 *
 * Idempotency:
 *   Each output file is skipped if it already exists AND its mtime is newer
 *   than the source file. Re-running the script after images change will only
 *   regenerate stale variants.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve an absolute path relative to the monorepo root. */
const __dirnameResolved = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirnameResolved, "..");
const IMAGES_DIR = path.join(
  ROOT,
  "apps",
  "fe",
  "public",
  "assets",
  "images",
);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Output widths in pixels for responsive variants. */
const WIDTHS: number[] = [640, 1024, 1920];

/**
 * Describes an output format variant to generate.
 * Each source JPEG gets one variant per (width × format) combination.
 */
interface FormatConfig {
  /** File extension (without leading dot) */
  ext: string;
  /** sharp format-specific options */
  options: Parameters<sharp.Sharp["avif"]>[0] | Parameters<sharp.Sharp["webp"]>[0] | Parameters<sharp.Sharp["jpeg"]>[0];
  /** sharp method name to call */
  method: "avif" | "webp" | "jpeg";
}

/**
 * All output formats and their encoding parameters.
 * AVIF is listed first: it is the most aggressive in size reduction and
 * the most compute-intensive, so failures there don't block WebP/JPEG.
 */
const FORMATS: FormatConfig[] = [
  {
    ext: "avif",
    method: "avif",
    options: { quality: 65, effort: 4 },
  },
  {
    ext: "webp",
    method: "webp",
    options: { quality: 80 },
  },
  {
    ext: "jpg",
    method: "jpeg",
    options: { quality: 85, progressive: true },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether an output file is fresh relative to its source.
 * Returns true when the output exists AND its mtime is newer than the source.
 * Used to skip regenerating variants that are already up-to-date.
 *
 * @param srcPath - Absolute path to the source JPEG
 * @param outPath - Absolute path to the candidate output file
 * @returns true if the output is already up-to-date, false if it needs generation
 */
function isFresh(srcPath: string, outPath: string): boolean {
  if (!fs.existsSync(outPath)) return false;
  const srcMtime = fs.statSync(srcPath).mtimeMs;
  const outMtime = fs.statSync(outPath).mtimeMs;
  return outMtime >= srcMtime;
}

// ---------------------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------------------

/**
 * Processes a single source JPEG, generating all width × format variants.
 * Skips outputs that are already fresh. Logs progress per output file.
 * On sharp errors, logs the error and continues — partial output is acceptable
 * (the browser will fall back to the next available format).
 *
 * @param srcPath  - Absolute path to the source JPEG (e.g. .../1.jpg)
 * @param filename - Source filename stem (e.g. "1")
 * @param current  - 1-based index of this image in the batch (for progress)
 * @param total    - Total number of source images being processed
 * @returns Object counting generated and skipped variants for this source image
 */
async function processImage(
  srcPath: string,
  filename: string,
  current: number,
  total: number,
): Promise<{ generated: number; skipped: number }> {
  console.log(`[img-optimize] Processing ${filename}.jpg (${current}/${total})`);

  let generated = 0;
  let skipped = 0;

  for (const width of WIDTHS) {
    for (const fmt of FORMATS) {
      const outName = `${filename}-${width}w.${fmt.ext}`;
      const outPath = path.join(IMAGES_DIR, outName);

      if (isFresh(srcPath, outPath)) {
        console.log(`[img-optimize] Skipping ${outName} (already exists)`);
        skipped++;
        continue;
      }

      try {
        // Chain: read source -> resize to width (preserve aspect ratio) -> encode
        const pipeline = sharp(srcPath).resize({ width });

        if (fmt.method === "avif") {
          await pipeline.avif(fmt.options as Parameters<sharp.Sharp["avif"]>[0]).toFile(outPath);
        } else if (fmt.method === "webp") {
          await pipeline.webp(fmt.options as Parameters<sharp.Sharp["webp"]>[0]).toFile(outPath);
        } else {
          await pipeline.jpeg(fmt.options as Parameters<sharp.Sharp["jpeg"]>[0]).toFile(outPath);
        }

        console.debug(`[img-optimize] Wrote ${outName}`);
        generated++;
      } catch (err) {
        console.error(`[img-optimize] Error generating ${outName}:`, err);
      }
    }
  }

  return { generated, skipped };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Scans apps/fe/public/assets/images/ for source JPEGs (files matching
 * /^\d+\.jpg$/ — only numbered originals, not already-resized variants),
 * then generates all responsive variants sequentially.
 *
 * Sequential processing is chosen over parallel to avoid overwhelming the
 * CPU with simultaneous AVIF encoders, which are compute-intensive.
 *
 * Exits with code 1 if no source images are found or the directory is missing.
 */
async function main(): Promise<void> {
  console.log("[img-optimize] Starting image optimization pipeline");
  console.debug(`[img-optimize] Images directory: ${IMAGES_DIR}`);

  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`[img-optimize] Directory not found: ${IMAGES_DIR}`);
    process.exit(1);
  }

  // Discover source JPEGs: only files matching /^\d+\.jpg$/ (numbered originals)
  const allFiles = fs.readdirSync(IMAGES_DIR);
  const sourceFiles = allFiles
    .filter((f) => /^\d+\.jpg$/.test(f))
    .sort((a, b) => {
      // Sort numerically (1.jpg, 2.jpg, ..., 12.jpg — not lexicographic)
      return parseInt(a, 10) - parseInt(b, 10);
    });

  if (sourceFiles.length === 0) {
    console.error("[img-optimize] No source JPEGs found in", IMAGES_DIR);
    process.exit(1);
  }

  console.debug(`[img-optimize] Found ${sourceFiles.length} source images`);

  let totalGenerated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < sourceFiles.length; i++) {
    const file = sourceFiles[i]!;
    const basename = path.basename(file, ".jpg");
    const srcPath = path.join(IMAGES_DIR, file);

    const { generated, skipped } = await processImage(
      srcPath,
      basename,
      i + 1,
      sourceFiles.length,
    );

    totalGenerated += generated;
    totalSkipped += skipped;
  }

  console.log(
    `[img-optimize] Done: ${totalGenerated} generated, ${totalSkipped} skipped`,
  );
}

// Run via an async IIFE to work with both ESM and CJS tsx modes (Phase 11 decision)
main().catch((err) => {
  console.error("[img-optimize] Fatal error:", err);
  process.exit(1);
});
