/**
 * global.d.ts — ambient Window augmentations for the preview runtime.
 *
 * `__PREVIEW__` and `__SANITY_STUDIO_URL__` are stamped onto the page by
 * `injectPreviewHtml()` (apps/fe/scripts/preview/inject.ts) — they are never
 * present in a production build. `maybeEnableVisualEditing()`
 * (src/app/preview/visual-editing.ts) reads both to decide whether to load
 * `@sanity/visual-editing` at all.
 */

interface Window {
  /** True only on preview-deployment HTML — gates the visual-editing dynamic import. */
  __PREVIEW__?: boolean;
  /** Origin (or base path) of the Sanity Studio hosting Presentation. */
  __SANITY_STUDIO_URL__?: string;
}
