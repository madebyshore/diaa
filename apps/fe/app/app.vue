<script setup lang="ts">
/**
 * app.vue — root shell. Phase 5: mounts the boot-only intro overlay and the
 * persistent return-to-home brand-beat overlay OUTSIDE <main> (mirroring
 * apps/fe/index.html's DOM order — both are siblings of #app, not
 * descendants of it, so they survive every SPA page swap untouched), wires
 * the ported transition system onto <NuxtPage>, and kicks off the boot
 * sequence once mounted.
 *
 * Dev grid/GUI components (Ctrl+G / Ctrl+F) are out of scope for 5a — they
 * land with the home controller in Phase 5b.
 */
import { createDefaultTransition } from "~/transitions/default";

// Registers the router.beforeEach nav-lock guard (composables/useNavLock.ts).
// Called at setup time (not inside onMounted) so the guard is active before
// ANY navigation can occur. Idempotent — see that file's beforeEachRegistered
// module flag — so this is safe to call exactly once here even though
// individual page controllers may also read useNavLock()'s `mutating` state.
useNavLock();

// Built HERE, inside <script setup>, rather than imported as a module-scope
// singleton — createDefaultTransition() calls useRouter() internally
// (installRouteTracking()), which requires an ACTIVE Nuxt app/request
// context. A module-scope call would execute once at import time, which
// during SSR/prerender can run before any request context exists — see the
// comment on transitions/default.ts where the singleton export used to
// live for the NUXT_E1001 crash this caused.
const defaultTransition = createDefaultTransition();

onMounted(() => {
  console.debug("[boot] app.vue mounted — starting boot sequence");
  void runBoot();
});
</script>

<template>
  <div id="w">
    <IntroOverlay />
    <IntroBeat />
    <main id="app">
      <NuxtPage :transition="defaultTransition" :page-key="(r) => r.fullPath" />
    </main>
  </div>
</template>
