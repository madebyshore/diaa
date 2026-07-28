/**
 * Shared type definitions for the controller subsystem.
 *
 * Also re-exports IntroAnimation from engine/boot/intro so that
 * Application.init() can type the intro reference without importing the
 * concrete class (avoids pulling kido/anima into the boot module graph
 * at type-check time, and allows test doubles).
 */

// Re-export the IntroAnimation interface so callers can import it from
// the controller types barrel rather than reaching into engine/boot.
export type { IntroAnimation } from "@engine/boot/intro";

/**
 * Shared type definitions for the controller subsystem.
 *
 * These contracts define how the Ctrl orchestrator and TransitionManager
 * communicate at choreography moments during a page transition. The callback
 * pattern decouples DOM operations (inserting/removing pages) from the
 * animation lifecycle — TransitionManager calls these at the right moment,
 * Ctrl supplies the implementations.
 */

/**
 * Callback set that Ctrl installs before a transition begins.
 *
 * - `insertNew`: called by TransitionManager when it is safe to insert the
 *   incoming page element into the DOM (typically between the out and in
 *   phases so the element is reachable but not yet visible).
 * - `removeOld`: called by TransitionManager when it is safe to remove the
 *   outgoing page element from the DOM (typically after the in animation
 *   completes so there is no visual pop).
 * - `update`: called by TransitionManager after the DOM has been updated —
 *   used to trigger scroller/GPU state refresh on the new page.
 */
export interface TransitionCallbacks {
  /** Insert the incoming page element into the DOM at the appropriate moment. */
  insertNew: () => void;
  /** Remove the outgoing page element from the DOM after it has animated out. */
  removeOld: () => void;
  /** Refresh any dependent subsystems (scroller, GPU scene) after DOM update. */
  update: () => void;
}

/**
 * A normalised URL string (pathname only, no query string or hash).
 *
 * Using a branded alias makes function signatures self-documenting and
 * helps prevent raw `string` values from leaking into URL-specific slots.
 */
export type NormalizedUrl = string;

/**
 * Page callbacks interface — the contract a page module must expose so that
 * the controller can hook into its lifecycle.
 *
 * Mirrors the PageManagerLike interface in context.ts but is scoped to the
 * controller subsystem so downstream plans can extend it without touching the
 * global AppState type.
 */
export interface PageLifecycleCallbacks {
  /** Called before the outgoing page animates out. Allows pages to clean up. */
  beforeOut: () => Promise<void>;
  /** Called after the incoming page has animated in. Used for post-mount setup. */
  afterIn: () => Promise<void>;
}

