import {defineField, defineType} from 'sanity'
import {BiGridAlt} from 'react-icons/bi'

// 3Up slice — exactly three captioned images. The Layout dropdown drives each
// image's aspect + size, so the images themselves don't carry their own
// Aspect/Size fields.
export default defineType({
  name: 'slice3Up',
  title: '3Up',
  type: 'object',
  icon: BiGridAlt,
  fields: [
    defineField({
      title: 'Layout',
      name: 'layout',
      type: 'string',
      description:
        'A sets the first image 3:4 Mid, second 3:4 Small, third 4:3 Small. B sets the first image 4:3 Small, second 3:4 Small, third 3:4 Mid. C sets the first image 3:4 Small, second 3:4 Mid, third 4:3 Small.',
      options: {
        list: [
          {title: 'A', value: 'a'},
          {title: 'B', value: 'b'},
          {title: 'C', value: 'c'},
        ],
        layout: 'dropdown',
      },
      initialValue: 'a',
      validation: (Rule) => Rule.required(),
    }),
    // When on, the frontend aligns the images to their baseline (bottom)
    // instead of the top. Independent of the Layout variant.
    defineField({
      title: 'Bottom Aligned',
      name: 'bottomAligned',
      type: 'boolean',
      description: 'Align the images to their baseline (bottom) instead of the top.',
      initialValue: false,
    }),
    defineField({
      title: 'Images',
      name: 'images',
      type: 'array',
      of: [{type: 'imageWithCaption'}],
      validation: (Rule) => Rule.required().length(3),
    }),
  ],
  preview: {
    select: {layout: 'layout', media: 'images.0.image'},
    prepare({layout, media}) {
      return {
        title: '3Up',
        subtitle: layout ? `Layout: ${String(layout).toUpperCase()}` : '',
        media,
      }
    },
  },
})
