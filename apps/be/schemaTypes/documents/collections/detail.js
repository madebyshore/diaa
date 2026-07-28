import {BiDetail} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'
import {slugify, validateSlug} from '../../../utils/helperFunctions.js'
import {stylizedTitleField} from '../../../utils/fields.js'

// A Detail is the atomic content unit — what used to be Pages / Case Studies.
// Every Detail belongs to one Taxonomy (selected via the `taxonomy` reference)
// so the Home page can group Details by Taxonomy in its nav + Grid composer.
export default defineType({
  title: 'Detail',
  name: 'detail',
  type: 'document',
  icon: BiDetail,
  groups: [
    {
      title: 'General',
      name: 'general',
    },
    {
      title: 'Slices',
      name: 'slices',
    },
    {
      title: 'SEO',
      name: 'seo',
    },
  ],
  fields: [
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
      validation: (Rule) => Rule.required(),
      group: 'general',
    }),
    // Rich-text version of the title, constrained to bold/italic decorators
    // (no styles, lists, or links). This is what the front end RENDERS as the
    // title — on the home grid (Text mode + Image-mode hover overlay) and on
    // the detail-page heading. The plain Title above stays the CMS entry
    // title and the browser-tab title. Editors stylize freely here — e.g.
    // append an italicized "(In Progress)" — the front end no longer adds
    // that tag automatically.
    stylizedTitleField({
      description:
        'Rendered as the title on the home page and detail page. Supports bold and italic — e.g. italicize an "(In Progress)" suffix here. When empty, the plain Title renders instead.',
      group: 'general',
    }),
    // Routing switch. On (the default) the detail page is built and the home
    // grid links to it; off, the grid entry renders as a non-routing label and
    // no page is emitted. No longer tied to the removed "In Progress" toggle —
    // in-progress signalling now lives in the Stylized Title text itself.
    defineField({
      title: 'Allow Routing to Page',
      name: 'allowRouting',
      type: 'boolean',
      description:
        'When enabled (default), the detail page is built and the home grid routes to it. Disable to show the entry without a page.',
      initialValue: true,
      group: 'general',
    }),
    defineField({
      title: 'Slug',
      name: 'slug',
      type: 'slug',
      options: {
        source: 'title',
        slugify: slugify,
      },
      validation: validateSlug,
      group: 'general',
    }),
    defineField({
      title: 'Cover Image',
      name: 'coverImage',
      type: 'image',
      description:
        'Used everywhere the cover appears (home grid, hover reveal, detail page). When a Cover Video is also set, this image becomes the video poster / fallback — upload both.',
      options: {hotspot: true},
      group: 'general',
    }),
    // Optional MP4 cover. When present, the front end renders it as a looping,
    // muted, autoplaying <video> everywhere the cover appears (home grid, the
    // text-mode hover reveal, and the detail-page cover), with the Cover Image
    // as poster/fallback. `options.accept` restricts the picker to MP4; the
    // custom validation re-checks the uploaded asset's extension so a non-MP4
    // can never slip through.
    defineField({
      title: 'Cover Video (MP4)',
      name: 'coverVideo',
      type: 'file',
      description:
        'Optional. When set, an MP4 renders as a looping autoplay video everywhere the cover appears. Must be an .mp4 file. Set the Cover Image too — it is used as the poster/fallback.',
      options: {accept: 'video/mp4'},
      validation: (Rule) =>
        Rule.custom((value) => {
          // No file attached → nothing to validate (the field is optional).
          const ref = value?.asset?._ref
          if (!ref) return true
          // Sanity file asset refs end with the extension: `file-<hash>-mp4`.
          return ref.endsWith('-mp4') || 'Cover Video must be an MP4 file.'
        }),
      group: 'general',
    }),
    defineField({
      title: 'Cover Size',
      name: 'coverSize',
      type: 'string',
      description: 'Aspect ratio and size of the cover image on the home grid.',
      options: {
        list: [
          {title: '4:3 Small', value: '4x3-sm'},
          {title: '4:3 Large', value: '4x3-lg'},
          {title: '3:4 Small', value: '3x4-sm'},
          {title: '3:4 Large', value: '3x4-lg'},
        ],
        layout: 'dropdown',
      },
      validation: (Rule) => Rule.required(),
      group: 'general',
    }),
    defineField({
      title: 'Taxonomy',
      name: 'taxonomy',
      type: 'reference',
      to: [{type: 'taxonomy'}],
      description: 'Which Taxonomy this Detail belongs to.',
      options: {
        disableNew: true,
      },
      group: 'general',
    }),
    defineField({
      title: 'Slices',
      name: 'slices',
      type: 'slices',
      group: 'slices',
    }),
    defineField({
      title: 'SEO',
      name: 'seo',
      type: 'seo',
      group: 'seo',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      media: 'coverImage',
      taxonomy: 'taxonomy.title',
    },
    prepare({title, media, taxonomy}) {
      return {
        title: title || '',
        subtitle: taxonomy ? taxonomy : '',
        media: media,
      }
    },
  },
})
