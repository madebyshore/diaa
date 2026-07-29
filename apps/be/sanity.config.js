import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool, defineLocations} from 'sanity/presentation'
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
        // No `mainDocuments`: detail/pageContact/pageImprint all resolve to
        // single-segment root paths (`/${slug}`) from freeform slugs, so a
        // route pattern can't disambiguate which document type produced a
        // given path without also fetching and comparing against live slugs —
        // that lookup is exactly what `locations` above already provides in
        // the other direction. Add it later if the Presentation "main
        // document" panel proves worth the extra query.
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})
