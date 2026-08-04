import {createElement, Fragment} from 'react'
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool, defineLocations, defineDocuments} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {media} from 'sanity-plugin-media'
import {vercelDeployTool} from 'sanity-deploy'
import {desk} from './desk'

export default defineConfig({
  name: 'default',
  title: 'Diaa',
  projectId: '0in4i1po',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: desk,
    }),
    media(),
    visionTool(),
    vercelDeployTool(),
    // Presentation (Visual Editing) — opens the Presentation tab, iframing the
    // Nuxt dev/preview deployment so editors click text to jump to the
    // authoring field and see draft saves reflected live. `previewUrl.origin`
    // points at the preview deployment (localhost Nuxt dev server while
    // developing, the SSR preview Vercel URL in production — set via the
    // SANITY_STUDIO_PREVIEW_ORIGIN env var read at `sanity dev`/`sanity deploy`
    // time); `previewMode.enable` is the Nuxt app's own Nitro route (no
    // `/__preview/` prefix — that was an artifact of the old standalone
    // preview server, not something the Nuxt app needs). `resolve.locations`
    // mirrors the exact route derivation the front end uses to build page
    // paths, so the sidebar/back button always points at a route the front
    // end actually renders. See apps/fe/docs/visual-editing.md for the full
    // architecture (to be rewritten for the Nuxt app at cutover).
    presentationTool({
      previewUrl: {
        origin: process.env.SANITY_STUDIO_PREVIEW_ORIGIN || 'http://localhost:3000',
        previewMode: {
          enable: '/preview/enable',
        },
      },
      
      resolve: {
        locations: {
          // Home singleton — always "/" (sanity-content.ts pushes it
          // unconditionally, no slug field on this schema).
          pageHome: defineLocations({
            select: {title: 'title'},
            resolve: (doc) => ({
              locations: [{title: doc?.title || 'Home', href: '/'}],
            }),
          }),
          // Detail — routes to `/${slug}` only when it has a slug AND
          // `allowRouting` is not explicitly false, matching the
          // `d.slug && routable` gate in sanity-content.ts (routable =
          // allowRouting !== false). Docs that fail either check render no
          // page, so surface no location rather than a dead link.
          detail: defineLocations({
            select: {title: 'title', slug: 'slug.current', allowRouting: 'allowRouting'},
            resolve: (doc) => {
              if (!doc?.slug || doc.allowRouting === false) {
                return {locations: []}
              }
              return {
                locations: [{title: doc.title || 'Untitled', href: `/${doc.slug}`}],
              }
            },
          }),
          // Contact singleton — slug-derived path, falling back to "/contact"
          // exactly like `contactPath` in sanity-content.ts.
          pageContact: defineLocations({
            select: {title: 'title', slug: 'slug.current'},
            resolve: (doc) => ({
              locations: [
                {title: doc?.title || 'Contact', href: `/${doc?.slug || 'contact'}`},
              ],
            }),
          }),
          // Imprint singleton — same fallback shape as Contact above,
          // mirroring `imprintPath` in sanity-content.ts.
          pageImprint: defineLocations({
            select: {title: 'title', slug: 'slug.current'},
            resolve: (doc) => ({
              locations: [
                {title: doc?.title || 'Imprint', href: `/${doc?.slug || 'imprint'}`},
              ],
            }),
          }),
        },
        // Main documents: resolves the primary document for the URL in the
        // Presentation iframe, populating the "Documents on this page"
        // sidebar. Needed because the front end ships NO stega encoding
        // (apps/fe/app/data/stega.ts has `enabled: false`) — with no
        // zero-width markers in the DOM, the visual-editing runtime detects
        // zero documents, so without this the sidebar reads "No matching
        // documents" on every route. The single-segment `/:slug` pattern
        // can't disambiguate document type on its own, so ONE filter mirrors
        // the front end's route resolution exactly (loadRouteContent in
        // apps/fe/app/data/content.ts): detail requires a slug match AND
        // `allowRouting !== false` (GROQ: missing → null != false → true,
        // same as the JS check); contact/imprint match their authored slug,
        // falling back to "contact"/"imprint" when unauthored — the same
        // `?? "contact"` / `?? "imprint"` coalesce content.ts applies. Edge:
        // a detail slugged "contact"/"imprint" beside an unauthored
        // singleton matches both here with no guaranteed order, while the
        // front end deterministically prefers detail — acceptable, since
        // that slug collision is already a broken authoring state.
        mainDocuments: defineDocuments([
          {
            route: '/',
            type: 'pageHome',
          },
          {
            route: '/:slug',
            filter: `
              (_type == "detail" && slug.current == $slug && allowRouting != false) ||
              (_type == "pageContact" && coalesce(slug.current, "contact") == $slug) ||
              (_type == "pageImprint" && coalesce(slug.current, "imprint") == $slug)
            `,
          },
        ]),
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },

  studio: {
    components: {
      // Layout wrapper whose only job is injecting one CSS rule: hide the
      // Edit/Preview mode toggle in Presentation's preview toolbar so editors
      // can't accidentally turn click-to-edit overlays off (the toggle starts
      // on, and with no control rendered it stays on). There is no supported
      // plugin option for this — the toggle is hardcoded in Presentation's
      // header — so we remove it via CSS. `display: none` also drops it from
      // tab order, closing the keyboard-focus path a pointer-events freeze
      // would leave open. The selector keys off the toggle's unique
      // pill-shaped label wrapper (inline `border-radius: 999px` on a
      // `label[data-ui="Card"]`): a bare `[data-ui="Switch"]` would also
      // hide every boolean field's switch in the document form pane, which
      // uses the same primitive. Internal DOM, not public API — re-verify
      // the selector after Studio upgrades. Note the Alt/Option
      // momentary-disable shortcut still works (fine: it springs back on
      // release).
      layout: (props) =>
        createElement(
          Fragment,
          null,
          createElement(
            'style',
            null,
            'label[data-ui="Card"][style*="999px"]:has([data-ui="Switch"]) { display: none; }',
          ),
          props.renderDefault(props),
        ),
    },
  },
})
