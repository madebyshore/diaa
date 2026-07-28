import {defineField, defineType} from 'sanity'
import {BiImages} from 'react-icons/bi'

// Reusable Image-with-Caption object — an image (with hotspot) paired with a
// rich-text caption. Consumed by the multi-image slices (2Up, 3Up) and
// available anywhere a captioned image is needed.
export default defineType({
  name: 'imageWithCaption',
  title: 'Image with Caption',
  type: 'object',
  icon: BiImages,
  fields: [
    defineField({
      title: 'Image',
      name: 'image',
      type: 'image',
      options: {hotspot: true},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      title: 'Caption',
      name: 'caption',
      type: 'richText',
    }),
  ],
  preview: {
    select: {media: 'image', caption: 'caption'},
    // Surface the caption's plain text as the preview title so editors can tell
    // captioned images apart in array lists; fall back to the type name.
    prepare({media, caption}) {
      const text = Array.isArray(caption)
        ? caption
            .filter((block) => block._type === 'block')
            .map((block) => (block.children || []).map((child) => child.text).join(''))
            .join(' ')
            .trim()
        : ''
      return {
        title: text || 'Image with Caption',
        media,
      }
    },
  },
})
