import { Stack, Text } from '@sanity/ui'
import type { ReactNode } from 'react'

type Props = {
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
}

// Drop-in replacement for `FormField` from `sanity`. The Studio-provided
// FormField requires DocumentDivergencesContext (only present inside the
// document form), so calling it from a Tool view crashes at mount. This
// shim renders the same title/description/control layout using only
// @sanity/ui primitives — no Studio form context required.
export function FormField({ title, description, children }: Props) {
  return (
    <Stack space={2}>
      {title ? (
        <Text as="label" size={1} weight="medium">
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text size={1} muted>
          {description}
        </Text>
      ) : null}
      {children}
    </Stack>
  )
}
