<script setup lang="ts">
/**
 * pages/index.vue — the home route ("/"). Phase 2 DOM-structure port of
 * `apps/fe/src/routes/home/home.html` (Phase 3 fills in slice-equivalent
 * behavior — there are none on home; Phase 4 ports the SCSS against these
 * exact classes; Phase 5 wires the filter/mode/hover controllers).
 *
 * Both mode panes (`.home__text`, `.home__image`) render UNCONDITIONALLY —
 * the image pane carries a native `hidden` attribute, never `v-if` — so
 * Phase 5's mode-toggle controller always has both DOM trees present to
 * animate between rather than mounting/unmounting them. Same reasoning
 * applies to `.home__text-gpu`'s per-item reveal figures.
 *
 * `loadRouteContent("/")` (data/content.ts) always resolves a
 * `HomeRouteContent` — unlike `[slug].vue`, there is no 404 branch here.
 */

import { createHomeController } from "~/controllers/home";

const pageData = usePageData();
const siteOptions = useSiteOptions();
const route = useRoute();

// Phase 5b: full mode/filter/hover/nav-V-fold/bridge choreography — see
// controllers/home.ts. Replaces Phase 5a's placeholder BaseController now
// that the real controller exists.
usePageController(createHomeController());

// Snapshot at mount — the correct content for THIS instance, since
// composables/usePageContentSync.ts's router.beforeEach always writes fresh
// content BEFORE the route change that triggers this component to mount
// (see that composable's own header). Used as the fallback below once a
// LATER, unrelated write lands in the shared `pageData` ref.
const initialHome = pageData.value?.template === "home" ? pageData.value : null;

// Narrow usePageData() to the home variant, reactively — but ONLY when the
// live value is actually tagged for THIS route (`data.path === route.path`).
// `usePageData()` is ONE shared `useState`; `usePageContentSync.ts` has to
// write the INCOMING route's content to it before the outgoing page
// unmounts (Vue's mode-less `<Transition>` keeps both pages mounted
// throughout the swap — see transitions/default.ts's file header), so
// WITHOUT the path check, navigating home → a Detail slug would land here
// too: `data.template` would flip to "detail" while home is STILL the
// visible, animating-out page, this computed would go `null`, `gridItems`/
// `taxonomies`/`footerLinks` below would all collapse to `[]`, and the
// ENTIRE GRID (including whatever text-gpu figure the home→detail image
// bridge was about to clone) would vanish from the DOM instantly — read as
// "the transition is instant" and "the bridged image doesn't stay" from
// the user's side. The path check keeps this computed reacting ONLY to
// writes meant for home (a hard reload, or a live-preview refresh of "/"
// while already on it), and lets the `initialHome` snapshot above carry the
// still-mounted, still-fading-out page through any other route's write.
const home = computed(() => {
  const data = pageData.value;
  if (data?.template === "home" && data.path === route.path) return data;
  return initialHome;
});

const gridItems = computed(() => home.value?.gridItems ?? []);
const taxonomies = computed(() => home.value?.taxonomies ?? []);
const footerLinks = computed(() => home.value?.footerLinks ?? []);

const siteTitle = computed(() => siteOptions.value?.siteTitle ?? "");
// Old shell rendered a bare `{{siteTitle}}` for EVERY page's <title> at
// build time; the SPA never rewrote it for home specifically. Ported as-is —
// only [slug].vue composes "<siteTitle> - <pageTitle>". The third arg is
// the Home singleton's own SEO overrides (usePageSeo layers them over the
// Global document's defaults).
usePageSeo(siteTitle, siteTitle, () => home.value?.seo ?? null);

console.debug(
  `[page:home] rendering — gridItems=${gridItems.value.length}, taxonomies=${taxonomies.value.length}, footerLinks=${footerLinks.value.length}`,
);
</script>

<template>
  <section id="page" class="home" data-mode="text">
    <!-- Top-center global nav: taxonomy filters + mode toggles. -->
    <nav class="global-nav" aria-label="View mode">
      <div class="global-nav__group">
        <button type="button" class="home__filter is-active" data-filter="all" aria-pressed="true">All</button>
        <button
          v-for="tax in taxonomies"
          :key="tax.id"
          type="button"
          class="home__filter"
          :data-filter="tax.id"
          aria-pressed="false"
        >
          {{ tax.title }}
        </button>
      </div>
      <div class="global-nav__group">
        <button type="button" class="home__mode is-active" data-mode="text" aria-pressed="true">Text</button>
        <button type="button" class="home__mode" data-mode="image" aria-pressed="false">Image</button>
      </div>
    </nav>

    <!-- Text mode — centered flex-wrap of text labels. -->
    <div class="home__text" data-mode-pane="text">
      <template v-for="item in gridItems" :key="item.flatIndex">
        <a
          v-if="item.routable"
          class="home__text-item"
          :href="`/${item.slug}`"
          :data-index="item.flatIndex"
          :data-taxonomy="item.taxonomyId"
        >
          <RichText inline :blocks="item.stylizedTitle" :fallback="item.title" />
        </a>
        <div
          v-else
          class="home__text-item"
          :data-index="item.flatIndex"
          :data-taxonomy="item.taxonomyId"
        >
          <RichText inline :blocks="item.stylizedTitle" :fallback="item.title" />
        </div>
      </template>
    </div>

    <!-- Image mode — 4-per-row grid of 1:1 cells. Hidden via the native
         attribute (matches the old static markup), not v-if. -->
    <div class="home__image" data-mode-pane="image" hidden>
      <div
        v-for="item in gridItems"
        :key="item.flatIndex"
        class="home__image-item"
        :data-index="item.flatIndex"
        :data-taxonomy="item.taxonomyId"
      >
        <a
          v-if="item.routable"
          :class="`home__image-slot home__image-slot--${item.coverSize}`"
          :href="`/${item.slug}`"
          :data-index="item.flatIndex"
        >
          <FigureBase v-bind="item.cover" />
        </a>
        <div
          v-else
          :class="`home__image-slot home__image-slot--${item.coverSize}`"
          :data-index="item.flatIndex"
        >
          <FigureBase v-bind="item.cover" />
        </div>
        <span class="home__image-title" aria-hidden="true">
          <RichText inline :blocks="item.stylizedTitle" :fallback="item.title" />
        </span>
      </div>
    </div>

    <!-- Footer — inline below the panes, not sticky. -->
    <nav v-if="footerLinks.length" class="global-nav global-nav--footer" aria-label="Footer">
      <a
        v-for="link in footerLinks"
        :key="link.href"
        class="global-nav__link"
        :href="link.href"
        :target="link.blank ? '_blank' : undefined"
        :rel="link.blank ? 'noopener noreferrer' : undefined"
      >
        {{ link.title }}
      </a>
    </nav>

    <!-- Text-mode hover-reveal figures. Fixed to the viewport; home.ts
         (Phase 5) toggles `.is-active` on the figure matching the hovered
         text label. Distinct markup from FigureBase/picture.html — the old
         template inlines its own video/img here (`.home__text-gpu-img`),
         never the shared `_g`/`_g-video` classes. -->
    <div class="home__text-gpu" aria-hidden="true">
      <div class="home__text-gpu-inner">
        <figure
          v-for="item in gridItems"
          :key="item.flatIndex"
          :class="`home__text-gpu-figure home__text-gpu-figure--${item.coverSize}`"
          :data-index="item.flatIndex"
          :data-taxonomy="item.taxonomyId"
        >
          <video
            v-if="item.cover.hasVideo"
            class="home__text-gpu-img"
            :src="item.cover.video"
            autoplay
            loop
            muted
            playsinline
            :poster="item.cover.src || undefined"
          />
          <img v-else class="home__text-gpu-img" :src="item.cover.src" :alt="item.cover.alt" />
        </figure>
      </div>
    </div>
  </section>
</template>
