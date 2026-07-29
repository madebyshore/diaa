import { Delay, Raf } from "./raf";
import { bindMethod, Sniff } from "./utils";

type ResizeSub = { id: symbol; cb: () => void };

class _ResizeHub {
  private subs: ResizeSub[];
  private on: boolean;
  private timer: Delay;
  private readonly raf: Raf;

  constructor() {
    this.subs = [];
    this.on = false;
    bindMethod(this as unknown as Record<string, unknown>, [
      "_raf",
      "_run",
      "_handler",
    ]);
    this.timer = new Delay(() => this._rafTrigger(), 40);
    // SSR guard: `ResizeHub` is instantiated eagerly at module scope (see
    // the singleton export below). `window`/`navigator` (via Sniff.isMobile)
    // don't exist in an isomorphic app's server render — without this
    // guard, merely importing `kido/resize` from a universal (non-
    // client-only) module throws immediately at import time. No resize
    // events can ever fire without a `window` to listen on, so skipping
    // registration there is harmless — `add()`/`remove()` still work
    // normally once this module is re-evaluated client-side.
    if (typeof window !== "undefined") {
      window.addEventListener(
        Sniff.isMobile ? "orientationchange" : "resize",
        this._handler.bind(this)
      );
    }
    this.raf = new Raf("resize hub", this._run.bind(this));
  }

  add(cb: () => void): symbol {
    const id = Symbol("resize");
    this.subs.push({ id, cb });
    return id;
  }

  remove(id: symbol): void {
    const i = this.subs.findIndex((s) => s.id === id);
    if (i >= 0) this.subs.splice(i, 1);
  }

  _handler(): void {
    this.timer.run();
  }

  _rafTrigger(): void {
    if (!this.on) {
      this.on = true;
      this.raf.run();
    }
  }

  _run(): void {
    try {
      for (let i = 0; i < this.subs.length; i++) {
        this.subs[i]?.cb();
      }
    } finally {
      this.raf.stop();
      this.on = false;
    }
  }
}

export const ResizeHub = new _ResizeHub();
