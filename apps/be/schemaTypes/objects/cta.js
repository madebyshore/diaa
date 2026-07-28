import {BiRightArrowAlt} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'

export default defineType({
  title: 'CTA',
  name: 'cta',
  type: 'object',
  icon: BiRightArrowAlt,
  fields: [
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      title: 'Link',
      name: 'link',
      type: 'array',
      of: [{type: 'internalLink'}, {type: 'externalLink'}],
      validation: (Rule) => Rule.required().max(1).min(1),
    }),
  ],
  preview: {
    select: {
      title: 'title',
      link: 'link.0',
      internalTitle: 'link.0.linkTarget.title',
      externalHref: 'link.0.href',
    },
    prepare({title, link, internalTitle, externalHref}) {
      const subtitle = link?._type === 'internalLink' ? internalTitle : externalHref
      return {
        title: title ?? 'Untitled CTA',
        subtitle: subtitle ?? '',
        media: BiRightArrowAlt,
      }
    },
  },
})
