import {defineField, defineType} from 'sanity'
import {BiImageAlt} from 'react-icons/bi'
import {aspectField, sizeField, stylizedTitleField} from '../../utils/fields.js'

// Image with Text slice — an image paired with a titled rich-text block. Unlike
// the bare Image slice this keeps the Small size option.
export default defineType({
  name: 'sliceImageWithText',
  title: 'Image with Text',
  type: 'object',
  icon: BiImageAlt,
  fields: [
    // 3:2, 4:3, and 3:4 are supported by this slice's layout. The landscape
    // ratios (3:2, 4:3) span the center 6 columns; 3:4 is centered with a
    // column-derived fixed height.
    aspectField({allowed: ['3x2', '4x3', '3x4'], initialValue: '3x2'}),
    sizeField({includeSmall: true}),
    defineField({
      title: 'Image',
      name: 'image',
      type: 'image',
      description: 'When a Video is also set, this image becomes the video poster / fallback.',
      options: {hotspot: true},
      validation: (Rule) => Rule.required(),
    }),
    // Optional MP4. When set, the front end renders it as a looping, muted,
    // autoplaying <video> in place of the image (the Image above is the
    // poster/fallback). Mirrors the Detail cover video: options.accept limits
    // the picker to MP4 and the custom validation re-checks the uploaded asset
    // ref so a non-MP4 can never slip through.
    defineField({
      title: 'Video (MP4)',
      name: 'video',
      type: 'file',
      description:
        'Optional. When set, an MP4 renders as a looping autoplay video in place of the image. Must be an .mp4 file — the Image is used as poster/fallback.',
      options: {accept: 'video/mp4'},
      validation: (Rule) =>
        Rule.custom((value) => {
          const ref = value?.asset?._ref
          if (!ref) return true
          return ref.endsWith('-mp4') || 'Video must be an MP4 file.'
        }),
    }),
    // Same constrained rich-text title as the Detail document — bold/italic
    // decorators only. Replaces the old plain-string Title.
    stylizedTitleField({
      description: 'Optional title above the image. Supports bold and italic.',
    }),
    defineField({
      title: 'Text',
      name: 'text',
      type: 'richText',
    }),
  ],
  preview: {
    select: {media: 'image', stylizedTitle: 'stylizedTitle'},
    prepare({media, stylizedTitle}) {
      // Flatten the stylized-title blocks to plain text for the list preview.
      const title = (stylizedTitle ?? [])
        .map((b) => (b.children ?? []).map((c) => c.text ?? '').join(''))
        .join(' ')
        .trim()
      return {
        title: title || 'Image with Text',
        media,
      }
    },
  },
})
