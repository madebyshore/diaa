import {defineField, defineType} from 'sanity'
import {BiImage} from 'react-icons/bi'
import {ASPECT_OPTIONS, aspectField} from '../../utils/fields.js'

// Hidden when `full` is on — a full-screen image ignores Aspect.
const hiddenWhenFull = ({parent}) => parent?.full === true

// Required only when NOT full (the field is hidden in full mode, so requiring a
// value the editor can't see would be a publish trap).
const requiredUnlessFull = (Rule) =>
  Rule.custom((value, context) => (context?.parent?.full || value ? true : 'Required'))

// Image slice — a single positioned image. Aspect is 3:4 or 4:3 (cropped to
// that ratio) or one of the two Open aspect options (uncropped — Vertical
// sits at the 3:4 width, Horizontal at the 4:3 width, and the height follows
// the uploaded image's own proportions). Each
// aspect has exactly one rendered size per breakpoint (the old Small/Large
// dropdown is gone — 4:3 renders at the former Small span on desktop and
// full width on tablet/mobile; legacy stored `size` values are ignored by
// the frontend resolver). Toggle `full` for a full-screen 3:2 image, which
// hides the Aspect control.
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
    aspectField({
      allowed: ['3x4', '4x3', 'open-v', 'open-h'],
      description:
        '3:4 and 4:3 crop the image to that ratio. Open aspect keeps the image at its own proportions: Vertical is as wide as a 3:4 image, Horizontal as wide as a 4:3 image.',
      hidden: hiddenWhenFull,
      validation: requiredUnlessFull,
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
    // Optional small caption under the image — same treatment as the 2Up/3Up
    // captions. Hidden for full-screen images, which never show one.
    defineField({
      title: 'Caption',
      name: 'caption',
      type: 'richText',
      description: 'Optional. A small caption shown under the image.',
      hidden: hiddenWhenFull,
    }),
  ],
  preview: {
    select: {media: 'image', aspect: 'aspect', full: 'full'},
    prepare({media, aspect, full}) {
      // Show the editor-facing option title ("3:4", "Open aspect — Vertical")
      // rather than the stored value ("3x4", "open-v").
      const label = ASPECT_OPTIONS.find((o) => o.value === aspect)?.title ?? aspect
      const subtitle = full ? 'Full screen' : label
      return {
        title: 'Image',
        subtitle,
        media,
      }
    },
  },
})
