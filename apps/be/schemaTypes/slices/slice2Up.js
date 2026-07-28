import {defineField, defineType} from 'sanity'
import {BiColumns} from 'react-icons/bi'

// 2Up slice — exactly two captioned images side by side. The Layout dropdown
// drives the per-image aspect ratios, so the images themselves don't carry
// their own Aspect/Size fields.
export default defineType({
  name: 'slice2Up',
  title: '2Up',
  type: 'object',
  icon: BiColumns,
  fields: [
    defineField({
      title: 'Layout',
      name: 'layout',
      type: 'string',
      description:
        'Vertical sets both images in 3:4 aspect side by side. A sets the first image 3:4 and the second 4:3. B sets the first image 4:3 and the second 3:4.',
      options: {
        list: [
          {title: 'Vertical', value: 'vertical'},
          {title: 'A', value: 'a'},
          {title: 'B', value: 'b'},
        ],
        layout: 'dropdown',
      },
      initialValue: 'vertical',
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
      validation: (Rule) => Rule.required().length(2),
    }),
  ],
  preview: {
    select: {layout: 'layout', media: 'images.0.image'},
    prepare({layout, media}) {
      return {
        title: '2Up',
        subtitle: layout ? `Layout: ${String(layout).toUpperCase()}` : '',
        media,
      }
    },
  },
})
