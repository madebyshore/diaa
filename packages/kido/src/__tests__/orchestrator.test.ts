import { describe, it, expect, beforeEach, vi } from "vitest";
import { Anima } from "../anima";
import { AnimaOrchestrator } from "../orchestrator";

// ─── Test helpers exposed via module internals ────────────────────────────────
// We test bezierPath indirectly through the curve editor DOM.
// All tests run in jsdom environment (configured in vitest.config.ts).

/**
 * Unit tests for AnimaOrchestrator — track registration, timeline math, and
 * toggle state.
 *
 * Tests run in jsdom. DOM methods (document.body.appendChild, etc.) are
 * available via the jsdom environment configured in vitest.config.ts.
 *
 * Tests focus on observable public behaviour:
 *   - attach / detach / clear registration
 *   - toggle visibility state and lazy panel mount
 *   - computeMaxExtent / computeTrackPosition timeline math helpers
 *   - seek() per-track delay offset math
 *
 * Panel DOM structure is not exhaustively tested here — visual correctness
 * is verified by hand. Unit tests target the pure logic.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a minimal Anima instance configured with given duration and delay. */
function makeAnima(d: number, de = 0): Anima {
  return new Anima({ el: window, d, de, e: "linear" });
}

// ─── Track registration ──────────────────────────────────────────────────────

describe("AnimaOrchestrator.attach()", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("adds a track to the internal tracks list on attach()", () => {
    const a = makeAnima(1000);
    orch.attach(a, "title");
    expect(orch.trackCount).toBe(1);
  });

  it("attach() with the same label replaces the existing track (no duplicates)", () => {
    const a1 = makeAnima(500);
    const a2 = makeAnima(800);
    orch.attach(a1, "hero");
    orch.attach(a2, "hero");
    expect(orch.trackCount).toBe(1);
  });

  it("attach() with different labels results in multiple tracks", () => {
    orch.attach(makeAnima(400), "alpha");
    orch.attach(makeAnima(600), "beta");
    orch.attach(makeAnima(300), "gamma");
    expect(orch.trackCount).toBe(3);
  });
});

describe("AnimaOrchestrator.detach()", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("detach() removes a track by label", () => {
    orch.attach(makeAnima(1000), "remove-me");
    orch.detach("remove-me");
    expect(orch.trackCount).toBe(0);
  });

  it("detach() with a non-existent label does nothing", () => {
    orch.attach(makeAnima(1000), "keep");
    orch.detach("phantom");
    expect(orch.trackCount).toBe(1);
  });
});

describe("AnimaOrchestrator.clear()", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("clear() removes all tracks", () => {
    orch.attach(makeAnima(400), "a");
    orch.attach(makeAnima(600), "b");
    orch.clear();
    expect(orch.trackCount).toBe(0);
  });
});

// ─── Toggle / panel visibility ───────────────────────────────────────────────

describe("AnimaOrchestrator.toggle()", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("toggle() mounts the panel DOM on the first call (lazy mount)", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    orch.toggle();
    expect(appendSpy).toHaveBeenCalled();
    appendSpy.mockRestore();
  });

  it("toggle() sets panel display to 'flex' on the first call (visible)", () => {
    orch.toggle();
    expect(orch.panelDisplay).toBe("flex");
  });

  it("toggle() sets panel display to 'none' on the second call (hidden)", () => {
    orch.toggle();
    orch.toggle();
    expect(orch.panelDisplay).toBe("none");
  });

  it("toggle() re-shows the panel on the third call", () => {
    orch.toggle();
    orch.toggle();
    orch.toggle();
    expect(orch.panelDisplay).toBe("flex");
  });
});

// ─── Timeline math ───────────────────────────────────────────────────────────

describe("AnimaOrchestrator timeline math helpers", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("computeMaxExtent returns 0 when no tracks are attached", () => {
    expect(orch.computeMaxExtent()).toBe(0);
  });

  it("computeMaxExtent returns max(de + d) across all tracks", () => {
    // track A: delay=0, duration=1000, extent=1000
    // track B: delay=200, duration=1200, extent=1400
    // track C: delay=500, duration=600,  extent=1100
    orch.attach(makeAnima(1000, 0), "a");
    orch.attach(makeAnima(1200, 200), "b");
    orch.attach(makeAnima(600, 500), "c");
    expect(orch.computeMaxExtent()).toBe(1400);
  });

  it("computeTrackPosition returns left%=0 and correct width% for zero-delay track", () => {
    // maxExtent=2000, delay=0, duration=1000 → left=0%, width=50%
    const pos = orch.computeTrackPosition(0, 1000, 2000);
    expect(pos.leftPct).toBeCloseTo(0);
    expect(pos.widthPct).toBeCloseTo(50);
  });

  it("computeTrackPosition returns correct left% and width% for delayed track", () => {
    // maxExtent=2000, delay=500, duration=1000 → left=25%, width=50%
    const pos = orch.computeTrackPosition(500, 1000, 2000);
    expect(pos.leftPct).toBeCloseTo(25);
    expect(pos.widthPct).toBeCloseTo(50);
  });

  it("computeTrackPosition clamps to 100 even if bar would exceed timeline", () => {
    // delay=1800, duration=1000, maxExtent=2000 → left=90%, bar would end at 140%
    // width should be clamped so left+width <= 100
    const pos = orch.computeTrackPosition(1800, 1000, 2000);
    expect(pos.leftPct + pos.widthPct).toBeLessThanOrEqual(100);
  });
});

// ─── Seek with delay offset ──────────────────────────────────────────────────

describe("AnimaOrchestrator.seek() with delay offsets", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("seek(0) calls anima.seek(0) for a track with no delay", () => {
    const a = makeAnima(1000, 0);
    const spy = vi.spyOn(a, "seek");
    orch.attach(a, "no-delay");
    orch.seek(0);
    expect(spy).toHaveBeenCalledWith(0);
  });

  it("seek(1) calls anima.seek(1) for a track with no delay", () => {
    const a = makeAnima(1000, 0);
    const spy = vi.spyOn(a, "seek");
    orch.attach(a, "no-delay");
    orch.seek(1);
    expect(spy).toHaveBeenCalledWith(1);
  });

  it("seek(0) calls anima.seek(0) for a track whose delay starts after the playhead", () => {
    // maxExtent = 0 + 1000 = 1000 (just one track, delay=500, duration=500)
    // global ms at t=0 → 0ms. Track delay = 500ms, so localMs = -500ms → seek(0)
    const a = makeAnima(500, 500);
    const spy = vi.spyOn(a, "seek");
    orch.attach(a, "delayed");
    orch.seek(0); // playhead at 0ms, track doesn't start until 500ms
    expect(spy).toHaveBeenCalledWith(0);
  });

  it("seek(1) calls anima.seek(1) once all tracks have completed", () => {
    const a = makeAnima(500, 200);
    const spy = vi.spyOn(a, "seek");
    orch.attach(a, "delayed");
    orch.seek(1); // playhead at end → all tracks should be at progress 1
    expect(spy).toHaveBeenCalledWith(1);
  });
});

// ─── Curve editor DOM structure ───────────────────────────────────────────────

describe("AnimaOrchestrator curve editor", () => {
  let orch: AnimaOrchestrator;

  beforeEach(() => {
    orch = new AnimaOrchestrator();
  });

  it("_buildCurveEditor returns an element containing an SVG with a path and two circles", () => {
    const a = makeAnima(1000);
    orch.attach(a, "curve-test");
    // Mount the panel so track rows are created
    orch.toggle();

    // Access the private _buildCurveEditor via the class cast (test-only access)
    type OrchestratorWithEditor = AnimaOrchestrator & {
      _buildCurveEditor: (track: { anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }) => HTMLElement;
      _tracks: Array<{ anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }>;
    };
    const orchPrivate = orch as unknown as OrchestratorWithEditor;
    const track = orchPrivate._tracks[0];
    if (!track) throw new Error("Expected track to exist after attach");

    const editor = orchPrivate._buildCurveEditor(track);

    // Must have an SVG child
    const svgEl = editor.querySelector("svg");
    expect(svgEl).not.toBeNull();

    // SVG must have a path (the curve)
    const pathEl = svgEl?.querySelector("path");
    expect(pathEl).not.toBeNull();

    // SVG must have exactly two circles (the handles)
    const circles = svgEl?.querySelectorAll("circle");
    expect(circles?.length).toBe(2);
  });

  it("Preset click updates the anima easing via setEase()", () => {
    const a = makeAnima(1000);
    const spy = vi.spyOn(a, "setEase");
    orch.attach(a, "preset-test");
    orch.toggle();

    type OrchestratorWithEditor = AnimaOrchestrator & {
      _buildCurveEditor: (track: { anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }) => HTMLElement;
      _tracks: Array<{ anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }>;
    };
    const orchPrivate = orch as unknown as OrchestratorWithEditor;
    const track = orchPrivate._tracks[0];
    if (!track) throw new Error("Expected track to exist after attach");

    const editor = orchPrivate._buildCurveEditor(track);

    // Find the first preset button (linear) and click it
    const firstBtn = editor.querySelector("button") as HTMLButtonElement | null;
    expect(firstBtn).not.toBeNull();
    firstBtn?.click();

    // setEase should have been called with the linear preset values
    expect(spy).toHaveBeenCalledWith([0, 0, 1, 1]);
  });

  it("bezierPath produces correct SVG path for linear preset (x1=0,y1=0,x2=1,y2=1)", () => {
    const a = makeAnima(1000);
    orch.attach(a, "bezier-path-test");
    orch.toggle();

    type OrchestratorWithEditor = AnimaOrchestrator & {
      _buildCurveEditor: (track: { anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }) => HTMLElement;
      _tracks: Array<{ anima: Anima; label: string; color: string; row: HTMLElement | null; curveThumb: SVGSVGElement | null; expanded: boolean }>;
    };
    const orchPrivate = orch as unknown as OrchestratorWithEditor;
    const track = orchPrivate._tracks[0];
    if (!track) throw new Error("Expected track to exist after attach");

    // Set easing to linear before building editor
    a.setEase([0, 0, 1, 1]);
    const editor = orchPrivate._buildCurveEditor(track);

    const svgEl = editor.querySelector("svg");
    const pathEl = svgEl?.querySelector("path");
    // Linear: M 0,150 C 0,150 200,0 200,0
    // x1=0*200=0, y1=150-0*150=150, x2=1*200=200, y2=150-1*150=0
    expect(pathEl?.getAttribute("d")).toBe("M 0,150 C 0,150 200,0 200,0");
  });
});
