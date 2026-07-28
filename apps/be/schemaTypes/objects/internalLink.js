import {BiDirections} from 'react-icons/bi'
import {linkTargets} from '../../utils/internalLinkTargets'
import {defineField, defineType} from 'sanity'

export default defineType({
  title: 'Internal Link',
  name: 'internalLink',
  type: 'object',
  icon: BiDirections,
  fields: [
    defineField({
      title: 'Internal Link',
      name: 'linkTarget',
      type: 'reference',
      to: linkTargets,
      options: {
        disableNew: true,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      title: 'Title',
      description: 'Keep empty to use Internal link title',
      name: 'title',
      type: 'string',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      targetTitle: 'linkTarget.title',
    },
    prepare({title, targetTitle}) {
      return {
        title: title ?? targetTitle ?? '',
        media: BiDirections,
      }
    },
  },
})
