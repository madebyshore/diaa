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
 */

const pageData = usePageData();
const siteOptions = useSiteOptions();

// Capture into a local const (not repeated `pageData.value` reads) so
// TypeScript's control-flow narrowing on the `=== null` check below applies
// to every later reference to `content`.
const content = pageData.value;
if (content === null || content.template === "home") {
  // `content.template === "home"` is unreachable in practice (Nuxt's router
  // only mounts this page for a path other than "/", and "/" is the only
  // path `loadRouteContent()` ever resolves to a `HomeRouteContent`) — the
  // check exists so TypeScript narrows `content` to `DetailRouteContent |
  // RichTextRouteContent` below (both carry `.title`; `HomeRouteContent`
  // doesn't), without an `as` cast. Genuinely reaching this branch would
  // mean routing itself is broken, so 404 is still the right response.
  throw createError({
    statusCode: 404,
    statusMessage: "Page not found",
    fatal: true,
  });
}

const siteTitle = computed(() => siteOptions.value?.siteTitle ?? "");
// "<siteTitle> - <pageTitle>" — every non-home route composes the document
// title this way (ported from the old build's title-composition rule, see
// the Phase-1 CHANGELOG entry's "browser/tab title format" note).
usePageSeo(() => `${siteTitle.value} - ${content.title}`, siteTitle);

console.debug(`[page:slug] rendering — template="${content.template}", title="${content.title}"`);
</script>

<template>
  <!-- Detail -->
  <section v-if="content.template === 'detail'" id="page" class="detail">
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
         pattern; a plain <a href="/"> so Phase 5's click delegation runs the
         detail → home transition. -->
    <nav class="global-nav global-nav--footer detail__footer" aria-label="Close">
      <a class="global-nav__link" href="/">Close</a>
    </nav>
  </section>

  <!-- Contact -->
  <section v-else-if="content.template === 'contact'" id="page" class="contact">
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
  </section>

  <!-- Imprint -->
  <section v-else-if="content.template === 'imprint'" id="page" class="imprint">
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
  </section>
</template>
