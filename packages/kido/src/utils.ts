import { getFrameRatio } from "./raf";

/**
 * Clamp a number between a minimum and maximum value (inclusive).
 *
 * Used throughout kido to keep interpolated values within valid ranges
 * (e.g. progress values in [0, 1], opacity in [0, 1]).
 */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Linear interpolation between `a` and `b` at factor `t`.
 *
 * t=0 returns a, t=1 returns b. Values outside [0,1] extrapolate linearly.
 * Prefer `aLerp` (alpha-weighted form) for audio/animation blending where
 * precision near the endpoints matters more.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Alpha-weighted linear interpolation: a*(1-t) + b*t.
 *
 * Numerically equivalent to `lerp` but avoids floating-point drift when
 * a and b are large and t is close to 1. Preferred for animation blend weights.
 */
export function aLerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/**
 * Inverse lerp — given value `i` within the range [t, s], return the
 * normalised factor in [0, 1].
 *
 * Useful for mapping a raw DOM value (e.g. scroll position) into a [0,1]
 * progress value for easing or animation timelines.
 */
export function iLerp(t: number, s: number, i: number): number {
  return clamp((i - t) / (s - t), 0, 1);
}

/**
 * Frame-rate–independent exponential smoothing (damping).
 *
 * Drives `current` toward `target` each frame at a rate governed by `lambda`
 * (0 = no movement, ~0.12 = snappy follow, 0.999999 = instant snap).
 * Uses the elapsed frame ratio from `getFrameRatio` so the feel is
 * consistent across different display refresh rates.
 */
export function damp(current: number, target: number, lambda = 0.12): number {
  const ratio = Math.max(getFrameRatio(), 0);
  const strength = Math.min(Math.max(lambda, 0), 0.999999);
  if (ratio <= 0 || strength <= 0) return current;
  const weight = 1 - Math.exp(Math.log(1 - strength) * ratio);
  return aLerp(current, target, weight);
}

/**
 * Round a number to `p` decimal places (default: 3).
 *
 * Uses Number.EPSILON correction to avoid IEEE 754 rounding artifacts
 * (e.g. 1.005 rounding to 1.00 instead of 1.01).
 */
export function round(val: number, p = 3): number {
  const m = Math.pow(10, p | 0);
  return Math.round((val + Number.EPSILON) * m) / m;
}

/**
 * Return true when the absolute difference between `a` and `b` is non-zero
 * at the given decimal `precision` (default: 3).
 *
 * Used in animation loops to detect when a value has settled close enough
 * to its target that further updates are imperceptible.
 */
export function unequal(a: number, b: number, precision = 3): boolean {
  return round(Math.abs(a - b), precision) !== 0;
}

/**
 * Apply a GPU-composited translate3d transform to an element.
 *
 * Writes directly to `el.style.transform` using the three-argument form so
 * the browser can promote the element to its own compositor layer and avoid
 * layout/paint during animation. The default unit is "%" for percentage-based
 * slide transitions; pass "px" for pixel-based transforms.
 */
export function translate3d(
  el: HTMLElement,
  x: number,
  y: number,
  unit = "%"
): void {
  if (!el?.style) return;
  const suffix = unit ?? "%";
  el.style.transform = `translate3d(${x}${suffix},${y}${suffix},0)`;
}

/**
 * Build a CSS cubic-bezier easing function from four control-point coordinates.
 *
 * Implements the same Newton–Raphson solver used in browser CSS animation
 * engines. The returned function maps a linear time value t ∈ [0,1] to the
 * corresponding eased value, clamped to [0,1].
 *
 * All entries in the `Ease` map are built with this function. Consumers can
 * also call `ease4([x1,y1,x2,y2])` to build a one-off easing from an array.
 *
 * @param x1 - First control point x-coordinate (0–1).
 * @param y1 - First control point y-coordinate.
 * @param x2 - Second control point x-coordinate (0–1).
 * @param y2 - Second control point y-coordinate.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): (t: number) => number {
  function A(aA1: number, aA2: number) {
    return 1.0 - 3.0 * aA2 + 3.0 * aA1;
  }

  function B(aA1: number, aA2: number) {
    return 3.0 * aA2 - 6.0 * aA1;
  }

  function C(aA1: number) {
    return 3.0 * aA1;
  }

  function calcBezier(aT: number, aA1: number, aA2: number) {
    return ((A(aA1, aA2) * aT + B(aA1, aA2)) * aT + C(aA1)) * aT;
  }

  function getSlope(aT: number, aA1: number, aA2: number) {
    return 3.0 * A(aA1, aA2) * aT * aT + 2.0 * B(aA1, aA2) * aT + C(aA1);
  }

  function getTForX(aX: number) {
    let aGuessT = aX;
    for (let i = 0; i < 4; ++i) {
      const currentSlope = getSlope(aGuessT, x1, x2);
      if (currentSlope === 0) return aGuessT;
      const currentX = calcBezier(aGuessT, x1, x2) - aX;
      aGuessT -= currentX / currentSlope;
    }
    return aGuessT;
  }
  return function bezier(t: number): number {
    if (x1 === y1 && x2 === y2) return t;
    const x = clamp(t, 0, 1);
    const paramT = getTForX(x);
    return clamp(calcBezier(paramT, y1, y2), 0, 1);
  };
}

/**
 * Named easing functions, each built from a cubic-bezier control-point set.
 *
 * Consumers can reference entries by name (e.g. `e: "codrops"` in an Anima
 * config) or use `ease4([x1,y1,x2,y2])` for raw arrays.
 */
export const Ease: Record<string, (t: number) => number> = {
  linear: (t: number) => t,
  o6: cubicBezier(0.16, 1.0, 0.3, 1.0),
  io6: cubicBezier(0.87, 0.0, 0.13, 1.0),
  oC: cubicBezier(0.0, 0.55, 0.45, 1.0),
  oQ: cubicBezier(0.22, 1, 0.36, 1),
  o2: cubicBezier(0.5, 1.0, 0.89, 1.0),
  i1: cubicBezier(0.55, 0.055, 0.675, 0.19),
  i3: cubicBezier(0.55, 0.085, 0.68, 0.53),
  o1: cubicBezier(0.215, 0.61, 0.355, 1.0),
  o3: cubicBezier(0.25, 0.46, 0.45, 0.94),
  /**
   * Codrops CustomEase approximation — single cubic-bezier fit of the SVG path
   * used in the Codrops page transition demo:
   *   M0,0 C0.38,0.05 0.48,0.58 0.65,0.82 0.82,1 1,1 1,1
   *
   * The original path is a compound curve (two cubic segments). This is a
   * single-segment approximation that preserves the characteristic feel:
   * slow initial acceleration, sharp mid-section speed, hard deceleration
   * into the endpoint.
   *
   * This should be tuned empirically against the live Codrops demo at:
   *   https://tympanus.net/codrops/2023/...
   * Reference: INFR-04 (kido package updated to support new architecture)
   */
  codrops: cubicBezier(0.38, 0.05, 0.65, 0.82),
  /**
   * "Slow" settle — least-squares cubic-bezier fit of a Figma spring
   * (stiffness 80, damping 20, mass 1) sampled over its 600ms interaction
   * window. Slightly overdamped (ζ ≈ 1.12): brisk initial motion that decays
   * into a long, smooth settle with no overshoot. Used for the intro
   * brand-beat text and the home entrance fade so both share one curve.
   */
  slow: cubicBezier(0.192, 0.062, 0.275, 0.879),
  /**
   * "Gentle" spring — least-squares cubic-bezier fit of a Figma spring
   * (stiffness 100, damping 15, mass 1) sampled over its 800ms interaction
   * window. Underdamped (ζ = 0.75): rises fast, overshoots the target by ~3%,
   * then settles back. Used for the home text-mode image reveal. Note
   * `cubicBezier` clamps its output to [0,1], so as a JS easing the overshoot
   * is flattened; in CSS (opacity, also clamped) the feel is the gentle,
   * slightly-springy settle this is named for.
   */
  gentle: cubicBezier(0.345, 0.635, 0.084, 1.167),
};

const linearEase = (t: number) => t;

/**
 * Build a cubic-bezier easing function from a 4-element number array.
 *
 * Convenience wrapper around `cubicBezier` for use with config-driven
 * animation specs where the control points are stored as an array rather
 * than named arguments. Falls back to linear if the array is malformed.
 *
 * @param arr - [x1, y1, x2, y2] cubic-bezier control points.
 */
export function ease4(arr: number[]): (t: number) => number {
  if (!Array.isArray(arr) || arr.length !== 4) return linearEase;
  const [a, b, c, d] = arr;
  if (a === undefined || b === undefined || c === undefined || d === undefined)
    return linearEase;
  return cubicBezier(a, b, c, d);
}

/** Context type for `bindMethod` — any object with string-keyed properties. */
export type BindMethodsCtx = Record<string, unknown>;

/**
 * Bind a list of named methods to their host object in-place.
 *
 * Replaces `ctx[name]` with `ctx[name].bind(ctx)` for each name in `names`.
 * Used in classes whose methods are passed as callbacks (event listeners,
 * RAF handlers) and need a stable `this` reference without arrow functions.
 */
export function bindMethod(ctx: BindMethodsCtx, names: string[]): void {
  if (!ctx || !Array.isArray(names)) return;
  for (const n of names) {
    const method = ctx[n];
    if (typeof method === "function") {
      ctx[n] = method.bind(ctx);
    }
  }
}

/**
 * Utility functions for generating random numbers.
 *
 * Used for procedural animation values (e.g. staggered delays, randomised
 * particle velocities) where deterministic values would look mechanical.
 */
export const Random = {
  /**
   * Random float in [min, max] rounded to `p` decimal places.
   *
   * @param min - Lower bound (inclusive).
   * @param max - Upper bound (inclusive).
   * @param p   - Decimal precision (default: 0 for integers).
   */
  range(min: number, max: number, p = 0): number {
    const precision = Math.pow(10, p);
    return (
      Math.round((Math.random() * (max - min) + min) * precision) / precision
    );
  },
  /**
   * Return a Fischer-Yates shuffled array of unique integers in [0, n).
   *
   * Used to generate randomised-but-non-repeating index sequences for
   * staggered animation targets without duplicating indices.
   */
  uniq(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = a[i];
      const swap = a[j];
      if (temp !== undefined && swap !== undefined) {
        a[i] = swap;
        a[j] = temp;
      }
    }
    return a;
  },
};

/**
 * Get the bounding rect of an element, returning a zero-rect if the element
 * is null/undefined or does not support getBoundingClientRect.
 *
 * Safe to call during SSR or before the element is mounted.
 */
export function bounds(
  el: Element | null | undefined
): DOMRect | { left: number; top: number; width: number; height: number } {
  return (
    el?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 }
  );
}

/**
 * Browser/device detection utilities.
 *
 * Centralised sniffing prevents scattered `navigator.userAgent` checks
 * throughout the codebase. Use sparingly — prefer feature detection where
 * possible. These are primarily needed for Safari/Firefox rendering workarounds.
 */
export const Sniff = {
  /** Lowercased user-agent string — used by the other getters. */
  get uA(): string {
    return navigator.userAgent.toLowerCase();
  },
  /**
   * True for iPad running iOS 13+ which reports itself as MacIntel.
   *
   * iOS 13+ iPads set navigator.platform to "MacIntel" and expose
   * maxTouchPoints > 1, making them indistinguishable from a real Mac by
   * those two fields alone. MacBooks with Touch Bar also satisfy both
   * conditions, causing a false-positive that blocks the GPU dynamic import
   * on real desktops.
   *
   * The `(pointer: fine)` media query is the reliable discriminator: a
   * mouse is a "fine" pointer so desktop Macs match it, while iPads (pen
   * or touch only) do not. Negating the match ensures we only flag actual
   * iPad Safari, never a real desktop Mac.
   */
  get iPadIOS13(): boolean {
    // navigator.platform === 'MacIntel' + maxTouchPoints > 1 is true on
    // iPads running iOS 13+, BUT also on MacBooks with Touch Bar and some
    // desktop browsers. The (pointer: fine) media query is the reliable
    // discriminator: real desktops have a mouse (fine pointer); iPads do
    // not. Negating it ensures we only flag actual iPad Safari, not Macs.
    return (
      navigator.platform === "MacIntel" &&
      (navigator.maxTouchPoints ?? 0) > 1 &&
      !window.matchMedia("(pointer: fine)").matches
    );
  },
  /** True when the device is a phone, tablet, or iPad (including iOS 13+). */
  get isMobile(): boolean {
    return /mobi|android|tablet|ipad|iphone/.test(this.uA) || this.iPadIOS13;
  },
  /** True when the browser is Firefox — used for Firefox-specific CSS workarounds. */
  get isFirefox(): boolean {
    return this.uA.indexOf("firefox") > -1;
  },
};

/**
 * Cancel the default browser action for an event if the event is cancelable.
 *
 * Safe to call with null/undefined — used as a drop-in for event listener
 * callbacks where the event might not always be present.
 */
export function preventDefault(e: Event | null | undefined): void {
  if (e && "cancelable" in e && e.cancelable) e.preventDefault();
}

/**
 * Call the `stop()` method on an instance if it exists, ignoring errors.
 *
 * Defensive teardown helper — used to stop scrollers, animation loops, or
 * other stoppable instances during page transitions without crashing if the
 * instance is null or has already been cleaned up.
 */
export function stop(inst: { stop?: () => void } | null | undefined): void {
  try {
    if (inst && typeof inst.stop === "function") inst.stop();
  } catch {
    // ignore
  }
}

/**
 * Type-safe `Object.prototype.hasOwnProperty` check.
 *
 * Avoids the common pitfall of calling `o.hasOwnProperty(k)` directly on
 * objects that may not inherit from Object.prototype (e.g. Object.create(null)
 * used in AppState.cache and similar stores).
 */
export function has(
  o: Record<string, unknown> | null | undefined,
  k: PropertyKey
): boolean {
  return o != null && Object.prototype.hasOwnProperty.call(o, k);
}

/**
 * Return true if `v` is neither undefined nor null.
 *
 * A concise defined-check used in place of `v !== undefined && v !== null`
 * throughout the codebase for guard clauses and conditional feature enabling.
 */
export function def(v: unknown): boolean {
  return typeof v !== "undefined" && v !== null;
}

/**
 * Query all elements matching `selector` under `root`, returning typed HTMLElement[].
 *
 * Returns an empty array (rather than throwing) when root is null/undefined or
 * the selector is invalid, making it safe to call before DOM is ready or with
 * optional container references.
 */
export function queryAll(
  root: ParentNode | null | undefined,
  selector: string
): HTMLElement[] {
  if (!root) return [];
  try {
    return Array.from(
      (root as Document | DocumentFragment | Element).querySelectorAll(selector)
    );
  } catch {
    return [];
  }
}

/**
 * Convert a rem value to pixels using the current root font-size.
 *
 * Reads `getComputedStyle(documentElement).fontSize` at call time so the
 * result reflects live CSS custom property overrides (e.g. viewport-scaled
 * fluid typography). Call inside a resize handler rather than caching.
 */
export function toPx(rem: number): number {
  const cs = getComputedStyle(document.documentElement);
  const fontSize = parseFloat(cs.fontSize || "0") || 0;
  return rem * fontSize;
}

/**
 * Apply a color theme to the root HTML element via the `theme` attribute.
 *
 * CSS rules should target `[theme="dark"]` / `[theme="light"]` on the `<html>`
 * element. Setting it here (rather than toggling a class) allows a single
 * attribute to drive both CSS theming and any JS code that reads it.
 */
export function setTheme(theme: "dark" | "light"): void {
  const html = document.documentElement;
  html.setAttribute("theme", theme);
}

const utils = {
  clamp,
  lerp,
  damp,
  cubicBezier,
  Ease,
  ease4,
  bindMethod,
  unequal,
  translate3d,
  Random,
  bounds,
  Sniff,
  preventDefault,
  stop,
  has,
  def,
  queryAll,
  aLerp,
  iLerp,
  toPx,
};

export default utils;
