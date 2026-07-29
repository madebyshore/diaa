<script setup lang="ts">
/**
 * HomeAnimGui.client.vue — dev-only tweak panel for the home-page animation
 * timings, ported from apps/fe/src/app/components/home-anim-gui.ts.
 *
 * Renders a small fixed panel (bottom-right) with a slider + number input
 * for every duration in `homeAnim` and an enable checkbox per animation
 * group:
 *
 *   Beat fade — the return-to-home brand beat (fade in / hold / fade out)
 *   Home in   — the entrance fade (duration / delay / mobile stagger)
 *   Home out  — the exit fade (duration)
 *   Switch    — the mode/filter toggle fade (per-half duration)
 *
 * Edits mutate `homeAnim` (composables/useHomeAnim.ts) in place and persist
 * to localStorage, so they apply to the very next animation run AND survive
 * a reload. "Reset" restores the shipped defaults.
 *
 * `.client.vue` suffix (not just an `import.meta.dev` guard inside) — Nuxt
 * strips `.client` components from the server render entirely, matching
 * this component's own dynamic-import-behind-`import.meta.dev` gate in
 * controllers/home.ts's onInit(). Unlike the vanilla-DOM source (a bare
 * Ctrl+F install/mount function pair), THIS component owns its own Ctrl+F
 * key listener internally (registered in onMounted, removed in onUnmounted)
 * — controllers/home.ts mounts it ONCE and unmounts it wholesale in
 * onDestroy(), rather than mounting/unmounting a Vue app tree on every
 * toggle. The panel itself starts hidden (`visible` false) until Ctrl+F is
 * pressed, same as the source.
 */
import {
  HOME_ANIM_DEFAULTS,
  homeAnim,
  loadHomeAnim,
  resetHomeAnim,
  saveHomeAnim,
  type HomeAnimConfig,
  type HomeAnimDurationKey,
  type HomeAnimToggleKey,
} from "~/composables/useHomeAnim";

/** One slider row: label, range bounds, and the config key it edits. */
interface SliderSpec {
  label: string;
  key: HomeAnimDurationKey;
  max: number;
}

/** One panel group: heading, enable toggle, and its slider rows. */
interface GroupSpec {
  title: string;
  toggle: HomeAnimToggleKey;
  sliders: SliderSpec[];
}

/** Panel contents — mirrors the four home animations, in play order. */
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

/** Panel visibility — Ctrl+F toggles it. Starts hidden, mirroring the
 *  source's "nothing renders until the shortcut is pressed" behavior. */
const visible = ref(false);
/** Body collapse state — persisted so the panel remembers its fold state
 *  across a Ctrl+F hide/show within the same session. */
const collapsed = ref(false);

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false; // storage unavailable — start expanded
  }
}
function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable — state still applies for this session
  }
}

function onHeaderClick(): void {
  collapsed.value = !collapsed.value;
  writeCollapsed(collapsed.value);
}

/** Ctrl+F (no meta/alt) flips the panel. preventDefault so the browser's
 *  find bar doesn't open alongside it on Windows/Linux — dev-only, so
 *  shadowing find on this one page is an acceptable trade. */
function onKeydown(e: KeyboardEvent): void {
  if (!e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key !== "f" && e.key !== "F") return;
  e.preventDefault();
  visible.value = !visible.value;
}

onMounted(() => {
  loadHomeAnim();
  collapsed.value = readCollapsed();
  window.addEventListener("keydown", onKeydown);
  console.debug("[home:gui] Ctrl+F toggle installed (panel hidden)");
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});

/** Push a clamped value into the config and persist — shared by the range
 *  and number inputs for one slider. */
function commitDuration(key: HomeAnimDurationKey, raw: number, max: number): void {
  const clamped = Math.max(0, Math.min(max, Math.round(raw)));
  (homeAnim[key] as number) = clamped;
  saveHomeAnim();
  console.debug(`[home:gui] ${key} = ${clamped}ms`);
}

function commitToggle(key: HomeAnimToggleKey, value: boolean): void {
  (homeAnim[key] as boolean) = value;
  saveHomeAnim();
  console.debug(`[home:gui] ${key} = ${value}`);
}

function onReset(): void {
  resetHomeAnim();
}

/** Type-only reference so `HomeAnimConfig` isn't flagged unused — the
 *  slider/toggle key mapped types above are derived from it. */
type _KeepConfigTypeUsed = HomeAnimConfig;
</script>

<template>
  <div v-if="visible" data-home-anim-gui class="home-anim-gui">
    <div class="home-anim-gui__header" @click="onHeaderClick">
      <span class="home-anim-gui__title">HOME ANIM</span>
      <span class="home-anim-gui__caret">{{ collapsed ? "▸" : "▾" }}</span>
    </div>

    <div v-show="!collapsed" class="home-anim-gui__body">
      <div v-for="group in GROUPS" :key="group.title" class="home-anim-gui__group">
        <label class="home-anim-gui__group-head">
          <input
            type="checkbox"
            :checked="homeAnim[group.toggle]"
            @change="commitToggle(group.toggle, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ group.title }}</span>
        </label>

        <div class="home-anim-gui__rows" :style="{ opacity: homeAnim[group.toggle] ? 1 : 0.35 }">
          <div v-for="slider in group.sliders" :key="slider.key" class="home-anim-gui__row">
            <span class="home-anim-gui__label">{{ slider.label }}</span>
            <input
              type="range"
              min="0"
              :max="slider.max"
              step="50"
              :value="homeAnim[slider.key]"
              @input="commitDuration(slider.key, Number(($event.target as HTMLInputElement).value), slider.max)"
            />
            <input
              type="number"
              min="0"
              :max="slider.max"
              step="50"
              :value="homeAnim[slider.key]"
              @change="commitDuration(slider.key, Number(($event.target as HTMLInputElement).value), slider.max)"
            />
          </div>
        </div>
      </div>

      <button type="button" class="home-anim-gui__reset" @click="onReset">
        Reset (beat {{ HOME_ANIM_DEFAULTS.beatFadeIn }}/{{ HOME_ANIM_DEFAULTS.beatHold }}/{{
          HOME_ANIM_DEFAULTS.beatFadeOut
        }} …)
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Plain scoped CSS (not an SCSS module) — this is dev-only tooling, not
   shipped design-system surface, so it doesn't need styles/includes tokens. */
.home-anim-gui {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 9999;
  width: 248px;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #fff;
  background: rgba(17, 17, 17, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px 10px;
  user-select: none;
}

.home-anim-gui__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}
.home-anim-gui__title {
  letter-spacing: 0.08em;
  opacity: 0.7;
}
.home-anim-gui__caret {
  opacity: 0.7;
}

.home-anim-gui__body {
  margin-top: 8px;
}

.home-anim-gui__group {
  margin: 8px 0 0;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.home-anim-gui__group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.home-anim-gui__group-head input[type="checkbox"] {
  accent-color: #fff;
}
.home-anim-gui__group-head span {
  letter-spacing: 0.05em;
}

.home-anim-gui__row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
}
.home-anim-gui__label {
  flex: 0 0 56px;
  opacity: 0.7;
}
.home-anim-gui__row input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: #fff;
}
.home-anim-gui__row input[type="number"] {
  flex: 0 0 52px;
  font: inherit;
  color: #fff;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  padding: 1px 3px;
}

.home-anim-gui__reset {
  display: block;
  width: 100%;
  margin-top: 10px;
  font: inherit;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  padding: 3px 0;
  cursor: pointer;
}
</style>
