import { Raf } from "./raf";
import { ResizeHub } from "./resize";
import type { ScrollState, ScrollerConfig, RouteScrollState } from "./types";
import { clamp, damp, round, bindMethod } from "./utils";

type Direction = "vertical" | "horizontal";

/**
 * Native scroll-based smooth scroller.
 * 
 * Uses window.scrollTo() with damped interpolation for smooth native scrolling.
 * API is identical to Scroller for drop-in replacement.
 * 
 * @example
 * ```ts
 * const scroller = new NativeScroller({
 *   container: document.getElementById('app'),
 *   damping: 0.09,
 *   onUpdate: (state) => {
 *     myRenderer.setScrollPosition(state.current);
 *   }
 * });
 * 
 * scroller.registerRoute('/');
 * scroller.setActiveRoute('/');
 * scroller.start();
 * ```
 */
export class NativeScroller {
  private routes: Record<string, RouteScrollState>;
  private url: string;
  public current: number;
  public target: number;
  private min: number;
  private max: number;
  private _isRunning: boolean;
  private isPaused: boolean;
  private _damping: number;
  private listeners: Set<(e: ScrollState) => void>;
  private readonly _raf: Raf;
  private rqd: boolean;

  // Configuration
  private _container: HTMLElement | null;
  private _onUpdate: ((state: ScrollState) => void) | null;

  // Resize subscription
  private resizeId: symbol;

  // Content-size observation — recomputes scroll bounds when the measured
  // element itself changes height (see observeContent()).
  private contentObserver: ResizeObserver | null;

  // Prevent double scroll events
  private _preventNextNativeScrollEvent: boolean;
  private _resetVelocityTimeout: ReturnType<typeof setTimeout> | null;

  // Touch state
  private isTouching: boolean;
  private touchStart: { x: number; y: number };
  private lastTouchPos: number;

  // Wheel/touch multipliers
  private wheelMultiplier: number;
  private touchMultiplier: number;
  private syncTouch: boolean;
  private syncTouchLerp: number;
  private smoothWheel: boolean;
  private keyboard: boolean;

  constructor(config: ScrollerConfig = {}) {
    this.routes = Object.create(null) as Record<string, RouteScrollState>;
    this.url = "/";
    this.current = 0;
    this.target = 0;
    this.min = 0;
    this.max = 0;
    this._isRunning = false;
    this.isPaused = false;
    this.listeners = new Set();
    this.rqd = false;
    this._damping = config.damping ?? 0.09;
    this._preventNextNativeScrollEvent = false;
    this._resetVelocityTimeout = null;
    this.isTouching = false;
    this.touchStart = { x: 0, y: 0 };
    this.lastTouchPos = 0;

    // Extended options (not in base ScrollerConfig, but useful)
    this.wheelMultiplier = 1;
    this.touchMultiplier = 1;
    this.syncTouch = false;
    this.syncTouchLerp = 0.075;
    this.smoothWheel = true;
    this.keyboard = true;

    // Store configuration
    this._container = config.container ?? null;
    this._onUpdate = config.onUpdate ?? null;

    bindMethod(this as unknown as Record<string, unknown>, [
      "loop",
      "resize",
      "handleNativeScroll",
      "onWheel",
      "onTouchStart",
      "onTouchMove",
      "onTouchEnd",
      "onKeyDown",
    ]);

    this._raf = new Raf("scroller", this.loop.bind(this));
    this.resizeId = ResizeHub.add(this.resize.bind(this));
    this.contentObserver = null;
    this.observeContent();
  }

  /**
   * Observe the measured content element for size changes so scroll bounds
   * stay correct when the page grows WITHOUT a window resize — late web-font
   * swaps, image loads, and injected style changes all reflow content
   * silently. ResizeHub only fires on window resize/orientationchange, so
   * without this observer `max` goes stale after any such reflow and the
   * wheel clamp stops the user short of the true bottom of the page.
   */
  private observeContent(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.contentObserver?.disconnect();
    const el = this._container ?? document.body;
    if (!el) return;
    this.contentObserver =
      this.contentObserver ?? new ResizeObserver(() => this.resize());
    this.contentObserver.observe(el);
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
    if (config.container !== undefined) {
      this._container = config.container;
      this.observeContent();
    }
    if (config.onUpdate !== undefined) this._onUpdate = config.onUpdate;
    if (config.damping !== undefined) this._damping = config.damping;
  }

  /**
   * Set the scroll container element
   */
  setContainer(el: HTMLElement | null): void {
    this._container = el;
    this.observeContent();
  }

  /**
   * Subscribe to scroll updates
   */
  subscribe(fn: (e: ScrollState) => void): () => void {
    if (typeof fn !== "function") return () => {};
    this.listeners.add(fn);
    // Immediately call with current state
    try {
      fn(this.getState());
    } catch {
      // ignore
    }
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    if (!this.listeners.size && !this._onUpdate) return;
    const ev = this.getState();

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
    this.resize();
  }

  /**
   * Resize handler - recalculates scroll bounds
   */
  resize(): void {
    const vH = window.innerHeight;
    let contentHeight = document.documentElement.scrollHeight;

    // If using container, measure its content height
    if (this._container) {
      contentHeight = this._container.scrollHeight;
    }

    this.max = Math.max(contentHeight - vH, 0);
    this.max = round(this.max);

    const routeState = this.routes[this.url];
    if (!routeState) return;

    // Re-clamp current and target independently instead of collapsing target
    // onto current (the old updateAll behaviour): a re-measure mid-scroll —
    // content growth via the ResizeObserver, or a window resize — must not
    // cancel an in-flight damped scroll, only bound it to the new limits.
    routeState.current = this.clampValue(routeState.current || 0);
    routeState.target = this.clampValue(routeState.target || 0);
    this.current = routeState.current;
    this.target = routeState.target;
  }

  private handleNativeScroll(): void {
    if (this._resetVelocityTimeout !== null) {
      clearTimeout(this._resetVelocityTimeout);
      this._resetVelocityTimeout = null;
    }

    if (this._preventNextNativeScrollEvent) {
      this._preventNextNativeScrollEvent = false;
      return;
    }

    // Scroll events can't be preventDefault'ed — a scrollbar drag or trailing
    // trackpad momentum still moves the page while paused. Snap the viewport
    // back to the scroller's current position (guarded so we never call
    // setScroll on an already-correct position, which would fire no scroll
    // event and leave a stale _preventNextNativeScrollEvent flag behind).
    if (this.isPaused) {
      const y = round(this.current);
      if ((window.scrollY || 0) !== y) this.setScroll(y);
      return;
    }

    // Sync with native scroll position
    const routeState = this.routes[this.url];
    if (!routeState) return;

    const y = this.clampValue(window.scrollY || 0);
    if (routeState.current !== y) {
      routeState.current = y;
      routeState.target = y;
      this.current = y;
      this.target = y;
      this.rqd = true;
      this.notify();
    }
  }

  private setScroll(value: number): void {
    this._preventNextNativeScrollEvent = true;
    window.scrollTo({ top: value, behavior: "instant" as ScrollBehavior });
  }

  private onWheel(event: WheelEvent): void {
    if (event.ctrlKey) return; // Allow zoom (even while paused)

    // Paused must actually block scrolling: a bare early-return here only
    // skips the smoothing, and the browser's default wheel scroll still moves
    // the page natively (the listener is passive: false precisely so we can
    // preventDefault).
    if (this.isPaused) {
      event.preventDefault();
      return;
    }

    if (!this.smoothWheel) return;

    event.preventDefault();

    let delta = event.deltaY;
    
    // Normalize delta
    if (event.deltaMode === 1) delta *= 40; // Lines
    if (event.deltaMode === 2) delta *= 800; // Pages

    delta *= this.wheelMultiplier;

    this.update(this.target + delta);
  }

  private onTouchStart(event: TouchEvent): void {
    if (this.isPaused) return;
    
    const touch = event.touches[0];
    if (!touch) return;
    
    this.isTouching = true;
    this.touchStart = { x: touch.clientX, y: touch.clientY };
    this.lastTouchPos = touch.clientY;
  }

  private onTouchMove(event: TouchEvent): void {
    // Block native touch scrolling entirely while paused — regardless of
    // isTouching/syncTouch, since in the non-sync mode the browser scrolls
    // natively and only preventDefault can stop it.
    if (this.isPaused) {
      event.preventDefault();
      return;
    }
    if (!this.isTouching) return;
    if (!this.syncTouch) return;

    const touch = event.touches[0];
    if (!touch) return;
    
    const delta = (this.lastTouchPos - touch.clientY) * this.touchMultiplier;
    this.lastTouchPos = touch.clientY;

    const totalDelta = Math.abs(touch.clientY - this.touchStart.y);
    if (totalDelta > 5) {
      event.preventDefault();
      this.update(this.target + delta);
    }
  }

  private onTouchEnd(): void {
    this.isTouching = false;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.keyboard) return;

    // Ignore if in input
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }

    // While paused, swallow the browser's own keyboard scrolling (space,
    // arrows, page/home/end) — an early return alone would let the native
    // default scroll the page.
    if (this.isPaused) {
      switch (event.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "PageUp":
        case "PageDown":
        case "Home":
        case "End":
        case " ":
          event.preventDefault();
      }
      return;
    }

    let delta = 0;
    const step = 100;
    const pageStep = window.innerHeight * 0.9;

    switch (event.key) {
      case "ArrowUp":
        delta = -step;
        break;
      case "ArrowDown":
        delta = step;
        break;
      case "PageUp":
        delta = -pageStep;
        break;
      case "PageDown":
        delta = pageStep;
        break;
      case "Home":
        this.scrollTo(0, true);
        event.preventDefault();
        return;
      case "End":
        this.scrollTo(this.max, true);
        event.preventDefault();
        return;
      case " ": // Spacebar
        delta = event.shiftKey ? -pageStep : pageStep;
        break;
      default:
        return;
    }

    if (delta !== 0) {
      event.preventDefault();
      this.update(this.target + delta);
    }
  }

  private loop(): void {
    this.rqd = false;

    const routeState = this.routes[this.url];
    if (!routeState) {
      this._raf.stop();
      this._isRunning = false;
      return;
    }

    const needsUpdate = Math.abs(routeState.current - routeState.target) > 0.5;

    if (needsUpdate && this._isRunning) {
      const effectiveDamping = this.isTouching ? this.syncTouchLerp : this._damping;
      this.current = routeState.current = damp(
        routeState.current,
        routeState.target,
        effectiveDamping
      );

      // Apply native scroll
      this.setScroll(round(this.current));

      this.rqd = true;
    } else if (Math.abs(routeState.current - routeState.target) <= 0.5 && routeState.current !== routeState.target) {
      // Snap to target
      this.current = routeState.current = routeState.target;
      this.setScroll(round(this.current));
    }

    if (this.rqd) this.notify();
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
    
    const clamped = this.clampValue(value);
    routeState.target = clamped;
    routeState.current = clamped;
    this.current = clamped;
    this.target = clamped;
  }

  /**
   * Scroll to a specific position
   */
  scrollTo(position: number, immediate = false): void {
    if (immediate) {
      this.updateAll(this.clampValue(position));
      this.setScroll(round(this.current));
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
    
    // Attach event listeners
    window.addEventListener("scroll", this.handleNativeScroll.bind(this), { passive: true });
    window.addEventListener("wheel", this.onWheel.bind(this) as EventListener, { passive: false });
    window.addEventListener("touchstart", this.onTouchStart.bind(this) as EventListener, { passive: true });
    window.addEventListener("touchmove", this.onTouchMove.bind(this) as EventListener, { passive: false });
    window.addEventListener("touchend", this.onTouchEnd.bind(this), { passive: true });
    
    if (this.keyboard) {
      window.addEventListener("keydown", this.onKeyDown.bind(this));
    }

    this._raf.run();
  }

  /**
   * Stop the scroller
   */
  stop(): void {
    this._raf.stop();
    this._isRunning = false;

    // Detach event listeners
    window.removeEventListener("scroll", this.handleNativeScroll.bind(this));
    window.removeEventListener("wheel", this.onWheel.bind(this) as EventListener);
    window.removeEventListener("touchstart", this.onTouchStart.bind(this) as EventListener);
    window.removeEventListener("touchmove", this.onTouchMove.bind(this) as EventListener);
    window.removeEventListener("touchend", this.onTouchEnd.bind(this));
    
    if (this.keyboard) {
      window.removeEventListener("keydown", this.onKeyDown.bind(this));
    }
  }

  /**
   * Destroy the scroller and clean up
   */
  destroy(): void {
    this.stop();
    this.listeners.clear();
    ResizeHub.remove(this.resizeId);
    this.contentObserver?.disconnect();
    this.contentObserver = null;

    if (this._resetVelocityTimeout) {
      clearTimeout(this._resetVelocityTimeout);
    }
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
      mode: "native",
      direction: st.direction,
    };
  }
}

export default NativeScroller;
