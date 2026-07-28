import { describe, it, expect, vi } from "vitest";
import { Anima } from "../anima";
import type { AnimaState } from "../anima";

/**
 * Unit tests for the new Anima control API: seek(), setEase(), setTiming(),
 * and the duration/delay/easing property getters.
 *
 * These methods are required by the orchestrator module (Plan 02) to enable
 * playhead scrubbing, live easing-curve editing, and duration/delay mutation
 * without restarting the animation.
 */

describe("Anima.seek()", () => {
  it("seek(0) sets pr=0, prE=0 and calls u() exactly once", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });
    a.seek(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pr).toBeCloseTo(0);
    expect(calls[0]!.prE).toBeCloseTo(0);
  });

  it("seek(1) sets pr=1, prE=1 and calls u() exactly once", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });
    a.seek(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pr).toBeCloseTo(1);
    expect(calls[0]!.prE).toBeCloseTo(1);
  });

  it("seek(0.5) with linear easing sets pr=0.5, prE=0.5", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });
    a.seek(0.5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pr).toBeCloseTo(0.5);
    expect(calls[0]!.prE).toBeCloseTo(0.5);
  });

  it("seek(0.5) with non-linear easing produces prE != pr", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      // oQ = cubicBezier(0.22, 1, 0.36, 1) — strongly ease-out, so prE >> pr at midpoint
      e: "oQ",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });
    a.seek(0.5);
    expect(calls).toHaveLength(1);
    // oQ is strongly ease-out so at t=0.5 the eased value should be well above 0.5
    expect(calls[0]!.pr).toBeCloseTo(0.5);
    expect(calls[0]!.prE).toBeGreaterThan(0.7);
  });

  it("seek() stops any running RAF loop (pause is called internally)", () => {
    const pauseSpy = vi.spyOn(Anima.prototype as unknown as Record<string, () => void>, "pause");
    const a = new Anima({ el: window, d: 1000, e: "linear" });
    a.seek(0.5);
    expect(pauseSpy).toHaveBeenCalled();
    pauseSpy.mockRestore();
  });

  it("seek() on a fresh Anima (never played) uses v.d.origin, not v.d.cur (which is 0)", () => {
    // If seek() incorrectly divided by v.d.cur (=0 on a fresh instance),
    // the elapsed computation would produce NaN/Infinity and pr would be wrong.
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 800,
      e: "linear",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });
    a.seek(0.25);
    expect(calls).toHaveLength(1);
    // Should be close to 0.25 — not NaN, not Infinity, not 1
    expect(calls[0]!.pr).toBeCloseTo(0.25);
    expect(Number.isFinite(calls[0]!.pr)).toBe(true);
  });

  it("seek() clamps values above 1 to 1", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => { calls.push({ pr: state.pr, prE: state.prE }); },
    });
    a.seek(1.5);
    expect(calls[0]!.pr).toBeCloseTo(1);
  });

  it("seek() clamps values below 0 to 0", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => { calls.push({ pr: state.pr, prE: state.prE }); },
    });
    a.seek(-0.5);
    expect(calls[0]!.pr).toBeCloseTo(0);
  });
});

describe("Anima.setEase()", () => {
  it("setEase([0.22, 1, 0.36, 1]) changes easing — prE differs from linear at midpoint", () => {
    const calls: { pr: number; prE: number }[] = [];
    const a = new Anima({
      el: window,
      d: 1000,
      e: "linear",
      u: (state: AnimaState) => {
        calls.push({ pr: state.pr, prE: state.prE });
      },
    });

    // With linear easing, prE ≈ 0.5 at midpoint
    a.seek(0.5);
    const linearPrE = calls[0]!.prE;

    calls.length = 0;

    // Switch to a strongly ease-out curve
    a.setEase([0.22, 1, 0.36, 1]);

    // Now seek(0.5) should yield a different (higher) prE
    a.seek(0.5);
    const easedPrE = calls[0]!.prE;

    expect(linearPrE).toBeCloseTo(0.5);
    expect(easedPrE).toBeGreaterThan(0.7);
  });

  it("setEase('oQ') sets a named preset easing — easing getter returns 'oQ'", () => {
    const a = new Anima({ el: window, d: 1000, e: "linear" });
    a.setEase("oQ");
    expect(a.easing).toBe("oQ");
  });

  it("setEase() updates easing getter to the new value (array)", () => {
    const curve = [0.22, 1, 0.36, 1];
    const a = new Anima({ el: window, d: 1000, e: "linear" });
    a.setEase(curve);
    expect(a.easing).toEqual(curve);
  });
});

describe("Anima.setTiming()", () => {
  it("setTiming(500, 100) updates duration getter to 500 and delay getter to 100", () => {
    const a = new Anima({ el: window, d: 1000, de: 0 });
    a.setTiming(500, 100);
    expect(a.duration).toBe(500);
    expect(a.delay).toBe(100);
  });

  it("setTiming clamps negative duration to 0", () => {
    const a = new Anima({ el: window, d: 1000 });
    a.setTiming(-200, 0);
    expect(a.duration).toBe(0);
  });

  it("setTiming clamps negative delay to 0", () => {
    const a = new Anima({ el: window, d: 1000 });
    a.setTiming(1000, -50);
    expect(a.delay).toBe(0);
  });
});

describe("Anima property getters", () => {
  it("duration getter returns the configured d value", () => {
    const a = new Anima({ el: window, d: 750 });
    expect(a.duration).toBe(750);
  });

  it("delay getter returns the configured de value", () => {
    const a = new Anima({ el: window, d: 500, de: 200 });
    expect(a.delay).toBe(200);
  });

  it("easing getter returns the configured e value (string)", () => {
    const a = new Anima({ el: window, d: 500, e: "o6" });
    expect(a.easing).toBe("o6");
  });

  it("easing getter returns the configured e value (array)", () => {
    const curve = [0.16, 1, 0.3, 1];
    const a = new Anima({ el: window, d: 500, e: curve });
    expect(a.easing).toEqual(curve);
  });
});
