/**
 * debug.ts — Colorized console.debug helpers for the Tamahagane subsystems.
 *
 * Each subsystem gets a distinct color so console output is scannable at a
 * glance. Uses CSS %c formatting which works in all modern browser devtools.
 *
 * Usage:
 *   import { dbg } from "@app/debug";
 *   dbg.ctrl("navigation complete", path);
 *   dbg.page("init", key);
 */

/** CSS style string for a colored, bold prefix label */
const s = (color: string): string =>
  `color:${color};font-weight:bold`;

/** Reset style — applied to the message text after the prefix */
const r = "color:inherit;font-weight:normal";

/**
 * Create a prefixed debug logger with a specific color.
 *
 * @param prefix - The bracketed label (e.g. "[ctrl]")
 * @param color  - CSS color for the prefix
 */
function make(prefix: string, color: string) {
  return (...args: unknown[]): void => {
    const msg = args.length > 0 && typeof args[0] === "string" ? args.shift() as string : "";
    console.debug(`%c${prefix}%c ${msg}`, s(color), r, ...args);
  };
}

export const dbg = {
  /** Navigation controller — blue */
  ctrl:       make("[ctrl]",              "#3b82f6"),
  /** Controller sub-events — lighter blue */
  ctrlNav:    make("[ctrl:navigate]",     "#60a5fa"),
  ctrlRoute:  make("[ctrl:route]",        "#60a5fa"),
  ctrlTitle:  make("[ctrl:title]",        "#60a5fa"),
  ctrlHistory:make("[ctrl:history]",      "#60a5fa"),
  ctrlDom:    make("[ctrl:dom]",          "#60a5fa"),
  ctrlNavLink:make("[ctrl:nav]",          "#60a5fa"),

  /** Transition manager — amber/orange */
  tm:         make("[transition-manager]","#f59e0b"),
  tmHooks:    make("[transition-manager:hooks]", "#fbbf24"),
  tmOut:      make("[transition-manager:out]",   "#f59e0b"),
  tmIn:       make("[transition-manager:in]",    "#f59e0b"),

  /** Transition animation — orange */
  txOut:      make("[transition:out]",    "#fb923c"),
  txIn:       make("[transition:in]",     "#fb923c"),

  /** Transition registry — dim orange */
  registry:   make("[transition-registry]", "#d97706"),

  /** Page lifecycle — green */
  page:       make("[page]",              "#22c55e"),
  pageOut:    make("[page:out]",          "#4ade80"),
  pageIn:     make("[page:in]",           "#4ade80"),
  pageScroll: make("[page:scroll]",       "#4ade80"),
  pageMgr:    make("[page-manager]",      "#16a34a"),
  pageAuto:   make("[page-manager:auto]", "#16a34a"),

  /** GPU / rendering — purple */
  gpu:        make("[gpu]",               "#a855f7"),
  gpuHook:    make("[gpu:hook]",          "#c084fc"),

  /** Boot sequence — cyan */
  boot:       make("[boot]",              "#06b6d4"),
  bootPhase:  (n: number, ...args: unknown[]): void => {
    const msg = args.length > 0 && typeof args[0] === "string" ? args.shift() as string : "";
    console.debug(`%c[boot:phase${n}]%c ${msg}`, s("#06b6d4"), r, ...args);
  },

  /** Intro animation — teal */
  intro:      make("[intro]",             "#14b8a6"),
  introInit:  make("[intro:init]",        "#14b8a6"),
  introPlay:  make("[intro:play]",        "#14b8a6"),
  introDone:  make("[intro:done]",        "#14b8a6"),
  introProgress: make("[intro:progress]", "#14b8a6"),

  /** Canvas visibility — pink */
  canvas:     make("[canvas:visibility]", "#ec4899"),
};
