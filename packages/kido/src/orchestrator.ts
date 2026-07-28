/**
 * orchestrator.ts — Dev-time animation timeline overlay for Anima instances.
 *
 * Provides a toggleable docked panel (theatre.js–inspired) for sequencing,
 * editing, and previewing Anima-driven animations with visual easing curves,
 * duration controls, and transport (play/pause/replay/scrub).
 *
 * Usage:
 *   import { orchestrator } from "kido/orchestrator";
 *   orchestrator.attach(myAnima, "hero-fade");
 *   orchestrator.toggle(); // show panel
 *
 * This module is intended for dev-mode only. Consumers must guard imports
 * with `if (import.meta.env.DEV)` to tree-shake it from production builds.
 *
 * All panel styles are applied via inline JavaScript (el.style.*) — zero
 * external CSS files are required or created.
 */

import type { Anima } from "./anima";
import { clamp } from "./utils";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Named easing presets for the curve editor preset buttons.
 *
 * Each entry maps a human-readable label to its cubic-bezier control
 * points [x1, y1, x2, y2]. These match kido's Ease map names so the
 * preset click can call both setEase(label) for named curves and update
 * the SVG visualisation using the resolved control points.
 */
const PRESETS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  oQ: [0.22, 1, 0.36, 1],
  oC: [0, 0.55, 0.45, 1],
  o6: [0.16, 1, 0.3, 1],
  io: [0.87, 0, 0.13, 1],
  codrops: [0.38, 0.05, 0.65, 0.82],
};

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Represents one Anima instance registered for timeline control.
 *
 * Holds the Anima reference, its display label, assigned palette color, and
 * lazy-mounted DOM elements for the track row and easing curve thumbnail.
 */
interface Track {
  anima: Anima;
  label: string;
  color: string;
  row: HTMLElement | null;
  curveThumb: SVGSVGElement | null;
  expanded: boolean;
}

/**
 * Result of computeTrackPosition() — the bar's left% and width% within the
 * full timeline area, clamped so left+width never exceeds 100.
 */
interface TrackPosition {
  leftPct: number;
  widthPct: number;
}

/**
 * Track bar colour palette — assigned to tracks in order and cycled.
 *
 * Chosen to be visually distinct on the dark panel background (#1a1a2e).
 */
const PALETTE: readonly string[] = [
  "#ff6b6b",
  "#4ecdc4",
  "#45b7d1",
  "#96ceb4",
  "#ffeaa7",
  "#dda0dd",
  "#98d8c8",
  "#f7dc6f",
];

// ─── AnimaOrchestrator ───────────────────────────────────────────────────────

export class AnimaOrchestrator {
  // ── Private state ──────────────────────────────────────────────────────────

  /** All registered tracks, in attach order. */
  private _tracks: Track[] = [];

  /** Lazy-mounted root panel element. Null until toggle() is first called. */
  private _panel: HTMLElement | null = null;

  /** Whether the panel is currently visible. */
  private _visible: boolean = false;

  /** Global playhead position in normalized [0, 1]. */
  private _playhead: number = 0;

  /**
   * Whether the transport is actively playing.
   *
   * Set by play() and pause(). Exposed via the isPlaying getter so the
   * transport bar can reflect state in Plan 03's time cursor animation.
   */
  private _isPlaying: boolean = false;

  /** Scrollable container that holds all track rows and the playhead line. */
  private _trackContainer: HTMLElement | null = null;

  /** Vertical playhead indicator line (positioned via left%). */
  private _playheadLine: HTMLElement | null = null;

  /**
   * The timeline region element (used for pointer-event scrub detection and
   * for re-mounting scrub listeners when new tracks are added in Plan 03).
   *
   * Stored on the instance so _wireScrub can be called again if the container
   * is rebuilt. Currently set during _mount() and read by _renderTrack().
   * Declared here to keep the shape stable across plans.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private _timelineArea: HTMLElement | null = null;

  /**
   * Keyboard listener stored for cleanup in destroy().
   * Listens for the backtick key to toggle the panel.
   */
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── Test-only helpers (not documented in public API) ──────────────────────

  /**
   * Number of currently registered tracks.
   *
   * Exposed for unit tests so they can assert registration state without
   * reaching into private _tracks. Not part of the public production API.
   */
  get trackCount(): number {
    return this._tracks.length;
  }

  /**
   * Current panel display value — "flex" when visible, "none" when hidden.
   *
   * Exposed for unit tests that need to assert toggle state. Returns "none"
   * when the panel has not yet been mounted (toggle() never called).
   */
  get panelDisplay(): string {
    if (!this._panel) return "none";
    return this._panel.style.display;
  }

  /**
   * Whether the transport is currently in a playing state.
   *
   * Reflects the last call to play() or pause(). Useful for Plan 03's
   * time-cursor RAF loop which checks this flag each frame to decide
   * whether to advance the playhead display.
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a live Anima instance under the given label.
   *
   * If a track with the same label already exists, it is replaced in-place
   * so the timeline never shows duplicate rows. If the panel is already
   * mounted, the new track row is rendered immediately.
   *
   * @param anima - The Anima instance to attach.
   * @param label - Display name shown in the label column.
   */
  attach(anima: Anima, label: string): void {
    console.debug("[kido:orchestrator] attach", label);
    // Register the keyboard shortcut on the first attach — can't wait for
    // _mount() because _mount() is only called from toggle(), and toggle()
    // can't fire without the listener. This breaks the chicken-and-egg.
    if (!this._keyHandler) {
      this._keyHandler = (e: KeyboardEvent) => {
        if (e.key === "`") this.toggle();
      };
      document.addEventListener("keydown", this._keyHandler);
    }
    const existing = this._tracks.findIndex((t) => t.label === label);
    const colorIndex = existing >= 0 ? existing : this._tracks.length;
    const track: Track = {
      anima,
      label,
      color: PALETTE[colorIndex % PALETTE.length] as string,
      row: null,
      curveThumb: null,
      expanded: false,
    };
    if (existing >= 0) {
      // Remove old DOM row before replacing the track record
      const oldRow = this._tracks[existing]?.row;
      if (oldRow?.parentNode) oldRow.parentNode.removeChild(oldRow);
      this._tracks[existing] = track;
    } else {
      this._tracks.push(track);
    }
    // If the panel is already mounted, render this track immediately
    if (this._trackContainer) {
      this._renderTrack(track, this._tracks.indexOf(track));
    }
  }

  /**
   * Remove a registered track by label.
   *
   * Also removes its DOM row from the panel if the panel is mounted.
   * No-op if the label is not found.
   *
   * @param label - The label to remove.
   */
  detach(label: string): void {
    console.debug("[kido:orchestrator] detach", label);
    const idx = this._tracks.findIndex((t) => t.label === label);
    if (idx < 0) return;
    const row = this._tracks[idx]?.row;
    if (row?.parentNode) row.parentNode.removeChild(row);
    this._tracks.splice(idx, 1);
  }

  /**
   * Remove all registered tracks and their DOM rows.
   *
   * Does not remove or unmount the panel itself — use destroy() for full teardown.
   */
  clear(): void {
    console.debug("[kido:orchestrator] clear");
    for (const track of this._tracks) {
      if (track.row?.parentNode) track.row.parentNode.removeChild(track.row);
    }
    this._tracks = [];
  }

  /**
   * Show or hide the docked timeline panel.
   *
   * Lazy-mounts the panel on first call. Subsequent calls alternate between
   * display:flex and display:none.
   */
  toggle(): void {
    console.debug("[kido:orchestrator] toggle", !this._visible);
    if (!this._panel) {
      this._mount();
    }
    this._visible = !this._visible;
    if (this._panel) {
      this._panel.style.display = this._visible ? "flex" : "none";
    }
  }

  /**
   * Start playback for all attached Anima instances.
   *
   * Calls play({}) on each track, which resets each Anima from its
   * currently stored progress.
   */
  play(): void {
    console.debug("[kido:orchestrator] play");
    this._isPlaying = true;
    for (const track of this._tracks) {
      track.anima.play({});
    }
  }

  /**
   * Pause all attached Anima instances.
   *
   * Stops their RAF loops without resetting progress so resume (via play())
   * or seek() can continue from where they were.
   */
  pause(): void {
    console.debug("[kido:orchestrator] pause");
    this._isPlaying = false;
    for (const track of this._tracks) {
      track.anima.pause();
    }
  }

  /**
   * Replay all attached Anima instances from the beginning.
   *
   * Resets each Anima to t=0 and starts playback immediately.
   */
  replay(): void {
    console.debug("[kido:orchestrator] replay");
    for (const track of this._tracks) {
      track.anima.play({});
    }
    this._playhead = 0;
    this._updatePlayheadPosition();
  }

  /**
   * Scrub the global playhead to normalized position `t` in [0, 1].
   *
   * Each track's local seek position accounts for its individual delay offset:
   * a track with delay > 0 will show progress 0 until the global playhead
   * advances past the delay, then progress proportionally from there.
   *
   * Updates the playhead line position in the panel if mounted.
   *
   * @param t - Normalized playhead position [0, 1].
   */
  seek(t: number): void {
    console.debug("[kido:orchestrator] seek", t);
    this._playhead = clamp(t, 0, 1);
    const maxExtent = this.computeMaxExtent();
    const globalMs = this._playhead * maxExtent;
    for (const track of this._tracks) {
      const localMs = globalMs - track.anima.delay;
      const localT =
        track.anima.duration > 0
          ? clamp(localMs / track.anima.duration, 0, 1)
          : localMs >= 0
            ? 1
            : 0;
      track.anima.seek(localMs < 0 ? 0 : localT);
    }
    this._updatePlayheadPosition();
  }

  /**
   * Fully tear down the orchestrator — removes the panel from the DOM,
   * removes the keyboard shortcut listener, and clears all tracks.
   *
   * Call this in cleanup/unmount hooks when the orchestrator is no longer
   * needed (e.g. before hot-module reload in development).
   */
  destroy(): void {
    console.debug("[kido:orchestrator] destroy");
    if (this._panel?.parentNode) {
      this._panel.parentNode.removeChild(this._panel);
    }
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }
    this._tracks = [];
    this._panel = null;
    this._trackContainer = null;
    this._playheadLine = null;
    this._timelineArea = null;
    this._visible = false;
  }

  // ── Timeline math (exposed for unit tests) ─────────────────────────────────

  /**
   * Compute the maximum timeline extent across all registered tracks.
   *
   * Extent for a single track = delay + duration. The maximum governs the
   * total timeline duration that the playhead scrubs over.
   *
   * Returns 0 when no tracks are registered.
   */
  computeMaxExtent(): number {
    if (this._tracks.length === 0) return 0;
    let max = 0;
    for (const track of this._tracks) {
      const extent = track.anima.delay + track.anima.duration;
      if (extent > max) max = extent;
    }
    return max;
  }

  /**
   * Compute the left% and width% for a track bar within the timeline area.
   *
   * @param delay      - Track delay in milliseconds.
   * @param duration   - Track duration in milliseconds.
   * @param maxExtent  - The full timeline extent (computeMaxExtent() result).
   *
   * @returns { leftPct, widthPct } — both in [0, 100], clamped so they
   *   don't overflow the timeline right edge.
   */
  computeTrackPosition(
    delay: number,
    duration: number,
    maxExtent: number
  ): TrackPosition {
    if (maxExtent <= 0) return { leftPct: 0, widthPct: 0 };
    const leftPct = clamp((delay / maxExtent) * 100, 0, 100);
    const rawWidth = (duration / maxExtent) * 100;
    const widthPct = clamp(rawWidth, 0, 100 - leftPct);
    return { leftPct, widthPct };
  }

  // ── Private DOM construction ───────────────────────────────────────────────

  /**
   * Create and mount the full panel DOM structure.
   *
   * Called lazily from toggle() on the first invocation. All styles are
   * applied via el.style.* — no CSS files or class names are used.
   */
  private _mount(): void {
    console.debug("[kido:orchestrator] mount");

    // ── Root panel ──────────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.bottom = "0";
    panel.style.left = "0";
    panel.style.right = "0";
    panel.style.height = "250px";
    panel.style.background = "#1a1a2e";
    panel.style.borderTop = "1px solid #333";
    panel.style.zIndex = "99999";
    panel.style.display = "none"; // toggled to "flex" after mount
    panel.style.flexDirection = "column";
    panel.style.fontFamily = "monospace";
    panel.style.color = "#e0e0e0";
    panel.style.fontSize = "12px";
    panel.style.userSelect = "none";
    panel.style.boxSizing = "border-box";
    this._panel = panel;

    // ── Resize handle ───────────────────────────────────────────────────────
    const resizeHandle = document.createElement("div");
    resizeHandle.style.height = "6px";
    resizeHandle.style.cursor = "ns-resize";
    resizeHandle.style.background = "#333";
    resizeHandle.style.flexShrink = "0";
    resizeHandle.style.transition = "background 0.15s";
    resizeHandle.addEventListener("mouseenter", () => {
      resizeHandle.style.background = "#555";
    });
    resizeHandle.addEventListener("mouseleave", () => {
      resizeHandle.style.background = "#333";
    });
    this._wireResizeHandle(resizeHandle, panel);
    panel.appendChild(resizeHandle);

    // ── Transport bar ───────────────────────────────────────────────────────
    const transport = document.createElement("div");
    transport.style.height = "36px";
    transport.style.display = "flex";
    transport.style.alignItems = "center";
    transport.style.gap = "8px";
    transport.style.padding = "0 12px";
    transport.style.borderBottom = "1px solid #333";
    transport.style.background = "#16162a";
    transport.style.flexShrink = "0";

    const btnStyle = (btn: HTMLButtonElement): void => {
      btn.style.background = "transparent";
      btn.style.border = "1px solid #444";
      btn.style.color = "#e0e0e0";
      btn.style.borderRadius = "3px";
      btn.style.padding = "2px 8px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "14px";
      btn.style.lineHeight = "1.4";
      btn.style.fontFamily = "monospace";
    };

    // Play button ▶
    const playBtn = document.createElement("button");
    playBtn.textContent = "\u25B6";
    btnStyle(playBtn);
    playBtn.addEventListener("click", () => this.play());

    // Pause button ⏸
    const pauseBtn = document.createElement("button");
    pauseBtn.textContent = "\u23F8";
    btnStyle(pauseBtn);
    pauseBtn.addEventListener("click", () => this.pause());

    // Replay button ↺
    const replayBtn = document.createElement("button");
    replayBtn.textContent = "\u21BA";
    btnStyle(replayBtn);
    replayBtn.addEventListener("click", () => this.replay());

    // Time display
    const timeDisplay = document.createElement("span");
    timeDisplay.style.marginLeft = "8px";
    timeDisplay.style.color = "#888";
    timeDisplay.style.fontSize = "11px";
    timeDisplay.textContent = "0ms / 0ms";
    this._updateTimeDisplay(timeDisplay);

    transport.appendChild(playBtn);
    transport.appendChild(pauseBtn);
    transport.appendChild(replayBtn);
    transport.appendChild(timeDisplay);
    panel.appendChild(transport);

    // ── Track container ─────────────────────────────────────────────────────
    const trackContainer = document.createElement("div");
    trackContainer.style.flex = "1";
    trackContainer.style.overflowY = "auto";
    trackContainer.style.overflowX = "hidden";
    trackContainer.style.position = "relative";
    this._trackContainer = trackContainer;
    this._timelineArea = trackContainer;
    panel.appendChild(trackContainer);

    // ── Playhead line ───────────────────────────────────────────────────────
    const playheadLine = document.createElement("div");
    playheadLine.style.position = "absolute";
    playheadLine.style.top = "0";
    playheadLine.style.bottom = "0";
    playheadLine.style.width = "1px";
    playheadLine.style.background = "#ff6b6b";
    playheadLine.style.pointerEvents = "none";
    playheadLine.style.zIndex = "1";
    playheadLine.style.left = "0%";
    this._playheadLine = playheadLine;
    trackContainer.appendChild(playheadLine);

    // ── Render existing tracks (if any were attached before toggle) ─────────
    this._renderTracks(timeDisplay);

    // ── Wire playhead scrub on the timeline area ────────────────────────────
    // Use this._timelineArea (same ref as trackContainer) so the field is
    // read here and available as a re-wire target in Plan 03.
    this._wireScrub(this._timelineArea, timeDisplay);

    document.body.appendChild(panel);
  }

  /**
   * Build a single easing curve thumbnail SVG for a track.
   *
   * Renders a 40x30 SVG showing the cubic-bezier path for the track's
   * current easing curve. Named presets are resolved to their control
   * points; array curves are used directly. Straight diagonal shown as
   * fallback for linear or unrecognised presets.
   *
   * @param track - The track whose easing to visualise.
   */
  private _buildCurveThumb(track: Track): SVGSVGElement {
    const W = 40;
    const H = 30;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.flexShrink = "0";
    svg.style.opacity = "0.8";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    // Resolve easing control points for named presets
    const PRESET_POINTS: Record<string, [number, number, number, number]> = {
      linear: [0, 0, 1, 1],
      o6: [0.16, 1.0, 0.3, 1.0],
      io6: [0.87, 0.0, 0.13, 1.0],
      oC: [0.0, 0.55, 0.45, 1.0],
      oQ: [0.22, 1, 0.36, 1],
      o2: [0.5, 1.0, 0.89, 1.0],
      i1: [0.55, 0.055, 0.675, 0.19],
      i3: [0.55, 0.085, 0.68, 0.53],
      o1: [0.215, 0.61, 0.355, 1.0],
      o3: [0.25, 0.46, 0.45, 0.94],
      codrops: [0.38, 0.05, 0.65, 0.82],
    };

    const curve = track.anima.easing;
    let x1 = 0,
      y1 = 0,
      x2 = 1,
      y2 = 1;

    if (typeof curve === "string") {
      const pts = PRESET_POINTS[curve] ?? PRESET_POINTS["linear"];
      if (pts) [x1, y1, x2, y2] = pts;
    } else if (Array.isArray(curve) && curve.length >= 4) {
      [x1, y1, x2, y2] = [
        curve[0] ?? 0,
        curve[1] ?? 0,
        curve[2] ?? 1,
        curve[3] ?? 1,
      ];
    }

    // SVG cubic-bezier from (0,H) → (W,0) with control points scaled to W×H
    const d = `M 0,${H} C ${x1 * W},${H - y1 * H} ${x2 * W},${H - y2 * H} ${W},0`;
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", track.color);
    path.setAttribute("stroke-width", "1.5");
    svg.appendChild(path);

    return svg;
  }

  /**
   * Build one complete track row element for the timeline.
   *
   * Comprises a label column, an animated duration bar (with delay spacer),
   * and a cubic-bezier easing thumbnail SVG. The returned element is stored
   * on track.row for subsequent removal/replacement.
   *
   * @param track      - The track to render.
   * @param maxExtent  - The full timeline extent used for bar sizing.
   */
  private _buildTrack(track: Track, maxExtent: number): HTMLElement {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.height = "40px";
    row.style.alignItems = "center";
    row.style.borderBottom = "1px solid #2a2a3e";
    row.style.boxSizing = "border-box";

    // ── Label column ────────────────────────────────────────────────────────
    const label = document.createElement("div");
    label.style.width = "120px";
    label.style.minWidth = "120px";
    label.style.padding = "0 8px";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.style.whiteSpace = "nowrap";
    label.style.color = "#aaa";
    label.style.fontSize = "11px";
    label.textContent = track.label;
    row.appendChild(label);

    // ── Timeline bar area ───────────────────────────────────────────────────
    const barArea = document.createElement("div");
    barArea.style.flex = "1";
    barArea.style.position = "relative";
    barArea.style.height = "100%";
    barArea.style.overflow = "hidden";
    barArea.style.display = "flex";
    barArea.style.alignItems = "center";

    const { leftPct, widthPct } = this.computeTrackPosition(
      track.anima.delay,
      track.anima.duration,
      maxExtent
    );

    // Delay spacer — invisible block that pushes the bar right
    const spacer = document.createElement("span");
    spacer.style.display = "inline-block";
    spacer.style.width = `${leftPct}%`;
    spacer.style.flexShrink = "0";
    barArea.appendChild(spacer);

    // Duration bar — colored rounded rect
    const bar = document.createElement("span");
    bar.style.display = "inline-block";
    bar.style.width = `${widthPct}%`;
    bar.style.minWidth = "4px";
    bar.style.height = "24px";
    bar.style.borderRadius = "3px";
    bar.style.background = track.color;
    bar.style.flexShrink = "0";
    bar.style.marginTop = "0"; // vertically centred by flex align
    barArea.appendChild(bar);

    row.appendChild(barArea);

    // ── Duration and delay number inputs ─────────────────────────────────────
    // These sit between the bar area and the easing thumbnail so the user
    // can tune timing values without opening the curve editor.
    const inputGroup = document.createElement("div");
    inputGroup.style.display = "flex";
    inputGroup.style.alignItems = "center";
    inputGroup.style.gap = "4px";
    inputGroup.style.padding = "0 6px";
    inputGroup.style.flexShrink = "0";

    /** Build a labelled number input for a timing property. */
    const makeTimingInput = (
      labelText: string,
      initialValue: number,
      step: number,
      onChange: (v: number) => void
    ): HTMLElement => {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "2px";

      const lbl = document.createElement("span");
      lbl.textContent = labelText;
      lbl.style.color = "#777";
      lbl.style.fontSize = "10px";
      lbl.style.fontFamily = "monospace";
      wrapper.appendChild(lbl);

      const input = document.createElement("input");
      input.type = "number";
      input.value = String(initialValue);
      input.min = "0";
      input.step = String(step);
      input.style.background = "#2a2a3e";
      input.style.color = "#e0e0e0";
      input.style.border = "1px solid #444";
      input.style.borderRadius = "2px";
      input.style.padding = "2px 4px";
      input.style.fontSize = "11px";
      input.style.fontFamily = "monospace";
      input.style.width = "55px";
      input.style.boxSizing = "border-box";
      input.addEventListener("input", () => {
        onChange(parseInt(input.value) || 0);
      });
      wrapper.appendChild(input);
      return wrapper;
    };

    // Duration input — updates Anima timing and redraws track bars.
    const dWrapper = makeTimingInput(
      "d",
      track.anima.duration,
      50,
      (v) => {
        track.anima.setTiming(v, track.anima.delay);
        this._renderTracks();
      }
    );
    inputGroup.appendChild(dWrapper);

    // Delay input — updates Anima timing and redraws track bars.
    const deWrapper = makeTimingInput(
      "de",
      track.anima.delay,
      10,
      (v) => {
        track.anima.setTiming(track.anima.duration, v);
        this._renderTracks();
      }
    );
    inputGroup.appendChild(deWrapper);

    row.appendChild(inputGroup);

    // ── Easing curve thumbnail ───────────────────────────────────────────────
    // Clicking the thumbnail expands / collapses the inline bezier editor.
    const thumb = this._buildCurveThumb(track);
    thumb.style.cursor = "pointer";
    thumb.setAttribute("aria-label", "Click to edit easing curve");
    thumb.addEventListener("click", () => {
      track.expanded = !track.expanded;
      if (track.expanded) {
        // Insert the curve editor immediately after this row
        const editor = this._buildCurveEditor(track);
        track.row?.parentNode?.insertBefore(editor, track.row.nextSibling);
      } else {
        // Remove the curve editor — it is the next sibling of the row
        const next = track.row?.nextSibling as HTMLElement | null;
        if (next && next.dataset["curveEditor"] === track.label) {
          next.parentNode?.removeChild(next);
        }
      }
    });
    track.curveThumb = thumb;
    row.appendChild(thumb);

    track.row = row;
    return row;
  }

  /**
   * Build the inline SVG bezier curve editor for a track.
   *
   * Returns a div panel containing:
   *  - Preset buttons row (linear, oQ, oC, o6, io, codrops) — clicking each
   *    snaps the curve and calls track.anima.setEase() with the preset values.
   *  - 200×150 SVG canvas with the cubic bezier curve path, two draggable
   *    control-point circles, guide lines to endpoints, and a linear reference.
   *  - Current bezier value display below the SVG.
   *
   * Dragging a handle updates the curve live (setEase() on every move event)
   * and also refreshes the thumbnail in the track row so both views stay in sync.
   *
   * @param track - The track whose easing to edit.
   */
  private _buildCurveEditor(track: Track): HTMLElement {
    const W = 200;
    const H = 150;

    const container = document.createElement("div");
    container.dataset["curveEditor"] = track.label;
    container.style.height = "180px";
    container.style.background = "#12122a";
    container.style.padding = "8px";
    container.style.borderBottom = "1px solid #2a2a3e";
    container.style.boxSizing = "border-box";

    // ── Resolve current control points ────────────────────────────────────
    // Named presets are looked up from PRESETS; array curves are used directly.
    // Falls back to linear if the preset is unrecognised.
    const resolvePoints = (curve: string | number[]): [number, number, number, number] => {
      if (typeof curve === "string") {
        return PRESETS[curve] ?? PRESETS["linear"]!;
      }
      if (Array.isArray(curve) && curve.length >= 4) {
        return [curve[0] ?? 0, curve[1] ?? 0, curve[2] ?? 1, curve[3] ?? 1];
      }
      return [0, 0, 1, 1];
    };

    let [x1, y1, x2, y2] = resolvePoints(track.anima.easing);

    // ── Preset buttons row ────────────────────────────────────────────────
    const presetRow = document.createElement("div");
    presetRow.style.display = "flex";
    presetRow.style.gap = "4px";
    presetRow.style.marginBottom = "8px";

    for (const presetName of Object.keys(PRESETS)) {
      const btn = document.createElement("button");
      btn.textContent = presetName;
      btn.style.padding = "2px 8px";
      btn.style.borderRadius = "3px";
      btn.style.background = "#2a2a3e";
      btn.style.color = "#aaa";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "10px";
      btn.style.border = "1px solid #3a3a4e";
      btn.style.fontFamily = "monospace";

      btn.addEventListener("click", () => {
        const pts = PRESETS[presetName];
        if (!pts) return;
        [x1, y1, x2, y2] = pts;
        track.anima.setEase(pts);
        updateSvg();
        updateThumb();
        console.debug("[kido:orchestrator] curve-edit preset", track.label, presetName, pts);
      });
      presetRow.appendChild(btn);
    }
    container.appendChild(presetRow);

    // ── SVG bezier canvas ─────────────────────────────────────────────────
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.display = "block";
    svg.style.cursor = "default";
    svg.style.background = "transparent";

    // Diagonal reference line — shows linear as a dotted guide.
    const refLine = document.createElementNS(svgNS, "line");
    refLine.setAttribute("x1", "0");
    refLine.setAttribute("y1", String(H));
    refLine.setAttribute("x2", String(W));
    refLine.setAttribute("y2", "0");
    refLine.setAttribute("stroke", "#333");
    refLine.setAttribute("stroke-width", "1");
    refLine.setAttribute("stroke-dasharray", "4,4");
    svg.appendChild(refLine);

    // Guide line from (0, H) to handle 1.
    const guide1 = document.createElementNS(svgNS, "line");
    guide1.setAttribute("stroke", "#555");
    guide1.setAttribute("stroke-width", "1");
    svg.appendChild(guide1);

    // Guide line from (W, 0) to handle 2.
    const guide2 = document.createElementNS(svgNS, "line");
    guide2.setAttribute("stroke", "#555");
    guide2.setAttribute("stroke-width", "1");
    svg.appendChild(guide2);

    // Cubic bezier curve path.
    const curvePath = document.createElementNS(svgNS, "path");
    curvePath.setAttribute("fill", "none");
    curvePath.setAttribute("stroke", track.color);
    curvePath.setAttribute("stroke-width", "2");
    svg.appendChild(curvePath);

    // Control point handle 1.
    const handle1 = document.createElementNS(svgNS, "circle");
    handle1.setAttribute("r", "6");
    handle1.setAttribute("fill", track.color);
    handle1.setAttribute("stroke", "white");
    handle1.setAttribute("stroke-width", "1");
    handle1.style.cursor = "grab";
    svg.appendChild(handle1);

    // Control point handle 2.
    const handle2 = document.createElementNS(svgNS, "circle");
    handle2.setAttribute("r", "6");
    handle2.setAttribute("fill", track.color);
    handle2.setAttribute("stroke", "white");
    handle2.setAttribute("stroke-width", "1");
    handle2.style.cursor = "grab";
    svg.appendChild(handle2);

    container.appendChild(svg);

    // ── Current values display ────────────────────────────────────────────
    const valDisplay = document.createElement("div");
    valDisplay.style.fontSize = "10px";
    valDisplay.style.color = "#777";
    valDisplay.style.fontFamily = "monospace";
    valDisplay.style.marginTop = "4px";
    container.appendChild(valDisplay);

    // ── Update helpers ────────────────────────────────────────────────────

    /**
     * Compute the SVG path d attribute for the current control points.
     * Maps unit [0,1] coordinates to SVG pixel space where (0,0) = top-left,
     * so y is inverted: svgY = H - unitY * H.
     */
    const bezierPath = (): string => {
      const cx1 = x1 * W;
      const cy1 = H - y1 * H;
      const cx2 = x2 * W;
      const cy2 = H - y2 * H;
      return `M 0,${H} C ${cx1},${cy1} ${cx2},${cy2} ${W},0`;
    };

    /** Refresh all SVG elements to reflect the current x1/y1/x2/y2 state. */
    const updateSvg = (): void => {
      const hx1 = x1 * W;
      const hy1 = H - y1 * H;
      const hx2 = x2 * W;
      const hy2 = H - y2 * H;

      curvePath.setAttribute("d", bezierPath());

      handle1.setAttribute("cx", String(hx1));
      handle1.setAttribute("cy", String(hy1));
      handle2.setAttribute("cx", String(hx2));
      handle2.setAttribute("cy", String(hy2));

      // Guide from anchor (0, H) to handle 1.
      guide1.setAttribute("x1", "0");
      guide1.setAttribute("y1", String(H));
      guide1.setAttribute("x2", String(hx1));
      guide1.setAttribute("y2", String(hy1));

      // Guide from anchor (W, 0) to handle 2.
      guide2.setAttribute("x1", String(W));
      guide2.setAttribute("y1", "0");
      guide2.setAttribute("x2", String(hx2));
      guide2.setAttribute("y2", String(hy2));

      valDisplay.textContent = `cubic-bezier(${x1.toFixed(2)}, ${y1.toFixed(2)}, ${x2.toFixed(2)}, ${y2.toFixed(2)})`;
    };

    /** Refresh the small easing thumbnail in the track row to match the editor. */
    const updateThumb = (): void => {
      if (!track.curveThumb) return;
      // Rebuild the thumbnail using the same logic as _buildCurveThumb.
      const newThumb = this._buildCurveThumb(track);
      newThumb.style.cursor = "pointer";
      newThumb.setAttribute("aria-label", "Click to edit easing curve");
      newThumb.addEventListener("click", () => {
        track.expanded = !track.expanded;
        if (track.expanded) {
          const editor = this._buildCurveEditor(track);
          track.row?.parentNode?.insertBefore(editor, track.row.nextSibling);
        } else {
          const next = track.row?.nextSibling as HTMLElement | null;
          if (next && next.dataset["curveEditor"] === track.label) {
            next.parentNode?.removeChild(next);
          }
        }
      });
      track.curveThumb.parentNode?.replaceChild(newThumb, track.curveThumb);
      track.curveThumb = newThumb;
    };

    // ── Drag state ────────────────────────────────────────────────────────
    let activeHandle: 1 | 2 | null = null;

    const getSvgRect = (): DOMRect => svg.getBoundingClientRect();

    const onHandleDown = (which: 1 | 2) => (e: PointerEvent): void => {
      activeHandle = which;
      svg.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };

    const onSvgMove = (e: PointerEvent): void => {
      if (activeHandle === null) return;
      const rect = getSvgRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // X is clamped to [0,1]; Y is NOT clamped — overshoot allowed (e.g. oQ y1=1).
      const unitX = clamp(px / W, 0, 1);
      const unitY = (H - py) / H;

      if (activeHandle === 1) {
        x1 = unitX;
        y1 = unitY;
      } else {
        x2 = unitX;
        y2 = unitY;
      }

      track.anima.setEase([x1, y1, x2, y2]);
      updateSvg();
      updateThumb();
    };

    const onSvgUp = (e: PointerEvent): void => {
      if (activeHandle !== null) {
        console.debug("[kido:orchestrator] curve-edit drag-end", track.label, [x1, y1, x2, y2]);
      }
      svg.releasePointerCapture(e.pointerId);
      activeHandle = null;
    };

    handle1.addEventListener("pointerdown", onHandleDown(1));
    handle2.addEventListener("pointerdown", onHandleDown(2));
    svg.addEventListener("pointermove", onSvgMove);
    svg.addEventListener("pointerup", onSvgUp);
    svg.addEventListener("pointercancel", onSvgUp);

    // Initial render.
    updateSvg();

    return container;
  }

  /**
   * Clear and rebuild all track rows in the track container.
   *
   * Called after attach() when the panel is already mounted, and once during
   * _mount() to render any tracks that were registered before toggle().
   *
   * @param timeDisplay - Optional time display element to update after render.
   */
  private _renderTracks(timeDisplay?: HTMLElement): void {
    if (!this._trackContainer) return;
    // Remove existing track rows (but keep the playhead line)
    const toRemove: ChildNode[] = [];
    for (const child of Array.from(this._trackContainer.childNodes)) {
      if (child !== this._playheadLine) toRemove.push(child);
    }
    for (const node of toRemove) this._trackContainer.removeChild(node);

    const maxExtent = this.computeMaxExtent();
    for (const track of this._tracks) {
      const row = this._buildTrack(track, maxExtent);
      this._trackContainer.appendChild(row);
    }

    if (timeDisplay) this._updateTimeDisplay(timeDisplay);
  }

  /**
   * Render a single track and append its row to the container.
   *
   * Called from attach() when a new track is added after the panel is
   * already mounted. More efficient than a full _renderTracks() rebuild
   * when only one track is being added.
   *
   * Note: When a new track is added the maxExtent may change, which affects
   * all bar widths. For simplicity this plan does a full re-render — Plan 03
   * can optimise if needed.
   *
   * @param track - The track to render.
   * @param _idx  - Track index (unused; kept for API symmetry with plan spec).
   */
  private _renderTrack(_track: Track, _idx: number): void {
    this._renderTracks();
  }

  /**
   * Update the playhead line's horizontal position within the track container.
   *
   * Position is expressed as a percentage of the container width corresponding
   * to the current normalized playhead value. Skips if the line is not mounted.
   */
  private _updatePlayheadPosition(): void {
    if (!this._playheadLine) return;
    this._playheadLine.style.left = `${this._playhead * 100}%`;
  }

  /**
   * Update the time display text to show current playhead ms / total ms.
   *
   * @param el - The time display span element.
   */
  private _updateTimeDisplay(el: HTMLElement): void {
    const maxExtent = this.computeMaxExtent();
    const currentMs = Math.round(this._playhead * maxExtent);
    el.textContent = `${currentMs}ms / ${Math.round(maxExtent)}ms`;
  }

  /**
   * Wire pointer-based resize on the panel's top drag handle.
   *
   * Listens for pointerdown on the handle, then tracks pointermove on
   * the document to adjust panel height. Uses pointer capture to receive
   * events even when the pointer leaves the element during fast drag.
   * Height is clamped to [100px, 60vh].
   *
   * @param handle - The resize handle element.
   * @param panel  - The root panel element whose height is adjusted.
   */
  private _wireResizeHandle(handle: HTMLElement, panel: HTMLElement): void {
    let dragging = false;
    let startY = 0;
    let startH = 0;

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      startH = panel.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const delta = startY - e.clientY; // drag up → larger panel
      const maxH = window.innerHeight * 0.6;
      const newH = clamp(startH + delta, 100, maxH);
      panel.style.height = `${newH}px`;
    });

    handle.addEventListener("pointerup", () => {
      dragging = false;
    });

    handle.addEventListener("pointercancel", () => {
      dragging = false;
    });
  }

  /**
   * Wire playhead scrubbing on the timeline / track container area.
   *
   * Converts pointer x-position within the container to a normalized [0,1]
   * value and calls seek() on each move event. Updates the time display as
   * the playhead moves.
   *
   * @param container   - The track container element (pointer event target).
   * @param timeDisplay - Time display span to update during scrub.
   */
  private _wireScrub(container: HTMLElement | null, timeDisplay: HTMLElement): void {
    if (!container) return;
    let scrubbing = false;

    const getScrubT = (e: PointerEvent): number => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return clamp((e.clientX - rect.left) / rect.width, 0, 1);
    };

    container.addEventListener("pointerdown", (e: PointerEvent) => {
      // Only scrub when clicking the bar area background — skip all
      // interactive children (buttons, inputs, SVGs, circles, preset row).
      const target = e.target as HTMLElement;
      const tag = target.tagName.toUpperCase();
      if (
        tag === "BUTTON" ||
        tag === "INPUT" ||
        tag === "SVG" ||
        tag === "CIRCLE" ||
        tag === "LINE" ||
        tag === "PATH" ||
        target.closest("svg") ||
        target.closest("input") ||
        target.closest("button")
      ) return;
      scrubbing = true;
      container.setPointerCapture(e.pointerId);
      this.seek(getScrubT(e));
      this._updateTimeDisplay(timeDisplay);
    });

    container.addEventListener("pointermove", (e: PointerEvent) => {
      if (!scrubbing) return;
      this.seek(getScrubT(e));
      this._updateTimeDisplay(timeDisplay);
    });

    container.addEventListener("pointerup", () => {
      scrubbing = false;
    });

    container.addEventListener("pointercancel", () => {
      scrubbing = false;
    });
  }
}

/** Pre-constructed singleton — import and use directly, no instantiation needed. */
export const orchestrator = new AnimaOrchestrator();
