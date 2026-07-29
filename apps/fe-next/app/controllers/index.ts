/**
 * controllers/index.ts — barrel export for the page-controller layer.
 * Mirrors the anim-plan's target file tree convention (a barrel per
 * directory) so callers can `import { ... } from "~/controllers"` instead of
 * reaching into individual files. controllers/home.ts (Phase 5b) joins this
 * barrel once the home controller replacing BaseController lands.
 */
export { BaseController, type PageController, type ScrollEvent } from "./page-controller";
export { createRichTextController } from "./rich-text-page";
export { createDetailController } from "./detail";
