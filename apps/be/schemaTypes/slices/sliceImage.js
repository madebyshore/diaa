import {defineField, defineType} from 'sanity'
import {BiImage} from 'react-icons/bi'
import {aspectField, sizeField} from '../../utils/fields.js'

// Hidden when `full` is on — a full-screen image ignores Aspect/Size.
const hiddenWhenFull = ({parent}) => parent?.full === true

// Required only when NOT full (the field is hidden in full mode, so requiring a
// value the editor can't see would be a publish trap).
const requiredUnlessFull = (Rule) =>
  Rule.custom((value, context) => (context?.parent?.full || value ? true : 'Required'))

// Image slice — a single positioned image. Aspect controls the ratio; Size
// controls how large it sits in the layout. Small is omitted: a lone image only
// renders at Mid or Large. Toggle `full` for a full-screen image, which hides
// the Aspect/Size controls.
export default defineType({
  name: 'sliceImage',
  title: 'Image',
  type: 'object',
  icon: BiImage,
  fields: [
    defineField({
      title: 'Full',
      name: 'full',
      type: 'boolean',
      description: 'Toggle this for a full screen image.',
      initialValue: false,
    }),
    aspectField({hidden: hiddenWhenFull, validation: requiredUnlessFull}),
    sizeField({includeSmall: false, hidden: hiddenWhenFull, validation: requiredUnlessFull}),
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
  ],
  preview: {
    select: {media: 'image', aspect: 'aspect', size: 'size', full: 'full'},
    prepare({media, aspect, size, full}) {
      return {
        title: 'Image',
        subtitle: full ? 'Full screen' : [aspect, size].filter(Boolean).join(' · '),
        media,
      }
    },
  },
})
