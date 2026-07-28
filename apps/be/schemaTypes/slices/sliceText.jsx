import {defineField, defineType, useFormValue} from 'sanity'
import {BiText} from 'react-icons/bi'
import {Box, Text} from '@sanity/ui'

// Field wrapper for the Text slice's rich-text body. Renders the standard field,
// then — only when the slice's Variant is "Quote" — appends a reminder under the
// input that the quotation marks are added on the front end, not in the copy.
function QuoteTextField(props) {
  // `props.path` points at the `text` field; swapping the last segment for
  // `variant` reads the sibling dropdown. The array `_key` baked into the path
  // keeps this correct for any slice instance.
  const variantPath = [...props.path.slice(0, -1), 'variant']
  const variant = useFormValue(variantPath)
  return (
    <>
      {props.renderDefault(props)}
      {variant === 'quote' && (
        <Box marginTop={2}>
          <Text size={1} muted>
            {"Please don't add quotes, these will be added via the front end"}
          </Text>
        </Box>
      )}
    </>
  )
}

// Text slice — a rich-text block with a Variant dropdown that sets how it
// renders: Plain (body copy), Quote (pull-quote, reveals a Quote Author field +
// a front-end-quotes reminder), or Credits (credit list). The body uses the
// shared `richText` type.
export default defineType({
  name: 'sliceText',
  title: 'Text',
  type: 'object',
  icon: BiText,
  fields: [
    defineField({
      title: 'Variant',
      name: 'variant',
      type: 'string',
      options: {
        list: [
          {title: 'Plain', value: 'plain'},
          {title: 'Quote', value: 'quote'},
          {title: 'Credits', value: 'credits'},
        ],
        layout: 'dropdown',
      },
      initialValue: 'plain',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      title: 'Text',
      name: 'text',
      type: 'richText',
      validation: (Rule) => Rule.required(),
      components: {field: QuoteTextField},
    }),
    defineField({
      title: 'Quote Author',
      name: 'quoteAuthor',
      type: 'string',
      // Only relevant for the Quote variant — hidden otherwise.
      hidden: ({parent}) => parent?.variant !== 'quote',
    }),
  ],
  preview: {
    select: {variant: 'variant', text: 'text'},
    // Surface the body's plain text as the preview title so editors can tell
    // text blocks apart in the slice list; fall back to the type name.
    prepare({variant, text}) {
      const plain = Array.isArray(text)
        ? text
            .filter((block) => block._type === 'block')
            .map((block) => (block.children || []).map((child) => child.text).join(''))
            .join(' ')
            .trim()
        : ''
      return {
        title: plain || 'Text',
        subtitle: variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : '',
      }
    },
  },
})
