import { PointerMove } from "./pointer";
import { Raf } from "./raf";
import { ResizeHub } from "./resize";
import type { ScrollState, ScrollerConfig, RouteScrollState } from "./types";
import {
  bindMethod,
  bounds,
  clamp,
  damp,
  preventDefault,
  round,
  Sniff,
  translate3d,
  unequal,
} from "./utils";
import { WheelKeySubscription } from "./wheel";

type Direction = "vertical" | "horizontal";

/**
 * Smooth scroll manager with virtual (transform-based) and native scroll modes.
 *
 * Decoupled from any app context - configure via constructor options and callbacks.
 *
 * @example
 * ```ts
 * const scroller = new Scroller({
 *   container: document.getElementById('app'),
 *   damping: 0.09,
 *   getSections: () => Array.from(document.querySelectorAll('.section')),
 *   onUpdate: (state) => {
 *     // Update WebGL or other systems
 *     myRenderer.setScrollPosition(state.current);
 *   }
 * });
 *
 * scroller.registerRoute('/');
 * scroller.setActiveRoute('/');
 * scroller.start();
 * ```
 */
export class Scroller {
  private routes: Record<string, RouteScrollState>;
  private url: string;
  public current: number;
  public target: number;
  public prev: number;
  public tarPrev: number;
  private min: number;
  private max: number;
  private applyTransforms: boolean;
  private virtualListenersAttached: boolean;
  private nativeScrollAttached: boolean;
  private nativeScrollEl: (Window | Element) | null;
  private nativeScrollPending: boolean;
  private _isRunning: boolean;
  private targets: HTMLElement[];
  private dragStart: { x: number; y: number };
  private readonly wheelSub: WheelKeySubscription;
  private readonly pointerSub: PointerMove;
  private readonly _raf: Raf;
  private rqd: boolean;
  private isDown: boolean;
  private isDrag: boolean;
  private isPaused: boolean;
  private _damping: number;
  private listeners: Set<(e: ScrollState) => void>;
  private measureReq: number | null;

  // Bound event handlers (stored for proper removal)
  private _boundDown: (e: PointerEvent) => void;
  private _boundUp: (e: PointerEvent) => void;
  private _boundNativeScroll: () => void;

  // Configuration
  private _container: HTMLElement | null;
  private _getSections: (() => HTMLElement[]) | null;
  private _onUpdate: ((state: ScrollState) => void) | null;
  private _shouldUseVirtualScroll: (() => boolean) | null;

  constructor(config: ScrollerConfig = {}) {
    this.routes = Object.create(null) as Record<string, RouteScrollState>;
    this.url = "/";
    this.current = 0;
    this.target = 0;
    this.prev = 0;
    this.tarPrev = 0;
    this.min = 0;
    this.max = 0;
    this.applyTransforms = !Sniff.isMobile;
    this.virtualListenersAttached = false;
    this.nativeScrollAttached = false;
    this.nativeScrollEl = null;
    this.nativeScrollPending = false;
    this._isRunning = false;
    this.dragStart = { x: 0, y: 0 };
    this.rqd = false;
    this.targets = [];
    this.isDown = false;
    this.isDrag = false;
    this.isPaused = false;
    this.listeners = new Set();
    this.measureReq = null;
    this._damping = config.damping ?? 0.09;

    // Store configuration
    this._container = config.container ?? null;
    this._getSections = config.getSections ?? null;
    this._onUpdate = config.onUpdate ?? null;
    this._shouldUseVirtualScroll = config.shouldUseVirtualScroll ?? null;

    if (config.forceNative) {
      this.applyTransforms = false;
    }

    bindMethod(this as unknown as Record<string, unknown>, [
      "virtualFn",
      "loop",
      "move",
      "down",
      "up",
      "resize",
      "handleNativeScroll",
    ]);

    // Store bound references for proper add/remove of event listeners
    this._boundDown = this.down.bind(this);
    this._boundUp = this.up.bind(this);
    this._boundNativeScroll = this.handleNativeScroll.bind(this);

    this.wheelSub = new WheelKeySubscription({
      cb: this.virtualFn.bind(this),
      k: false,
    });

    this.pointerSub = new PointerMove({
      cb: this.move.bind(this),
    });

    this._raf = new Raf("scroller", this.loop.bind(this));
    ResizeHub.add(this.resize.bind(this));
  }

  /** Get whether scroller is currently running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Get/set damping factor (0-1) */
  get damping(): number {
    return this._damping;
  }

  set damping(value: number) {
    this._damping = Math.max(0, Math.min(1, value));
  }

  /**
   * Update configuration after construction
   */
  configure(config: Partial<ScrollerConfig>): void {
    if (config.container !== undefined) this._container = config.container;
    if (config.getSections !== undefined)
      this._getSections = config.getSections;
    if (config.onUpdate !== undefined) this._onUpdate = config.onUpdate;
    if (config.shouldUseVirtualScroll !== undefined)
      this._shouldUseVirtualScroll = config.shouldUseVirtualScroll;
    if (config.damping !== undefined) this._damping = config.damping;
    if (config.forceNative !== undefined) {
      this.applyTransforms = !config.forceNative && !Sniff.isMobile;
    }
  }

  /**
   * Set the scroll container element
   */
  setContainer(el: HTMLElement | null): void {
    this._container = el;
  }

  /**
   * Subscribe to scroll updates
   */
  subscribe(fn: (e: ScrollState) => void): () => void {
    if (typeof fn !== "function") return () => {};
    this.listeners.add(fn);
    try {
      const st = this.routes[this.url] ?? {
        current: 0,
        target: 0,
        direction: "vertical" as Direction,
      };
      const ev: ScrollState = {
        url: this.url,
        current: this.current,
        target: this.target,
        min: this.min,
        max: this.max,
        progress: this.max > 0 ? this.current / this.max : 0,
        mode: this.applyTransforms ? "virtual" : "native",
        direction: st.direction,
      };
      fn(ev);
    } catch {
      // ignore
    }
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    if (!this.listeners.size && !this._onUpdate) return;
    const st = this.routes[this.url] ?? {
      current: 0,
      target: 0,
      direction: "vertical" as Direction,
    };
    const ev: ScrollState = {
      url: this.url,
      current: this.current,
      target: this.target,
      min: this.min,
      max: this.max,
      progress: this.max > 0 ? this.current / this.max : 0,
      mode: this.applyTransforms ? "virtual" : "native",
      direction: st.direction,
    };

    // Call onUpdate callback if provided
    if (this._onUpdate) {
      try {
        this._onUpdate(ev);
      } catch {
        // ignore
      }
    }

    for (const cb of this.listeners) {
      try {
        cb(ev);
      } catch {
        // ignore
      }
    }
  }

  private shouldApplyTransforms(): boolean {
    if (this._shouldUseVirtualScroll) {
      const result = this._shouldUseVirtualScroll();
      if (typeof result === "boolean") return result;
    }
    return !Sniff.isMobile;
  }

  private clearTransforms(): void {
    if (!this.targets?.length) return;
    for (const target of this.targets) {
      if (!target) continue;
      target.style.transform = "";
    }
  }

  private attachVirtualListeners(): void {
    if (this.virtualListenersAttached) return;
    this.wheelSub.on();
    this.pointerSub.on();
    document.addEventListener("pointerdown", this._boundDown, {
      passive: false,
    });
    document.addEventListener("pointerup", this._boundUp, {
      passive: false,
    });
    document.addEventListener("pointercancel", this._boundUp, {
      passive: false,
    });
    document.addEventListener("pointerleave", this._boundUp, {
      passive: false,
    });
    this.virtualListenersAttached = true;
  }

  private detachVirtualListeners(): void {
    if (!this.virtualListenersAttached) return;
    this.wheelSub.off();
    this.pointerSub.off();
    document.removeEventListener("pointerdown", this._boundDown);
    document.removeEventListener("pointerup", this._boundUp);
    document.removeEventListener("pointercancel", this._boundUp);
    document.removeEventListener("pointerleave", this._boundUp);
    this.virtualListenersAttached = false;
  }

  private attachNativeScroll(): void {
    if (this.nativeScrollAttached) return;
    const container = this._container;
    let target: Window | Element = window;
    try {
      if (container) {
        const style = getComputedStyle(container);
        const scrollableY = /(auto|scroll)/.test(
          style.overflowY || style.overflow || ""
        );
        const canScroll = container.scrollHeight > container.clientHeight;
        if (scrollableY && canScroll) target = container;
      }
    } catch {
      // ignore
    }

    target.addEventListener("scroll", this._boundNativeScroll, {
      passive: true,
    });
    this.nativeScrollEl = target;
    this.nativeScrollAttached = true;
    this.nativeScrollPending = true;
  }

  private detachNativeScroll(): void {
    if (!this.nativeScrollAttached) return;
    try {
      const el = this.nativeScrollEl ?? window;
      el.removeEventListener("scroll", this._boundNativeScroll);
    } catch {
      // ignore
    }
    this.nativeScrollEl = null;
    this.nativeScrollAttached = false;
  }

  private refreshListeners(): void {
    if (!this._isRunning) return;
    if (this.applyTransforms) {
      this.detachNativeScroll();
      this.attachVirtualListeners();
    } else {
      this.detachVirtualListeners();
      this.attachNativeScroll();
    }
  }

  private updateScrollMode(next: boolean): void {
    if (this.applyTransforms === next) return;
    this.applyTransforms = next;
    if (!this.applyTransforms) {
      this.clearTransforms();
      this.nativeScrollPending = true;
    }
    this.refreshListeners();
  }

  /**
   * Register a route for scroll state tracking
   */
  registerRoute(url: string, state?: Partial<RouteScrollState>): void {
    const normalizedUrl = url !== "/" ? url.replace(/\/$/, "") : "/";
    this.routes[normalizedUrl] = {
      current: state?.current ?? 0,
      target: state?.target ?? 0,
      direction: state?.direction ?? "vertical",
    };
  }

  /**
   * Initialize routes from a map of URLs
   */
  initRoutes(routes: string[] | Record<string, unknown>): void {
    this.routes = Object.create(null) as Record<string, RouteScrollState>;
    const routeKeys = Array.isArray(routes) ? routes : Object.keys(routes);
    for (const routeKey of routeKeys) {
      this.registerRoute(routeKey);
    }
  }

  /**
   * Set the active route (call on navigation)
   */
  setActiveRoute(url?: string): void {
    const u = url ?? location.pathname;
    this.url = u !== "/" ? u.replace(/\/$/, "") : "/";

    const st = this.routes[this.url];
    if (!st) {
      this.routes[this.url] = {
        current: 0,
        target: 0,
        direction: "vertical",
      };
    }

    this.updateAll(0);
    this.updateScrollMode(this.shouldApplyTransforms());
    this.refreshListeners();
    this.resize();
  }

  /**
   * Resize handler - recalculates scroll bounds
   */
  resize(): void {
    const vH = window.innerHeight;
    const sections = this._getSections?.() ?? [];

    this.targets = sections.length
      ? sections
      : this._container
        ? [this._container]
        : [];

    let contentHeight = 0;
    const limit = this.targets.length;
    for (let i = 0; i < limit; i += 1) {
      const target = this.targets[i];
      if (target) contentHeight += bounds(target).height;
    }

    // If using container, measure its height
    if (this._container) {
      contentHeight = bounds(this._container).height;
    }

    this.max = Math.max(contentHeight - vH, 0);
    this.max = round(this.max);

    const routeState = this.routes[this.url];
    if (!routeState) return;

    if (this.applyTransforms) {
      this.updateAll(this.clampValue(routeState.current || 0));
    } else {
      this.detachNativeScroll();
      this.attachNativeScroll();
      this.nativeScrollPending = true;
      this.syncNativeScroll();
    }
  }

  private handleNativeScroll(): void {
    this.nativeScrollPending = true;
    if (this.measureReq != null) cancelAnimationFrame(this.measureReq);
    this.measureReq = requestAnimationFrame(() => {
      this.measureReq = null;
      this.syncNativeScroll();
      this.rqd = true;
      this.notify();
    });
  }

  private syncNativeScroll(): void {
    const routeState = this.routes[this.url];
    if (!routeState) return;
    const raw =
      Math.max(
        0,
        window.scrollY ||
          window.pageYOffset ||
          document.documentElement.scrollTop ||
          this._container?.scrollTop ||
          0
      ) || 0;
    const y = this.clampValue(raw);
    if (routeState.current !== y) {
      routeState.current = y;
      routeState.target = y;
      this.current = y;
      this.target = y;
      this.rqd = true;
    }
  }

  private loop(): void {
    this.rqd = false;

    const routeState = this.routes[this.url];
    if (!routeState) {
      if (this.applyTransforms) this.detachVirtualListeners();
      else this.detachNativeScroll();
      this._raf.stop();
      this._isRunning = false;
      return;
    }

    if (!this.applyTransforms) {
      if (this.nativeScrollPending) {
        this.nativeScrollPending = false;
        this.syncNativeScroll();
      }
      if (this.rqd) this.notify();
      return;
    }

    const routeNeedsUpdate = unequal(routeState.current, routeState.target, 3);

    if (routeNeedsUpdate && this._isRunning) {
      this.current = routeState.current = damp(
        routeState.current,
        routeState.target,
        this._damping
      );
      const limit = this.targets.length;
      for (let i = 0; i < limit; i += 1) {
        const target = this.targets[i];
        if (!target) continue;
        translate3d(target, 0, round(-this.current), "px");
      }

      this.rqd = true;
    }

    if (this.rqd) this.notify();
  }

  private move(
    pointerX: number,
    pointerY: number,
    nativeEvent: PointerEvent
  ): void {
    if (!this.applyTransforms) return;

    preventDefault(nativeEvent);

    if (!this.isDown) return;

    const deltaX = Math.abs(pointerX - this.dragStart.x);
    const deltaY = Math.abs(pointerY - this.dragStart.y);

    this.isDrag = deltaX > 6 || deltaY > 6;

    if (!this.isDrag) return;

    const pointerValue = pointerY;

    if (pointerValue > this.prev && this.target === this.min) {
      this.dragStart.y = pointerValue - (this.tarPrev - this.min) / 2;
    } else if (pointerValue < this.prev && this.target === this.max) {
      this.dragStart.y = pointerValue - (this.tarPrev - this.max) / 2;
    }

    this.prev = pointerValue;

    let nextTarget = -2 * (pointerValue - this.dragStart.y) + this.tarPrev;
    nextTarget = this.clampValue(nextTarget);
    this.target = nextTarget;
    this.update(nextTarget);
  }

  private down(event: PointerEvent): void {
    if (!this.applyTransforms) return;

    preventDefault(event);
    const target = event.target as HTMLElement;
    if (
      target?.tagName === "A" ||
      event.button === 2 ||
      (event.ctrlKey && event.button === 1)
    ) {
      return;
    }

    this.isDown = true;
    this.isDrag = false;

    this.dragStart = {
      x: event.pageX,
      y: event.pageY,
    };
    this.prev = event.pageY;

    const routeState = this.routes[this.url];
    if (!routeState) return;
    this.target = routeState.target;
    this.tarPrev = this.target;
  }

  private up(): void {
    if (!this.isDown) return;
    this.isDown = false;
    this.isDrag = false;
  }

  private virtualFn(delta: number): void {
    if (!this.applyTransforms) return;

    if (this.isDown) return;

    if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0)
      return;

    const routeState = this.routes[this.url];
    if (!routeState) return;

    const nextTarget = this.clampValue(
      (routeState.target ?? this.target ?? 0) + delta
    );
    this.update(nextTarget);
  }

  /**
   * Update target scroll position
   */
  update(targetValue: number): void {
    if (this.isPaused) return;

    const routeState = this.routes[this.url];
    if (!routeState) return;

    const clamped = this.clampValue(targetValue);
    routeState.target = clamped;
    this.target = clamped;
  }

  /**
   * Update both current and target scroll position (instant jump)
   */
  updateAll(value: number): void {
    const routeState = this.routes[this.url];
    if (!routeState) return;
    routeState.target = value;
    routeState.current = value;

    this.current = value;
    this.target = value;
  }

  /**
   * Scroll to a specific position
   */
  scrollTo(position: number, immediate = false): void {
    if (immediate) {
      this.updateAll(this.clampValue(position));
    } else {
      this.update(position);
    }
  }

  /**
   * Scroll by a delta amount
   */
  scrollBy(delta: number): void {
    this.update(this.target + delta);
  }

  private clampValue(value: number): number {
    return round(clamp(value, this.min, this.max));
  }

  /**
   * Pause scrolling
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume scrolling
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Start the scroller (begin RAF loop and attach listeners)
   */
  start(): void {
    this._isRunning = true;
    this.refreshListeners();
    this._raf.run();
  }

  /**
   * Stop the scroller
   */
  stop(): void {
    this._raf.stop();
    this._isRunning = false;
    this.detachVirtualListeners();
    this.detachNativeScroll();
  }

  /**
   * Get current scroll state
   */
  getState(): ScrollState {
    const st = this.routes[this.url] ?? {
      current: 0,
      target: 0,
      direction: "vertical" as Direction,
    };
    return {
      url: this.url,
      current: this.current,
      target: this.target,
      min: this.min,
      max: this.max,
      progress: this.max > 0 ? this.current / this.max : 0,
      mode: this.applyTransforms ? "virtual" : "native",
      direction: st.direction,
    };
  }
}

export default Scroller;
