/**
 * context.ts — Global application state singleton.
 *
 * App is the shared mutable state object that every subsystem reads and writes.
 * It holds route state, scroller, page manager, and the navigation controller.
 * Defined as a plain object (not a class) so any module can import { App } and
 * access the same live reference without constructor wiring.
 *
 * Types are co-located here to keep the state shape and its type definitions in
 * one file. Subsystem-specific "Like" interfaces (PageManagerLike) provide
 * minimal contracts that avoid circular imports between context and the concrete
 * implementations.
 *
 * All WebGPU types and the GpuInstance interface have been removed — rendering
 * is DOM-only. The GPU engine (tatara/katachi) has been fully removed from this
 * project.
 */

import type { Ctrl } from "@app/controller";

import type { NativeScroller } from "kido/native-scroller";
import type { Scroller } from "kido/scroller";


/** A URL pathname string used as a route key in App.config.routes and caches. */
export type RouteUrl = string;

/** The page key for a route (e.g. "home", "about"), or null for unknown routes. */
export type RoutePageKey = string | null;

/** A snapshot of a single route — url + resolved page key. */
export interface RouteSnapshot {
  url: RouteUrl | null;
  page: RoutePageKey;
}

/** Previous and current route snapshots — updated on every navigation by Ctrl. */
export interface RouteState {
  old: RouteSnapshot;
  new: RouteSnapshot;
}

/** Cached page data for a route — title for document.title, html for DOM insertion. */
export interface RouteCacheEntry {
  title?: string;
  html?: string;
}

/**
 * Persistent UI state for the home page. Lives on App so it survives across
 * SPA navigations (HomePage is reinstantiated on every visit but App is a
 * module-level singleton — mode is preserved without sessionStorage).
 */
export type HomeMode = "text" | "image";

/** Active taxonomy filter on the home page. `"all"` shows every grid cell;
 *  any other value is a taxonomy `_id` and hides cells outside that taxonomy. */
export type HomeFilter = "all" | string;

export interface HomeUiState {
  mode: HomeMode;
  filter: HomeFilter;
}

/** Minimal interface for the page manager — avoids circular imports */
export interface PageManagerLike {
  beforeOut: () => Promise<void>;
  afterIn: () => Promise<void>;
  registerFromRoutes: () => void;
  resize?: () => void;
}

/** Minimal interface for sections — avoids circular imports */
export interface SectionsLike {
  resize?: () => void;
}

/**
 * The shape of the global App singleton. Every field is mutable at runtime —
 * subsystems write to App during boot, navigation, and resize. The interface
 * is defined here so TypeScript can enforce field types across all consumers.
 */
export interface AppState {
  config: { routes: Record<RouteUrl, string> };
  route: RouteState;
  is: Record<string, boolean>;
  was: Record<string, boolean>;
  cache: Record<RouteUrl, RouteCacheEntry>;
  mutating: boolean;
  container: HTMLElement | null;
  app: HTMLElement | null;
  win: { w: number; h: number };
  target: unknown;
  scroller: Scroller | NativeScroller | null;
  sections: SectionsLike | null;
  pageManager: PageManagerLike | null;
  /**
   * The installed navigation controller. Set after boot phase 2 completes
   * (installController() returns). Null during startup and on server-side.
   */
  ctrl: Ctrl | null;
  introDone: boolean;
  revealLocked: boolean;
  /** Persistent home-page UI state (text/image mode). Survives navigation. */
  home: HomeUiState;
  data: Record<string, never>;
}

/**
 * The concrete App singleton instance. All fields start null/empty and are
 * populated progressively during the boot sequence in Application.init().
 */
const context: AppState = {
  config: { routes: Object.create(null) as Record<RouteUrl, string> },
  route: {
    old: { url: null, page: null },
    new: { url: null, page: null },
  },
  is: Object.create(null) as Record<string, boolean>,
  was: Object.create(null) as Record<string, boolean>,
  cache: Object.create(null) as Record<RouteUrl, RouteCacheEntry>,
  mutating: false,
  app: null,
  container: null,
  win: { w: 0, h: 0 },
  target: null,
  scroller: null,
  sections: null as SectionsLike | null,
  pageManager: null as PageManagerLike | null,
  ctrl: null,
  introDone: false,
  revealLocked: false,
  home: { mode: "text", filter: "all" },
  data: Object.create(null) as Record<string, never>,
};

/** The global App singleton — import { App } from "@app/context" in any module. */
export const App: AppState = context;

// Expose App globally for debugging (dev only)
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).App = App;
}
