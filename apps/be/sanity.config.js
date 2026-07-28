import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {media} from 'sanity-plugin-media'
import {vercelDeployTool} from 'sanity-deploy'
import {desk} from './desk'

export default defineConfig({
  name: 'default',
  title: 'Diaa',
  projectId: '0in4i1po',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: desk,
    }),
    media(),
    visionTool(),
    vercelDeployTool(),
  ],

  schema: {
    types: schemaTypes,
  },
})
