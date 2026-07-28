/**
 * MorphSvg — reusable SVG path morphing component.
 *
 * Resamples two closed polygons to equal point counts, then linearly
 * interpolates every vertex per animation frame using kido Anima.
 * No external dependencies — all geometry math is inline.
 *
 * Usage:
 *   const morph = new MorphSvg({
 *     source: [{ x: 0, y: 0 }, ...],
 *     target: MorphSvg.circle(100, 100, 70),
 *     selector: ".my-morph",
 *     duration: 1200,
 *     easing: "io",
 *   });
 *   morph.init(container, ".my-section");
 *   morph.play();   // forward
 *   morph.play();   // reverse (toggles)
 */

import { Anima } from "kido/anima";

import { Component } from "@app/primitives/component";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 2D point for polygon vertices and interpolation. */
export interface MorphPoint {
  x: number;
  y: number;
}

/** Configuration for a MorphSvg instance. */
export interface MorphSvgConfig {
  /** Source shape as a closed polygon (array of vertices). */
  source: MorphPoint[];
  /** Target shape as a closed polygon (array of vertices). */
  target: MorphPoint[];
  /** CSS selector for the SVG <path> element inside the component section. */
  pathSelector?: string;
  /** Number of resampled points for both shapes. Higher = smoother. Default 200. */
  sampleCount?: number;
  /** Animation duration in ms. Default 1200. */
  duration?: number;
  /** Kido easing string. Default "io" (in-out). */
  easing?: string;
  /** SVG viewBox string. Default "0 0 200 200". */
  viewBox?: string;
  /** Fill color for the path. Default "black". */
  fill?: string;
  /** Container element override for Component base. */
  container?: Element | Document;
}

// ---------------------------------------------------------------------------
// Geometry utilities
// ---------------------------------------------------------------------------

/**
 * Compute cumulative arc lengths along a closed polygon.
 * Returns array of length N+1 where [0] = 0 and [N] = total perimeter.
 */
function cumulativeLengths(pts: MorphPoint[]): number[] {
  const n = pts.length;
  const lengths: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1]!;
    const b = pts[i % n]!;
    const prev = lengths[i - 1]!;
    lengths.push(prev + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lengths;
}

/**
 * Resample a closed polygon to `count` evenly-spaced points along its perimeter.
 * Walks edges using cumulative arc lengths and interpolates between vertices.
 */
function resample(polygon: MorphPoint[], count: number): MorphPoint[] {
  const n = polygon.length;
  const lengths = cumulativeLengths(polygon);
  const total = lengths[n]!;
  const result: MorphPoint[] = [];
  let seg = 0;

  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;

    while (seg < n - 1 && lengths[seg + 1]! < target) {
      seg++;
    }

    const segStart = lengths[seg]!;
    const segEnd = lengths[seg + 1]!;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (target - segStart) / segLen : 0;
    const a = polygon[seg]!;
    const b = polygon[(seg + 1) % n]!;

    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }

  return result;
}

/**
 * Linearly interpolate between two same-length point arrays.
 * t=0 returns `a`, t=1 returns `b`.
 */
function lerpPoints(a: MorphPoint[], b: MorphPoint[], t: number): MorphPoint[] {
  const out: MorphPoint[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    out[i] = {
      x: pa.x + (pb.x - pa.x) * t,
      y: pa.y + (pb.y - pa.y) * t,
    };
  }
  return out;
}

/**
 * Convert a point array to an SVG path `d` attribute (closed polygon).
 * M for the first point, L for each subsequent, Z to close.
 */
function toPathD(pts: MorphPoint[]): string {
  if (pts.length === 0) return "";
  const first = pts[0]!;
  let d = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    d += `L${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }
  return d + "Z";
}

// ---------------------------------------------------------------------------
// MorphSvg Component
// ---------------------------------------------------------------------------

/**
 * Reusable SVG path morph component.
 *
 * Extends Component for resize handling and lifecycle. Call init() with a
 * container and section selector, then play() to toggle the morph animation.
 * The component finds (or creates) an SVG <path> element and updates its
 * `d` attribute each frame during animation.
 */
export class MorphSvg extends Component {
  /** Resampled source points. */
  private srcPoints: MorphPoint[] = [];

  /** Resampled target points. */
  private dstPoints: MorphPoint[] = [];

  /** SVG <path> element being animated. */
  private pathEl: SVGPathElement | null = null;

  /** Anima instance driving the morph. */
  private anim: Anima | null = null;

  /** true = next play() goes forward (source -> target). */
  private _forward: boolean = true;

  /** Current animation "from" points (swapped on direction change). */
  private _from: MorphPoint[] = [];

  /** Current animation "to" points (swapped on direction change). */
  private _to: MorphPoint[] = [];

  /** Merged config with defaults applied. */
  private cfg: Required<MorphSvgConfig>;

  constructor(config: MorphSvgConfig) {
    super(config.container ? { container: config.container } : {});
    this.componentName = "morph-svg";

    this.cfg = {
      source: config.source,
      target: config.target,
      pathSelector: config.pathSelector ?? "path",
      sampleCount: config.sampleCount ?? 200,
      duration: config.duration ?? 1200,
      easing: config.easing ?? "io",
      viewBox: config.viewBox ?? "0 0 200 200",
      fill: config.fill ?? "black",
      container: config.container ?? document,
    };
  }

  /**
   * Initialise the morph: resample both shapes, find/create the SVG path,
   * render the initial source shape, and create the Anima instance.
   */
  init(container: Element | null, selector: string): void {
    super.init(container, selector);
    if (!this.section) return;

    console.debug("[morph-svg] init");

    const { sampleCount, pathSelector, duration, easing } = this.cfg;

    // Resample both shapes to equal point counts.
    this.srcPoints = resample(this.cfg.source, sampleCount);
    this.dstPoints = resample(this.cfg.target, sampleCount);

    // Find existing path element in the section.
    this.pathEl = this.section.querySelector<SVGPathElement>(pathSelector);

    if (!this.pathEl) {
      console.debug("[morph-svg] no path element found for selector:", pathSelector);
      return;
    }

    // Render the source shape.
    this.pathEl.setAttribute("d", toPathD(this.srcPoints));
    console.debug("[morph-svg] initial path rendered,", sampleCount, "points");

    // Create Anima — u callback lerps and updates the path each tick.
    // Anima's prE always goes 0→1 regardless of reverse flag (reverse only
    // affects built-in prop/svg/line modes). We swap src/dst ourselves.
    this.anim = new Anima({
      d: duration,
      e: easing,
      u: (state) => {
        if (!this.pathEl) return;
        const pts = lerpPoints(this._from, this._to, state.prE);
        this.pathEl.setAttribute("d", toPathD(pts));
      },
      cb: () => {
        console.debug("[morph-svg] animation complete");
      },
    });
  }

  /**
   * Toggle the morph animation. First call plays forward (source -> target),
   * next call plays reverse (target -> source), and so on.
   */
  play(): void {
    if (!this.anim) return;
    if (this._forward) {
      this._from = this.srcPoints;
      this._to = this.dstPoints;
    } else {
      this._from = this.dstPoints;
      this._to = this.srcPoints;
    }
    this.anim.play();
    this._forward = !this._forward;
    console.debug(`[morph-svg] play — next direction=${this._forward ? "forward" : "reverse"}`);
  }

  /** Play forward explicitly (source -> target). */
  forward(): void {
    if (!this.anim) return;
    this._from = this.srcPoints;
    this._to = this.dstPoints;
    this.anim.play();
    this._forward = false;
    console.debug("[morph-svg] forward");
  }

  /** Play reverse explicitly (target -> source). */
  reverse(): void {
    if (!this.anim) return;
    this._from = this.dstPoints;
    this._to = this.srcPoints;
    this.anim.play();
    this._forward = true;
    console.debug("[morph-svg] reverse");
  }

  /** Clean up animation and DOM references. */
  destroy(): void {
    this.pathEl = null;
    this.anim = null;
    this.srcPoints = [];
    this.dstPoints = [];
    this._forward = true;
    super.destroy();
    console.debug("[morph-svg] destroyed");
  }

  // ---------------------------------------------------------------------------
  // Static shape helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a circle as a closed polygon with `count` vertices.
   * Starts at the top (12 o'clock) and proceeds clockwise.
   */
  static circle(cx: number, cy: number, r: number, count: number = 200): MorphPoint[] {
    const pts: MorphPoint[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      pts.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    }
    return pts;
  }

  /**
   * Generate a rectangle as a closed polygon with 4 vertices.
   * Starts at top-left, proceeds clockwise.
   */
  static rect(x: number, y: number, w: number, h: number): MorphPoint[] {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }

  /**
   * Parse an SVG path `d` string into a polygon by sampling curves.
   * Supports M, L, H, V, C, S, Z commands (absolute and relative).
   * Each cubic bezier is subdivided into `segSamples` straight segments.
   */
  static fromPath(d: string, segSamples: number = 8): MorphPoint[] {
    const pts: MorphPoint[] = [];
    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    // Last control point for S (smooth cubic) continuation.
    let lastCp2X = 0;
    let lastCp2Y = 0;
    let lastCmd = "";

    /** Sample a cubic bezier from t=0 to t=1, pushing intermediate points. */
    const sampleCubic = (
      x0: number, y0: number,
      cp1x: number, cp1y: number,
      cp2x: number, cp2y: number,
      x: number, y: number,
    ): void => {
      for (let i = 1; i <= segSamples; i++) {
        const t = i / segSamples;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        pts.push({
          x: mt2 * mt * x0 + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t2 * t * x,
          y: mt2 * mt * y0 + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t2 * t * y,
        });
      }
    };

    // Tokenise: split into commands + numeric args.
    const tokens = d.match(/[a-zA-Z][^a-zA-Z]*/g) || [];

    for (const token of tokens) {
      const cmd = token[0]!;
      const nums = (token.slice(1).match(/-?\d+\.?\d*(?:e[+-]?\d+)?/gi) || []).map(Number);
      const rel = cmd === cmd.toLowerCase();

      switch (cmd.toUpperCase()) {
        case "M": {
          const mx = rel ? cx + nums[0]! : nums[0]!;
          const my = rel ? cy + nums[1]! : nums[1]!;
          cx = mx; cy = my;
          startX = mx; startY = my;
          pts.push({ x: mx, y: my });
          // Implicit lineTo for additional coordinate pairs after M.
          for (let i = 2; i < nums.length; i += 2) {
            cx = rel ? cx + nums[i]! : nums[i]!;
            cy = rel ? cy + nums[i + 1]! : nums[i + 1]!;
            pts.push({ x: cx, y: cy });
          }
          break;
        }
        case "L": {
          for (let i = 0; i < nums.length; i += 2) {
            cx = rel ? cx + nums[i]! : nums[i]!;
            cy = rel ? cy + nums[i + 1]! : nums[i + 1]!;
            pts.push({ x: cx, y: cy });
          }
          break;
        }
        case "H": {
          for (const n of nums) {
            cx = rel ? cx + n : n;
            pts.push({ x: cx, y: cy });
          }
          break;
        }
        case "V": {
          for (const n of nums) {
            cy = rel ? cy + n : n;
            pts.push({ x: cx, y: cy });
          }
          break;
        }
        case "C": {
          for (let i = 0; i < nums.length; i += 6) {
            const cp1x = rel ? cx + nums[i]! : nums[i]!;
            const cp1y = rel ? cy + nums[i + 1]! : nums[i + 1]!;
            const cp2x = rel ? cx + nums[i + 2]! : nums[i + 2]!;
            const cp2y = rel ? cy + nums[i + 3]! : nums[i + 3]!;
            const ex = rel ? cx + nums[i + 4]! : nums[i + 4]!;
            const ey = rel ? cy + nums[i + 5]! : nums[i + 5]!;
            sampleCubic(cx, cy, cp1x, cp1y, cp2x, cp2y, ex, ey);
            lastCp2X = cp2x; lastCp2Y = cp2y;
            cx = ex; cy = ey;
          }
          break;
        }
        case "S": {
          for (let i = 0; i < nums.length; i += 4) {
            // Reflect previous cp2 for the first control point.
            const cp1x = lastCmd === "C" || lastCmd === "S"
              ? 2 * cx - lastCp2X : cx;
            const cp1y = lastCmd === "C" || lastCmd === "S"
              ? 2 * cy - lastCp2Y : cy;
            const cp2x = rel ? cx + nums[i]! : nums[i]!;
            const cp2y = rel ? cy + nums[i + 1]! : nums[i + 1]!;
            const ex = rel ? cx + nums[i + 2]! : nums[i + 2]!;
            const ey = rel ? cy + nums[i + 3]! : nums[i + 3]!;
            sampleCubic(cx, cy, cp1x, cp1y, cp2x, cp2y, ex, ey);
            lastCp2X = cp2x; lastCp2Y = cp2y;
            cx = ex; cy = ey;
          }
          break;
        }
        case "Z": {
          cx = startX; cy = startY;
          break;
        }
        default:
          break;
      }
      lastCmd = cmd.toUpperCase();
    }

    return pts;
  }
}

export default MorphSvg;
