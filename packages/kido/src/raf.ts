import { Tab } from "./tab";

const FRAME_TIME = 1000 / 60;
let frameRatio = 1;

export function getFrameRatio(): number {
  return frameRatio;
}

type RafItem = {
  name: string;
  id: symbol;
  cb: (elapsed: number) => void;
  startTime: number;
};

class _RafHub {
  private list: RafItem[];
  private on: boolean;
  private readonly _tickHandler: (ts: number) => void;
  private _tPrev: number | null;
  private fpsWatcher: { frames: number; lastTs: number };

  constructor() {
    this.list = [];
    this.on = true;
    this._tickHandler = this._tick.bind(this);
    this._tPrev = null;
    this.fpsWatcher = { frames: 0, lastTs: performance.now() };
    Tab.add({
      start: this._onResume.bind(this),
      stop: this._onPause.bind(this),
    });
    this._raf();
  }

  _onPause(): void {
    this.on = false;
  }

  /**
   * Resume after the tab was backgrounded. `hiddenFor` is the wall-clock
   * duration (ms) the tab spent hidden (supplied by Tab/Visibility — NOT an
   * absolute timestamp). Shift each ALREADY-STARTED item's clock forward by
   * that gap so it resumes where it paused instead of jumping ahead by the
   * hidden time. Items registered while hidden still have startTime 0 and are
   * left untouched — the tick loop stamps them on their first visible frame.
   * `_tPrev` is reset so frameRatio recomputes from the first real post-resume
   * delta rather than the long hidden gap.
   */
  _onResume(hiddenFor: number): void {
    const offset = Number.isFinite(hiddenFor) ? hiddenFor : 0;
    for (const it of this.list) if (it.startTime) it.startTime += offset;
    this.on = true;
    this._tPrev = null;
  }

  add(name: string | "no_name", cb: (elapsed: number) => void): symbol {
    const item: RafItem = { name, id: Symbol("raf"), cb, startTime: 0 };
    this.list.push(item);
    this._sortList();
    return item.id;
  }

  remove(id: symbol): void {
    const i = this.list.findIndex((it) => it.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  private _sortList(): void {
    const priority = (name: string) =>
      name === "scroller" ? 0 : name === "renderer" ? 1 : 2;
    this.list.sort((a, b) => priority(a.name) - priority(b.name));
  }

  _tick(ts: number): void {
    if (this._tPrev == null) {
      frameRatio = 0;
    } else {
      const delta = ts - this._tPrev;
      frameRatio = delta > 0 ? delta / FRAME_TIME : 0;
    }
    this._tPrev = ts;
    this._logFps(ts);
    const normTs = ts;
    if (this.on) {
      const len = this.list.length;
      for (let i = 0; i < len; i++) {
        const it = this.list[i];
        if (!it) continue;
        if (!it.startTime) it.startTime = normTs;
        const elapsed = normTs - it.startTime;
        try {
          it.cb(elapsed);
        } catch {
          // ignore callback errors
        }
      }
    }

    this._raf();
  }

  private _logFps(ts: number): void {
    const watcher = this.fpsWatcher;
    watcher.frames += 1;
    const elapsed = ts - watcher.lastTs;
    if (elapsed < 1000) return;
    watcher.frames = 0;
    watcher.lastTs = ts;
  }

  _raf(): void {
    // SSR guard: `RafHub` is instantiated eagerly at module scope (see the
    // singleton export below), and its constructor calls this method
    // immediately to kick off the tick loop. `requestAnimationFrame` doesn't
    // exist in Node — without this guard, merely importing `kido/raf` (or
    // anything that imports it — `kido/resize`, `kido/anima`, `kido/tab`)
    // from a universal (non-client-only) module throws immediately at
    // import time during an isomorphic app's server render. No frames can
    // ever tick without a browser event loop to drive them, so simply never
    // starting the loop is correct there — `add()`/`remove()` still work
    // normally (items just accumulate inert until this module is
    // re-evaluated client-side, where `requestAnimationFrame` is real).
    if (typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(this._tickHandler);
  }
}

export const RafHub = new _RafHub();

export class Raf {
  private readonly cb: (elapsed: number) => void;
  private readonly hub: _RafHub;
  private id: symbol | null;
  private name: string;

  constructor(
    name: string | null | undefined,
    cb: (elapsed: number) => void,
    hub: _RafHub = RafHub
  ) {
    this.cb = cb;
    this.hub = hub;
    this.id = null;
    this.name = name ?? "no_name";
  }

  run(): void {
    if (this.id) return;
    this.id = this.hub.add(this.name, this.cb);
  }

  stop(): void {
    if (!this.id) return;
    this.hub.remove(this.id);
    this.id = null;
  }
}

export class Delay {
  private readonly cb: (elapsed: number) => void;
  private readonly de: number;
  private readonly hub: _RafHub;
  private id: symbol | null;

  constructor(cb: (elapsed: number) => void, de = 0, hub: _RafHub = RafHub) {
    this.cb = cb;
    this.de = Math.max(0, de | 0);
    this.hub = hub;
    this.id = null;
  }

  run(): void {
    if (this.id) this.stop();
    const start = performance.now();
    const cb = this.cb;
    const de = this.de;
    const tick = () => {
      const now = performance.now();
      const total = now - start;
      if (total >= de) {
        this.stop();
        try {
          cb(total);
        } catch {
          // ignore callback errors
        }
        return;
      }
    };
    this.id = this.hub.add(`delay-${String(this.id)}`, tick);
  }

  stop(): void {
    if (this.id) this.hub.remove(this.id);
    this.id = null;
  }
}

export class Timer {
  private readonly _: Delay;

  constructor({
    cb,
    de,
  }: { cb?: (elapsed: number) => void; de?: number } = {}) {
    this._ = new Delay(cb ?? (() => {}), de ?? 0);
  }

  run(): void {
    this._.stop();
    this._.run();
  }

  stop(): void {
    this._.stop();
  }
}

const raf = {
  RafHub,
  Raf,
  Delay,
  Timer,
};

export default raf;
