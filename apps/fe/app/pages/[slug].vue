<script setup lang="ts">
/**
 * pages/[slug].vue — every non-home route: Detail, Contact, Imprint. DOM
 * structure ported from `apps/fe/src/routes/{*detail.html, contact.html,
 * imprint.html}`. Slice bodies render via `<SliceRenderer>` (Phase 3), which
 * dispatches each already-resolved slice (`resolveSlices()`'s output, see
 * `data/content.ts`) to its Vue component by `_type`. Contact/Imprint bodies
 * render via `<RichText>` with the old build's paragraph-wrap semantics
 * (`renderPortableText(body, { wrap: "p" })`).
 *
 * 404 handling: `loadRouteContent(path)` (data/content.ts) returns `null`
 * when nothing matched. That's already an UNAMBIGUOUS 404 signal for every
 * path this page can be asked to render — no not-found-specific change to
 * `content.ts`/`content.server.ts` was needed for this (they DID change in
 * this same commit, but only to thread an explicit `SanityClientConfig`
 * through for the `prerender:routes` hook — see `data/client.ts`; that
 * refactor doesn't touch the null-means-404 contract at all). Reasoning:
 * Nuxt's file-based router only ever mounts `[slug].vue` for a single path
 * segment other than "/" (index.vue owns "/", and matches it exactly), and
 * `loadRouteContent("/")` is the only branch in `data/content.ts` that can
 * never return null (it always resolves a `HomeRouteContent`). So for every
 * path this component can actually receive, `null` can only mean "no
 * Detail/Contact/Imprint matched" — genuinely a 404, not an ambiguous
 * "still loading" or "home with an empty grid" state.
 *
 * Phase 6 note on `content` below: it's a `computed()`, not the plain
 * destructured local this file originally had. Preview refresh
 * (`plugins-preview/visual-editing.client.ts`) replaces
 * `usePageData().value` wholesale after a Studio draft save — a value
 * captured once at setup would never observe that write, silently making
 * live refresh a no-op for every Detail/Contact/Imprint route. See the
 * `content` computed's own comment below for the full reasoning.
 *
 * PATH-GUARDED, not just null/template-guarded — a later fix (see that
 * comment) tightened this further: `usePageData()` is ONE shared
 * `useState`, and `composables/usePageContentSync.ts` has to write the
 * INCOMING route's content into it BEFORE the outgoing page unmounts (Vue's
 * mode-less `<Transition>` keeps both pages mounted throughout the swap —
 * see `transitions/default.ts`'s file header). Without a path check, a
 * still-mounted, still-fading-out `[slug].vue` instance (e.g. navigating
 * Detail → home, or Detail → a DIFFERENT Detail) would reactively pick up
 * the OTHER route's freshly-fetched content mid-fade and re-render with it.
 */

import { createDetailController } from "~/controllers/detail";
import { createRichTextController } from "~/controllers/rich-text-page";

const pageData = usePageData();
const siteOptions = useSiteOptions();
const route = useRoute();

// Initial snapshot — used to type-narrow away the null/"home" cases (a
// genuine 404 for this component, per the file header) AND as the `content`
// computed's fallback value below whenever a later `pageData` write isn't
// tagged for THIS route (see that computed's comment).
const initialContent = pageData.value;
if (initialContent === null || initialContent.template === "home") {
  // `initialContent.template === "home"` is unreachable in practice
  // (Nuxt's router only mounts this page for a path other than "/", and
  // "/" is the only path `loadRouteContent()` ever resolves to a
  // `HomeRouteContent`) — the check exists so TypeScript narrows
  // `initialContent` to `DetailRouteContent | RichTextRouteContent` here
  // (both carry `.title`; `HomeRouteContent` doesn't), without an `as`
  // cast. Genuinely reaching this branch would mean routing itself is
  // broken, so 404 is still the right response.
  throw createError({
    statusCode: 404,
    statusMessage: "Page not found",
    fatal: true,
  });
}

// Reactive view of the route's content — see the file header's Phase 6 +
// path-guard notes. Only accepts `pageData.value` as fresher-than-the-
// snapshot when it's BOTH non-home AND tagged (`data.path`) for this exact
// route — a hard reload's initial fetch and a same-route live-preview
// refresh both satisfy that; a navigation-in-flight write for some OTHER
// route does not, and falls through to `initialContent` instead of
// corrupting this still-mounted instance's render. Template bindings below
// (`content.template`, `content.title`, ...) don't need `.value` — Vue
// auto-unwraps a `computed()` referenced by name in `<script setup>`
// templates, same as a plain `ref()`.
const content = computed(() => {
  const data = pageData.value;
  return data && data.template !== "home" && data.path === route.path ? data : initialContent;
});

const siteTitle = computed(() => siteOptions.value?.siteTitle ?? "");
// "<siteTitle> - <pageTitle>" — every non-home route composes the document
// title this way (ported from the old build's title-composition rule, see
// the Phase-1 CHANGELOG entry's "browser/tab title format" note).
usePageSeo(() => `${siteTitle.value} - ${content.value.title}`, siteTitle);

console.debug(
  `[page:slug] rendering — template="${content.value.template}", title="${content.value.title}"`,
);

// Wire the matching controller by template — detail gets its full
// bridge/mobile-slide/bottom-dwell choreography (controllers/detail.ts),
// contact/imprint share the rich-text factory (controllers/rich-text-page.ts)
// keyed by their own BEM block name. Read off `initialContent` (not the
// reactive `content`) — the controller is chosen ONCE, at mount, for
// whichever template this document resolved to; a preview refresh changes
// that document's field values, never its `_type`/template, so there is no
// scenario where the controller choice itself needs to react to a refresh.
const controller =
  initialContent.template === "detail"
    ? createDetailController()
    : createRichTextController(initialContent.template);
usePageController(controller);
</script>

<template>
  <section id="page" :class="content.template">
    <!--
      Single root element — Nuxt/Vue requires a page component to have
      EXACTLY one root node for stable `$el` resolution and page-transition
      tracking. The old markup here was three ALTERNATIVE root-level
      `<section v-if>/<section v-else-if>` elements, which Vue compiles to a
      multi-root Fragment; Nuxt detects this and warns "does not have a
      single root node and will cause errors when navigating between
      routes" (NUXT_E4004) — and it wasn't just a warning: it broke
      composables/usePageController.ts's first-load `onMounted` guard
      (`getCurrentInstance()?.proxy?.$el` resolves to nothing for a Fragment
      root, so `controller.onInit()` silently never ran on a hard-loaded
      Detail/Contact/Imprint page) and destabilized `<Transition>`'s own
      element tracking during a home → detail SPA navigation. Fixed by
      giving the component ONE static root (its template-name class now a
      `:class` binding) and moving each conditional branch to a `<template
      v-if>` (a Vue construct that adds no wrapper element of its own)
      INSIDE that root — the rendered DOM for any given template is
      byte-identical to the old markup, only the component's OWN root shape
      changed.

      THIS COMMENT MUST STAY HERE, inside `<section>`, never as a sibling
      BEFORE its opening tag — Vue's compiler counts a top-level HTML
      comment as its own root node too (confirmed against the compiled
      render function: a comment placed ahead of `<section>` produces
      `createElementBlock(Fragment, ..., [commentVNode, sectionVNode])`,
      i.e. TWO root children again — Nuxt's own diagnostics for this class
      of error literally note "HTML comments are considered elements as
      well"). Putting the whole comment block as `<section>`'s first CHILD
      instead keeps the compiled output to a single root element.
    -->
    <!-- Detail -->
    <template v-if="content.template === 'detail'">
      <!-- Passive title heading — closing lives in the persistent ( Close )
           footer below (Phase 5 adds the desktop hover "( Close )" swap). -->
      <div class="detail__nav">
        <span class="detail__nav-label detail__nav-label--title">
          <RichText inline :blocks="content.stylizedTitle" :fallback="content.title" />
        </span>
      </div>
      <div class="detail__container">
        <div class="detail__cover">
          <div :class="`detail__cover-inner detail__cover-inner--${content.cover.coverSize}`">
            <FigureBase
              :src="content.cover.src"
              :alt="content.cover.alt"
              :width="content.cover.width"
              :height="content.cover.height"
              :is-first="content.cover.isFirst"
              :has-video="content.cover.hasVideo"
              :video="content.cover.video"
            />
          </div>
        </div>
        <SliceRenderer :slices="content.slices" />
        <div class="detail__outro">
          <DiaaWordmark logo-class="detail__outro-logo" />
        </div>
      </div>
      <!-- Mobile-only Close footer — see contact/imprint below for the same
           pattern; a plain <a href="/"> so Phase 5's click delegation runs
           the detail → home transition. -->
      <nav class="global-nav global-nav--footer detail__footer" aria-label="Close">
        <a class="global-nav__link" href="/">Close</a>
      </nav>
    </template>

    <!-- Contact -->
    <template v-else-if="content.template === 'contact'">
      <div class="contact__nav">
        <span class="contact__nav-label contact__nav-label--title">{{ content.title }}</span>
      </div>
      <div class="contact__container">
        <div class="contact__main">
          <div class="contact__body">
            <RichText :blocks="content.body" />
          </div>
        </div>
        <div class="contact__outro">
          <DiaaWordmark logo-class="contact__outro-logo" />
        </div>
      </div>
      <nav class="global-nav global-nav--footer contact__footer" aria-label="Close">
        <a class="global-nav__link" href="/">Close</a>
      </nav>
    </template>

    <!-- Imprint -->
    <template v-else-if="content.template === 'imprint'">
      <div class="imprint__nav">
        <span class="imprint__nav-label imprint__nav-label--title">{{ content.title }}</span>
      </div>
      <div class="imprint__container">
        <div class="imprint__main">
          <div class="imprint__body">
            <RichText :blocks="content.body" />
          </div>
        </div>
        <div class="imprint__outro">
          <DiaaWordmark logo-class="imprint__outro-logo" />
        </div>
      </div>
      <nav class="global-nav global-nav--footer imprint__footer" aria-label="Close">
        <a class="global-nav__link" href="/">Close</a>
      </nav>
    </template>
  </section>
</template>
