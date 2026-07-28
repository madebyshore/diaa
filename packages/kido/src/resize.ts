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
    window.addEventListener(
      Sniff.isMobile ? "orientationchange" : "resize",
      this._handler.bind(this)
    );
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
