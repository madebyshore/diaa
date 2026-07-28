type VisibilitySubscriber = {
  start?: (hiddenFor: number) => void;
  stop?: () => void;
};

/**
 * Visibility — wraps the document `visibilitychange` event into a small
 * pub/sub so animation drivers can pause while the tab is backgrounded and
 * resume cleanly when it returns.
 *
 * The critical contract is the value handed to `start`: it is the wall-clock
 * duration (ms) the tab spent hidden, NOT an absolute timestamp. RAF
 * subscribers add this gap to their in-flight `startTime`s so a paused
 * animation resumes exactly where it left off instead of jumping ahead (or,
 * if fed an absolute time, having its clock corrupted). Passing
 * `performance.now()` here — as an earlier version did — poisons every live
 * animation's start time and makes it snap to its end or freeze; that was the
 * root cause of the intermittent "mark appears without fading" glitch when a
 * visibilitychange landed mid-transition.
 */
class Visibility {
  private subs: VisibilitySubscriber[];
  private _isVisible: boolean;
  /**
   * `performance.now()` captured when the tab last went hidden, or null when
   * it has not been hidden since construction. Cleared on each resume so a
   * spurious `visible → visible` event can't replay a stale gap.
   */
  private _hiddenAt: number | null;

  constructor() {
    this.subs = [];
    this._isVisible = true;
    this._hiddenAt = null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.onHidden();
      else this.onVisible();
    });
  }

  /** Whether the tab is currently visible */
  get isVisible(): boolean {
    return this._isVisible;
  }

  add(subscriber: VisibilitySubscriber): void {
    this.subs.push(subscriber);
  }

  /** Tab backgrounded: freeze subscribers and stamp the hide time so the next
   *  resume can measure how long we were gone. */
  onHidden(): void {
    if (!this._isVisible) return;
    this._isVisible = false;
    this._hiddenAt = performance.now();
    for (const s of this.subs) s.stop?.();
  }

  /** Tab foregrounded: hand each subscriber the elapsed hidden duration so it
   *  can shift its clocks forward by exactly that gap. Guarded to 0 on the
   *  first-ever call (never hidden) and against any negative clock skew. */
  onVisible(): void {
    if (this._isVisible) return;
    this._isVisible = true;
    const hiddenFor =
      this._hiddenAt == null
        ? 0
        : Math.max(0, performance.now() - this._hiddenAt);
    this._hiddenAt = null;
    for (const s of this.subs) s.start?.(hiddenFor);
  }
}

export const Tab = new Visibility();
