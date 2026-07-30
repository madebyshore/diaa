import {defineField, defineType} from 'sanity'
import {BiImage} from 'react-icons/bi'
import {aspectField, sizeField} from '../../utils/fields.js'

// Hidden when `full` is on — a full-screen image ignores Aspect/Size.
const hiddenWhenFull = ({parent}) => parent?.full === true

// Size only applies to 4:3 — 3:4 renders at a single fixed size — and never
// in full mode, so the dropdown hides everywhere else.
const hiddenUnlessFourByThree = ({parent}) => parent?.full === true || parent?.aspect !== '4x3'

// Required only when NOT full (the field is hidden in full mode, so requiring a
// value the editor can't see would be a publish trap).
const requiredUnlessFull = (Rule) =>
  Rule.custom((value, context) => (context?.parent?.full || value ? true : 'Required'))

// Size is only visible (and therefore only required) for a non-full 4:3 image —
// same hidden-field-can't-be-required reasoning as requiredUnlessFull.
const requiredWhenFourByThree = (Rule) =>
  Rule.custom((value, context) =>
    context?.parent?.full || context?.parent?.aspect !== '4x3' || value ? true : 'Required',
  )

// Image slice — a single positioned image. Aspect is 3:4 or 4:3 only; Size
// (Small / Large) exists only for 4:3 — a 3:4 image has one fixed layout size.
// Toggle `full` for a full-screen 3:2 image, which hides both controls.
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
      description: 'Toggle this for a full screen image (3:2).',
      initialValue: false,
    }),
    aspectField({allowed: ['3x4', '4x3'], hidden: hiddenWhenFull, validation: requiredUnlessFull}),
    sizeField({
      description: 'Only for 4:3 images — 3:4 renders at a single fixed size.',
      options: {
        list: [
          {title: 'Small', value: 'sm'},
          {title: 'Large', value: 'lg'},
        ],
        layout: 'dropdown',
      },
      initialValue: 'sm',
      hidden: hiddenUnlessFourByThree,
      validation: requiredWhenFourByThree,
    }),
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
      // Size is only meaningful for 4:3 — don't echo a stale/hidden value on 3:4.
      const subtitle = full
        ? 'Full screen'
        : aspect === '4x3'
          ? [aspect, size].filter(Boolean).join(' · ')
          : aspect
      return {
        title: 'Image',
        subtitle,
        media,
      }
    },
  },
})
