/**
 * Image Slideshow slice runtime. Every image is rendered stacked inside the
 * 3:2 viewport; exactly one carries `.is-active`. Clicking (or pressing
 * Enter/Space on) the viewport advances to the next slide by swapping which
 * slide is active — an instant replace, no slide/transition — and wraps back
 * to the first after the last. The `current / total` counter caption is kept
 * in sync. Returns a teardown that detaches the listeners on navigation.
 */

/** Wire click/keyboard advancing for one slideshow instance under `root`. */
export function initSliceImageSlideshow(root: Element): (() => void) | void {
  const section = root as HTMLElement;
  const viewport = section.querySelector<HTMLElement>(
    ".slice-slideshow__viewport"
  );
  const slides = Array.from(
    section.querySelectorAll<HTMLElement>(".slice-slideshow__slide")
  );
  const counter = section.querySelector<HTMLElement>(
    ".slice-slideshow__counter-current"
  );

  // Nothing to cycle through (single image / malformed markup) → no-op.
  if (!viewport || slides.length < 2) return;

  // Start from whichever slide the template marked active (index 0 in SSR).
  let index = slides.findIndex((s) => s.classList.contains("is-active"));
  if (index < 0) index = 0;

  /** Activate slide `next`, wrapping in both directions, and update the counter. */
  function show(next: number): void {
    const count = slides.length;
    const wrapped = ((next % count) + count) % count;
    if (wrapped === index) return;
    slides[index]?.classList.remove("is-active");
    slides[wrapped]?.classList.add("is-active");
    index = wrapped;
    if (counter) counter.textContent = String(index + 1);
    console.debug("[slice:slideshow] advance", index + 1, "/", count);
  }

  /** Advance one step forward (loops past the last back to the first). */
  function advance(): void {
    show(index + 1);
  }

  function onClick(): void {
    advance();
  }

  // Enter/Space activate the role="button" viewport, matching native button keys.
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      advance();
    }
  }

  viewport.addEventListener("click", onClick);
  viewport.addEventListener("keydown", onKey);

  return () => {
    viewport.removeEventListener("click", onClick);
    viewport.removeEventListener("keydown", onKey);
  };
}
