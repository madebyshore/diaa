import { gsap } from "gsap";

import { getPageController } from "~/composables/usePageController";
import { subscribeOnScroll } from "~/composables/useLenisScroll";

/**
 * composables/useBoot.ts — Nuxt port of diaa's 5-phase boot sequence
 * (apps/fe/src/app/index.ts) + the intro brand beat (apps/fe/src/engine/
 * boot/intro.ts `Intro.play()`).
 *
 * Only boot phases 4 (intro animation) and 5 (page entrance) have real work
 * to do here — phases 1-3 are already satisfied elsewhere:
 *   1. Intro construction  → components/intro/IntroOverlay.vue, SSR-rendered
 *                            visible by default (see that file + the FOUC
 *                            rules in anim-plan.md §14).
 *   2. Controller install  → plugins/lenis.client.ts sets
 *                            `history.scrollRestoration = "manual"` and
 *                            constructs Lenis; plugins/nav-direction.client.ts
 *                            wires the popstate listener; app.vue calls
 *                            useNavLock() to register the router.beforeEach
 *                            guard.
 *   3. Scroller + page init → composables/usePageController.ts's onMounted
 *                            first-load branch calls the current route's
 *                            controller.onInit() BEFORE this module's
 *                            runBoot() ever executes — Vue mounts child
 *                            components (the page) and fires their
 *                            onMounted callbacks before the PARENT
 *                            (app.vue)'s onMounted runs, so by the time
 *                            app.vue calls runBoot() the page is already
 *                            initialised-but-hidden, exactly matching
 *                            diaa's "page.init() runs before the intro
 *                            wipes" invariant.
 */

// Tween durations/eases — line-for-line from Intro.play() (see that file's
// own header for the full brand-beat rationale: a phrase beat, then a
// logotype beat, then the whole overlay fades to reveal the page). GSAP
// durations are expressed in SECONDS, not ms.
const FADE_IN_S = 1.2;
const FADE_IN_DELAY_S = 0.4;
const HOLD_S = 0.4;
const FADE_OUT_S = 0.8;

/**
 * Easing for the centered DIAA text — kido's "slow" preset (the spring-fit
 * curve, see Ease.slow in kido/utils, registered as a GSAP CustomEase by
 * plugins/ease.client.ts). Applied to both the fade-in and the overlay
 * fade-out so the text's motion reads with a single, consistent curve
 * across the whole beat. Shared with the home entrance fade.
 */
const TEXT_EASE = "slow";

/**
 * playIntro — GSAP port of `Intro.play()`. The phrase and the logotype are
 * two separate beats, each centred in the overlay and shown one at a time
 * (never together):
 *   1. Phrase (only when the CMS provided one — `hasPhrase`): after
 *      FADE_IN_DELAY_S, fade the phrase in, hold so it reads, then fade it
 *      out. The white overlay stays up — only the text's opacity moves.
 *   2. Logotype: fade the DIAA mark in, then hold. Keeps the
 *      FADE_IN_DELAY_S lead-in when there was no phrase; follows
 *      immediately after a phrase.
 *   3. Fade the whole white overlay out (carrying the logotype to 0),
 *      revealing the page beneath.
 *   4. Remove the overlay from the DOM.
 *
 * Resolves after teardown so the caller can run the page entrance animation
 * the moment the overlay is gone — mirrors `Intro.play()`'s own contract.
 *
 * Unlike the original, the phrase text itself is written declaratively by
 * IntroOverlay.vue's template (Vue owns `.intro__text`'s textContent), so
 * this port only needs a `hasPhrase` boolean rather than picking/writing
 * the phrase itself.
 */
export async function playIntro(
  introEl: HTMLElement | null,
  logoEl: HTMLElement | null,
  textEl: HTMLElement | null,
  hasPhrase: boolean,
): Promise<void> {
  console.debug("[boot] playIntro — phrase in → out → logotype in → overlay out");

  // 1. Phrase beat (only when the CMS provided one): after FADE_IN_DELAY_S,
  //    fade the random phrase in, hold so it reads, then fade it out. The
  //    white overlay stays up — only the text's opacity moves.
  if (hasPhrase && textEl) {
    await gsap.to(textEl, { opacity: 1, duration: FADE_IN_S, delay: FADE_IN_DELAY_S, ease: TEXT_EASE });
    // Hold — a targetless tween used purely for its duration, same idea as
    // the original's RAF-clocked kido `Delay`, just on GSAP's ticker instead.
    await gsap.to({}, { duration: HOLD_S });
    await gsap.to(textEl, { opacity: 0, duration: FADE_OUT_S, ease: TEXT_EASE });
  }

  // 2. Logotype beat: fade the DIAA mark in, then hold. Without a phrase the
  //    mark keeps the FADE_IN_DELAY_S lead-in; after one it follows at once.
  if (logoEl) {
    await gsap.to(logoEl, {
      opacity: 1,
      duration: FADE_IN_S,
      delay: hasPhrase ? 0 : FADE_IN_DELAY_S,
      ease: TEXT_EASE,
    });
  }
  await gsap.to({}, { duration: HOLD_S });

  // 3. Fade the overlay (white field + logotype) to opacity 0, revealing the page.
  if (introEl) {
    await gsap.to(introEl, { opacity: 0, duration: FADE_OUT_S, ease: TEXT_EASE });
  }

  console.debug("[boot] intro animation complete");

  // Remove the intro overlay from the DOM — mirrors `Intro.play()`'s
  // `this.introEl?.remove()`. There is no `App.introDone` flag to set here;
  // nothing in this port reads an equivalent global (the boot sequence
  // itself is the only consumer, via runBoot() below awaiting this call).
  introEl?.remove();
}

/**
 * runBoot — orchestrates the first-load entrance: play the intro, then run
 * the CURRENT route's `controller.in()` while Lenis is stopped (mirrors
 * diaa's boot phase 5, `PageManager.animateCurrentPageIn`'s pause/resume
 * wrapping around the entrance animation, and its "subscribe onScroll only
 * after resume" ordering). Called once from app.vue's `onMounted`.
 *
 * The transition (transitions/default.ts) never runs on first load — Vue's
 * `<Transition>` does not fire enter hooks for the initially-mounted DOM —
 * so this function is the ONLY place that runs the entrance fade for the
 * very first page a visitor lands on. `usePageController()`'s `onMounted`
 * has already called the current controller's `onInit()` by the time this
 * runs (child components mount — and fire their `onMounted` — before their
 * parent does; app.vue is the parent of the page, so its `onMounted`
 * always observes an already-`onInit`'d page).
 */
export async function runBoot(): Promise<void> {
  console.debug("[boot] phases 1-3 already satisfied by SSR + plugins + page onInit");

  const introEl = document.querySelector<HTMLElement>(".intro");
  const logoEl = document.querySelector<HTMLElement>(".intro__logo");
  const textEl = document.querySelector<HTMLElement>(".intro__text");

  console.debug("[boot] phase 4 — intro animation");
  await playIntro(introEl, logoEl, textEl, textEl !== null);

  console.debug("[boot] phase 5 — page entrance animation");
  const route = useRoute();
  const page = document.getElementById("page") as HTMLElement | null;
  const controller = getPageController(route.fullPath);
  const { $lenis } = useNuxtApp();

  if (page && controller) {
    // Lock scroll input for the full entrance, same reasoning as
    // PageManager.animateCurrentPageIn: the page should settle into place
    // before the user can scroll. `finally` guarantees resume even if a
    // controller's in() throws — scrolling can never get stuck.
    $lenis?.stop();
    try {
      await controller.in(page);
    } finally {
      $lenis?.start();
    }

    // Subscribe onScroll only AFTER resume — mirrors diaa's ordering so a
    // page's onScroll handler never fires mid-entrance.
    if (controller.onScroll) {
      subscribeOnScroll((e) => controller.onScroll?.(e));
    }
  } else {
    console.warn("[boot] no controller/page element found for", route.fullPath);
  }

  console.debug("[boot] application ready");
}
