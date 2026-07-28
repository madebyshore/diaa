import {defineField, defineType} from 'sanity'
import {BiSlideshow} from 'react-icons/bi'

// Image Slideshow slice — an open-ended, ordered set of images shown as a
// slideshow. Plain hotspot images, no captions.
export default defineType({
  name: 'sliceImageSlideshow',
  title: 'Image Slideshow',
  type: 'object',
  icon: BiSlideshow,
  fields: [
    defineField({
      title: 'Images',
      name: 'images',
      type: 'array',
      of: [{type: 'image', options: {hotspot: true}}],
      validation: (Rule) => Rule.required().min(2),
    }),
    // Single caption for the whole slideshow, shown under the image after the
    // `current / total` counter, e.g. "1 / 4 — Lorem ipsum…".
    defineField({
      title: 'Caption',
      name: 'caption',
      type: 'text',
      rows: 2,
      description: 'Shown under the image, after the slide counter (e.g. "1 / 4 — your caption").',
    }),
  ],
  preview: {
    // Select the array once and derive both the count and the thumbnail in
    // prepare. Selecting an index sibling (e.g. `images.0`) alongside the whole
    // array makes Sanity resolve `images` to undefined — hence "0 images".
    select: {images: 'images'},
    prepare({images}) {
      const list = Array.isArray(images) ? images : []
      return {
        title: 'Image Slideshow',
        subtitle: `${list.length} image${list.length === 1 ? '' : 's'}`,
        media: list[0],
      }
    },
  },
})
