import { Delay, Raf } from "./raf";
import { Svg } from "./svg";
import {
  bindMethod,
  Ease,
  round,
  ease4,
  clamp,
  lerp,
  def,
} from "./utils";

const linearEase = (t: number) => t;

function hasKey<T extends object>(obj: T, key: string): boolean {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

export interface AnimaConfig {
  el?: string | Element | ArrayLike<Element> | null | Window;
  p?: Record<string, [number, number, string?]>;
  e?: string | number[];
  d?: number;
  de?: number;
  r?: number;
  cb?: () => void;
  u?: (state: AnimaState) => void;
  svg?: {
    type: string;
    start?: string;
    end: string;
  };
  line?: {
    dashed?: string;
    start?: number;
    end?: number;
    elWL?: SVGElement | HTMLElement;
  };
}

export type AnimaPlayOptions = {
  reverse?: boolean;
  d?: number;
  e?: string | number[];
  de?: number;
  cb?: () => void;
  p?: Record<string, { newEnd?: number; newStart?: number }>;
  svg?: { start?: Array<string | number>; end?: Array<string | number> };
  line?: { end?: number };
};

interface PropState {
  name: string;
  origin: { start: number; end: number };
  cur: number;
  start: number;
  end: number;
  unit: string;
}

interface SvgState {
  type: string;
  attr: string;
  start: string;
  end: string;
  cur: string;
  curTemp?: string;
  originArr: { start: Array<string | number>; end: Array<string | number> };
  arr: { start: Array<string | number>; end: Array<string | number> };
  arrL: number;
  val: Array<string | number>;
}

interface LineState {
  dashed?: string;
  factor: { start: number; end: number };
  shapeL: number[];
  origin: { start: number[]; end: number[] };
  cur: number[];
  start: number[];
  end: number[];
}

export interface AnimaState {
  el: Element[];
  elL: number;
  e: { curve: string | number[]; calc: (t: number) => number };
  d: { origin: number; cur: number };
  de: number;
  cb: (() => void) | null;
  r: number;
  pr: number;
  prE: number;
  elapsed: number;
  u: () => void;
  prop?: Record<number, PropState>;
  propI?: Record<string, number>;
  propL?: number;
  svg?: SvgState;
  line?: LineState;
}

function toEls(selOrEl: unknown): Element[] {
  if (!selOrEl) return [];
  if (typeof selOrEl === "string") {
    return Array.from(document.querySelectorAll(selOrEl));
  }
  if (
    (selOrEl as Element)?.nodeType === 1 ||
    selOrEl === window ||
    selOrEl === document
  )
    return [selOrEl as Element];
  if (
    Array.isArray(selOrEl) ||
    ((selOrEl as { length?: number })?.length !== undefined &&
      (selOrEl as { [idx: number]: Element })[0])
  )
    return Array.from(selOrEl as ArrayLike<Element>);
  return [];
}

function getAttr(el: Element | null, name: string): string {
  return el?.getAttribute(name) ?? "";
}

export class Anima {
  private v!: AnimaState;
  private readonly _raf: Raf;
  private _delay: Delay | null;

  constructor(cfg: AnimaConfig = {}) {
    bindMethod(this as unknown as Record<string, unknown>, [
      "_gRaf",
      "_run",
      "_uProp",
      "_uSvg",
      "_uLine",
    ]);
    this._raf = new Raf("anima", this._run.bind(this));
    this._delay = null;
    this._init(cfg);
  }

  private _init(s: AnimaConfig): void {
    const v: AnimaState = {
      el: toEls(s.el),
      elL: 0,
      e: { curve: s.e ?? "linear", calc: linearEase },
      d: { origin: s.d ?? 0, cur: 0 },
      de: s.de ?? 0,
      cb: s.cb ?? null,
      r: s.r ?? 2,
      pr: 0,
      prE: 0,
      elapsed: 0,
      u: () => {},
    };
    v.elL = v.el.length;

    if (hasKey(s, "u") && s.u) v.u = () => s.u!(v);
    else if (hasKey(s, "svg")) v.u = this._uSvg.bind(this);
    else if (hasKey(s, "line")) v.u = this._uLine.bind(this);
    else v.u = this._uProp.bind(this);

    if (s.p) {
      v.prop = {};
      v.propI = {};
      const keys = Object.keys(s.p);
      v.propL = keys.length;
      let seenR = false;
      for (let i = 0; i < keys.length; i++) {
        const name = keys[i]!;
        const arr = s.p[name]!;
        v.prop[i] = {
          name,
          origin: { start: arr[0], end: arr[1] },
          cur: arr[0],
          start: arr[0],
          end: arr[1],
          unit: arr[2] ?? "%",
        };
        const ch0 = name.charAt(0);
        const indexName = ch0 === "r" && seenR ? "r2" : ch0;
        seenR = ch0 === "r";
        v.propI[indexName] = i;
      }
    }

    if (s.svg) {
      const firstEl = v.el[0] ?? null;
      v.svg = {
        type: s.svg.type,
        attr: s.svg.type === "polygon" ? "points" : "d",
        end: s.svg.end,
        start: s.svg.start ?? getAttr(firstEl, s.svg.type === "polygon" ? "points" : "d"),
        cur: "",
        originArr: { start: [], end: [] },
        arr: { start: [], end: [] },
        arrL: 0,
        val: [],
      };
      v.svg.cur = v.svg.start;
      v.svg.originArr.start = Svg.split(v.svg.start);
      v.svg.originArr.end = Svg.split(v.svg.end);
      v.svg.arr.start = v.svg.originArr.start.slice();
      v.svg.arr.end = v.svg.originArr.end.slice();
      v.svg.arrL = v.svg.arr.start.length;
    }

    if (s.line) {
      v.line = {
        dashed: s.line.dashed,
        factor: {
          start: def(s.line.start) ? (100 - (s.line.start ?? 0)) / 100 : 1,
          end: def(s.line.end) ? (100 - (s.line.end ?? 0)) / 100 : 0,
        },
        shapeL: [],
        origin: { start: [], end: [] },
        cur: [],
        start: [],
        end: [],
      };
      for (let e = 0; e < v.elL; e++) {
        const el = v.el[e] as HTMLElement | SVGElement | undefined;
        const n = s.line.elWL ?? el;
        v.line.shapeL[e] = Svg.shapeLength(n ?? null);
        let dashArr: string;
        if (v.line.dashed) {
          const parts = String(v.line.dashed).split(/[\s,]/);
          let segLen = 0;
          for (const p of parts) segLen += parseFloat(p) || 0;
          const repeat = Math.max(
            1,
            Math.ceil((v.line.shapeL[e] ?? 0) / (segLen || 1))
          );
          dashArr =
            new Array(repeat).fill(v.line.dashed).join(" ") +
            " 0 " +
            (v.line.shapeL[e] ?? 0);
        } else {
          dashArr = String(v.line.shapeL[e] ?? 0);
        }
        if (el) (el as HTMLElement).style.strokeDasharray = dashArr;
        v.line.origin.start[e] = v.line.factor.start * (v.line.shapeL[e] ?? 0);
        v.line.origin.end[e] = v.line.factor.end * (v.line.shapeL[e] ?? 0);
        v.line.cur[e] = v.line.origin.start[e] ?? 0;
        v.line.start[e] = v.line.origin.start[e] ?? 0;
        v.line.end[e] = v.line.origin.end[e] ?? 0;
      }
    }

    const easeCurve =
      typeof v.e.curve === "string"
        ? (Ease[v.e.curve] ?? linearEase)
        : ease4(Array.isArray(v.e.curve) ? v.e.curve : []);
    v.e.calc = easeCurve;
    this.v = v;
  }

  play(opts: AnimaPlayOptions = {}): void {
    this.pause();
    this._prepare(opts);
    if (this.v.de > 0) {
      this._delay = new Delay(() => this._gRaf(), this.v.de);
      this._delay.run();
    } else {
      this._gRaf();
    }
  }

  pause(): void {
    this._raf.stop();
    if (this._delay) this._delay.stop();
  }

  /**
   * Scrub the animation playhead to a normalised time value `t` in [0, 1].
   *
   * Stops any running animation loop (via pause()), computes the correct
   * eased progress at `t` using the current easing function, and fires the
   * update callback exactly once. This is the primary API for the orchestrator
   * timeline scrubber and for setting initial hidden state before play().
   *
   * Uses v.d.origin (the configured duration) rather than v.d.cur (the
   * remaining duration) so it works correctly on fresh Anima instances where
   * v.d.cur has not yet been initialised (it is 0 until the first play()).
   *
   * @param t - Normalised time in [0, 1]. Values outside this range are clamped.
   */
  seek(t: number): void {
    console.debug("[kido:anima] seek", t);
    const v = this.v;
    this.pause();
    const clamped = clamp(t, 0, 1);
    v.elapsed = clamped * v.d.origin;
    v.pr = v.d.origin > 0 ? clamp(v.elapsed / v.d.origin, 0, 1) : 1;
    v.prE = v.e.calc(v.pr);
    v.u();
  }

  /**
   * Replace the easing function used by this Anima instance.
   *
   * Accepts either a named preset key from the Ease map (e.g. "oQ", "o6")
   * or a four-element cubic-bezier control-point array [x1, y1, x2, y2].
   * Subsequent seek() and play() calls will use the new curve. The easing
   * getter reflects the new value immediately.
   *
   * @param curve - Named ease key or [x1, y1, x2, y2] bezier array.
   */
  setEase(curve: string | number[]): void {
    this.v.e.curve = curve;
    this.v.e.calc =
      typeof curve === "string"
        ? (Ease[curve] ?? linearEase)
        : ease4(curve);
  }

  /**
   * Update the duration and delay for this Anima instance.
   *
   * Changes take effect on the next play() or seek() call. Negative values
   * are clamped to 0. The duration and delay getters reflect the new values
   * immediately so the orchestrator can read back what was set.
   *
   * @param d  - New animation duration in milliseconds (clamped to >= 0).
   * @param de - New delay before animation starts in milliseconds (clamped to >= 0).
   */
  setTiming(d: number, de: number): void {
    this.v.d.origin = Math.max(0, d);
    this.v.de = Math.max(0, de);
  }

  /**
   * Returns the configured animation duration in milliseconds (v.d.origin).
   *
   * Exposed as a getter so orchestrator UI can display and edit the current
   * timing without direct access to the internal AnimaState.
   */
  get duration(): number {
    return this.v.d.origin;
  }

  /**
   * Returns the configured pre-animation delay in milliseconds (v.de).
   *
   * Exposed as a getter so orchestrator UI can display and edit the current
   * delay without direct access to the internal AnimaState.
   */
  get delay(): number {
    return this.v.de;
  }

  /**
   * Returns the current easing curve — either a named preset string or a
   * four-element cubic-bezier array, as originally configured or as last
   * set via setEase().
   *
   * Exposed as a getter so the orchestrator can display the current curve
   * in the easing editor and detect when it has been mutated.
   */
  get easing(): string | number[] {
    return this.v.e.curve;
  }

  private _prepare(s: AnimaPlayOptions = {}): void {
    const v = this.v;
    const toKey: "start" | "end" = hasKey(s, "reverse") ? "start" : "end";
    if (v.prop && v.propL) {
      for (let i = 0; i < v.propL; i++) {
        const prop = v.prop[i];
        if (!prop) continue;
        prop.end = prop.origin[toKey];
        prop.start = prop.cur;
        if (hasKey(s, "p") && s.p && hasKey(s.p, prop.name)) {
          const cfg = s.p[prop.name];
          if (cfg && hasKey(cfg, "newEnd") && cfg.newEnd !== undefined)
            prop.end = cfg.newEnd;
          if (cfg && hasKey(cfg, "newStart") && cfg.newStart !== undefined)
            prop.start = cfg.newStart;
        }
      }
    } else if (v.svg) {
      v.svg.arr.start =
        hasKey(s, "svg") && s.svg && hasKey(s.svg, "start") && s.svg.start
          ? s.svg.start
          : Svg.split(v.svg.cur);
      v.svg.arr.end =
        hasKey(s, "svg") && s.svg && hasKey(s.svg, "end") && s.svg.end
          ? s.svg.end
          : v.svg.originArr[toKey];
    } else if (v.line) {
      for (let i = 0; i < v.elL; i++)
        v.line.start[i] = v.line.cur[i] ?? 0;
      if (hasKey(s, "line") && s.line && hasKey(s.line, "end") && s.line.end !== undefined) {
        v.line.factor.end = (100 - s.line.end) / 100;
        for (let i = 0; i < v.elL; i++)
          v.line.end[i] = v.line.factor.end * (v.line.shapeL[i] ?? 0);
      } else {
        for (let i = 0; i < v.elL; i++)
          v.line.end[i] = v.line.origin[toKey][i] ?? 0;
      }
    }
    v.d.cur = hasKey(s, "d") && s.d !== undefined
      ? s.d
      : Math.max(0, v.d.origin - v.d.cur + v.elapsed);
    v.e.curve = s.e ?? v.e.curve;
    v.e.calc =
      typeof v.e.curve === "string"
        ? (Ease[v.e.curve] ?? linearEase)
        : ease4(v.e.curve);
    v.de = hasKey(s, "de") && s.de !== undefined ? s.de : v.de;
    v.cb = hasKey(s, "cb") && s.cb !== undefined ? s.cb : v.cb;
    v.pr = v.prE = v.d.cur === 0 ? 1 : 0;
  }

  private _gRaf(): void {
    this._raf.run();
  }

  private _run(elapsedMs: number): void {
    const v = this.v;
    if (v.pr === 1) {
      this.pause();
      v.u();
      if (v.cb)
        try {
          v.cb();
        } catch {
          // ignore
        }
      return;
    }
    v.elapsed = clamp(elapsedMs, 0, v.d.cur);
    v.pr = clamp(v.elapsed / v.d.cur, 0, 1);
    v.prE = v.e.calc(v.pr);
    v.u();
  }

  private _uProp(): void {
    const v = this.v;
    const t = v.prop;
    const idx = v.propI;
    if (!t || !idx || !v.propL) return;

    for (let i = 0; i < v.propL; i++) {
      const prop = t[i];
      if (prop) prop.cur = this._lerp(prop.start, prop.end);
    }
    const xIdx = idx["x"];
    const yIdx = idx["y"];
    const rIdx = idx["r"];
    const r2Idx = idx["r2"];
    const sIdx = idx["s"];
    const oIdx = idx["o"];

    const xProp = xIdx !== undefined ? t[xIdx] : undefined;
    const yProp = yIdx !== undefined ? t[yIdx] : undefined;
    const rProp = rIdx !== undefined ? t[rIdx] : undefined;
    const r2Prop = r2Idx !== undefined ? t[r2Idx] : undefined;
    const sProp = sIdx !== undefined ? t[sIdx] : undefined;
    const oProp = oIdx !== undefined ? t[oIdx] : undefined;

    const x = xProp ? xProp.cur + xProp.unit : 0;
    const y = yProp ? yProp.cur + yProp.unit : 0;
    const tr = x || y ? `translate3d(${x || 0}, ${y || 0}, 0)` : 0;
    const r = rProp ? `${rProp.name}(${rProp.cur}deg)` : 0;
    const r2 = r2Prop ? `${r2Prop.name}(${r2Prop.cur}deg)` : 0;
    const s = sProp ? `${sProp.name}(${sProp.cur})` : 0;
    const o = oProp ? oProp.cur : -1;
    const transform = [tr, r, r2, s].filter(Boolean).join(" ");
    for (let n = 0; n < v.elL; n++) {
      const el = v.el[n] as HTMLElement | null | undefined;
      if (!el) continue;
      if (transform) el.style.transform = transform;
      if (o >= 0) el.style.opacity = String(o);
    }
  }

  private _uSvg(): void {
    const s = this.v.svg;
    if (!s) return;
    s.curTemp = "";
    for (let i = 0; i < s.arrL; i++) {
      const startVal = s.arr.start[i];
      const endVal = s.arr.end[i];
      s.val[i] = isNaN(Number(startVal))
        ? (startVal ?? "")
        : this._lerp(Number(startVal), Number(endVal));
    }
    for (let i = 0; i < s.arrL; i++) {
      s.curTemp += (i && i % 2 === 0 ? " " : i ? "," : "") + String(s.val[i]);
    }
    s.cur = s.curTemp;
    for (let i = 0; i < this.v.elL; i++) {
      const target = this.v.el[i];
      target?.setAttribute(s.attr, s.cur);
    }
  }

  private _uLine(): void {
    const v = this.v;
    if (!v.line) return;
    for (let i = 0; i < v.elL; i++) {
      v.line.cur[i] = this._lerp(v.line.start[i] ?? 0, v.line.end[i] ?? 0);
      const el = v.el[i] as HTMLElement | SVGElement | null | undefined;
      if (el) (el.style as CSSStyleDeclaration).strokeDashoffset = String(v.line.cur[i]);
    }
  }

  private _lerp(a: number, b: number): number {
    return round(lerp(a, b, this.v.prE), this.v.r);
  }
}

export default Anima;
