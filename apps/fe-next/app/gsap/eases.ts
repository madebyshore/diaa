/**
 * gsap/eases.ts — the named-ease → cubic-bezier control-point table.
 *
 * Ported from packages/kido/src/utils.ts's `Ease` map (the single source of
 * truth for every bezier curve the diaa animation code references). Only
 * the curves actually used by ported code are registered — see
 * plugins/ease.client.ts for the CustomEase.create() calls that consume this.
 *
 * "slow" is the only load-bearing curve: it drives the intro brand-beat text,
 * the home entrance fade, the return-to-home beat, mode/filter switches, and
 * every page's fadeContainer default (BaseController's in()/out()). It is a
 * least-squares cubic-bezier fit of a Figma spring (stiffness 80, damping 20,
 * mass 1) sampled over its 600ms interaction window — slightly overdamped
 * (zeta ~= 1.12): brisk initial motion decaying into a long, smooth settle
 * with no overshoot.
 *
 * o4/io/o6 are kept registered for parity with the DefaultTransition/
 * FadeTransition alternates (dead code in the live diaa app — EmptyTransition
 * is the real default) and because tamahagane-nuxt's own convention registers
 * them for its curtain transition. Nothing in this port's live path uses them
 * yet, but they cost nothing to keep available.
 */
export const EASES: Record<string, string> = {
  slow: "0.192,0.062,0.275,0.879",
  o4: "0.25,1,0.5,1",
  io: "0.76,0,0.2,1",
  o6: "0.16,1,0.3,1",
};
