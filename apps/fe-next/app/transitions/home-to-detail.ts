/**
 * transitions/home-to-detail.ts — STUB for Phase 5b (home→detail image
 * bridge). NOT implemented in Phase 5a — the home controller itself
 * (controllers/home.ts) is also still a Phase-5a placeholder (see
 * pages/index.vue), so there is no `.home__text-gpu-figure.is-active` DOM to
 * bridge from yet.
 *
 * Real implementation (Phase 5b) ports apps/fe/src/app/controller/
 * transitions/home-to-detail.ts: clone the active text-mode reveal image,
 * promote it to a `position: fixed` element on document.body, hand it off
 * via lib/image-bridge.ts's setImageBridge(), for controllers/detail.ts's
 * in() to consume via takeImageBridge(). The double-shadow rationale
 * comments in the source file (lines 22-33, 113-124) MUST survive verbatim
 * when this is implemented — they document a real visual bug fix.
 *
 * `transitions/default.ts` calls `bridgeOut(el)` unconditionally from its
 * onBeforeLeave when the route pair is home→detail (checked by route name).
 * This stub intentionally does nothing so that dispatch point exists and is
 * wired now, without requiring 5b's home controller to exist yet.
 */
export function bridgeOut(_fromEl: HTMLElement): void {
  // No-op until Phase 5b. Intentionally does not call setImageBridge().
}
