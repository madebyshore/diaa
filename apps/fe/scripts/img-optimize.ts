/**
 * Image Optimization Build Script
 *
 * Reads source images from public/assets/images/ and generates responsive
 * AVIF/WebP/JPEG variants at 640, 1024, and 1920px widths into dist/assets/images/.
 *
 * Run as a standalone pre-build step (before vite build) so the optimized
 * variants exist in dist/ before Vite copies public/ assets. Vite's public/
 * copy will place the originals; this script adds the variants alongside them.
 *
 * Can also be run standalone: `tsx scripts/img-optimize.ts`
 *
 * Requires sharp.
 */

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import log from "./utils/logger.js";

/** Widths to generate for each source image */
const WIDTHS = [640, 1024, 1920] as const;

/** Output formats with quality settings */
const FORMATS = [
  { ext: "avif", opts: { quality: 65 } },
  { ext: "webp", opts: { quality: 75 } },
  { ext: "jpg", opts: { quality: 80 } },
] as const;

/**
 * Generates responsive image variants from a single source file.
 * Creates width x format combinations (e.g. 3 widths x 3 formats = 9 files).
 *
 * @param srcPath - Absolute path to the source image
 * @param outDir - Directory to write optimized variants into
 * @param basename - Filename without extension (e.g. "1", "10")
 */
async function processImage(
  srcPath: string,
  outDir: string,
  basename: string,
): Promise<number> {
  const img = sharp(srcPath);
  const meta = await img.metadata();
  let count = 0;

  for (const width of WIDTHS) {
    // Resize to target width. If source is smaller, sharp upscales —
    // acceptable for small differences (e.g. 1707→1920). The HTML
    // srcsets always reference all three widths.
    const resized = sharp(srcPath).resize(width);

    for (const fmt of FORMATS) {
      const outName = `${basename}-${width}w.${fmt.ext}`;
      const outPath = path.join(outDir, outName);

      if (fmt.ext === "avif") {
        await resized.clone().avif(fmt.opts).toFile(outPath);
      } else if (fmt.ext === "webp") {
        await resized.clone().webp(fmt.opts).toFile(outPath);
      } else {
        await resized.clone().jpeg(fmt.opts).toFile(outPath);
      }
      count++;
    }
  }

  return count;
}

/**
 * Main entry — runs image optimization as a standalone script.
 * Output goes to dist/assets/images/ so variants are ready before vite build
 * copies public/ assets into the same directory.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  const srcDir = path.resolve(root, "public/assets/images");
  const destDir = path.resolve(root, "dist/assets/images");

  if (!fs.existsSync(srcDir)) {
    log.warn("images", "No source images found at public/assets/images/");
    return;
  }

  // Find source images (jpg/png/webp originals — not already-optimized variants)
  const sources = fs
    .readdirSync(srcDir)
    .filter((f) => /^\d+\.(jpg|jpeg|png|webp)$/i.test(f));

  if (sources.length === 0) {
    log.warn("images", "No source images to optimize");
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  log.section("Images");
  log.line("images", `optimizing ${sources.length} source images`);

  const start = Date.now();

  // Process images in parallel (sharp handles its own thread pool)
  const results = await Promise.all(
    sources.map(async (file) => {
      const basename = path.parse(file).name;
      const srcPath = path.join(srcDir, file);
      return processImage(srcPath, destDir, basename);
    }),
  );

  const totalFiles = results.reduce((sum, n) => sum + n, 0);
  log.line("images", `generated ${totalFiles} variants`);
  log.time("images", Date.now() - start);
}

main().catch((err) => {
  console.error("[images] Fatal error:", err);
  process.exit(1);
});
