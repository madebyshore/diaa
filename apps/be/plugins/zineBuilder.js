import {definePlugin} from 'sanity'

import builder from './builder'

export const zineBuilder = definePlugin({
  name: 'zine-builder',
  schema: {
    types: [builder],
  },
})
