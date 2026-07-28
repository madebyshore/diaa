/**
 * Unit tests for kido utility functions (clamp, lerp, aLerp, iLerp, round, unequal)
 * These are pure functions with no DOM or GPU dependencies.
 */

import { describe, it, expect } from "vitest";
import { clamp, lerp, aLerp, iLerp, round, unequal } from "../utils";

describe("clamp", () => {
  it("returns value unchanged when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min when below range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max when above range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns min when min === max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe("lerp", () => {
  it("returns start value at t=0", () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });

  it("returns end value at t=1", () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it("handles negative ranges", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe("aLerp", () => {
  it("returns a at t=0", () => {
    expect(aLerp(2, 8, 0)).toBe(2);
  });

  it("returns b at t=1", () => {
    expect(aLerp(2, 8, 1)).toBe(8);
  });

  it("produces same result as lerp for simple case", () => {
    expect(aLerp(0, 100, 0.25)).toBeCloseTo(25);
  });
});

describe("iLerp", () => {
  it("returns 0 when value equals start", () => {
    expect(iLerp(0, 100, 0)).toBe(0);
  });

  it("returns 1 when value equals end", () => {
    expect(iLerp(0, 100, 100)).toBe(1);
  });

  it("returns 0.5 for midpoint", () => {
    expect(iLerp(0, 100, 50)).toBe(0.5);
  });

  it("clamps below 0 when value < start", () => {
    expect(iLerp(0, 100, -10)).toBe(0);
  });

  it("clamps above 1 when value > end", () => {
    expect(iLerp(0, 100, 110)).toBe(1);
  });
});

describe("round", () => {
  it("rounds to 3 decimal places by default", () => {
    expect(round(1.23456789)).toBe(1.235);
  });

  it("rounds to specified precision", () => {
    expect(round(1.23456789, 2)).toBe(1.23);
    expect(round(1.23456789, 0)).toBe(1);
  });

  it("handles integers correctly", () => {
    expect(round(42, 3)).toBe(42);
  });
});

describe("unequal", () => {
  it("returns false for equal values", () => {
    expect(unequal(1.000001, 1.000002, 3)).toBe(false);
  });

  it("returns true for meaningfully different values", () => {
    expect(unequal(1.0, 1.1, 3)).toBe(true);
  });

  it("uses precision to determine equality", () => {
    expect(unequal(1.001, 1.002, 2)).toBe(false);
    expect(unequal(1.01, 1.02, 2)).toBe(true);
  });
});
