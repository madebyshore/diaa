/**
 * apps/fe/src/app/components/home-anim-gui.ts — Dev-only tweak panel for the
 * home-page animation timings.
 *
 * Renders a small fixed panel (bottom-right) with a slider + number input for
 * every duration in `homeAnim` and an enable checkbox per animation group:
 *
 *   Beat fade — the return-to-home brand beat (fade in / hold / fade out)
 *   Home in   — the entrance fade (duration / delay)
 *   Switch    — the mode/filter toggle fade (per-half duration)
 *
 * Edits mutate `homeAnim` in place and persist to localStorage, so they apply
 * to the very next animation run AND survive a reload — tune, then reload to
 * feel the boot entrance with the new values. "Reset" restores the shipped
 * defaults from home-anim.ts.
 *
 * The panel is HIDDEN by default — Ctrl+F toggles it on/off. Installed by
 * HomePage.init() behind `import.meta.env.DEV` via dynamic import, so none of
 * this code is fetched in production builds. HomePage.cleanup() calls the
 * returned teardown on navigation away, so neither the panel nor the shortcut
 * exists on any other page.
 */

import {
  HOME_ANIM_DEFAULTS,
  homeAnim,
  loadHomeAnim,
  resetHomeAnim,
  saveHomeAnim,
  type HomeAnimConfig,
} from "@app/components/home-anim";

/** Keys of the numeric (duration) fields — the slider-editable subset. */
type DurationKey = {
  [K in keyof HomeAnimConfig]: HomeAnimConfig[K] extends number ? K : never;
}[keyof HomeAnimConfig];

/** Keys of the boolean (enable) fields — the checkbox subset. */
type ToggleKey = {
  [K in keyof HomeAnimConfig]: HomeAnimConfig[K] extends boolean ? K : never;
}[keyof HomeAnimConfig];

/** One slider row: label, range bounds, and the config key it edits. */
interface SliderSpec {
  label: string;
  key: DurationKey;
  max: number;
}

/** One panel group: heading, enable toggle, and its slider rows. */
interface GroupSpec {
  title: string;
  toggle: ToggleKey;
  sliders: SliderSpec[];
}

/** Panel contents — mirrors the three home animations, in play order. */
const GROUPS: GroupSpec[] = [
  {
    title: "Beat fade",
    toggle: "beatEnabled",
    sliders: [
      { label: "fade in", key: "beatFadeIn", max: 3000 },
      { label: "hold", key: "beatHold", max: 2000 },
      { label: "fade out", key: "beatFadeOut", max: 3000 },
    ],
  },
  {
    title: "Home in",
    toggle: "homeInEnabled",
    sliders: [
      { label: "duration", key: "homeInDuration", max: 3000 },
      { label: "delay", key: "homeInDelay", max: 2000 },
      { label: "mobile stagger", key: "homeInMobileTextDelay", max: 2000 },
    ],
  },
  {
    title: "Home out",
    toggle: "homeOutEnabled",
    sliders: [{ label: "duration", key: "homeOutDuration", max: 3000 }],
  },
  {
    title: "Switch",
    toggle: "switchEnabled",
    sliders: [{ label: "duration", key: "switchDuration", max: 3000 }],
  },
];

/** localStorage key remembering whether the panel body is collapsed. */
const COLLAPSED_KEY = "tmhgne:home-anim-gui-collapsed";

/** Shared look for the small inline controls. */
const FONT = "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Install the dev panel behind a Ctrl+F toggle. Nothing renders until the
 * shortcut is pressed; pressing it again removes the panel. Persisted tuning
 * is loaded into `homeAnim` immediately so saved values drive the animations
 * even while the panel stays hidden. Returns a teardown that removes the
 * shortcut listener and the panel (if open).
 */
export function installHomeAnimGui(): () => void {
  loadHomeAnim();

  // Teardown for the currently-mounted panel; null while hidden.
  let unmount: (() => void) | null = null;

  // Ctrl+F (no meta/alt) flips the panel. preventDefault so the browser's
  // find bar doesn't open alongside it on Windows/Linux — dev-only, so
  // shadowing find on this one page is an acceptable trade.
  const onKeydown = (e: KeyboardEvent): void => {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "f" && e.key !== "F") return;
    e.preventDefault();
    if (unmount) {
      unmount();
      unmount = null;
    } else {
      unmount = mountHomeAnimGui();
    }
  };
  window.addEventListener("keydown", onKeydown);
  console.debug("[home:gui] Ctrl+F toggle installed (panel hidden)");

  return () => {
    window.removeEventListener("keydown", onKeydown);
    unmount?.();
    unmount = null;
  };
}

/**
 * Build and mount the tweak panel, returning a teardown that removes it.
 * Internal — reached only through the Ctrl+F toggle in installHomeAnimGui().
 */
function mountHomeAnimGui(): () => void {
  // Refresh callbacks — one per control, run after a reset so every input
  // re-reads its value from the (restored) config.
  const refreshers: Array<() => void> = [];

  const root = document.createElement("div");
  root.setAttribute("data-home-anim-gui", "");
  root.style.cssText = [
    "position: fixed",
    "right: 12px",
    "bottom: 12px",
    "z-index: 9999",
    "width: 248px",
    `font: ${FONT}`,
    "color: #fff",
    "background: rgba(17, 17, 17, 0.92)",
    "border: 1px solid rgba(255, 255, 255, 0.15)",
    "border-radius: 6px",
    "padding: 8px 10px",
    "user-select: none",
  ].join(";");

  // Header — panel title + collapse toggle. Clicking anywhere on it folds the
  // body away so the panel can sit unobtrusively while browsing.
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;cursor:pointer";
  const title = document.createElement("span");
  title.textContent = "HOME ANIM";
  title.style.cssText = "letter-spacing:0.08em;opacity:0.7";
  const caret = document.createElement("span");
  caret.style.opacity = "0.7";
  header.append(title, caret);
  root.append(header);

  const body = document.createElement("div");
  body.style.marginTop = "8px";
  root.append(body);

  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    // storage unavailable — start expanded
  }

  /** Apply the collapsed state to the DOM and persist it. */
  const applyCollapsed = (): void => {
    body.style.display = collapsed ? "none" : "";
    caret.textContent = collapsed ? "▸" : "▾";
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // storage unavailable — state still applies for this session
    }
  };
  const onHeaderClick = (): void => {
    collapsed = !collapsed;
    applyCollapsed();
  };
  header.addEventListener("click", onHeaderClick);
  applyCollapsed();

  /**
   * Build one labelled slider + number pair bound to a duration key. The two
   * inputs mirror each other; both write through to `homeAnim` and persist.
   */
  const buildSlider = (spec: SliderSpec): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;margin:4px 0";

    const label = document.createElement("span");
    label.textContent = spec.label;
    label.style.cssText = "flex:0 0 56px;opacity:0.7";

    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = String(spec.max);
    range.step = "50";
    range.style.cssText = "flex:1;min-width:0;accent-color:#fff";

    const num = document.createElement("input");
    num.type = "number";
    num.min = "0";
    num.max = String(spec.max);
    num.step = "50";
    num.style.cssText = [
      "flex:0 0 52px",
      `font: ${FONT}`,
      "color:#fff",
      "background:transparent",
      "border:1px solid rgba(255,255,255,0.2)",
      "border-radius:3px",
      "padding:1px 3px",
    ].join(";");

    /** Push a new value into the config, persist, and sync both inputs. */
    const commit = (value: number): void => {
      const clamped = Math.max(0, Math.min(spec.max, Math.round(value)));
      homeAnim[spec.key] = clamped;
      range.value = String(clamped);
      num.value = String(clamped);
      saveHomeAnim();
      console.debug(`[home:gui] ${spec.key} = ${clamped}ms`);
    };
    range.addEventListener("input", () => commit(Number(range.value)));
    num.addEventListener("change", () => commit(Number(num.value)));

    /** Re-read the config into the inputs (used on mount and after reset). */
    const refresh = (): void => {
      range.value = String(homeAnim[spec.key]);
      num.value = String(homeAnim[spec.key]);
    };
    refresh();
    refreshers.push(refresh);

    row.append(label, range, num);
    return row;
  };

  /** Build one group: heading row with enable checkbox, then its sliders. */
  const buildGroup = (spec: GroupSpec): HTMLElement => {
    const group = document.createElement("div");
    group.style.cssText =
      "margin:8px 0 0;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12)";

    const head = document.createElement("label");
    head.style.cssText =
      "display:flex;align-items:center;gap:6px;cursor:pointer";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.style.accentColor = "#fff";
    const name = document.createElement("span");
    name.textContent = spec.title;
    name.style.letterSpacing = "0.05em";
    head.append(check, name);
    group.append(head);

    const rows = document.createElement("div");
    for (const slider of spec.sliders) rows.append(buildSlider(slider));
    group.append(rows);

    /** Dim the sliders when the group's animation is toggled off. */
    const applyEnabled = (): void => {
      rows.style.opacity = homeAnim[spec.toggle] ? "1" : "0.35";
    };
    check.addEventListener("change", () => {
      homeAnim[spec.toggle] = check.checked;
      saveHomeAnim();
      applyEnabled();
      console.debug(`[home:gui] ${spec.toggle} = ${check.checked}`);
    });

    /** Re-read the config into the checkbox (used on mount and after reset). */
    const refresh = (): void => {
      check.checked = homeAnim[spec.toggle];
      applyEnabled();
    };
    refresh();
    refreshers.push(refresh);

    return group;
  };

  for (const group of GROUPS) body.append(buildGroup(group));

  // Reset — restore the shipped defaults from home-anim.ts and clear storage.
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = `Reset (beat ${HOME_ANIM_DEFAULTS.beatFadeIn}/${HOME_ANIM_DEFAULTS.beatHold}/${HOME_ANIM_DEFAULTS.beatFadeOut} …)`;
  reset.style.cssText = [
    "display:block",
    "width:100%",
    "margin-top:10px",
    `font: ${FONT}`,
    "color:#fff",
    "background:rgba(255,255,255,0.1)",
    "border:1px solid rgba(255,255,255,0.2)",
    "border-radius:3px",
    "padding:3px 0",
    "cursor:pointer",
  ].join(";");
  reset.addEventListener("click", () => {
    resetHomeAnim();
    for (const refresh of refreshers) refresh();
  });
  body.append(reset);

  document.body.append(root);
  console.debug("[home:gui] mounted", { ...homeAnim });

  return () => {
    header.removeEventListener("click", onHeaderClick);
    root.remove();
    console.debug("[home:gui] removed");
  };
}
