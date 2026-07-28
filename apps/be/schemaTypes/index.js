import siteOptions from './documents/site/siteOptions'
import seo from './objects/seo'
import internalLink from './objects/internalLink'
import externalLink from './objects/externalLink'
import cta from './objects/cta'
import pageHome from './documents/singletons/pageHome'
import pageContact from './documents/singletons/pageContact'
import pageImprint from './documents/singletons/pageImprint'
import detail from './documents/collections/detail'
import taxonomy from './documents/collections/taxonomy'
import slices from './slices'
import textBlock from './objects/textBlock'
import richText from './objects/richText.jsx'
import imageWithCaption from './objects/imageWithCaption'

export const schemaTypes = [
  siteOptions,
  seo,
  internalLink,
  externalLink,
  cta,
  pageHome,
  pageContact,
  pageImprint,
  detail,
  taxonomy,
  textBlock,
  richText,
  imageWithCaption,
  ...slices,
]
