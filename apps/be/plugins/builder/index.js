import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'zineBuilder',
  title: 'Zine Builder',
  type: 'object',
  fields: [
    defineField({
      title: 'Page Title',
      name: 'pageTitle',
      type: 'string',
    }),
    defineField({
      title: 'Images',
      name: 'images',
      type: 'array',
      of: [{type: 'image'}],
    }),
  ],
})
