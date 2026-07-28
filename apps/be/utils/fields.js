import {defineField} from 'sanity'

// Shared Aspect-ratio options. Values use `x` instead of `:` so they're safe as
// data keys and CSS class fragments on the front end.
export const ASPECT_OPTIONS = [
  {title: '3:2', value: '3x2'},
  {title: '3:4', value: '3x4'},
  {title: '2:3', value: '2x3'},
  {title: '4:3', value: '4x3'},
]

// Returns the shared Aspect dropdown field used across image slices. Pass
// overrides to tweak per slice (e.g. a different initialValue).
export const aspectField = ({allowed, ...overrides} = {}) =>
  defineField({
    title: 'Aspect',
    name: 'aspect',
    type: 'string',
    options: {
      // `allowed` (array of values) narrows the dropdown to a subset — e.g.
      // the Image-with-Text slice only supports 3:2 and 3:4.
      list: allowed ? ASPECT_OPTIONS.filter((o) => allowed.includes(o.value)) : ASPECT_OPTIONS,
      layout: 'dropdown',
    },
    initialValue: '3x4',
    validation: (Rule) => Rule.required(),
    ...overrides,
  })

// Returns the shared Stylized Title field: Portable Text constrained to a
// single normal-style block with only bold/italic decorators — no headings,
// lists, or links. The front end renders it via renderPortableText so
// <strong>/<em> runs survive (e.g. an italicized "(In Progress)" suffix).
// Used by the Detail document and the Image-with-Text slice; pass overrides
// (description, group, ...) to tweak per usage.
export const stylizedTitleField = (overrides = {}) =>
  defineField({
    title: 'Stylized Title',
    name: 'stylizedTitle',
    type: 'array',
    of: [
      {
        type: 'block',
        styles: [{title: 'Normal', value: 'normal'}],
        lists: [],
        marks: {
          decorators: [
            {title: 'Strong', value: 'strong'},
            {title: 'Emphasis', value: 'em'},
          ],
          annotations: [],
        },
      },
    ],
    ...overrides,
  })

// Returns the shared Size dropdown field. `Small` is included by default but can
// be omitted on slices that only render at Mid or Large (`includeSmall: false`).
export const sizeField = ({includeSmall = true, ...overrides} = {}) =>
  defineField({
    title: 'Size',
    name: 'size',
    type: 'string',
    options: {
      list: [
        {title: 'Large', value: 'lg'},
        {title: 'Mid', value: 'mid'},
        ...(includeSmall ? [{title: 'Small', value: 'sm'}] : []),
      ],
      layout: 'dropdown',
    },
    initialValue: 'mid',
    validation: (Rule) => Rule.required(),
    ...overrides,
  })
