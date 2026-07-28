import {BiEnvelope} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'
import {slugify, validateSlug} from '../../../utils/helperFunctions.js'

// Contact page singleton. Title + slug plus a rich-text body — the
// frontend renders the body centered in the middle six columns. Reuses
// the shared `richText` type so editors get line breaks (Shift+Enter),
// external hyperlinks, and internal page links for free.
export default defineType({
  title: 'Contact',
  name: 'pageContact',
  type: 'document',
  icon: BiEnvelope,
  groups: [
    {title: 'General', name: 'general', default: true},
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
  ],
  preview: {
    prepare() {
      return {
        title: 'Contact',
        media: BiEnvelope,
      }
    },
  },
})
