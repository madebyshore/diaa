
import { Raf } from "kido/raf";
import { ResizeHub } from "kido/resize";
import { bounds } from "kido/utils";

import { App } from "@app/context";

interface ComponentOptions {
  container?: Element | Document;
}

interface MotionLike {
  pause?: () => void;
  play?: () => void;
}

export class Component {
  protected componentName: string;
  protected container: Element | Document;
  protected section: Element | null;
  protected trigger: number;
  protected hasPlayed: boolean;
  protected raf: Raf | null;
  protected motion: MotionLike | null;
  private _resizeId: symbol | null;

  constructor({ container }: ComponentOptions = {}) {
    this.componentName = "";
    this.container = container || document;
    this.section = null;
    this.trigger = 0;
    this.hasPlayed = false;
    this.raf = null;
    this.motion = null;
    this._resizeId = null;
    this.resize = this.resize.bind(this);
  }

  init(container: Element | null, selector: string): void {
    if (!selector) {
      console.error("No selector added.");
      return;
    }
    this.container = container || this.container;
    const root = this.container as Element | Document;
    this.section =
      "querySelector" in root ? root.querySelector(selector) : null;

    if (!this.section) {
      console.warn(
        `[component:${this.componentName || "unknown"}] selector "${selector}" not found`
      );
      return;
    }

    if (!this.section.getAttribute?.("data-component")) {
      this.section.setAttribute?.("data-component", this.componentName);
    }
    this.attachResize(this.resize);
  }

  computeTrigger(): void {
    if (!this.section) return;
    const rect = bounds(this.section);
    const scroll = App.scroller?.current || 0;

    this.trigger = Math.abs(rect.top + scroll - window.innerHeight * 0.5);
  }

  startLoop(): void {
    if (this.raf) return;
    this.raf = new Raf("component", () => this.loop());
    this.raf.run();
  }

  stopLoop(): void {
    if (!this.raf) return;
    this.raf.stop();
    this.raf = null;
  }

  loop(): void {}
  play(): void {}
  resize(): void {}

  destroy(): void {
    this.detachResize();
    this.stopLoop();
    this.motion?.pause?.();
    this.motion = null;
    this.section = null;
    this.trigger = 0;
    this.hasPlayed = false;
  }

  attachResize(
    cb: () => void,
    { immediate = false }: { immediate?: boolean } = {}
  ): void {
    if (typeof cb !== "function") return;
    this.detachResize();
    this._resizeId = ResizeHub.add(cb);
    if (immediate) {
      try {
        cb();
      } catch {}
    }
  }

  detachResize(): void {
    if (!this._resizeId) return;
    ResizeHub.remove(this._resizeId);
    this._resizeId = null;
  }
}

export default Component;
