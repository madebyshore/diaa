import { gsap } from "gsap";
// Aliased: Nuxt auto-imports its OWN `createApp` (from `#app`, for
// bootstrapping the whole Nuxt application) into every file's global scope,
// which collides with — and wins over — Vue's component-mounting
// `createApp`. The dev-GUI mount below needs Vue's version explicitly.
import { createApp as createVueApp } from "vue";

import { homeAnim } from "~/composables/useHomeAnim";
import { takeHomeBeatSkip } from "~/lib/beat-skip";

import type { PageController, ScrollEvent } from "~/controllers/page-controller";

/**
 * controllers/home.ts — manages lifecycle for the `/` route, ported from
 * apps/fe/src/routes/home/home.ts (1109 lines — the highest-risk mechanical
 * port in this phase: freeze flags and generation counters were re-verified
 * by hand against the source, not re-derived from scratch).
 *
 * Two visual modes share the same DOM container:
 *
 *   Text mode — DOM shows a single centered, responsive flex-wrap of text
 *   labels. Hovering a label toggles `.is-active` on the matching
 *   `.home__text-gpu-figure` so its `<img>` fades in at the viewport centre
 *   via CSS transition. Mouse leave removes `.is-active` and the image fades
 *   out.
 *
 *   Image mode — DOM shows a 4-per-row grid of 1:1 cells. Each cell's
 *   `<figure class="_g">` contains the responsive `<img>`. Hovering a slot
 *   toggles `.is-hovered` on the parent `.home__image-item` so CSS reveals
 *   the title overlay and fades the figure's `<img>`.
 *
 * Mode/filter are persisted via `useState` (useHomeMode()/useHomeFilter()
 * below) so they survive SPA navigation — the Nuxt-idiomatic equivalent of
 * diaa's `App.home` module singleton (see the composable doc comments).
 *
 * FACTORY, not module-scope state (deviation from the anim-plan's original
 * "one module-scope controller" recommendation — see plans/twinkly-
 * shimmying-marshmallow.md and the anim-plan scratchpad §8): Phase 5a
 * already established that every page controller in THIS repo is built by a
 * factory with CLOSURED state (createDetailController(),
 * createRichTextController()), registered fresh per mount, because
 * pages/[slug].vue's component instance is recreated on every distinct
 * fullPath. `createHomeController()` follows that same convention for
 * consistency even though "/" only ever has one fullPath (so in practice at
 * most one instance exists at a time, same as the reference repo's
 * module-scope `homeController` object) — DOM refs/handlers/generation
 * counters live as closured `let`s (reset cleanly on every mount), while
 * mode/filter use `useState` specifically BECAUSE a fresh factory call
 * outlives the closure that created it (nav away and back calls
 * createHomeController() again from scratch) and still needs the persisted
 * value.
 */

// ALL durations (and per-animation enable toggles) for the home page live in
// the mutable `homeAnim` config (composables/useHomeAnim.ts) so the dev-only
// tweak panel (components/dev/HomeAnimGui.client.vue, installed in onInit()
// behind import.meta.dev, hidden until Ctrl+F) can adjust them on the fly.
// Read homeAnim.* at animation time — never cache a duration in a local
// const. Only the easing curves stay fixed here. homeAnim stores durations in
// MILLISECONDS (matching the dev panel's slider units); GSAP wants SECONDS,
// so every call site divides by 1000.

// Shared fade choreography for both home toggles — Text ⇄ Image mode
// switching AND taxonomy filtering use the same timing
// (homeAnim.switchDuration per fade half) so the two interactions feel
// identical, on kido's "slow" ease (the spring-fit curve, registered as a
// GSAP CustomEase by plugins/ease.client.ts — see gsap/eases.ts).
const MODE_SWITCH_EASE = "slow";

// Home entrance fade — mirrors the intro brand-beat curve. On first boot the
// intro overlay clears in composables/useBoot.ts's playIntro() before
// runBoot()'s page-entrance phase runs, so the container holds at opacity 0
// for homeAnim.homeInDelay, then fades in over homeAnim.homeInDuration with
// "slow" — the same curve the intro text uses. The delay also applies on SPA
// navigations back to home, giving the entrance a consistent beat.
const HOME_IN_EASE = "slow";

// Return-to-home brand beat — a re-run of the intro logotype beat
// (composables/useBoot.ts's playIntro) using the same "slow" ease.
// On every SPA navigation back to home, in() covers the swap with the
// persistent `.intro-beat` overlay (white field + DIAA mark — see
// components/intro/IntroBeat.vue and styles/core/intro-beat.module.scss),
// fades the mark IN over homeAnim.beatFadeIn, holds it for homeAnim.beatHold,
// then fades the whole cover out over homeAnim.beatFadeOut. Home is revealed
// only AFTER the cover is fully gone (it stays hidden through the beat, then
// fades in) — the same sequence as the intro: overlay out, THEN page in;
// never a crossfade. First boot is excluded automatically: the only signal
// is useNavLock().mutating, true during a controller navigation but false
// during composables/useBoot.ts's runBoot(), where the real intro already
// played.
const BEAT_EASE = "slow";

// Nav hover reveal — a fade-swap, NOT a width expansion. On hover the whole
// nav fades out, swaps between collapsed (only the active filter + mode,
// e.g. `( All, Text )`) and expanded (every item, `( All, Projects, Studio,
// Curio   Text, Image )`), then fades back in. Visibility is pure CSS via
// `.is-expanded` on the nav. ONE ease spans the WHOLE animation: a single
// tween drives a V-shaped opacity (1 → 0 → 1) over NAV_FADE_DURATION,
// LINEAR — cubic-bezier(0, 0, 1, 1), GSAP's built-in "none" — applied once
// across both the fade-out and the fade-in (never restarted per half),
// toggling `.is-expanded` at the midpoint. Linear (not an ease-in) because an
// ease-in ramp reads as lag on a hover affordance: the response has to be
// visible the instant the cursor moves.
const NAV_FADE_DURATION = 0.3; // seconds (was 300ms)
const NAV_FADE_EASE = "none"; // linear — GSAP built-in, matches [0,0,1,1]

// Mobile tier — keep in sync with `breakpoint-mobile` in
// styles/includes/_breakpoints.module.scss (everything at or below 768px).
// Used to gate touch-specific nav behaviour like auto-collapse after a
// filter pick, where desktop relies on hover instead.
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

// True hover-capability gate for the nav's mouseenter/mouseleave listeners —
// DELIBERATELY not MOBILE_MEDIA_QUERY (a viewport-WIDTH breakpoint). Matches
// styles/includes/_helpers.module.scss's `hover()` mixin
// (`@media (hover: hover) and (pointer: fine)`), the codebase's existing
// convention for "does this device actually support hover" as opposed to
// "is the viewport narrow." A touch device firing a stray/delayed
// `mouseleave` after a tap (a real, observed mobile-browser quirk — some
// engines simulate a mouseleave shortly after touchend) was collapsing the
// nav the instant it opened instead of the click-to-open/stays-open/closes-
// only-on-filter-pick behaviour the mobile nav is required to have; gating
// the hover listeners on this query is the actual fix (rather than the width
// query, which a touch device in a WIDE viewport — a touchscreen laptop, an
// iPad in landscape — would still fail to catch).
const DESKTOP_HOVER_QUERY = "(hover: hover) and (pointer: fine)";

/** Text ⇄ Image mode. Ported from apps/fe/src/app/context.ts's `HomeMode`. */
export type HomeMode = "text" | "image";
/** Taxonomy filter id, or the "all" sentinel. Ported from context.ts's
 *  `HomeFilter`. */
export type HomeFilter = "all" | string;

/**
 * useHomeMode / useHomeFilter — the Nuxt-idiomatic replacement for diaa's
 * `App.home.mode`/`App.home.filter` module singleton. `useState` persists
 * across SPA navigation exactly like the old module-level object did, but —
 * unlike a true module singleton — resets to the default on every fresh SSR
 * request/hard reload, which is the SAME behavior diaa had (`App.home` was
 * itself a fresh module singleton on every full page load; persistence was
 * always SPA-nav-only). SSR therefore always renders the text/all pane by
 * default, matching pages/index.vue's hardcoded initial markup.
 *
 * Exported (not just used internally) so transitions/home-to-detail.ts can
 * read the SAME state without duplicating the useState key string.
 */
export function useHomeMode() {
  return useState<HomeMode>("home-mode", () => "text");
}
export function useHomeFilter() {
  return useState<HomeFilter>("home-filter", () => "all");
}

/**
 * Drive a single eased progress value 0→1 over `duration` seconds via a
 * proxy-object GSAP tween — the 1:1 replacement for every diaa
 * `animaToPromise(new Anima({el: window, u: (state) => ...}))` call site
 * (nav V-fold aside, which needs kill()-on-supersede and is handled inline in
 * setNavExpanded() below). Anima's `state.prE` (progress, eased) becomes the
 * proxy's own tweened value — GSAP has no bare "drive a callback with no
 * element" primitive, so a plain object stands in for Anima's `el: window`.
 * Resolves when the tween completes.
 */
function tweenProgress(
  duration: number,
  ease: string,
  onUpdate: (p: number) => void,
  delay = 0,
): Promise<void> {
  const proxy = { p: 0 };
  return new Promise((resolve) => {
    gsap.to(proxy, {
      p: 1,
      duration,
      delay,
      ease,
      onUpdate: () => onUpdate(proxy.p),
      onComplete: resolve,
    });
  });
}

/**
 * createHomeController — build a fresh PageController for the home route.
 * See the file header for why this is a factory (Phase 5a convention) rather
 * than the anim-plan's originally-proposed module-scope singleton.
 */
export function createHomeController(): PageController {
  const mode = useHomeMode();
  const filter = useHomeFilter();

  // ── DOM refs, queried in onInit, released in onDestroy ──────────────────
  let container: HTMLElement | null = null;
  let textPane: HTMLElement | null = null;
  let imagePane: HTMLElement | null = null;
  let textGpu: HTMLElement | null = null;
  let footer: HTMLElement | null = null;
  let modeButtons: HTMLButtonElement[] = [];
  let filterButtons: HTMLButtonElement[] = [];
  let textItems: HTMLElement[] = [];
  let imageItems: HTMLElement[] = [];
  let imageSlots: HTMLElement[] = [];
  let textGpuFigures: HTMLElement[] = [];

  /** Index of the figure the mobile scroll reveal currently holds active,
   *  -1 when none. Desktop keeps hover-driven reveals and ignores this. */
  let scrollRevealIndex = -1;

  // Handler references, stored so cleanup can removeEventListener the exact
  // same closure it added (source stored these as parallel arrays/pairs —
  // ported 1:1).
  let hoverHandlers: Array<{ item: HTMLElement; enter: () => void; leave: () => void }> = [];
  let imageHoverHandlers: Array<{ slot: HTMLElement; enter: () => void; leave: () => void }> = [];
  let modeBtnHandlers: Array<{ btn: HTMLButtonElement; handler: () => void }> = [];
  let filterBtnHandlers: Array<{ btn: HTMLButtonElement; handler: () => void }> = [];

  // Nav hover-reveal state.
  let navEl: HTMLElement | null = null;
  /** Current visible state — false = collapsed (resting), true = expanded. */
  let navExpanded = false;
  /** Bumped on each setNavExpanded() so a superseded fade can detect it was
   *  replaced by a newer hover and stop touching the nav. */
  let navGen = 0;
  let navAnima: gsap.core.Tween | null = null;
  let navEnterHandler: (() => void) | null = null;
  let navLeaveHandler: (() => void) | null = null;
  /** Touch parity for the hover reveal — a tap on the collapsed nav expands
   *  it (mobile hides the mode group but the filters still need opening). */
  let navClickHandler: ((e: Event) => void) | null = null;
  /** Mobile-only: a tap on the revealed centre image navigates to the same
   *  detail page as its text label (see the textGpu click wiring in onInit). */
  let textGpuClickHandler: ((e: Event) => void) | null = null;

  /** One-shot mousemove backstop armed by syncHoverFromPointer() — re-syncs
   *  hover state on the first pointer move after an entrance, for browsers
   *  that leave `:hover` stale until the mouse moves. Null when unarmed. */
  let hoverSyncMoveHandler: (() => void) | null = null;

  /** Teardown for the dev-only tweak panel's Ctrl+F toggle — unmounts the
   *  Vue component (which owns the keydown listener itself). Null in
   *  production or before the dynamic import resolves. */
  let animGuiTeardown: (() => void) | null = null;

  /** True while a mode or filter switch fade is in flight. The text and
   *  image hover handlers bail on it — a hover toggling
   *  `.is-hovered`/`.is-active` mid-fade would fight the pane opacity tween
   *  and leave stray hover state on the swapped-in pane. */
  let modeSwitching = false;

  /** Nav-lock's reactive `mutating` flag, captured at onInit() time (a
   *  guaranteed-safe Nuxt app context) — mirrors controllers/detail.ts's own
   *  capture-in-onInit convention. Read by the hover freeze checks and the
   *  return-beat gate in in(). */
  let mutating: ReturnType<typeof useNavLock>["mutating"] | null = null;

  /**
   * True if the cell at `index` is filtered out by the active taxonomy
   * filter. Reads `data-taxonomy` off whichever item exists at that index
   * (text or image mode — they share indices via flatIndex). When filter is
   * `"all"`, nothing is filtered.
   */
  function isFilteredOut(index: number): boolean {
    if (filter.value === "all") return false;
    return cellTaxonomyAt(index) !== filter.value;
  }

  /** Reads the taxonomy id off the matching grid item (text or image). */
  function cellTaxonomyAt(index: number): string {
    const fromImage = imageItems[index]?.dataset.taxonomy;
    if (fromImage !== undefined) return fromImage;
    const fromText = textItems[index]?.dataset.taxonomy;
    return fromText ?? "";
  }

  /**
   * Reveal/hide the nav with a fade-swap. A single GSAP tween drives a
   * V-shaped opacity (1 → 0 → 1) over NAV_FADE_DURATION on ONE continuous
   * linear ease spanning the whole animation — the V-fold is applied to the
   * eased progress, so the fade-out and the fade-in are two halves of one
   * curve, not two separately-eased tweens. At the midpoint (fully faded) we
   * toggle `.is-expanded`, which is what CSS reads to show every item vs.
   * only the active filter + mode. So the user sees: fade out → the set
   * swaps underneath → fade back in. Visibility and commas are pure CSS — no
   * per-item width/opacity tweening here.
   *
   * `navGen` guards rapid hover toggles: a newer call bumps the generation
   * and kills the in-flight tween (Anima's `.pause()` — GSAP's `.kill()` is
   * the equivalent here, since we always replace `navAnima` with a fresh
   * tween rather than resuming the old one), and the older run's onUpdate/
   * onComplete bail via the gen check before touching the nav.
   */
  function setNavExpanded(expanded: boolean): void {
    if (!navEl || navExpanded === expanded) return;
    navExpanded = expanded;
    const gen = ++navGen;
    navAnima?.kill();

    let swapped = false;
    const proxy = { p: 0 };
    navAnima = gsap.to(proxy, {
      p: 1,
      duration: NAV_FADE_DURATION,
      ease: NAV_FADE_EASE,
      onUpdate: () => {
        if (!navEl || gen !== navGen) return;
        // V-fold on the eased progress: |p - 0.5| * 2 → 1 at the ends, 0 at
        // the midpoint — one ease curve spans both the out and the in.
        navEl.style.opacity = String(Math.abs(proxy.p - 0.5) * 2);
        // Swap the visible set once, while the nav is fully faded out.
        if (!swapped && proxy.p >= 0.5) {
          swapped = true;
          navEl.classList.toggle("is-expanded", expanded);
        }
      },
      onComplete: () => {
        if (navEl && gen === navGen) navEl.style.opacity = "";
      },
    });
  }

  /**
   * Mobile scroll-driven image reveal — the touch counterpart of the desktop
   * hover reveal. Entries sit one small-viewport apart centre-to-centre
   * (item + gap = 100svh, see .home__text), so the entry the user is on is
   * the visible (unfiltered) item whose CENTRE is nearest the viewport
   * midline. The handoff fires at the halfway point between two entries —
   * the instant the outgoing label is leaving past the top as the next
   * enters from below the footer, never while both are readable — and the
   * image swaps at that crossover. Exactly one figure holds `.is-active` at
   * a time (the same class the hover path and the home→detail bridge use),
   * so the CSS fade and the transition clone work unchanged. No-ops on
   * desktop widths; `force` skips the mutating/mode-switch freeze for
   * init/filter-time re-syncs, where there is no bridge clone or hover state
   * to protect.
   *
   * Called `force`d from THREE places: onInit (via applyFilter, against
   * whatever scroll happens to be at mount time — before this page's own
   * scroll reset/restore has run), filter-switch time (against the new
   * item layout), and again from the top of in() (against the NOW-FINAL
   * entrance scroll — transitions/default.ts's onEnter finishes
   * restoreOrResetScroll() before in() is ever invoked). The in()-time call
   * is the one that actually matters for correctness: onInit's own call can
   * only ever be provisional, computed too early, and nothing re-syncs it
   * again until the user's first real scroll (onScroll, below) — which is
   * why a stale figure used to stay active through the whole entrance.
   */
  function updateScrollReveal(force = false): void {
    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
    if (!force && (mutating?.value || modeSwitching)) return;

    const mid = window.innerHeight / 2;
    let active = -1;
    let best = Infinity;
    for (let i = 0; i < textItems.length; i++) {
      if (isFilteredOut(i)) continue;
      const rect = textItems[i]!.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - mid);
      // Items are in document order, so distance to the midline strictly
      // shrinks then grows — once it grows, the nearest one is behind us.
      if (dist > best) break;
      best = dist;
      active = i;
    }

    if (active === scrollRevealIndex) return;
    if (scrollRevealIndex >= 0) textGpuFigures[scrollRevealIndex]?.classList.remove("is-active");
    if (active >= 0) textGpuFigures[active]?.classList.add("is-active");
    scrollRevealIndex = active;
    console.debug(`[page:home] scroll-reveal index=${active}`);
  }

  /**
   * Reflect the picked filter on the nav — persists via useHomeFilter() and
   * moves `.is-active`/aria-pressed to the matching filter button. The nav's
   * collapsed view (only the active filter + mode) reads these `.is-active`
   * toggles via CSS, so this MUST run at click time, before any fades: the
   * collapse that follows a pick has to close showing the NEW filter, not
   * close on the old one and hard-swap when the pane fade midpoint lands.
   */
  function applyFilterButtons(next: HomeFilter): void {
    filter.value = next;
    for (const btn of filterButtons) {
      const isActive = (btn.dataset.filter ?? "all") === next;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }

  /**
   * Per-item visibility for a filter — text items, image items, and the
   * text-mode DOM anchor figures. Each carries data-taxonomy; "all" shows
   * everything regardless. Runs at the filter-switch fade midpoint (while
   * the pane is invisible) so the layout reflow is never seen.
   */
  function applyFilterVisibility(next: HomeFilter): void {
    const setHidden = (el: HTMLElement, hidden: boolean): void => {
      if (hidden) el.setAttribute("data-filter-hidden", "");
      else el.removeAttribute("data-filter-hidden");
    };
    const matches = (el: HTMLElement): boolean => {
      if (next === "all") return true;
      return (el.dataset.taxonomy ?? "") === next;
    };

    for (const item of textItems) setHidden(item, !matches(item));
    for (const item of imageItems) setHidden(item, !matches(item));
    for (const fig of textGpuFigures) setHidden(fig, !matches(fig));

    // The visible item set changed, so the mobile scroll reveal's active
    // label may have too (forced — this also runs during onInit and the
    // filter-switch fade, setting the reveal for the initial scroll
    // position before the page is shown).
    updateScrollReveal(true);
  }

  /** Apply a taxonomy filter (no animation) — hides cells/figures/rows that
   *  don't match, and updates button active states. Only used at onInit. */
  function applyFilter(next: HomeFilter): void {
    applyFilterButtons(next);
    applyFilterVisibility(next);
  }

  /**
   * Reflect the picked mode on the nav — moves `.is-active`/aria-pressed to
   * the matching mode button. The collapsed nav's visible item set reads
   * these toggles via CSS, so (like applyFilterButtons) this runs at click
   * time in runModeSwitch, ahead of the pane fade, so a collapse mid-switch
   * closes showing the new mode. Deliberately does NOT touch useHomeMode()'s
   * value — the pane swap and state change stay at the fade midpoint.
   */
  function applyModeButtons(next: HomeMode): void {
    for (const btn of modeButtons) {
      const isActive = btn.dataset.mode === next;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }

  /**
   * Toggle DOM visibility for text vs image pane (and the text-gpu anchors).
   * The text-gpu anchors are only meaningful in text mode; hiding them in
   * image mode prevents them from accidentally intercepting pointer events.
   */
  function applyModeDom(next: HomeMode): void {
    if (container) container.dataset.mode = next;
    if (textPane) textPane.hidden = next !== "text";
    if (imagePane) imagePane.hidden = next !== "image";
    if (textGpu) textGpu.hidden = next !== "text";

    applyModeButtons(next);

    mode.value = next;
  }

  /**
   * Switch to `next` taxonomy filter with the same fade choreography —
   * duration and ease — as switchMode: fade out the active pane + footer,
   * apply the filter (toggles per-cell visibility and reflows text mode via
   * CSS), then fade everything back in. The current mode does not change.
   */
  async function switchFilter(next: HomeFilter): Promise<void> {
    console.debug(`[page:home] switch-filter → ${next}`);
    // Freeze the text/image hover handlers for the whole fade-swap-fade —
    // the finally guarantees they thaw even if a tween is superseded.
    modeSwitching = true;
    try {
      await runFilterSwitch(next);
    } finally {
      modeSwitching = false;
    }
  }

  /** The switchFilter body — see switchFilter for the hover freeze wrapper. */
  async function runFilterSwitch(next: HomeFilter): Promise<void> {
    // Move the nav's active state to the picked filter IMMEDIATELY — the
    // collapse that follows a pick (mobile auto-collapse, desktop hover-off)
    // reads `.is-active` at its own midpoint, which can land before the pane
    // fade below finishes; applying the buttons early means it always
    // closes showing the new filter. Item visibility still waits for the
    // midpoint.
    applyFilterButtons(next);

    const savedScrollY = window.scrollY;
    const currentPane = mode.value === "text" ? textPane : imagePane;

    // Clear any in-flight image-mode hover state so the new filter starts clean.
    for (const item of imageItems) item.classList.remove("is-hovered");

    // Fade everything down (skipped entirely — instant swap — when the dev
    // panel disables the switch animation).
    const fadeTargets: HTMLElement[] = [];
    if (currentPane) fadeTargets.push(currentPane);
    if (footer) fadeTargets.push(footer);
    if (homeAnim.switchEnabled && fadeTargets.length) {
      await tweenProgress(homeAnim.switchDuration / 1000, MODE_SWITCH_EASE, (p) => {
        const o = String(1 - p);
        for (const el of fadeTargets) el.style.opacity = o;
      });
    }

    // Apply the filter's item visibility — toggles data-filter-hidden on
    // items (the button active state already moved at click time, above).
    // Hidden items drop out and the remaining labels re-center via flex-wrap.
    if (currentPane) currentPane.style.opacity = "";
    if (footer) footer.style.opacity = "";
    applyFilterVisibility(next);

    // Mobile: reset scroll to top instead of restoring `savedScrollY` — a
    // new requirement, not a diaa port (`git show main:apps/fe/src/routes/
    // home/home.ts`'s runFilterSwitch always restores the saved position,
    // desktop and mobile alike; there is no existing top-reset precedent to
    // match). Placed HERE, at the fade's faded-out midpoint (pane/footer
    // opacity 0, right before applyFilterVisibility's item-visibility swap
    // takes effect), so the jump is invisible and the fade-in below reveals
    // the newly-filtered list already sitting at the top — never a
    // visible jump-then-settle. Native `window.scrollTo` remains correct now
    // that mobile runs Lenis (syncTouch — plugins/lenis.client.ts): Lenis
    // observes external native scrolls via its own scroll listener and
    // re-syncs its internal position from them. Desktop is unaffected — it
    // keeps restoring `savedScrollY` via Lenis, same as before.
    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      window.scrollTo(0, 0);
    } else {
      // Restore scroll across the layout change.
      const { $lenis } = useNuxtApp();
      $lenis?.resize();
      $lenis?.scrollTo(savedScrollY, { immediate: true });
    }

    // Instant swap — the filter is applied, nothing left to animate.
    if (!homeAnim.switchEnabled) return;

    const fadeInTargets: HTMLElement[] = [];
    if (currentPane) {
      currentPane.style.opacity = "0";
      fadeInTargets.push(currentPane);
    }
    if (footer) {
      footer.style.opacity = "0";
      fadeInTargets.push(footer);
    }
    if (fadeInTargets.length) {
      await tweenProgress(homeAnim.switchDuration / 1000, MODE_SWITCH_EASE, (p) => {
        const o = String(p);
        for (const el of fadeInTargets) el.style.opacity = o;
      });
    }
    if (currentPane) currentPane.style.opacity = "";
    if (footer) footer.style.opacity = "";
  }

  /**
   * Switch to `next` mode: fade current DOM out, swap pane visibility, fade
   * the new mode in. The DOM fade runs as a single tween over the pane and
   * footer so the transition feels unified.
   */
  async function switchMode(next: HomeMode): Promise<void> {
    console.debug(`[page:home] switch-mode → ${next}`);
    // Freeze the text/image hover handlers for the whole fade-swap-fade —
    // the finally guarantees they thaw even if a tween is superseded.
    modeSwitching = true;
    try {
      await runModeSwitch(next);
    } finally {
      modeSwitching = false;
    }
  }

  /** The switchMode body — see switchMode for the hover freeze wrapper. */
  async function runModeSwitch(next: HomeMode): Promise<void> {
    // Move the nav's active state to the picked mode IMMEDIATELY (same
    // reasoning as runFilterSwitch): a nav collapse racing this switch must
    // close showing the new mode. useHomeMode()'s value and the pane swap
    // still happen at the fade midpoint via applyModeDom.
    applyModeButtons(next);

    // Snapshot scroll BEFORE the DOM swap. Text and Image modes have very
    // different content heights — without restoring, the browser clamps
    // scroll to the new max (often 0 in image mode if it fits inside the
    // viewport) and the user loses their place when toggling back.
    const savedScrollY = window.scrollY;
    const currentPane = mode.value === "text" ? textPane : imagePane;

    // Clear any in-flight image-mode hover state so the new mode starts clean.
    for (const item of imageItems) item.classList.remove("is-hovered");

    // Fade the current pane and footer down together over the shared
    // homeAnim.switchDuration / "slow" fade — the same timing the filter
    // toggle uses. Skipped entirely (instant swap) when the dev panel
    // disables the switch animation.
    const fadeTargets: HTMLElement[] = [];
    if (currentPane) fadeTargets.push(currentPane);
    if (footer) fadeTargets.push(footer);
    if (homeAnim.switchEnabled && fadeTargets.length) {
      await tweenProgress(homeAnim.switchDuration / 1000, MODE_SWITCH_EASE, (p) => {
        const o = String(1 - p);
        for (const el of fadeTargets) el.style.opacity = o;
      });
    }

    // Swap DOM visibility for the new mode.
    if (currentPane) currentPane.style.opacity = "";
    if (footer) footer.style.opacity = "";
    applyModeDom(next);

    // Restore scroll position across the swap. Resize Lenis first so it
    // recalculates the new max, then scrollTo (which clamps internally to
    // the new bounds).
    const { $lenis } = useNuxtApp();
    $lenis?.resize();
    $lenis?.scrollTo(savedScrollY, { immediate: true });

    // Instant swap — the mode is applied, nothing left to animate.
    if (!homeAnim.switchEnabled) return;

    const newPane = next === "text" ? textPane : imagePane;
    const fadeInTargets: HTMLElement[] = [];
    if (newPane) {
      newPane.style.opacity = "0";
      fadeInTargets.push(newPane);
    }
    if (footer) {
      footer.style.opacity = "0";
      fadeInTargets.push(footer);
    }
    if (fadeInTargets.length) {
      await tweenProgress(homeAnim.switchDuration / 1000, MODE_SWITCH_EASE, (p) => {
        const o = String(p);
        for (const el of fadeInTargets) el.style.opacity = o;
      });
    }
    if (newPane) newPane.style.opacity = "";
    if (footer) footer.style.opacity = "";
  }

  /**
   * The shared home entrance fade — container 0 → 1 over
   * homeAnim.homeInDuration on the brand-beat ease, after an optional hold.
   * When the dev panel disables the entrance animation the container simply
   * snaps visible.
   *
   * Mobile stagger: on mobile the text-label pane, the top nav, and the
   * footer all lag the container fade by homeAnim.homeInMobileTextDelay, so
   * the scroll-revealed image (carried by the container fade) reads first
   * and the chrome + titles follow. Opacity compounds down the tree, so the
   * lagging elements can be held at inline opacity 0 inside the fading
   * container and run their own later fade on the same duration/ease.
   * Desktop keeps the single simultaneous fade.
   */
  async function homeInFade(delay = 0): Promise<void> {
    if (!homeAnim.homeInEnabled) {
      container?.style.setProperty("opacity", "1");
      return;
    }

    const lagTargets = window.matchMedia(MOBILE_MEDIA_QUERY).matches
      ? [textPane, navEl, footer].filter((el): el is HTMLElement => !!el && !el.hidden)
      : [];

    let lagFade: Promise<void> = Promise.resolve();
    if (lagTargets.length) {
      for (const el of lagTargets) el.style.opacity = "0";
      lagFade = tweenProgress(
        homeAnim.homeInDuration / 1000,
        HOME_IN_EASE,
        (p) => {
          for (const el of lagTargets) el.style.opacity = String(p);
        },
        delay + homeAnim.homeInMobileTextDelay / 1000,
      ).then(() => {
        // Drop the inline values so the mode/filter switch fades (and the
        // bridge exit fade) own these elements again.
        for (const el of lagTargets) el.style.opacity = "";
      });
    }

    const containerFade = new Promise<void>((resolve) => {
      if (!container) {
        resolve();
        return;
      }
      gsap.set(container, { opacity: 0 });
      gsap.to(container, {
        opacity: 1,
        duration: homeAnim.homeInDuration / 1000,
        delay,
        ease: HOME_IN_EASE,
        onComplete: resolve,
      });
    });

    await Promise.all([containerFade, lagFade]);
  }

  /**
   * The class-toggling half of syncHoverFromPointer(): for the active mode,
   * mirrors each item's current `:hover` state onto the same class its
   * mouseenter/mouseleave handlers manage (`.is-active` on the matching
   * text-gpu figure in text mode, `.is-hovered` on the image item in image
   * mode), respecting the active filter. Toggling OFF is deliberate — it
   * also clears any stray state left from before the freeze.
   */
  function applyPointerHover(): void {
    if (mode.value === "text") {
      for (let i = 0; i < textItems.length; i++) {
        const hovered = !isFilteredOut(i) && textItems[i]!.matches(":hover");
        textGpuFigures[i]?.classList.toggle("is-active", hovered);
      }
      return;
    }
    for (let i = 0; i < imageSlots.length; i++) {
      const hovered = !isFilteredOut(i) && imageSlots[i]!.matches(":hover");
      imageItems[i]?.classList.toggle("is-hovered", hovered);
    }
  }

  /**
   * Re-applies hover state from the live pointer position after an
   * entrance. The text/image hover handlers freeze while a navigation is in
   * flight (useNavLock().mutating — a stray mouse move mid-transition must
   * not fight the pane fades or the home→detail bridge), but if the cursor
   * is already resting on an item when home returns, no new mouseenter
   * fires once the freeze lifts — mouseenter only fires on a boundary
   * crossing — so the reveal would silently never happen. Called at the end
   * of in(): reads `:hover` off the DOM and toggles the same classes the
   * handlers would, for whichever mode is active. Desktop only — mobile
   * reveals are scroll-driven (see updateScrollReveal).
   */
  function syncHoverFromPointer(): void {
    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
    applyPointerHover();

    // Backstop: some engines (Safari notably) leave `:hover` stale when the
    // DOM changed under a motionless pointer, only recomputing it on the
    // next real mouse move — and a move WITHIN the same item fires
    // mousemove but no mouseenter, so the hover handlers alone can't
    // recover either. Arm a one-shot re-sync on that first move; it
    // self-disarms after firing and onDestroy removes it if the user
    // navigates away before moving.
    if (!hoverSyncMoveHandler) {
      hoverSyncMoveHandler = (): void => {
        hoverSyncMoveHandler = null;
        // Mirror the live handlers' freeze — by now a new navigation or a
        // mode/filter switch may have started, and the sync must not fight it.
        if (mutating?.value || modeSwitching) return;
        if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
        applyPointerHover();
      };
      window.addEventListener("mousemove", hoverSyncMoveHandler, { once: true });
    }
  }

  return {
    /**
     * Page mount. Queries every DOM ref, applies the persisted mode/filter
     * while the page is still hidden (see transitions/default.ts's
     * onBeforeEnter — this runs synchronously in the same tick the page is
     * pinned invisible, so restoring state here never flashes the cached
     * default), and wires every listener. Mirrors HomePage.init() exactly.
     */
    onInit(root: HTMLElement): void {
      console.debug("[page:home] onInit");
      container = root;
      mutating = useNavLock().mutating;

      // Pin hidden BEFORE `.is-controlled` is added (see
      // composables/usePageController.ts / transitions/default.ts). Every
      // other controller (BaseController, detail.ts) sets this in onInit —
      // home.ts was missing it, which meant CSS's `#page.is-controlled {
      // opacity: unset }` rule (styles/core/base.module.scss) released the
      // container to its default opacity (1) the instant `.is-controlled`
      // was added on first load, well before the boot intro overlay even
      // started fading — the container sat fully visible UNDER the still-
      // opaque intro the whole time, so when the intro faded out it read as
      // a crossfade into an already-revealed page instead of "intro fades
      // out completely, THEN home fades in." in()'s homeInFade() re-hides
      // and re-reveals correctly, but only after this pin stops the early,
      // uncontrolled reveal from ever happening.
      gsap.set(root, { opacity: 0 });

      textPane = root.querySelector<HTMLElement>('[data-mode-pane="text"]');
      imagePane = root.querySelector<HTMLElement>('[data-mode-pane="image"]');
      textGpu = root.querySelector<HTMLElement>(".home__text-gpu");
      footer = root.querySelector<HTMLElement>(".global-nav--footer");
      textItems = Array.from(root.querySelectorAll<HTMLElement>(".home__text-item"));
      imageItems = Array.from(root.querySelectorAll<HTMLElement>(".home__image-item"));
      imageSlots = Array.from(root.querySelectorAll<HTMLElement>(".home__image-slot"));
      textGpuFigures = Array.from(root.querySelectorAll<HTMLElement>(".home__text-gpu-figure"));
      modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".home__mode"));
      filterButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".home__filter"));

      // Initial mode + filter come from useHomeMode()/useHomeFilter()
      // (persistent across SPA navs, fresh "text"/"all" on a hard reload).
      applyModeDom(mode.value);
      applyFilter(filter.value);

      // Nav hover-reveal setup. No measurement, no inline styles: which
      // items show is pure CSS (`.global-nav:not(.is-expanded)` hides
      // non-active filter/mode buttons). The nav starts collapsed; hover
      // fades it out, toggles `.is-expanded`, fades it back in (see
      // setNavExpanded). We listen on the whole `.global-nav` element so
      // everything inside it — the groups, the inter-group gap, the
      // parens, the padding — counts as "hovering the nav";
      // mouseenter/mouseleave don't refire on internal crossings, so
      // parking the cursor in the gap between the two groups never
      // collapses an open nav. Open and close both fire IMMEDIATELY on
      // enter/leave — no debounce; the client wants zero detectable delay,
      // and setNavExpanded's generation guard already handles rapid
      // enter/leave thrash.
      //
      // Mobile/touch requirement: NO hover effects at all on the nav — tap
      // opens it, it STAYS open (never auto-collapses from a stray touch
      // event), and it only closes when a filter is picked (see the filter
      // button handler below). `navEnterHandler`/`navLeaveHandler` are
      // gated behind DESKTOP_HOVER_QUERY (real hover capability, not a
      // viewport-width check) so they're flatly inert on touch — this is
      // the actual fix for "doesn't stay open": some touch browsers fire a
      // synthetic/delayed `mouseleave` shortly after a tap, which was
      // instantly re-collapsing the nav through `navLeaveHandler` the exact
      // same way a real mouse-out would. Gating the LISTENERS themselves
      // (rather than trusting touch devices to just never fire these
      // events, which diaa's own old implementation assumed) removes that
      // path entirely.
      navEl = root.querySelector<HTMLElement>(".global-nav");
      if (navEl) {
        navEnterHandler = (): void => {
          if (!window.matchMedia(DESKTOP_HOVER_QUERY).matches) return;
          setNavExpanded(true);
        };
        navLeaveHandler = (): void => {
          if (!window.matchMedia(DESKTOP_HOVER_QUERY).matches) return;
          setNavExpanded(false);
        };
        // Click/tap opens the collapsed nav — required on touch devices
        // where hover can't fire. It only ever EXPANDS, and it must IGNORE
        // clicks that originated on the filter/mode buttons: their own
        // handlers run the switch (and on mobile collapse the nav), and
        // since that runs before the click bubbles up here, acting on it
        // would see the just-collapsed state and instantly re-expand the
        // nav. On desktop hover expands first, so this is effectively
        // touch-only. Already correctly "stays open" on a second tap
        // (`if (navExpanded) return`) — nothing here ever collapses it.
        navClickHandler = (e: Event): void => {
          const target = e.target as Element | null;
          if (target?.closest(".home__filter, .home__mode")) return;
          if (navExpanded) return;
          setNavExpanded(true);
        };
        navEl.addEventListener("mouseenter", navEnterHandler);
        navEl.addEventListener("mouseleave", navLeaveHandler);
        navEl.addEventListener("click", navClickHandler);
      }

      // Wire mode toggle clicks.
      for (const btn of modeButtons) {
        const handler = (): void => {
          const next = (btn.dataset.mode as HomeMode | undefined) ?? "text";
          if (next === mode.value) return;
          void switchMode(next);
        };
        btn.addEventListener("click", handler);
        modeBtnHandlers.push({ btn, handler });
      }

      // Wire filter button clicks. "all" is the sentinel that shows every
      // cell. The transition uses the same fade-down/swap/fade-up
      // choreography as the mode toggle (see switchMode) so filter changes
      // feel consistent.
      for (const btn of filterButtons) {
        const handler = (): void => {
          const next = (btn.dataset.filter as HomeFilter | undefined) ?? "all";
          if (next === filter.value) return;
          void switchFilter(next);
          // No-hover devices: there's no hover to leave, so the nav would
          // sit open indefinitely after a pick — collapse it as the filter
          // switch starts. Checked against the SAME hover-capability query
          // navEnterHandler/navLeaveHandler are gated on (not
          // MOBILE_MEDIA_QUERY's viewport width) — a touch device in a WIDE
          // viewport (a touchscreen laptop, an iPad in landscape) has no
          // hover either, and with the width check it would have had no way
          // to ever close the nav after a pick. Desktop (real hover) keeps
          // the hover-driven collapse instead — the cursor is still on the
          // nav, and collapsing under it would feel abrupt.
          if (!window.matchMedia(DESKTOP_HOVER_QUERY).matches) setNavExpanded(false);
        };
        btn.addEventListener("click", handler);
        filterBtnHandlers.push({ btn, handler });
      }

      // Wire text hover → DOM figure reveal. Hover toggles .is-active on the
      // matching .home__text-gpu-figure; CSS transitions opacity 0 → 1 so
      // the centered image appears behind the text labels (DOM-only).
      for (let i = 0; i < textItems.length; i++) {
        const item = textItems[i]!;

        const enter = (): void => {
          // Freeze hover state during a navigation: while a transition is
          // in flight the home→detail bridge depends on the active figure
          // staying `.is-active` until it is cloned (see out() /
          // transitions/home-to-detail.ts), so a stray mouse move must not
          // add/remove it. Same freeze during a mode/filter switch — hover
          // must not fight the pane fade.
          if (mutating?.value || modeSwitching) return;
          // Mobile reveals are scroll-driven (see updateScrollReveal); an
          // emulated mouseenter from a tap must not fight that state.
          if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
          if (mode.value !== "text") return;
          if (isFilteredOut(i)) return;
          textGpuFigures[i]?.classList.add("is-active");
        };
        const leave = (): void => {
          if (mutating?.value || modeSwitching) return;
          if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
          if (mode.value !== "text") return;
          if (isFilteredOut(i)) return;
          textGpuFigures[i]?.classList.remove("is-active");
        };

        item.addEventListener("mouseenter", enter);
        item.addEventListener("mouseleave", leave);
        hoverHandlers.push({ item, enter, leave });
      }

      // Mobile-only: the revealed centre image is a second tap target for
      // the detail page. CSS routes the hit (`.home__text` passes taps
      // through on mobile, only the `.is-active` figure is hit-testable),
      // and this delegated handler forwards the tap to the matching text
      // label's anchor via a programmatic click — so navigation takes the
      // exact same path as tapping the label (plugins/click-delegation.
      // client.ts's global delegation, the home→detail image bridge). Items
      // without an href (routable: false) render as <div>s, so their image
      // stays a no-op; routable ones are <a>s and forward normally.
      if (textGpu) {
        textGpuClickHandler = (e: Event): void => {
          if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
          if (mutating?.value || modeSwitching) return;
          const fig = (e.target as Element | null)?.closest<HTMLElement>(".home__text-gpu-figure");
          if (!fig) return;
          const item = textItems.find((el) => el.dataset.index === fig.dataset.index);
          if (item instanceof HTMLAnchorElement) {
            console.debug(`[page:home] gpu-tap → ${item.getAttribute("href")}`);
            item.click();
          }
        };
        textGpu.addEventListener("click", textGpuClickHandler);
      }

      // Image mode hover — entering a slot toggles `.is-hovered` on the
      // parent .home__image-item so CSS reveals the title overlay and fades
      // the figure's DOM <img>. One handler per image slot — bounded by the
      // DOM.
      for (let i = 0; i < imageSlots.length; i++) {
        const slot = imageSlots[i]!;
        const item = imageItems[i]!;

        const enter = (): void => {
          // Frozen during a mode/filter switch — toggling `.is-hovered`
          // mid-fade would fight the pane opacity tween and could land
          // stray hover state on the swapped-in pane.
          if (modeSwitching) return;
          if (mode.value !== "image") return;
          if (isFilteredOut(i)) return;
          item.classList.add("is-hovered");
        };
        const leave = (): void => {
          if (modeSwitching) return;
          if (mode.value !== "image") return;
          if (isFilteredOut(i)) return;
          item.classList.remove("is-hovered");
        };

        slot.addEventListener("mouseenter", enter);
        slot.addEventListener("mouseleave", leave);
        imageHoverHandlers.push({ slot, enter, leave });
      }

      // Dev-only animation tweak panel — hidden by default, Ctrl+F toggles
      // it (the panel itself owns that listener). Dynamically imported
      // behind import.meta.dev so production builds never fetch the panel
      // code. onInit() can't await this (the PageController contract's
      // onInit is synchronous, unlike diaa's async init()) — fire-and-forget
      // is safe here because the panel is dev-only and hidden until Ctrl+F,
      // by which point the import has long resolved. onDestroy() unmounts it
      // so neither the panel nor its shortcut exists on any other page.
      if (import.meta.dev) {
        void import("~/components/dev/HomeAnimGui.client.vue").then(({ default: HomeAnimGui }) => {
          const mountEl = document.createElement("div");
          document.body.appendChild(mountEl);
          const vueApp = createVueApp(HomeAnimGui);
          vueApp.mount(mountEl);
          animGuiTeardown = (): void => {
            vueApp.unmount();
            mountEl.remove();
          };
        });
      }
    },

    // `root` is intentionally unused — unlike out()/onInit() (which operate
    // on the exact root passed in), in()'s work (homeInFade, hover re-sync,
    // the beat) all runs against the SAME element via the `container`
    // closure set by onInit(), matching how the source's in() relied on
    // `this.container` rather than a parameter.
    async in(_root: HTMLElement): Promise<void> {
      console.debug("[page:home] in");
      // Clear any stale inline opacity left by out() on a previous mount.
      if (textPane) textPane.style.opacity = "";
      if (imagePane) imagePane.style.opacity = "";

      // Mobile: re-sync the scroll-driven reveal now that the scroll
      // position is FINAL. onInit()'s own updateScrollReveal(true) call
      // (via applyFilter → applyFilterVisibility) runs from
      // transitions/default.ts's onBeforeEnter — which fires well before
      // onEnter's scroll reset/restore (restoreOrResetScroll, called
      // synchronously right before this in() is invoked) — so it computed
      // the nearest-midline item against whatever scroll the OUTGOING page
      // happened to be at, not this page's actual entrance scroll (0 on
      // forward nav, the snapshot on back-nav). The result: the wrong
      // figure held `.is-active` and stayed wrong until the user's first
      // real scroll event (onScroll → updateScrollReveal()) self-corrected
      // it. There is no stale state to clear here first — onInit() runs
      // against a fresh DOM/closure every mount (no <KeepAlive>, no
      // module-level state), so the only thing wrong was WHEN the one
      // existing call ran, not leftover `.is-active` from a previous visit.
      // `force: true` bypasses the mutating/mode-switch freeze, matching
      // onInit's own forced call — there is no bridge clone or hover state
      // to protect this early in the entrance (container is still opacity 0
      // here, per transitions/default.ts's onEnter pin), and it must win
      // over a wrong index unconditionally. No-ops on desktop widths.
      updateScrollReveal(true);

      // Return-to-home brand beat: on every SPA navigation back to home,
      // echo the intro. useNavLock().mutating is true only during a
      // controller navigation — never during composables/useBoot.ts's
      // runBoot(), where the real intro already played — so it cleanly
      // gates the beat to returns. The persistent `.intro-beat` overlay
      // (white field + DIAA mark) covers the swap; we reveal home beneath
      // it, hold the mark, then fade the cover out on the intro's "slow"
      // ease.
      // One-shot beat suppression: the detail page's bottom-dwell
      // auto-close arrives FROM the DIAA outro, which already played the
      // brand moment — replaying the beat would show the mark twice back
      // to back. Claimed unconditionally (clear-on-read) so it can never
      // leak into a later nav.
      const skipBeat = takeHomeBeatSkip();

      // `.intro-beat` lives outside <NuxtPage> in app.vue (a sibling of
      // #app, exactly like the old index.html's DOM order — see
      // components/intro/IntroBeat.vue), so it can't be scoped through
      // `root` — reaching for it via a direct document.querySelector is
      // INTENTIONAL, mirroring HomePage.in()'s own direct DOM query
      // (routes/home/home.ts line ~800, see anim-plan.md §7), not an
      // oversight to fix.
      const beatEl = document.querySelector<HTMLElement>(".intro-beat");
      if (mutating?.value && beatEl && homeAnim.beatEnabled && !skipBeat) {
        console.debug("[page:home] in (return brand beat)");
        const logoEl = beatEl.querySelector<HTMLElement>(".intro-beat__logo");

        // Raise the white cover over the swap. Home stays hidden (opacity
        // 0, left by the transition's pin) for the WHOLE beat — the beat
        // plays entirely "on the cover", exactly like the boot intro, and
        // home is revealed only AFTER the cover is gone. The swap window is
        // already on the white html background (var(--bg-theme)), so the
        // cover appearing is seamless; the mark starts hidden (CSS opacity
        // 0 on .intro-beat__logo), like the intro logo.
        beatEl.classList.add("is-active");

        // 1. Fade the DIAA mark in over homeAnim.beatFadeIn on the intro's
        //    "slow" ease — the same opacity tween the intro uses for the
        //    logotype.
        if (logoEl) {
          await new Promise<void>((resolve) => {
            gsap.set(logoEl, { opacity: 0 });
            gsap.to(logoEl, {
              opacity: 1,
              duration: homeAnim.beatFadeIn / 1000,
              ease: BEAT_EASE,
              onComplete: resolve,
            });
          });
        }

        // 2/3. Hold the mark for homeAnim.beatHold (the tween's `delay`
        //      holds the cover at full opacity), then fade the whole cover
        //      (white field + mark) out over homeAnim.beatFadeOut — to the
        //      blank white background, NOT to home. The DIAA is fully gone
        //      before home appears (same hold + overlay fade-out as the
        //      intro).
        await new Promise<void>((resolve) => {
          gsap.set(beatEl, { opacity: 1 });
          gsap.to(beatEl, {
            opacity: 0,
            duration: homeAnim.beatFadeOut / 1000,
            delay: homeAnim.beatHold / 1000,
            ease: BEAT_EASE,
            onComplete: resolve,
          });
        });

        // Re-hide the overlay and drop the inline opacities so the CSS
        // rules (.is-active off, mark back to opacity 0) own the resting
        // state for the next return.
        beatEl.classList.remove("is-active");
        beatEl.style.opacity = "";
        if (logoEl) logoEl.style.opacity = "";

        // 4. Only now, with the DIAA fully gone, reveal home — fade the
        //    container up from 0 (the same entrance fade as first boot).
        //    onInit() already restored the persisted mode/filter while it
        //    was hidden, so the correct state fades in.
        await homeInFade();
        // The hover handlers were frozen for the whole navigation — if the
        // cursor is already parked on an item, apply its reveal now that
        // the entrance is done (see syncHoverFromPointer).
        syncHoverFromPointer();
        return;
      }

      // First boot (mutating false): reveal the page normally. onInit()
      // already restored the persisted mode/filter while the container was
      // hidden, so this fades the correct state in (no flash of the cached
      // Text-mode default when returning to Image mode). Held for
      // homeAnim.homeInDelay after the intro clears, then faded over
      // homeAnim.homeInDuration on the brand-beat ease.
      await homeInFade(homeAnim.homeInDelay / 1000);
      // Same pointer re-sync as the return path — on first boot the cursor
      // can be resting on an item before the intro clears.
      syncHoverFromPointer();
    },

    /**
     * Page-out fade. Fades the whole container to 0 so home leaves cleanly
     * before the transition swaps the DOM.
     *
     * Bridge exception: when navigating to the active figure's own detail
     * page in text mode, transitions/home-to-detail.ts's bridgeOut() has
     * ALREADY run by the time out() is called (onBeforeLeave fires before
     * onLeave — see transitions/default.ts) and, if it decided to bridge,
     * has already cloned the active figure to a fixed body element and set
     * the ORIGINAL figure's `visibility` to "hidden" (the double-shadow fix
     * — see that file). So "was I bridged" is exactly "is the active figure
     * now hidden out from under me" — no need to re-derive the
     * mode/route-target check a second time here. When bridging, fade only
     * the chrome — text labels, top nav, footer — and leave the container
     * (and `.home__text-gpu`) opaque so the clone (now standing in for the
     * hidden original) stays visible. The transition's DOM removal then
     * only ever touches the (already-hidden) original; the clone lives on
     * `document.body` and survives it.
     */
    async out(root: HTMLElement): Promise<void> {
      console.debug("[page:home] out");

      const activeFigure = root.querySelector<HTMLElement>(".home__text-gpu-figure.is-active");
      const bridging = !!activeFigure && activeFigure.style.visibility === "hidden";

      if (bridging) {
        const targets = [textPane, navEl, footer].filter((el): el is HTMLElement => !!el);
        if (!homeAnim.homeOutEnabled) {
          for (const el of targets) el.style.opacity = "0";
          return;
        }
        await tweenProgress(homeAnim.homeOutDuration / 1000, MODE_SWITCH_EASE, (p) => {
          const o = String(1 - p);
          for (const el of targets) el.style.opacity = o;
        });
        return;
      }

      if (!homeAnim.homeOutEnabled) {
        root.style.opacity = "0";
        return;
      }
      await new Promise<void>((resolve) => {
        gsap.set(root, { opacity: 1 });
        gsap.to(root, {
          opacity: 0,
          duration: homeAnim.homeOutDuration / 1000,
          ease: "slow",
          onComplete: resolve,
        });
      });
    },

    /** Scroll hook (subscribed after in() resolves) — drives the mobile
     *  reveal. Desktop keeps hover-driven reveals and no-ops here (see
     *  updateScrollReveal's own mobile-only guard). */
    onScroll(_e: ScrollEvent): void {
      updateScrollReveal();
    },

    /** Teardown: remove every listener onInit added, kill any in-flight
     *  tween, and release every DOM ref so nothing leaks across SPA
     *  navigation. */
    onDestroy(): void {
      for (const { item, enter, leave } of hoverHandlers) {
        item.removeEventListener("mouseenter", enter);
        item.removeEventListener("mouseleave", leave);
      }
      for (const { slot, enter, leave } of imageHoverHandlers) {
        slot.removeEventListener("mouseenter", enter);
        slot.removeEventListener("mouseleave", leave);
      }
      for (const { btn, handler } of modeBtnHandlers) btn.removeEventListener("click", handler);
      for (const { btn, handler } of filterBtnHandlers) btn.removeEventListener("click", handler);
      if (navEl) {
        if (navEnterHandler) navEl.removeEventListener("mouseenter", navEnterHandler);
        if (navLeaveHandler) navEl.removeEventListener("mouseleave", navLeaveHandler);
        if (navClickHandler) navEl.removeEventListener("click", navClickHandler);
      }
      if (textGpu && textGpuClickHandler) textGpu.removeEventListener("click", textGpuClickHandler);
      textGpuClickHandler = null;
      // Disarm the one-shot pointer re-sync if the user navigated away
      // before moving the mouse (harmless no-op when it already fired).
      if (hoverSyncMoveHandler) {
        window.removeEventListener("mousemove", hoverSyncMoveHandler);
        hoverSyncMoveHandler = null;
      }
      navAnima?.kill();
      navAnima = null;

      textItems = [];
      imageItems = [];
      imageSlots = [];
      textGpuFigures = [];
      hoverHandlers = [];
      imageHoverHandlers = [];
      modeBtnHandlers = [];
      filterBtnHandlers = [];
      textPane = null;
      imagePane = null;
      textGpu = null;
      footer = null;
      container = null;
      scrollRevealIndex = -1;
      modeButtons = [];
      filterButtons = [];
      navEl = null;
      navEnterHandler = null;
      navLeaveHandler = null;
      navClickHandler = null;
      navExpanded = false;
      navGen = 0;
      modeSwitching = false;
      mutating = null;

      animGuiTeardown?.();
      animGuiTeardown = null;
    },
  };
}

export default createHomeController;
