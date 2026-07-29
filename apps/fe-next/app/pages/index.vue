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

import { BaseController } from "~/controllers/page-controller";

const pageData = usePageData();
const siteOptions = useSiteOptions();

// Phase 5a wires the default container-fade controller so navigation works
// end-to-end (onInit/in/out all resolve, the transition can sequence
// against them). Phase 5b replaces this with controllers/home.ts's full
// mode/filter/hover/nav-V-fold/bridge choreography — this line is the only
// change that commit needs to make here.
usePageController(new BaseController());

// Narrow usePageData() to the home variant. Defensive fallback only —
// loadRouteContent("/") always returns `{template: "home"}`; this guards a
// malformed/failed fetch, not a real routing case.
const home = computed(() => {
  const data = pageData.value;
  if (data?.template !== "home") {
    console.debug("[page:home] usePageData() did not resolve a home template");
    return null;
  }
  return data;
});

const gridItems = computed(() => home.value?.gridItems ?? []);
const taxonomies = computed(() => home.value?.taxonomies ?? []);
const footerLinks = computed(() => home.value?.footerLinks ?? []);

const siteTitle = computed(() => siteOptions.value?.siteTitle ?? "");
// Old shell rendered a bare `{{siteTitle}}` for EVERY page's <title> at
// build time; the SPA never rewrote it for home specifically. Ported as-is —
// only [slug].vue composes "<siteTitle> - <pageTitle>".
usePageSeo(siteTitle, siteTitle);

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
