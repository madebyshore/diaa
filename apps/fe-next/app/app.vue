<script setup lang="ts">
// Root shell. Phase 0 placeholder — the real shell (IntroOverlay + IntroBeat
// outside <main>, the ported transition system on <NuxtPage>, dev grid/GUI
// components) lands in Phase 5 (see plans/twinkly-shimmying-marshmallow.md,
// "app.vue" in the target structure). Kept intentionally minimal here so the
// scaffold boots and generates without depending on anything not yet ported.
</script>

<template>
  <main id="app">
    <!-- Phase 5 wires :transition="defaultTransition" :page-key="r => r.fullPath" -->
    <NuxtPage />
  </main>
</template>
