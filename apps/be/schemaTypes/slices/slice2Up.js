import {defineField, defineType} from 'sanity'
import {BiColumns} from 'react-icons/bi'

// Layout options. Titles spell out each image's aspect, left to right, so
// editors don't have to memorise letter codes. The stored VALUES are the
// original ones (`vertical` / `a` / `b`) — only the labels changed, so
// existing documents need no migration. `open` is the 3:4 | 3:4 placement with
// each image at its own uploaded proportions instead of a 3:4 crop.
const LAYOUTS = [
  {title: '3:4 | 3:4', value: 'vertical'},
  {title: '3:4 | 4:3', value: 'a'},
  {title: '4:3 | 3:4', value: 'b'},
  {title: 'Open aspect', value: 'open'},
]

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
        'The aspect of each image, left to right — images are cropped to fit. Open aspect does not crop: the images sit in the same positions and at the same width as 3:4 | 3:4, but each keeps its own proportions.',
      options: {
        list: LAYOUTS,
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
        subtitle: LAYOUTS.find((l) => l.value === layout)?.title ?? '',
        media,
      }
    },
  },
})
