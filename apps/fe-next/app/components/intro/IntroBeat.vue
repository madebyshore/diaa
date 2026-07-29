<script setup lang="ts">
/**
 * IntroBeat.vue — the persistent `.intro-beat` return-to-home brand overlay,
 * ported from the `.intro-beat` block in apps/fe/index.html.
 *
 * SSR-rendered, hidden by default via CSS (styles/core/intro-beat.module.scss:
 * opacity 0, visibility hidden, pointer-events none) — unlike IntroOverlay,
 * this is NOT removed after boot. It lives outside `<NuxtPage>` in app.vue
 * (a sibling of `#app`, exactly like the old `index.html`'s DOM order) so it
 * survives every SPA navigation and is reused on every return to home.
 *
 * Phase 5b's home controller toggles `.is-active` on this element and drives
 * the fade via inline opacity, reaching for it with a direct
 * `document.querySelector(".intro-beat")` — mirroring `HomePage.in()`'s own
 * direct DOM query (`routes/home/home.ts` line ~800, see anim-plan.md §7):
 * the overlay sits outside any page's root, so it can't be scoped through a
 * controller's `root` argument, and that's intentional rather than an
 * oversight to fix.
 */
</script>

<template>
  <div class="intro-beat" aria-hidden="true">
    <DiaaWordmark logo-class="intro-beat__logo" />
  </div>
</template>
