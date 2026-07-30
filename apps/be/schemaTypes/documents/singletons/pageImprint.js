import {BiFileBlank} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'
import {slugify, validateSlug} from '../../../utils/helperFunctions.js'

// Imprint page singleton. Title + slug plus a rich-text body — the
// frontend renders the body centered in the middle six columns. Reuses
// the shared `richText` type so editors get line breaks (Shift+Enter),
// external hyperlinks, and internal page links for free.
export default defineType({
  title: 'Imprint',
  name: 'pageImprint',
  type: 'document',
  icon: BiFileBlank,
  groups: [
    {title: 'General', name: 'general', default: true},
    {title: 'SEO', name: 'seo'},
  ],
  fields: [
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
      validation: (Rule) => Rule.required(),
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
      title: 'Body',
      name: 'body',
      type: 'richText',
      description:
        'Rendered centered on the page. Shift+Enter for line breaks; links can be external URLs or internal page references.',
      group: 'general',
    }),
    defineField({
      title: 'SEO',
      name: 'seo',
      type: 'seo',
      description: 'Per-page meta description, keywords, and OG image — overrides the Global defaults.',
      group: 'seo',
    }),
  ],
  preview: {
    prepare() {
      return {
        title: 'Imprint',
        media: BiFileBlank,
      }
    },
  },
})
