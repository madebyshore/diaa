/**
 * HomePage — manages lifecycle for the / route.
 *
 * Two visual modes share the same DOM container:
 *
 *   Text mode — DOM shows a single centered, responsive flex-wrap of text
 *   labels. Hovering a label toggles `.is-active` on the matching
 *   `.home__text-gpu-figure` so its `<img>` fades in at the viewport centre via
 *   CSS transition. Mouse leave removes `.is-active` and the image fades out.
 *
 *   Image mode — DOM shows a 4-per-row grid of 1:1 cells. Each cell's
 *   `<figure class="_g">` contains the responsive `<img>`. Hovering a
 *   slot toggles `.is-hovered` on the parent `.home__image-item` so CSS
 *   reveals the title overlay and fades the figure's `<img>`.
 *
 * Mode is persisted on `App.home.mode` so it survives navigation. The
 * mode toggle nav at top-center swaps DOM panes and `.home__text-gpu`
 * visibility on every switch.
 */

import { Anima, type AnimaState } from "kido/anima";

import { homeAnim } from "@app/components/home-anim";
import { App, type HomeMode, type HomeFilter } from "@app/context";
import { takeHomeBeatSkip } from "@app/controller/beat-skip";
import { animaToPromise } from "@app/controller/transition-fx";
import { dbg } from "@app/debug";
import { BasePage } from "@app/primitives/base-page";

// ALL durations (and per-animation enable toggles) for the home page live in
// the mutable `homeAnim` config (@app/components/home-anim) so the dev-only
// tweak panel (home-anim-gui.ts, installed in init() behind import.meta.env.DEV,
// hidden until Ctrl+F) can adjust them on the fly. Read homeAnim.* at animation
// time — never cache a duration in a local const. Only the easing curves stay
// fixed here.

// Shared fade choreography for both home toggles — Text ⇄ Image mode switching
// AND taxonomy filtering use the same timing (homeAnim.switchDuration per fade
// half) so the two interactions feel identical, on kido's "slow" ease (the
// spring-fit curve — see Ease.slow in packages/kido/src/utils.ts).
const MODE_SWITCH_EASE = "slow";

// Home entrance fade — mirrors the intro brand-beat curve. On first boot the
// intro overlay clears in boot phase 4 before page.in() runs in phase 5, so the
// container holds at opacity 0 for homeAnim.homeInDelay, then fades in over
// homeAnim.homeInDuration with kido's "slow" ease — the same curve the intro
// text uses. The delay also applies on SPA navigations back to home, giving the
// entrance a consistent beat.
const HOME_IN_EASE = "slow";

// Return-to-home brand beat — a re-run of the intro logotype beat
// (engine/boot/intro.ts) using the intro's "slow" ease (the spring-fit curve —
// see Ease.slow in packages/kido/src/utils.ts).
// On every SPA navigation back to home, in() covers the swap with the persistent
// `.intro-beat` overlay (white field + DIAA mark — see index.html and
// core/intro-beat.module.scss), fades the mark IN over homeAnim.beatFadeIn,
// holds it for homeAnim.beatHold, then fades the whole cover out over
// homeAnim.beatFadeOut. Home is revealed only AFTER the cover is fully gone (it
// stays hidden through the beat, then fades in) — the same sequence as the
// intro: overlay out, THEN page in; never a crossfade. First boot is excluded
// automatically: the only signal is App.mutating, true during a controller
// navigation but false in boot phase 5, where the real intro already played.
const BEAT_EASE = "slow";

// Nav hover reveal — a fade-swap, NOT a width expansion. On hover the whole
// nav fades out, swaps between collapsed (only the active filter + mode, e.g.
// `( All, Text )`) and expanded (every item, `( All, Projects, … Text, Image )`),
// then fades back in. Visibility is pure CSS via `.is-expanded` on the nav.
// ONE ease spans the WHOLE animation: a single Anima drives a V-shaped opacity
// (1 → 0 → 1) over NAV_FADE_DURATION, LINEAR — cubic-bezier(0, 0, 1, 1) —
// applied once across both the fade-out and the fade-in (never restarted per
// half), toggling `.is-expanded` at the midpoint. Linear (not the Figma
// prototype's "Ease in") because an ease-in ramp reads as lag on a hover
// affordance: the response has to be visible the instant the cursor moves.
const NAV_FADE_DURATION = 300;
const NAV_FADE_EASE: number[] = [0, 0, 1, 1];

// Mobile tier — keep in sync with `breakpoint-mobile` in
// styles/includes/_breakpoints.module.scss (everything at or below 768px).
// Used to gate touch-specific nav behaviour like auto-collapse after a
// filter pick, where desktop relies on hover instead.
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

export default class HomePage extends BasePage {
  private textPane: HTMLElement | null = null;
  private imagePane: HTMLElement | null = null;
  private textGpu: HTMLElement | null = null;
  /** Index of the figure the mobile scroll reveal currently holds active,
   *  -1 when none. Desktop keeps hover-driven reveals and ignores this. */
  private scrollRevealIndex = -1;
  private footer: HTMLElement | null = null;
  private modeButtons: HTMLButtonElement[] = [];
  private filterButtons: HTMLButtonElement[] = [];
  private textItems: HTMLElement[] = [];
  private imageItems: HTMLElement[] = [];
  private imageSlots: HTMLElement[] = [];
  private textGpuFigures: HTMLElement[] = [];
  private hoverAnimas: Array<Anima | null> = [];
  private hoverHandlers: Array<{
    enter: () => void;
    leave: () => void;
  }> = [];
  private imageHoverHandlers: Array<{
    enter: () => void;
    leave: () => void;
  }> = [];
  private modeBtnHandlers: Array<{
    btn: HTMLButtonElement;
    handler: (e: Event) => void;
  }> = [];
  private filterBtnHandlers: Array<{
    btn: HTMLButtonElement;
    handler: (e: Event) => void;
  }> = [];

  // Nav hover-reveal state.
  private navEl: HTMLElement | null = null;
  /** Current visible state — false = collapsed (resting), true = expanded. */
  private navExpanded = false;
  /** Bumped on each setNavExpanded() so a superseded fade can detect it was
   *  replaced by a newer hover and stop touching the nav. */
  private navGen = 0;
  private navAnima: Anima | null = null;
  private navEnterHandler: (() => void) | null = null;
  private navLeaveHandler: (() => void) | null = null;
  /** Touch parity for the hover reveal — a tap on the collapsed nav expands
   *  it (mobile hides the mode group but the filters still need opening). */
  private navClickHandler: ((e: Event) => void) | null = null;
  /** Mobile-only: a tap on the revealed centre image navigates to the same
   *  detail page as its text label (see the textGpu click wiring in init). */
  private textGpuClickHandler: ((e: Event) => void) | null = null;

  /** One-shot mousemove backstop armed by syncHoverFromPointer() — re-syncs
   *  hover state on the first pointer move after an entrance, for browsers
   *  that leave `:hover` stale until the mouse moves. Null when unarmed. */
  private hoverSyncMoveHandler: (() => void) | null = null;

  /** Teardown for the dev-only tweak panel's Ctrl+F toggle — removes the
   *  shortcut listener and the panel if open (null in production). */
  private animGuiTeardown: (() => void) | null = null;

  /** True while a mode or filter switch fade is in flight. The text and image
   *  hover handlers bail on it — a hover toggling `.is-hovered`/`.is-active`
   *  mid-fade would fight the pane opacity tween and leave stray hover state
   *  on the swapped-in pane. */
  private modeSwitching = false;

  async init(container: Element | null): Promise<void> {
    if (!container) return;
    await super.init(container);
    dbg.page("home:init");

    this.textPane = container.querySelector<HTMLElement>(
      '[data-mode-pane="text"]'
    );
    this.imagePane = container.querySelector<HTMLElement>(
      '[data-mode-pane="image"]'
    );
    this.textGpu = container.querySelector<HTMLElement>(".home__text-gpu");
    this.footer = container.querySelector<HTMLElement>(".global-nav--footer");
    this.textItems = Array.from(
      container.querySelectorAll<HTMLElement>(".home__text-item")
    );
    this.imageItems = Array.from(
      container.querySelectorAll<HTMLElement>(".home__image-item")
    );
    this.imageSlots = Array.from(
      container.querySelectorAll<HTMLElement>(".home__image-slot")
    );
    this.textGpuFigures = Array.from(
      container.querySelectorAll<HTMLElement>(".home__text-gpu-figure")
    );
    this.modeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".home__mode")
    );
    this.filterButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".home__filter")
    );

    // Initial mode + filter come from App.home (persistent across navs).
    const initialMode: HomeMode = App.home?.mode ?? "text";
    const initialFilter: HomeFilter = App.home?.filter ?? "all";
    this.applyModeDom(initialMode);
    this.applyFilter(initialFilter);

    // Nav hover-reveal setup. No measurement, no inline styles: which items
    // show is pure CSS (`.global-nav:not(.is-expanded)` hides non-active filter
    // / mode buttons). The nav starts collapsed; hover fades it out, toggles
    // `.is-expanded`, fades it back in (see setNavExpanded). We listen on the
    // whole `.global-nav` element so everything inside it — the groups, the
    // inter-group gap, the parens, the padding — counts as "hovering the nav";
    // mouseenter/mouseleave don't refire on internal crossings, so parking the
    // cursor in the gap between the two groups never collapses an open nav.
    // Open and close both fire IMMEDIATELY on enter/leave — no debounce; the
    // client wants zero detectable delay, and setNavExpanded's generation
    // guard already handles rapid enter/leave thrash.
    this.navEl = container.querySelector<HTMLElement>(".global-nav");
    if (this.navEl) {
      this.navEnterHandler = (): void => {
        this.setNavExpanded(true);
      };
      this.navLeaveHandler = (): void => {
        this.setNavExpanded(false);
      };
      // Click/tap opens the collapsed nav — required on touch devices where
      // hover can't fire. It only ever EXPANDS, and it must IGNORE clicks
      // that originated on the filter/mode buttons: their own handlers run
      // the switch (and on mobile collapse the nav), and since that runs
      // before the click bubbles up here, acting on it would see the
      // just-collapsed state and instantly re-expand the nav. On desktop
      // hover expands first, so this is effectively touch-only.
      this.navClickHandler = (e: Event): void => {
        const target = e.target as Element | null;
        if (target?.closest(".home__filter, .home__mode")) return;
        if (this.navExpanded) return;
        this.setNavExpanded(true);
      };
      this.navEl.addEventListener("mouseenter", this.navEnterHandler);
      this.navEl.addEventListener("mouseleave", this.navLeaveHandler);
      this.navEl.addEventListener("click", this.navClickHandler);
    }

    // Wire mode toggle clicks.
    for (const btn of this.modeButtons) {
      const handler = (): void => {
        const next = (btn.dataset.mode as HomeMode | undefined) ?? "text";
        if (next === App.home.mode) return;
        void this.switchMode(next);
      };
      btn.addEventListener("click", handler);
      this.modeBtnHandlers.push({ btn, handler });
    }

    // Wire filter button clicks. "all" is the sentinel that shows every cell.
    // The transition uses the same fade-down/swap/fade-up choreography as
    // the mode toggle (see switchMode) so filter changes feel consistent.
    for (const btn of this.filterButtons) {
      const handler = (): void => {
        const next = (btn.dataset.filter as HomeFilter | undefined) ?? "all";
        if (next === App.home.filter) return;
        void this.switchFilter(next);
        // Mobile: there's no hover to leave, so the nav would sit open
        // indefinitely after a pick — collapse it as the filter switch
        // starts. Desktop keeps the hover-driven collapse (the cursor is
        // still on the nav, and collapsing under it would feel abrupt).
        if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
          this.setNavExpanded(false);
        }
      };
      btn.addEventListener("click", handler);
      this.filterBtnHandlers.push({ btn, handler });
    }

    // Wire text hover → DOM figure reveal. One Anima per index, paired with
    // the text item and the matching .home__text-gpu-figure at that index.
    // Hover toggles .is-active on the figure; CSS transitions opacity 0 → 1
    // so the centered image appears behind the text labels (DOM-only).
    for (let i = 0; i < this.textItems.length; i++) {
      this.hoverAnimas.push(null);
      const item = this.textItems[i]!;

      const enter = (): void => {
        // Freeze hover state during a navigation: while a transition is in
        // flight the home→detail bridge depends on the active figure staying
        // `.is-active` until it is cloned (see out()), so a stray mouse move
        // must not add/remove it. Same freeze during a mode/filter switch —
        // hover must not fight the pane fade.
        if (App.mutating || this.modeSwitching) return;
        // Mobile reveals are scroll-driven (see updateScrollReveal); an
        // emulated mouseenter from a tap must not fight that state.
        if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
        if (App.home.mode !== "text") return;
        if (this.isFilteredOut(i)) return;
        // Reveal the matching centred image behind the text labels (DOM).
        this.textGpuFigures[i]?.classList.add("is-active");
      };
      const leave = (): void => {
        if (App.mutating || this.modeSwitching) return;
        if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
        if (App.home.mode !== "text") return;
        if (this.isFilteredOut(i)) return;
        this.textGpuFigures[i]?.classList.remove("is-active");
      };

      item.addEventListener("mouseenter", enter);
      item.addEventListener("mouseleave", leave);
      this.hoverHandlers.push({ enter, leave });
    }

    // Mobile-only: the revealed centre image is a second tap target for the
    // detail page. CSS routes the hit (`.home__text` passes taps through on
    // mobile, only the `.is-active` figure is hit-testable), and this
    // delegated handler forwards the tap to the matching text label's
    // anchor via a programmatic click — so navigation takes the exact same
    // path as tapping the label (SPA delegation, App.target = the anchor,
    // home→detail image bridge). In-progress entries without "Allow Routing
    // to Page" render as <div>s with no href, so their image stays a no-op;
    // routable ones are <a>s and forward normally.
    if (this.textGpu) {
      this.textGpuClickHandler = (e: Event): void => {
        if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
        if (App.mutating || this.modeSwitching) return;
        const fig = (e.target as Element | null)?.closest<HTMLElement>(
          ".home__text-gpu-figure"
        );
        if (!fig) return;
        const item = this.textItems.find(
          (el) => el.dataset.index === fig.dataset.index
        );
        if (item instanceof HTMLAnchorElement) {
          dbg.page(`home:gpu-tap → ${item.getAttribute("href")}`);
          item.click();
        }
      };
      this.textGpu.addEventListener("click", this.textGpuClickHandler);
    }

    // Image mode hover — entering a slot toggles `.is-hovered` on the parent
    // .home__image-item so CSS reveals the title overlay and fades the figure's
    // DOM <img>. One handler per image slot — bounded by the DOM.
    for (let i = 0; i < this.imageSlots.length; i++) {
      const slot = this.imageSlots[i]!;
      const item = this.imageItems[i]!;

      const enter = (): void => {
        // Frozen during a mode/filter switch — toggling `.is-hovered` mid-fade
        // would fight the pane opacity tween and could land stray hover state
        // on the swapped-in pane.
        if (this.modeSwitching) return;
        if (App.home.mode !== "image") return;
        if (this.isFilteredOut(i)) return;
        item.classList.add("is-hovered");
      };
      const leave = (): void => {
        if (this.modeSwitching) return;
        if (App.home.mode !== "image") return;
        if (this.isFilteredOut(i)) return;
        item.classList.remove("is-hovered");
      };

      slot.addEventListener("mouseenter", enter);
      slot.addEventListener("mouseleave", leave);
      this.imageHoverHandlers.push({ enter, leave });
    }

    // Dev-only animation tweak panel — hidden by default, Ctrl+F toggles it.
    // Dynamically imported behind DEV so production builds never fetch the
    // panel code. Installed here (before in()) so any persisted tuning is
    // loaded into homeAnim before the entrance runs; cleanup() removes the
    // shortcut + panel so neither exists on any other page.
    if (import.meta.env.DEV) {
      const { installHomeAnimGui } = await import(
        "@app/components/home-anim-gui"
      );
      this.animGuiTeardown = installHomeAnimGui();
    }
  }

  /**
   * True if the cell at `index` is filtered out by the active taxonomy
   * filter. Reads `data-taxonomy` off whichever item exists at that index
   * (text or image mode — they share indices via flatIndex). When filter
   * is `"all"`, nothing is filtered.
   */
  private isFilteredOut(index: number): boolean {
    const filter = App.home.filter;
    if (filter === "all") return false;
    const tax = this.cellTaxonomyAt(index);
    return tax !== filter;
  }

  /**
   * Write nav expand/collapse styles for the current navProgress (0..1).
   * Two-phase, with staggered per-item opacity:
   *
   *   elapsedMs    = p * navExpandTotalMs
   *   widthFactor  = clamp(elapsedMs / NAV_WIDTH_PHASE_MS, 0, 1)
   *   itemOpacity  = clamp((elapsedMs - itemStartMs) / NAV_OPACITY_FADE_MS, 0, 1)
   *
   * where itemStartMs = NAV_WIDTH_PHASE_MS + inactiveIdx * NAV_OPACITY_STAGGER_MS.
   *
   * On expand: width grows first; then inactive labels fade in
   * staggered (first → last). On collapse the formula naturally
   * reverses — last item's opacity drops first, then earlier items,
   * then width collapses.
   *
   * Active items hold full opacity + natural width regardless of p;
   * only their margin-left tracks the width phase.
   */
  /**
   * Reveal/hide the nav with a fade-swap. A single Anima drives a V-shaped
   * opacity (1 → 0 → 1) over NAV_FADE_DURATION on ONE continuous ease
   * (NAV_FADE_EASE, linear) spanning the whole animation — the
   * V-fold is applied to the eased progress, so the fade-out and the fade-in
   * are two halves of one curve, not two separately-eased tweens. At the
   * midpoint (fully faded) we toggle `.is-expanded`, which is what CSS reads
   * to show every item vs. only the active filter + mode. So the user sees:
   * fade out → the set swaps underneath → fade back in. Visibility and commas
   * are pure CSS — no per-item width/opacity tweening here.
   *
   * `navGen` guards rapid hover toggles: a newer call bumps the generation and
   * pauses the in-flight anima, and the older run bails before clearing opacity.
   */
  private setNavExpanded(expanded: boolean): void {
    if (!this.navEl || this.navExpanded === expanded) return;
    this.navExpanded = expanded;
    const gen = ++this.navGen;
    this.navAnima?.pause();

    let swapped = false;
    this.navAnima = new Anima({
      el: window,
      d: NAV_FADE_DURATION,
      e: NAV_FADE_EASE,
      u: (state: AnimaState) => {
        if (!this.navEl || gen !== this.navGen) return;
        // V-fold on the eased progress: |p - 0.5| * 2 → 1 at the ends, 0 at
        // the midpoint — one ease curve spans both the out and the in.
        this.navEl.style.opacity = String(Math.abs(state.prE - 0.5) * 2);
        // Swap the visible set once, while the nav is fully faded out.
        if (!swapped && state.prE >= 0.5) {
          swapped = true;
          this.navEl.classList.toggle("is-expanded", expanded);
        }
      },
      cb: () => {
        if (this.navEl && gen === this.navGen) this.navEl.style.opacity = "";
      },
    });
    this.navAnima.play();
  }

  /** Reads the taxonomy id off the matching grid item (text or image). */
  private cellTaxonomyAt(index: number): string {
    const fromImage = this.imageItems[index]?.dataset.taxonomy;
    if (fromImage !== undefined) return fromImage;
    const fromText = this.textItems[index]?.dataset.taxonomy;
    return fromText ?? "";
  }

  /**
   * Mobile scroll-driven image reveal — the touch counterpart of the desktop
   * hover reveal. Entries sit one small-viewport apart centre-to-centre
   * (item + gap = 100svh, see .home__text), so the entry the user is on is
   * the visible (unfiltered) item whose CENTRE is nearest the viewport
   * midline. The handoff fires at the halfway point between two entries —
   * the instant the outgoing label is leaving past the top as the next
   * enters from below the footer, never while both are readable — and the
   * image swaps at that crossover. Exactly one figure holds `.is-active`
   * at a time (the same class the hover path and the home→detail bridge
   * use), so the CSS fade and the transition clone work unchanged. No-ops
   * on desktop widths; `force` skips the mutating/mode-switch freeze for
   * init/filter-time re-syncs, where there is no bridge clone or hover
   * state to protect.
   */
  private updateScrollReveal(force = false): void {
    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
    if (!force && (App.mutating || this.modeSwitching)) return;

    const mid = window.innerHeight / 2;
    let active = -1;
    let best = Infinity;
    for (let i = 0; i < this.textItems.length; i++) {
      if (this.isFilteredOut(i)) continue;
      const rect = this.textItems[i]!.getBoundingClientRect();
      const dist = Math.abs(rect.top + rect.height / 2 - mid);
      // Items are in document order, so distance to the midline strictly
      // shrinks then grows — once it grows, the nearest one is behind us.
      if (dist > best) break;
      best = dist;
      active = i;
    }

    if (active === this.scrollRevealIndex) return;
    if (this.scrollRevealIndex >= 0)
      this.textGpuFigures[this.scrollRevealIndex]?.classList.remove(
        "is-active"
      );
    if (active >= 0) this.textGpuFigures[active]?.classList.add("is-active");
    this.scrollRevealIndex = active;
    dbg.page(`home:scroll-reveal index=${active}`);
  }

  /** Scroll hook (subscribed by PageManager) — drives the mobile reveal. */
  onScroll(): void {
    this.updateScrollReveal();
  }

  /**
   * Apply a taxonomy filter — hide cells/figures/rows that don't match,
   * and update button active states. Persists `App.home.filter`.
   */
  private applyFilter(filter: HomeFilter): void {
    this.applyFilterButtons(filter);
    this.applyFilterVisibility(filter);
  }

  /**
   * Reflect the picked filter on the nav — persists `App.home.filter` and
   * moves `.is-active`/aria-pressed to the matching filter button. The nav's
   * collapsed view (only the active filter + mode) reads these `.is-active`
   * toggles via CSS, so this MUST run at click time, before any fades: the
   * collapse that follows a pick has to close showing the NEW filter, not
   * close on the old one and hard-swap when the pane fade midpoint lands.
   */
  private applyFilterButtons(filter: HomeFilter): void {
    App.home.filter = filter;
    for (const btn of this.filterButtons) {
      const isActive = (btn.dataset.filter ?? "all") === filter;
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
  private applyFilterVisibility(filter: HomeFilter): void {
    const setHidden = (el: HTMLElement, hidden: boolean): void => {
      if (hidden) el.setAttribute("data-filter-hidden", "");
      else el.removeAttribute("data-filter-hidden");
    };
    const matches = (el: HTMLElement): boolean => {
      if (filter === "all") return true;
      return (el.dataset.taxonomy ?? "") === filter;
    };

    for (const item of this.textItems) setHidden(item, !matches(item));
    for (const item of this.imageItems) setHidden(item, !matches(item));
    for (const fig of this.textGpuFigures) setHidden(fig, !matches(fig));

    // The visible item set changed, so the mobile scroll reveal's active
    // label may have too (forced — this also runs during init and the
    // filter-switch fade, setting the reveal for the initial scroll
    // position before the page is shown).
    this.updateScrollReveal(true);
  }

  /**
   * Toggle DOM visibility for text vs image pane (and the text-gpu anchors).
   * The text-gpu anchors are only meaningful in text mode; hiding them in
   * image mode prevents them from accidentally intercepting pointer events.
   */
  private applyModeDom(mode: HomeMode): void {
    if (this.container) (this.container as HTMLElement).dataset.mode = mode;

    if (this.textPane) this.textPane.hidden = mode !== "text";
    if (this.imagePane) this.imagePane.hidden = mode !== "image";
    if (this.textGpu) this.textGpu.hidden = mode !== "text";

    this.applyModeButtons(mode);

    App.home.mode = mode;
  }

  /**
   * Reflect the picked mode on the nav — moves `.is-active`/aria-pressed to
   * the matching mode button. The collapsed nav's visible item set reads
   * these toggles via CSS, so (like applyFilterButtons) this runs at click
   * time in runModeSwitch, ahead of the pane fade, so a collapse mid-switch
   * closes showing the new mode. Deliberately does NOT touch App.home.mode —
   * the pane swap and state change stay at the fade midpoint.
   */
  private applyModeButtons(mode: HomeMode): void {
    for (const btn of this.modeButtons) {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
  }

  /**
   * Switch to `next` taxonomy filter with the same fade choreography —
   * duration and ease — as `switchMode`: fade out the active pane + footer,
   * apply the filter (toggles per-cell visibility and reflows text mode via
   * CSS), then fade everything back in. The current mode does not change.
   */
  private async switchFilter(next: HomeFilter): Promise<void> {
    dbg.page(`home:switch-filter → ${next}`);
    // Freeze the text/image hover handlers for the whole fade-swap-fade —
    // the finally guarantees they thaw even if an Anima is superseded.
    this.modeSwitching = true;
    try {
      await this.runFilterSwitch(next);
    } finally {
      this.modeSwitching = false;
    }
  }

  /** The switchFilter body — see switchFilter for the hover freeze wrapper. */
  private async runFilterSwitch(next: HomeFilter): Promise<void> {
    // Move the nav's active state to the picked filter IMMEDIATELY — the
    // collapse that follows a pick (mobile auto-collapse, desktop hover-off)
    // reads `.is-active` at its own midpoint, which can land before the pane
    // fade below finishes; applying the buttons early means it always closes
    // showing the new filter. Item visibility still waits for the midpoint.
    this.applyFilterButtons(next);

    const savedScrollY = window.scrollY;
    const currentPane =
      App.home.mode === "text" ? this.textPane : this.imagePane;

    // Clear any in-flight image-mode hover state so the new filter starts clean.
    for (const item of this.imageItems) item.classList.remove("is-hovered");

    // Fade everything down (skipped entirely — instant swap — when the dev
    // panel disables the switch animation).
    const fades: Promise<unknown>[] = [];
    const fadeTargets: HTMLElement[] = [];
    if (currentPane) fadeTargets.push(currentPane);
    if (this.footer) fadeTargets.push(this.footer);
    if (homeAnim.switchEnabled && fadeTargets.length) {
      fades.push(
        animaToPromise(
          new Anima({
            el: window,
            d: homeAnim.switchDuration,
            e: MODE_SWITCH_EASE,
            u: (state: AnimaState) => {
              const o = String(1 - state.prE);
              for (const el of fadeTargets) el.style.opacity = o;
            },
          })
        )
      );
    }
    await Promise.all(fades);

    // Apply the filter's item visibility — toggles data-filter-hidden on
    // items (the button active state already moved at click time, above).
    // Hidden items drop out and the remaining labels re-center via flex-wrap.
    if (currentPane) currentPane.style.opacity = "";
    if (this.footer) this.footer.style.opacity = "";
    this.applyFilterVisibility(next);

    // Restore scroll across the layout change.
    App.scroller?.resize?.();
    App.scroller?.scrollTo?.(savedScrollY, true);

    // Instant swap — the filter is applied, nothing left to animate.
    if (!homeAnim.switchEnabled) return;

    const ups: Promise<unknown>[] = [];
    const fadeInTargets: HTMLElement[] = [];
    if (currentPane) {
      currentPane.style.opacity = "0";
      fadeInTargets.push(currentPane);
    }
    if (this.footer) {
      this.footer.style.opacity = "0";
      fadeInTargets.push(this.footer);
    }
    if (fadeInTargets.length) {
      ups.push(
        animaToPromise(
          new Anima({
            el: window,
            d: homeAnim.switchDuration,
            e: MODE_SWITCH_EASE,
            u: (state: AnimaState) => {
              const o = String(state.prE);
              for (const el of fadeInTargets) el.style.opacity = o;
            },
          })
        )
      );
    }
    await Promise.all(ups);
    if (currentPane) currentPane.style.opacity = "";
    if (this.footer) this.footer.style.opacity = "";
  }

  /**
   * Switch to `next` mode: fade current DOM out, swap pane visibility, fade
   * the new mode in. The DOM fade runs as a single Anima over the pane and
   * footer so the transition feels unified.
   */
  private async switchMode(next: HomeMode): Promise<void> {
    dbg.page(`home:switch-mode → ${next}`);
    // Freeze the text/image hover handlers for the whole fade-swap-fade —
    // the finally guarantees they thaw even if an Anima is superseded.
    this.modeSwitching = true;
    try {
      await this.runModeSwitch(next);
    } finally {
      this.modeSwitching = false;
    }
  }

  /** The switchMode body — see switchMode for the hover freeze wrapper. */
  private async runModeSwitch(next: HomeMode): Promise<void> {
    // Move the nav's active state to the picked mode IMMEDIATELY (same
    // reasoning as runFilterSwitch): a nav collapse racing this switch must
    // close showing the new mode. App.home.mode and the pane swap still
    // happen at the fade midpoint via applyModeDom.
    this.applyModeButtons(next);

    // Snapshot scroll BEFORE the DOM swap. Text and Image modes have very
    // different content heights — without restoring, the browser clamps
    // scrollY to the new max (often 0 in image mode if it fits inside the
    // viewport) and the user loses their place when toggling back.
    const savedScrollY = window.scrollY;
    const currentPane =
      App.home.mode === "text" ? this.textPane : this.imagePane;

    // Clear any in-flight image-mode hover state so the new mode starts clean.
    for (const item of this.imageItems) item.classList.remove("is-hovered");

    // Fade the current pane and footer down together over the shared
    // homeAnim.switchDuration / "slow" fade — the same timing the filter
    // toggle uses. Skipped entirely (instant swap) when the dev panel
    // disables the switch animation.
    const fades: Promise<unknown>[] = [];
    const fadeTargets: HTMLElement[] = [];
    if (currentPane) fadeTargets.push(currentPane);
    if (this.footer) fadeTargets.push(this.footer);
    if (homeAnim.switchEnabled && fadeTargets.length) {
      fades.push(
        animaToPromise(
          new Anima({
            el: window,
            d: homeAnim.switchDuration,
            e: MODE_SWITCH_EASE,
            u: (state: AnimaState) => {
              const o = String(1 - state.prE);
              for (const el of fadeTargets) el.style.opacity = o;
            },
          })
        )
      );
    }
    await Promise.all(fades);

    // Swap DOM visibility for the new mode.
    if (currentPane) currentPane.style.opacity = "";
    if (this.footer) this.footer.style.opacity = "";
    this.applyModeDom(next);

    // Restore scroll position across the swap. Let the scroller resize first
    // so it recalculates the new max, then call scrollTo (which clamps
    // internally to the new bounds and syncs current/target).
    App.scroller?.resize?.();
    App.scroller?.scrollTo?.(savedScrollY, true);

    // Instant swap — the mode is applied, nothing left to animate.
    if (!homeAnim.switchEnabled) return;

    const newPane = next === "text" ? this.textPane : this.imagePane;
    const ups: Promise<unknown>[] = [];
    const fadeInTargets: HTMLElement[] = [];
    if (newPane) {
      newPane.style.opacity = "0";
      fadeInTargets.push(newPane);
    }
    if (this.footer) {
      this.footer.style.opacity = "0";
      fadeInTargets.push(this.footer);
    }
    if (fadeInTargets.length) {
      ups.push(
        animaToPromise(
          new Anima({
            el: window,
            d: homeAnim.switchDuration,
            e: MODE_SWITCH_EASE,
            u: (state: AnimaState) => {
              const o = String(state.prE);
              for (const el of fadeInTargets) el.style.opacity = o;
            },
          })
        )
      );
    }
    await Promise.all(ups);
    if (newPane) newPane.style.opacity = "";
    if (this.footer) this.footer.style.opacity = "";
  }

  async in(): Promise<void> {
    dbg.page("home:in");
    // Clear any stale inline opacity left by `out()` on a previous mount.
    if (this.textPane) this.textPane.style.opacity = "";
    if (this.imagePane) this.imagePane.style.opacity = "";

    // Return-to-home brand beat: on every SPA navigation back to home, echo the
    // intro. `App.mutating` is true only during a controller navigation — never
    // in first-boot phase 5, where the real intro already played — so it cleanly
    // gates the beat to returns. The persistent `.intro-beat` overlay (white
    // field + DIAA mark) covers the swap; we reveal home beneath it, hold the
    // mark, then fade the cover out on the intro's "slow" ease.
    // One-shot beat suppression: the detail page's bottom-dwell auto-close
    // arrives FROM the DIAA outro, which already played the brand moment —
    // replaying the beat would show the mark twice back to back. Claimed
    // unconditionally (clear-on-read) so it can never leak into a later nav.
    const skipBeat = takeHomeBeatSkip();

    const beatEl = document.querySelector<HTMLElement>(".intro-beat");
    if (App.mutating && beatEl && homeAnim.beatEnabled && !skipBeat) {
      dbg.page("home:in (return brand beat)");
      const logoEl = beatEl.querySelector<HTMLElement>(".intro-beat__logo");

      // Raise the white cover over the swap. Home stays hidden (opacity 0, left
      // by the transition's cleanup) for the WHOLE beat — the beat plays entirely
      // "on the cover", exactly like the boot intro, and home is revealed only
      // AFTER the cover is gone. The swap window is already on the white html
      // background (var(--bg-theme)), so the cover appearing is seamless; the mark
      // starts hidden (CSS opacity 0 on .intro-beat__logo), like the intro logo.
      beatEl.classList.add("is-active");

      // 1. Fade the DIAA mark in over homeAnim.beatFadeIn on the intro's "slow"
      //    ease — the same opacity tween (p.o + r:3) the intro uses for the
      //    logotype.
      if (logoEl) {
        await animaToPromise(
          new Anima({
            el: logoEl,
            p: { o: [0, 1] },
            d: homeAnim.beatFadeIn,
            e: BEAT_EASE,
            r: 3,
          })
        );
      }

      // 2/3. Hold the mark for homeAnim.beatHold (the Anima `de` delay holds the
      //      cover at full opacity), then fade the whole cover (white field +
      //      mark) out over homeAnim.beatFadeOut — to the blank white background,
      //      NOT to home. The DIAA is fully gone before home appears (same hold +
      //      overlay fade-out as the intro).
      await animaToPromise(
        new Anima({
          el: beatEl,
          p: { o: [1, 0] },
          d: homeAnim.beatFadeOut,
          de: homeAnim.beatHold,
          e: BEAT_EASE,
          r: 3,
        })
      );

      // Re-hide the overlay and drop the inline opacities so the CSS rules
      // (.is-active off, mark back to opacity 0) own the resting state for the
      // next return.
      beatEl.classList.remove("is-active");
      beatEl.style.opacity = "";
      if (logoEl) logoEl.style.opacity = "";

      // 4. Only now, with the DIAA fully gone, reveal home — fade the container
      //    up from 0 (the same entrance fade as first boot). init() already
      //    restored the persisted mode/filter while it was hidden, so the correct
      //    state fades in.
      await this.homeInFade();
      // The hover handlers were frozen for the whole navigation — if the
      // cursor is already parked on an item, apply its reveal now that the
      // entrance is done (see syncHoverFromPointer).
      this.syncHoverFromPointer();
      return;
    }

    // First boot (App.mutating false): reveal the page normally. init() already
    // restored the persisted mode/filter while the container was hidden, so this
    // fades the correct state in (no flash of the cached Text-mode default when
    // returning to Image mode). Held for homeAnim.homeInDelay after the intro
    // clears, then faded over homeAnim.homeInDuration on the brand-beat ease.
    await this.homeInFade(homeAnim.homeInDelay);
    // Same pointer re-sync as the return path — on first boot the cursor can
    // be resting on an item before the intro clears.
    this.syncHoverFromPointer();
  }

  /**
   * The shared home entrance fade — container 0 → 1 over homeAnim.homeInDuration
   * on the brand-beat ease, after an optional hold. When the dev panel disables
   * the entrance animation the container simply snaps visible.
   *
   * Mobile stagger: on mobile the text-label pane, the top nav, and the footer
   * all lag the container fade by homeAnim.homeInMobileTextDelay, so the
   * scroll-revealed image (carried by the container fade) reads first and the
   * chrome + titles follow. Opacity compounds down the tree, so the lagging
   * elements can be held at inline opacity 0 inside the fading container and
   * run their own later fade on the same duration/ease. Desktop keeps the
   * single simultaneous fade.
   */
  private async homeInFade(delay = 0): Promise<void> {
    if (!homeAnim.homeInEnabled) {
      (this.container as HTMLElement | null)?.style.setProperty("opacity", "1");
      return;
    }

    const lagTargets = window.matchMedia(MOBILE_MEDIA_QUERY).matches
      ? [this.textPane, this.navEl, this.footer].filter(
          (el): el is HTMLElement => !!el && !el.hidden
        )
      : [];

    let lagFade: Promise<unknown> = Promise.resolve();
    if (lagTargets.length) {
      for (const el of lagTargets) el.style.opacity = "0";
      lagFade = animaToPromise(
        new Anima({
          el: window,
          d: homeAnim.homeInDuration,
          e: HOME_IN_EASE,
          de: delay + homeAnim.homeInMobileTextDelay,
          u: (state: AnimaState) => {
            for (const el of lagTargets) el.style.opacity = String(state.prE);
          },
        })
      ).then(() => {
        // Drop the inline values so the mode/filter switch fades (and the
        // bridge exit fade) own these elements again.
        for (const el of lagTargets) el.style.opacity = "";
      });
    }

    await Promise.all([
      this.fadeContainer(1, homeAnim.homeInDuration, {
        e: HOME_IN_EASE,
        de: delay,
      }),
      lagFade,
    ]);
  }

  /**
   * Re-applies hover state from the live pointer position after an entrance.
   * The text/image hover handlers freeze while a navigation is in flight
   * (`App.mutating` — a stray mouse move mid-transition must not fight the
   * pane fades or the home→detail bridge), but if the cursor is already
   * resting on an item when home returns, no new mouseenter fires once the
   * freeze lifts — mouseenter only fires on a boundary crossing — so the
   * reveal would silently never happen. Called at the end of in(): reads
   * `:hover` off the DOM and toggles the same classes the handlers would,
   * for whichever mode is active. Desktop only — mobile reveals are
   * scroll-driven (see updateScrollReveal).
   */
  private syncHoverFromPointer(): void {
    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
    this.applyPointerHover();

    // Backstop: some engines (Safari notably) leave `:hover` stale when the
    // DOM changed under a motionless pointer, only recomputing it on the next
    // real mouse move — and a move WITHIN the same item fires mousemove but
    // no mouseenter, so the hover handlers alone can't recover either. Arm a
    // one-shot re-sync on that first move; it self-disarms after firing and
    // cleanup() removes it if the user navigates away before moving.
    if (!this.hoverSyncMoveHandler) {
      this.hoverSyncMoveHandler = (): void => {
        this.hoverSyncMoveHandler = null;
        // Mirror the live handlers' freeze — by now a new navigation or a
        // mode/filter switch may have started, and the sync must not fight it.
        if (App.mutating || this.modeSwitching) return;
        if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
        this.applyPointerHover();
      };
      window.addEventListener("mousemove", this.hoverSyncMoveHandler, {
        once: true,
      });
    }
  }

  /**
   * The class-toggling half of syncHoverFromPointer(): for the active mode,
   * mirrors each item's current `:hover` state onto the same class its
   * mouseenter/mouseleave handlers manage (`.is-active` on the matching
   * text-gpu figure in text mode, `.is-hovered` on the image item in image
   * mode), respecting the active filter. Toggling OFF is deliberate — it
   * also clears any stray state left from before the freeze.
   */
  private applyPointerHover(): void {
    if (App.home.mode === "text") {
      for (let i = 0; i < this.textItems.length; i++) {
        const hovered =
          !this.isFilteredOut(i) && this.textItems[i]!.matches(":hover");
        this.textGpuFigures[i]?.classList.toggle("is-active", hovered);
      }
      return;
    }
    for (let i = 0; i < this.imageSlots.length; i++) {
      const hovered =
        !this.isFilteredOut(i) && this.imageSlots[i]!.matches(":hover");
      this.imageItems[i]?.classList.toggle("is-hovered", hovered);
    }
  }

  /**
   * Page-out fade. Pauses every hover Anima, then fades the whole container
   * to 0 so the home leaves cleanly before the EmptyTransition swaps the DOM.
   *
   * Bridge exception: when navigating to a detail page in text mode with an
   * image currently revealed, we keep that image alive across the swap (see
   * controller/transitions/home-to-detail.ts). In that case we fade only the
   * chrome — text labels, top nav, footer — and leave the container (and
   * `.home__text-gpu`) opaque so the active figure stays visible. The transition
   * then promotes that figure to a fixed body clone that survives removeOld().
   */
  async out(): Promise<void> {
    dbg.page("home:out");
    for (const a of this.hoverAnimas) a?.pause();

    const activeFigure = this.textGpu?.querySelector<HTMLElement>(
      ".home__text-gpu-figure.is-active"
    );
    const bridging =
      App.route.new.page === "detail" &&
      App.home.mode === "text" &&
      !!activeFigure;

    if (bridging) {
      // Fade chrome only; leave the container opaque so the revealed image holds.
      const targets = [this.textPane, this.navEl, this.footer].filter(
        (el): el is HTMLElement => !!el
      );
      if (!homeAnim.homeOutEnabled) {
        for (const el of targets) el.style.opacity = "0";
        return;
      }
      await animaToPromise(
        new Anima({
          el: window,
          d: homeAnim.homeOutDuration,
          e: MODE_SWITCH_EASE,
          u: (state: AnimaState) => {
            const o = String(1 - state.prE);
            for (const el of targets) el.style.opacity = o;
          },
        })
      );
      return;
    }

    if (!homeAnim.homeOutEnabled) {
      (this.container as HTMLElement | null)?.style.setProperty("opacity", "0");
      return;
    }
    await this.fadeContainer(0, homeAnim.homeOutDuration);
  }

  async cleanup(): Promise<void> {
    for (let i = 0; i < this.textItems.length; i++) {
      const item = this.textItems[i];
      const handlers = this.hoverHandlers[i];
      if (item && handlers) {
        item.removeEventListener("mouseenter", handlers.enter);
        item.removeEventListener("mouseleave", handlers.leave);
      }
    }
    for (let i = 0; i < this.imageSlots.length; i++) {
      const slot = this.imageSlots[i];
      const handlers = this.imageHoverHandlers[i];
      if (slot && handlers) {
        slot.removeEventListener("mouseenter", handlers.enter);
        slot.removeEventListener("mouseleave", handlers.leave);
      }
    }
    for (const { btn, handler } of this.modeBtnHandlers) {
      btn.removeEventListener("click", handler);
    }
    for (const { btn, handler } of this.filterBtnHandlers) {
      btn.removeEventListener("click", handler);
    }
    if (this.navEl) {
      if (this.navEnterHandler)
        this.navEl.removeEventListener("mouseenter", this.navEnterHandler);
      if (this.navLeaveHandler)
        this.navEl.removeEventListener("mouseleave", this.navLeaveHandler);
      if (this.navClickHandler)
        this.navEl.removeEventListener("click", this.navClickHandler);
    }
    if (this.textGpu && this.textGpuClickHandler)
      this.textGpu.removeEventListener("click", this.textGpuClickHandler);
    this.textGpuClickHandler = null;
    // Disarm the one-shot pointer re-sync if the user navigated away before
    // moving the mouse (harmless no-op when it already fired).
    if (this.hoverSyncMoveHandler) {
      window.removeEventListener("mousemove", this.hoverSyncMoveHandler);
      this.hoverSyncMoveHandler = null;
    }
    this.navAnima?.pause();
    for (const a of this.hoverAnimas) a?.pause();
    this.textItems = [];
    this.imageItems = [];
    this.imageSlots = [];
    this.textGpuFigures = [];
    this.hoverAnimas = [];
    this.hoverHandlers = [];
    this.imageHoverHandlers = [];
    this.modeBtnHandlers = [];
    this.filterBtnHandlers = [];
    this.textPane = null;
    this.imagePane = null;
    this.textGpu = null;
    this.scrollRevealIndex = -1;
    this.modeButtons = [];
    this.filterButtons = [];
    this.navEl = null;
    this.navAnima = null;
    this.navEnterHandler = null;
    this.navLeaveHandler = null;
    this.navClickHandler = null;
    this.navExpanded = false;
    this.animGuiTeardown?.();
    this.animGuiTeardown = null;
    await super.cleanup();
  }
}
