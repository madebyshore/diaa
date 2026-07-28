import {BiLinkAlt} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'

export default defineType({
  title: 'External Link',
  name: 'externalLink',
  type: 'object',
  icon: BiLinkAlt,
  initialValue: {
    blank: true,
  },
  fields: [
    defineField({
      title: 'URL',
      name: 'href',
      type: 'url',
      validation: (Rule) =>
        Rule.uri({
          allowRelative: true,
          scheme: ['https', 'http', 'mailto', 'tel'],
        }),
    }),
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
    }),
    defineField({
      title: 'Open in new tab?',
      name: 'blank',
      type: 'boolean',
    }),
  ],
  preview: {
    select: {
      url: 'href',
      title: 'title',
    },
    prepare({url, title}) {
      return {
        title: title ?? 'Untitled Link',
        subtitle: url,
        media: BiLinkAlt,
      }
    },
  },
})
