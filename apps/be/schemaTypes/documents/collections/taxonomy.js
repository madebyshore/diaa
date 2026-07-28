import {BiCategory} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'

// A Taxonomy groups Entries under a single topic. The relationship is owned
// entirely by the Entry (Detail) side via its `taxonomy` reference — the
// Taxonomy itself only stores a title.
export default defineType({
  title: 'Taxonomy',
  name: 'taxonomy',
  type: 'document',
  icon: BiCategory,
  fields: [
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {
      title: 'title',
    },
    prepare({title}) {
      return {
        title: title || 'Untitled Taxonomy',
      }
    },
  },
})
