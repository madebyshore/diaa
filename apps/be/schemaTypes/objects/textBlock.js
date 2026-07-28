import {defineType} from 'sanity'
import {BiText} from 'react-icons/bi'

export default defineType({
  name: 'textBlock',
  title: 'Text Block',
  type: 'array',
  icon: BiText,
  of: [
    {
      type: 'block',
      styles: [{title: 'Normal', value: 'normal'}],
      marks: {
        // Only allow these decorators
        decorators: [
          {title: 'Strong', value: 'strong'},
          {title: 'Emphasis', value: 'em'},
        ],
      },
    },
  ],
  preview: {
    prepare() {
      return {
        title: 'Text Block',
      }
    },
  },
})
