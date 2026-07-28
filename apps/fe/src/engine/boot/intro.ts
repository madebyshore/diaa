/**
 * apps/fe/src/engine/boot/intro.ts — Pure intro animation class.
 *
 * IntroAnimation is the public interface contract. Intro implements it as a
 * self-contained animation object that knows nothing about GPU, Loader, or
 * NativeScroller. Those concerns belong to Application.init() in apps/fe/src/app/index.ts.
 *
 * The intro is a brand beat, not a loading screen — there is nothing to preload
 * (the GPU engine is disabled), so there is no counter. Responsibilities:
 *   - Play a random CMS phrase (if any) then the DIAA logotype as two centred
 *     beats — one at a time — then fade the whole white overlay out
 *   - Set App.introDone and remove the intro element when the animation finishes
 *
 * The class is exported both as the default export (for backward-compatible
 * engine/index.ts barrel) and as a named export so callers can use either style.
 */

import { Anima } from "kido/anima";
import { Delay } from "kido/raf";

import { App } from "@app/context";
import { dbg } from "@app/debug";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Public contract for the intro animation.
 *
 * Boot phase 7 in Application.init() holds a reference typed as IntroAnimation
 * rather than Intro so that the concrete class can be swapped in tests without
 * importing the full module.
 */
export interface IntroAnimation {
  /** Animate the DIAA fade-in → hold → fade-out and resolve when complete. */
  play(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

/** Tween durations and the mid-sequence hold, in milliseconds. */
const FADE_IN_MS = 1200;
const FADE_IN_DELAY_MS = 400;
const HOLD_MS = 400;
const FADE_OUT_MS = 800;

/**
 * Easing for the centered DIAA text — kido's "slow" preset (the spring-fit
 * curve, see Ease.slow in kido/utils). Applied to both the fade-in and the overlay
 * fade-out so the text's motion reads with a single, consistent curve across
 * the whole beat. Shared with the home entrance fade.
 */
const TEXT_EASE = "slow";

/**
 * Pure intro animation — no GPU, Loader, or Scroller dependencies.
 *
 * The constructor queries the DOM for the .intro overlay and the .intro__logo
 * mark and stores references. It does NOT start any animation. Await play() to
 * run the brand beat and dismiss the overlay.
 *
 * @example
 * const intro = new Intro();
 * await intro.play();
 */
export class Intro implements IntroAnimation {
  /**
   * The root intro overlay element (.intro). The white field that fades out and
   * is removed from the DOM on play() completion.
   */
  private readonly introEl: Element | null;

  /**
   * The DIAA mark element (.intro__logo). Starts at CSS opacity 0 and is faded
   * in by play() before the overlay fades out.
   */
  private readonly logoEl: Element | null;

  /**
   * The centered phrase element (.intro__text). Filled in the constructor with
   * a random phrase from the CMS list (see setRandomPhrase), then shown as its
   * own beat — before the logotype — by play(). Null when the CMS provided no
   * phrases.
   */
  private readonly textEl: Element | null;

  /**
   * Whether a phrase was actually written into .intro__text. Drives whether
   * play() runs the phrase beat, and whether the logotype keeps the original
   * 200ms lead-in (no phrase) or follows immediately (after a phrase). Set by
   * setRandomPhrase().
   */
  private hasPhrase = false;

  /**
   * Creates the Intro animation instance.
   *
   * Queries .intro, .intro__logo, and .intro__text from the DOM — any may be
   * null on fallback pages (play() and setRandomPhrase guard against null).
   * Picks the random phrase here, up front, so it is in place before play()
   * reveals it.
   */
  constructor() {
    this.introEl = document.querySelector(".intro");
    this.logoEl = document.querySelector(".intro__logo");
    this.textEl = document.querySelector(".intro__text");

    // Choose the random phrase now — while .intro__text is still opacity 0 —
    // so it is written before play() fades it in (no flash).
    this.setRandomPhrase();

    dbg.introInit("intro animation ready");
  }

  /**
   * Pick a random phrase from the inline JSON list and write it into
   * .intro__text. The list is emitted by routes-plugin into a
   * `<script class="intro__phrases" type="application/json">` inside the
   * overlay. No-ops safely when the text element or script is absent, the JSON
   * is malformed, or the list is empty (CMS unset, or a Sanity-less build).
   */
  private setRandomPhrase(): void {
    if (!this.textEl) return;

    const raw = document.querySelector(".intro__phrases")?.textContent?.trim();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      dbg.introInit("intro phrases JSON failed to parse");
      return;
    }

    const phrases = Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];
    if (phrases.length === 0) return;

    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    if (!phrase) return;

    this.textEl.textContent = phrase;
    this.hasPhrase = true;
    dbg.introInit(`intro phrase chosen: "${phrase}"`);
  }

  /**
   * Play the brand-beat sequence and resolve when complete.
   *
   * The phrase and the logotype are two separate beats, each centred in the
   * overlay and shown one at a time (never together):
   *   1. Phrase (only when the CMS provided one): after FADE_IN_DELAY_MS, fade
   *      the random phrase in, hold HOLD_MS so it reads, then fade it out. The
   *      white overlay stays up — only the text's opacity moves.
   *   2. Logotype: fade the DIAA mark in, hold HOLD_MS. Keeps the
   *      FADE_IN_DELAY_MS lead-in when there was no phrase; follows
   *      immediately after a phrase.
   *   3. Fade the whole white overlay out (carrying the logotype to 0),
   *      revealing the page beneath.
   *   4. Mark App.introDone, remove the overlay.
   *
   * Resolves after teardown so Application.init() can run the page entrance
   * animations the moment the overlay is gone.
   *
   * @returns Promise<void> — resolves when the intro fully completes.
   */
  async play(): Promise<void> {
    dbg.introPlay("phrase in → out → logotype in → overlay out");

    // 1. Phrase beat (only when the CMS provided one): after FADE_IN_DELAY_MS,
    //    fade the random phrase in, hold so it reads, then fade it out. The
    //    white overlay stays up — only the text's opacity moves.
    if (this.hasPhrase) {
      await this.tween(this.textEl, { o: [0, 1] }, FADE_IN_MS, {
        e: TEXT_EASE,
        de: FADE_IN_DELAY_MS,
      });
      await this.wait(HOLD_MS);
      await this.tween(this.textEl, { o: [1, 0] }, FADE_OUT_MS, {
        e: TEXT_EASE,
      });
    }

    // 2. Logotype beat: fade the DIAA mark in, then hold. Without a phrase the
    //    mark keeps the FADE_IN_DELAY_MS lead-in; after one it follows at once.
    await this.tween(this.logoEl, { o: [0, 1] }, FADE_IN_MS, {
      e: TEXT_EASE,
      de: this.hasPhrase ? 0 : FADE_IN_DELAY_MS,
    });
    await this.wait(HOLD_MS);

    // 3. Fade the overlay (white field + logotype) to opacity 0, revealing the page.
    await this.tween(this.introEl, { o: [1, 0] }, FADE_OUT_MS, {
      e: TEXT_EASE,
    });

    dbg.introDone("intro animation complete");

    // Mark intro complete globally so page modules can respond.
    App.introDone = true;

    // Remove the intro overlay from the DOM.
    this.introEl?.remove();
  }

  /**
   * Run a single Anima tween on an element and resolve when it completes.
   *
   * Wraps the kido Anima callback (cb) in a Promise so play() can await each
   * step sequentially. Resolves immediately when el is null (fallback pages).
   *
   * @param el    - Target element, or null to no-op.
   * @param props - Animated properties (e.g. { o: [0, 1] } for opacity).
   * @param d     - Duration in milliseconds.
   * @param opts  - Optional easing (`e`) and delay (`de`). Easing defaults to the
   *                "io" preset; delay defaults to 0.
   */
  private tween(
    el: Element | null,
    props: Record<string, [number, number, string?]>,
    d: number,
    opts: { e?: string | number[]; de?: number } = {}
  ): Promise<void> {
    if (!el) return Promise.resolve();

    return new Promise<void>((resolve) => {
      new Anima({
        el,
        p: props,
        e: opts.e ?? "io",
        de: opts.de ?? 0,
        d,
        r: 3,
        cb: resolve,
      }).play();
    });
  }

  /**
   * Resolve after `ms` milliseconds using kido's RAF-driven Delay so the hold
   * stays on the same clock as the tweens rather than a stray setTimeout.
   *
   * @param ms - Hold duration in milliseconds.
   */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      new Delay(() => resolve(), ms).run();
    });
  }
}

export default Intro;
