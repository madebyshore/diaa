import {BiSliderAlt} from 'react-icons/bi'
import {defineField} from 'sanity'

export default {
  name: 'siteOptions',
  type: 'document',
  title: 'Global',
  icon: BiSliderAlt,
  groups: [
    {
      title: 'Site',
      name: 'page',
      default: true,
    },
    {
      title: 'Intro',
      name: 'intro',
    },
    {
      title: 'Footer',
      name: 'footer',
    },
    {
      title: 'Meta',
      name: 'meta',
    },
    {
      title: 'SEO',
      name: 'seo',
    },
  ],
  fields: [
    defineField({
      title: 'Site Title',
      name: 'name',
      type: 'string',
      validation: (Rule) => Rule.required(),
      group: 'page',
    }),
    /* intro */
    defineField({
      title: 'Intro Text',
      name: 'introText',
      type: 'array',
      description:
        'Phrases shown in the intro overlay. The intro picks one at random on each load and plays it as its own centered beat before the logotype. Defaults to “Design, interiors, architecture, atmosphere” when left empty.',
      of: [{type: 'string'}],
      initialValue: ['Design, interiors, architecture, atmosphere'],
      group: 'intro',
    }),
    /* footer */
    defineField({
      title: 'Footer Links',
      name: 'footerLinks',
      type: 'array',
      description:
        'Rendered on the home page below the grid, comma-separated. Pick Internal Link to reference another singleton/document, or External Link for an arbitrary URL.',
      of: [{type: 'internalLink'}, {type: 'externalLink'}],
      group: 'footer',
    }),
    /* meta */
    defineField({
      title: 'Favicon',
      name: 'favicon',
      type: 'image',
      description:
        'Browser tab icon, also used as the Apple touch icon. Upload a square PNG or SVG, at least 180×180.',
      group: 'meta',
    }),
    defineField({
      title: 'OG Image',
      name: 'ogImage',
      type: 'image',
      description:
        'Default social-share image (Open Graph / Twitter) for every page that does not set its own in its SEO tab. 1200×630 recommended.',
      group: 'meta',
    }),
    /* seo */
    defineField({
      title: 'Language Code',
      description:
        'ISO 639-1 Language Codes (i.e. “de” or “en”), can be country specific (i.e. “en-us”)',
      name: 'language',
      type: 'string',
      group: 'seo',
    }),
    defineField({
      title: 'SEO',
      name: 'seo',
      type: 'seo',
      group: 'seo',
    }),
  ],
  preview: {
    prepare() {
      return {
        title: 'Global',
      }
    },
  },
}
