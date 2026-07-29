/**
 * beat-skip.ts — a one-slot flag for suppressing the return-to-home brand beat.
 *
 * The detail page's bottom-dwell auto-close (see routes/detail/detail.ts
 * checkBottomDwell) navigates home from the DIAA-logotype outro section — a
 * full-viewport brand moment that already IS the beat. Replaying the
 * `.intro-beat` overlay on top of it would show the mark twice back to back,
 * so the detail page raises this flag right before navigating and
 * `HomePage.in()` consumes it to skip straight to the entrance fade.
 *
 * One-shot semantics: `takeHomeBeatSkip()` clears on read, so the flag can
 * never leak into a later, unrelated navigation — every other path to home
 * (nav click, Close, back button) still plays the beat.
 */

/** True while a beat-suppressed navigation to home is in flight. */
let skip = false;

/**
 * Request that the NEXT home entrance skips the return brand beat. Called by
 * the detail page's bottom-dwell handler immediately before navigating.
 */
export function skipNextHomeBeat(): void {
  skip = true;
}

/**
 * Claim and clear the pending skip. Returns false on every navigation that
 * didn't request a suppressed beat, so `HomePage.in()` can branch to its
 * normal choreography.
 */
export function takeHomeBeatSkip(): boolean {
  const s = skip;
  skip = false;
  return s;
}
