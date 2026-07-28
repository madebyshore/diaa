import studio from '@sanity/eslint-config-studio'
import globals from 'globals'

export default [
  ...studio,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Sanity studio components don't use prop-types — types come from Sanity schemas
      'react/prop-types': 'off',
    },
  },
]
