<script setup lang="ts">
/**
 * IntroOverlay.vue — the boot-only `.intro` brand-beat overlay, ported from
 * apps/fe/src/routes/partials/intro.html + apps/fe/src/engine/boot/intro.ts.
 *
 * SSR-rendered with `opacity: 1` by DEFAULT in CSS (styles/core/intro.module.scss)
 * — no `v-if`, no `<ClientOnly>` — so it covers the entire viewport from the
 * very first paint, before any JS runs (see anim-plan.md §14 rule 1: a
 * client-only-gated overlay would itself flash, since nothing renders until
 * hydration). `composables/useBoot.ts`'s `playIntro()` fades it out and
 * removes it from the DOM once the brand beat finishes; nothing else ever
 * un-hides it.
 *
 * The random CMS phrase is picked via `useState` rather than a plain
 * `Math.random()` call, so the SAME value is chosen once (during SSR, or on
 * first client render if SSR is skipped) and REUSED — not re-randomized —
 * during client hydration. A bare `Math.random()` here would produce a
 * hydration mismatch: the server picks phrase A, the client re-renders with
 * phrase B against the same server-emitted DOM.
 */
const siteOptions = useSiteOptions();

const phrase = useState<string | null>("intro-phrase", () => {
  const phrases = siteOptions.value?.introPhrases ?? [];
  if (phrases.length === 0) return null;
  return phrases[Math.floor(Math.random() * phrases.length)] ?? null;
});
</script>

<template>
  <div class="intro">
    <DiaaWordmark logo-class="intro__logo" />
    <!-- Centered intro phrase. Starts hidden (opacity: 0 in CSS) — useBoot's
         playIntro() fades it in with the logotype. Absent entirely when the
         CMS has no phrases (matches the old build's `{{#hasIntroPhrases}}`
         Mustache guard), so document.querySelector(".intro__text") in
         playIntro() is null and the phrase beat is skipped outright. -->
    <p v-if="phrase" class="intro__text">{{ phrase }}</p>
  </div>
</template>
