import { bindMethod, Sniff } from "./utils";

type WheelKeySub = {
  id: number | symbol;
  cb: (delta: number) => void;
  k?: boolean;
};

class WheelKeyDispatcher {
  private subs: WheelKeySub[];
  private len: number;
  private busy: boolean;
  private ff: boolean;
  private e?: WheelEvent | KeyboardEvent;
  private eT?: string;
  private eK?: string;
  private delta: number;

  constructor() {
    this.subs = [];
    this.len = 0;
    this.busy = false;
    this.ff = Sniff.isFirefox;
    this.delta = 0;
    this.e = undefined;
    this.eT = undefined;
    this.eK = undefined;
    bindMethod(this as unknown as Record<string, unknown>, [
      "_fn",
      "_run",
      "_wheel",
      "_key",
    ]);
    document.body.addEventListener("wheel", this._fn.bind(this), {
      passive: false,
    });
    document.addEventListener("keydown", this._fn.bind(this));
  }

  add(sub: WheelKeySub): void {
    this.subs.push(sub);
    this.len++;
  }

  remove(id: number | symbol): void {
    let i = this.len;
    for (; i--; ) {
      const sub = this.subs[i];
      if (sub?.id === id) {
        this.subs.splice(i, 1);
        this.len--;
        return;
      }
    }
  }

  _fn(e: WheelEvent | KeyboardEvent): void {
    this.e = e;
    this.eT = e.type;
    this.eK = "key" in e ? e.key : undefined;
    if (this.len > 0) {
      if (this.eT === "keydown") {
        const k = this.eK || "";
        const handled =
          k === "ArrowUp" ||
          k === "ArrowDown" ||
          k === "PageUp" ||
          k === "PageDown" ||
          k === "Home" ||
          k === "End" ||
          k === " ";
        if (handled && !e.metaKey && !e.ctrlKey && e.cancelable)
          e.preventDefault();
      } else if (this.eT === "wheel" && e.cancelable) {
        e.preventDefault();
      }
      if (!this.busy) {
        this.busy = true;
        this._run();
      }
    }
  }

  _run(): void {
    if (this.eT === "wheel") this._wheel();
    else if (this.eT === "keydown") this._key();
  }

  _wheel(): void {
    const e = this.e as WheelEvent;
    const wheelEvent = e as WheelEvent & { wheelDeltaY?: number };
    const dy =
      "wheelDeltaY" in wheelEvent && wheelEvent.wheelDeltaY !== undefined
        ? wheelEvent.wheelDeltaY
        : e.deltaY * -1;
    const scale = this.ff && e.deltaMode === 1 ? 0.833333 : 0.555556;
    this.delta = -dy * scale;
    this._cb("w");
  }

  _key(): void {
    const k = this.eK || "";
    const base = "Arrow";
    const isUp = k === base + "Up" || k === base + "Left";
    const isDown = k === base + "Down" || k === base + "Right";
    const isSpace = k === " ";
    if (isUp || isDown || isSpace) {
      let delta = 100;
      if (isUp) delta *= -1;
      else if (isSpace) {
        const shiftKey = (this.e as KeyboardEvent).shiftKey;
        const sign = shiftKey ? -1 : 1;
        delta = (window.innerHeight - 40) * sign;
      }
      this.delta = delta;
      this._cb("k");
    } else {
      this.busy = false;
    }
  }

  _cb(type: "w" | "k"): void {
    let i = this.len;
    for (; i--; ) {
      const sub = this.subs[i];
      if (!sub) continue;
      if (type === "w" && sub.k) continue;
      sub.cb(this.delta);
    }
    this.busy = false;
  }
}

export const WheelKeys = new WheelKeyDispatcher();

let WK_ID = 0;

export interface WheelKeySubscriptionConfig {
  cb?: (delta: number) => void;
  k?: boolean;
}

export class WheelKeySubscription {
  private readonly cb: (delta: number) => void;
  private readonly k: boolean;
  private readonly id: number;

  constructor(config: WheelKeySubscriptionConfig = {}) {
    this.cb = config.cb ?? (() => {});
    this.k = !!config.k;
    this.id = WK_ID++;
  }

  on(): void {
    WheelKeys.add({ id: this.id, cb: this.cb, k: this.k });
  }

  off(): void {
    WheelKeys.remove(this.id);
  }
}
