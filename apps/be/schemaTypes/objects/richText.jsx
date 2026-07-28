import {defineType} from 'sanity'
import {BiText, BiFontFamily, BiTerminal} from 'react-icons/bi'

/**
 * Studio preview renderers for the custom font decorators. These run inside
 * the Sanity editor only — they render the selected text with the same
 * font-family the frontend will apply. Using system fonts here (serif /
 * monospace) since the studio doesn't load the site's @font-face files;
 * this gives editors a visible distinction without needing asset parity.
 */
const SerifDecorator = (props) => (
  <span style={{fontFamily: 'Georgia, serif'}}>{props.children}</span>
)

const MonoDecorator = (props) => (
  <span style={{fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'}}>
    {props.children}
  </span>
)

export default defineType({
  name: 'richText',
  title: 'Rich Text',
  type: 'array',
  icon: BiText,
  description: 'For line breaks, use Shift Enter. For paragraph breaks use Enter.',
  of: [
    {
      type: 'block',
      styles: [
        {title: 'Normal', value: 'normal'},
        {title: 'H1', value: 'h1'},
        {title: 'H2', value: 'h2'},
        {title: 'H3', value: 'h3'},
        {title: 'H4', value: 'h4'},
        {title: 'Quote', value: 'blockquote'},
      ],
      lists: [
        {title: 'Bullet', value: 'bullet'},
        {title: 'Numbered', value: 'number'},
      ],
      marks: {
        decorators: [
          {title: 'Strong', value: 'strong'},
          {title: 'Emphasis', value: 'em'},
          {title: 'Underline', value: 'underline'},
          {title: 'Code', value: 'code'},
          // Font-family toggles. Frontend maps these to `qt` (body/serif)
          // and `fxm` (mono) via the portable-text renderer — see
          // apps/fe/scripts/utils/portable-text.ts.
          {
            title: 'Serif',
            value: 'serif',
            icon: BiFontFamily,
            component: SerifDecorator,
          },
          {
            title: 'Mono',
            value: 'mono',
            icon: BiTerminal,
            component: MonoDecorator,
          },
        ],
        annotations: [
          {
            name: 'internalLink',
            type: 'internalLink',
          },
          {
            name: 'externalLink',
            type: 'externalLink',
          },
        ],
      },
    },
  ],
})
