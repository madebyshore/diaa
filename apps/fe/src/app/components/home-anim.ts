/**
 * apps/fe/src/app/components/home-anim.ts — Live-tunable home animation config.
 *
 * Single mutable source of truth for the durations (and on/off toggles) of the
 * three home-page animations:
 *
 *   - the return-to-home brand beat (mark fade-in / hold / cover fade-out)
 *   - the home entrance fade (duration + delay)
 *   - the mode/filter switch fade
 *
 * `home.ts` reads `homeAnim` at animation time — never caching values at module
 * init — so the dev tweak panel (home-anim-gui.ts) can adjust them on the fly
 * and the very next animation run picks the new values up. In production the
 * GUI never mounts and `homeAnim` simply holds `HOME_ANIM_DEFAULTS`.
 *
 * The values here are the shipped timings; treat this file (not home.ts) as
 * the place to persist a tuning once it's settled.
 */

/** The tunable set — all durations in milliseconds. */
export interface HomeAnimConfig {
  /** Play the return-to-home brand beat at all (off = straight to entrance). */
  beatEnabled: boolean;
  /** DIAA mark fade-in on the white cover. */
  beatFadeIn: number;
  /** Hold at full opacity between mark fade-in and cover fade-out. */
  beatHold: number;
  /** Whole cover (white field + mark) fade-out. */
  beatFadeOut: number;

  /** Animate the home entrance at all (off = container appears instantly). */
  homeInEnabled: boolean;
  /** Container fade 0 → 1. */
  homeInDuration: number;
  /** Hold at opacity 0 before the entrance fade starts. */
  homeInDelay: number;
  /** Mobile only: extra hold on the text-label pane, top nav, and footer
   *  after the container fade starts, so the revealed image reads first and
   *  the chrome + titles follow. Desktop ignores this — everything still
   *  fades together there. */
  homeInMobileTextDelay: number;

  /** Animate the home exit at all (off = container hides instantly). */
  homeOutEnabled: boolean;
  /** Page-out fade — both the plain container fade and the bridge chrome fade. */
  homeOutDuration: number;

  /** Animate mode/filter switches at all (off = instant swap). */
  switchEnabled: boolean;
  /** Each half of the switch fade (out, then back in after the swap). */
  switchDuration: number;
}

/** Shipped timings — the resting state of the site. */
export const HOME_ANIM_DEFAULTS: Readonly<HomeAnimConfig> = Object.freeze({
  beatEnabled: true,
  beatFadeIn: 1200,
  beatHold: 400,
  beatFadeOut: 800,

  homeInEnabled: true,
  homeInDuration: 1200,
  homeInDelay: 200,
  homeInMobileTextDelay: 400,

  homeOutEnabled: true,
  homeOutDuration: 800,

  switchEnabled: true,
  switchDuration: 600,
});

/**
 * The live config object. Mutated in place by the dev tweak panel so every
 * consumer holding this reference sees updates immediately.
 */
export const homeAnim: HomeAnimConfig = { ...HOME_ANIM_DEFAULTS };

/** localStorage key for dev-panel persistence across reloads. */
const STORAGE_KEY = "tmhgne:home-anim";

/**
 * Merge a persisted tuning from localStorage into `homeAnim`. Only keys that
 * exist on the defaults with a matching type are accepted, so a stale or
 * hand-mangled payload can never corrupt the config. Called by the dev panel
 * on mount — production never touches storage.
 */
export function loadHomeAnim(): void {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return; // storage unavailable (privacy mode) — keep defaults
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.debug("[home:anim] persisted config failed to parse — ignoring");
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;

  const source = parsed as Record<string, unknown>;
  // Generic write-through — lets TS verify key/value pairs line up even though
  // the config mixes boolean and number fields.
  const take = <K extends keyof HomeAnimConfig>(
    key: K,
    value: HomeAnimConfig[K]
  ): void => {
    homeAnim[key] = value;
  };
  for (const key of Object.keys(HOME_ANIM_DEFAULTS) as Array<
    keyof HomeAnimConfig
  >) {
    const value = source[key];
    if (typeof value === typeof HOME_ANIM_DEFAULTS[key]) {
      // The typeof check just proved the runtime type matches the field.
      take(key, value as HomeAnimConfig[typeof key]);
    }
  }
  console.debug("[home:anim] loaded persisted config", { ...homeAnim });
}

/** Persist the current `homeAnim` values. Called by the dev panel on change. */
export function saveHomeAnim(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(homeAnim));
  } catch {
    // storage unavailable — tuning still applies for this session
  }
}

/** Restore `HOME_ANIM_DEFAULTS` and clear the persisted tuning. */
export function resetHomeAnim(): void {
  Object.assign(homeAnim, HOME_ANIM_DEFAULTS);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — nothing persisted to clear
  }
  console.debug("[home:anim] reset to defaults");
}
