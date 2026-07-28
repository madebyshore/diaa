import {defineField, defineType} from 'sanity'

export default defineType({
  title: 'SEO',
  name: 'seo',
  type: 'object',
  fields: [
    defineField({
      title: 'Meta Description',
      name: 'metaDescription',
      type: 'text',
    }),
    defineField({
      title: 'Meta Keywords',
      name: 'metaKeywords',
      type: 'array',
      of: [{type: 'string'}],
      options: {
        layout: 'tags',
      },
    }),
    defineField({
      title: 'Open Graph Image',
      name: 'ogImage',
      type: 'image',
    }),
  ],
})
