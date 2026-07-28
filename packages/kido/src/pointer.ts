import { bindMethod } from "./utils";

export type PointerMoveCallback = (
  x: number,
  y: number,
  event: PointerEvent
) => void;

export interface PointerMoveConfig {
  cb?: PointerMoveCallback;
  el?: string | Element;
}

export class PointerMove {
  private readonly cb: PointerMoveCallback;
  private readonly el: Document | Element;
  run: (e: PointerEvent) => void;

  constructor(config: PointerMoveConfig = {}) {
    this.cb = config.cb ?? (() => {});
    this.el = config.el
      ? typeof config.el === "string"
        ? (document.querySelector(config.el) ?? document)
        : config.el
      : document;
    bindMethod(this as unknown as Record<string, unknown>, ["run"]);
    this.run = this._run.bind(this);
  }

  on(): void {
    this.el.addEventListener("pointermove", this.run as EventListener, {
      passive: false,
    });
  }

  off(): void {
    this.el.removeEventListener("pointermove", this.run as EventListener);
  }

  private _run(e: PointerEvent): void {
    this.cb(e.pageX, e.pageY, e);
  }
}
