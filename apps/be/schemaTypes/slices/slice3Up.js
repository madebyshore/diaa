import {defineField, defineType} from 'sanity'
import {BiGridAlt} from 'react-icons/bi'

// Layout options. Titles spell out each image's aspect + size (M = Mid,
// S = Small), left to right. The stored VALUES are the original letter codes
// — only the labels changed, so existing documents need no migration.
const LAYOUTS = [
  {title: '3:4 M | 3:4 S | 4:3 S', value: 'a'},
  {title: '4:3 S | 3:4 S | 3:4 M', value: 'b'},
  {title: '3:4 S | 3:4 M | 4:3 S', value: 'c'},
]

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
        'The aspect and size of each image, left to right (M = Mid, S = Small). Images are cropped to fit.',
      options: {
        list: LAYOUTS,
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
        subtitle: LAYOUTS.find((l) => l.value === layout)?.title ?? '',
        media,
      }
    },
  },
})
