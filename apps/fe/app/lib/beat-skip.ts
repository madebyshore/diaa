/**
 * beat-skip.ts — a one-slot flag for suppressing the return-to-home brand beat.
 *
 * TWO paths raise the flag, on every content page (detail/contact/imprint):
 * the bottom-dwell auto-close (checkBottomDwell — navigating home from the
 * DIAA-logotype outro, a full-viewport brand moment that already IS the
 * beat), and the `( Close )` footer click (by client request Close reads as
 * a plain "page fades out, home fades in" crossfade, identical to the
 * bottom-dwell path — no brand break). `HomePage.in()` consumes the flag and
 * skips straight to the entrance fade.
 *
 * One-shot semantics: `takeHomeBeatSkip()` clears on read, so the flag can
 * never leak into a later, unrelated navigation — remaining paths to home
 * (browser back, the DIAA wordmark) still play the beat.
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
