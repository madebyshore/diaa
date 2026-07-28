import {BiHome} from 'react-icons/bi'
import {defineField, defineType} from 'sanity'

// Home page singleton. No default group — content / taxonomy / grid / seo
// are all opt-in tabs so the editor consciously chooses where to work.
export default defineType({
  title: 'Home',
  name: 'pageHome',
  type: 'document',
  icon: BiHome,
  groups: [
    {title: 'Content', name: 'content'},
    {title: 'Taxonomy', name: 'taxonomy'},
    {title: 'Grid', name: 'grid'},
    {title: 'SEO', name: 'seo'},
  ],
  fields: [
    defineField({
      title: 'Title',
      name: 'title',
      type: 'string',
      validation: (Rule) => Rule.required(),
      group: 'content',
    }),

    /* taxonomy */
    defineField({
      title: 'Taxonomies',
      name: 'taxonomies',
      type: 'array',
      description: 'Selected Taxonomies appear in the navigation',
      of: [{type: 'reference', to: [{type: 'taxonomy'}]}],
      validation: (Rule) =>
        Rule.custom((refs) => {
          if (!refs) return true
          const ids = refs.map((r) => r._ref).filter(Boolean)
          const unique = new Set(ids)
          return unique.size === ids.length ? true : 'Each Taxonomy can only be added once.'
        }).error(),
      group: 'taxonomy',
    }),

    /* grid — flat, ordered list of Details. The array order is the render
       order on the front end, where the items reflow as a single centered
       responsive row (no authored row breaks). */
    defineField({
      title: 'Grid',
      name: 'grid',
      type: 'array',
      description:
        'Add Details from the selected Taxonomies. The order here is the render order on the front end, where they reflow into one centered, responsive row.',
      of: [{type: 'reference', to: [{type: 'detail'}]}],
      group: 'grid',
    }),

    /* seo */
    defineField({
      title: 'SEO',
      name: 'seo',
      type: 'seo',
      group: 'seo',
    }),
  ],
  preview: {
    prepare() {
      return {
        title: 'Home',
        media: BiHome,
      }
    },
  },
})
