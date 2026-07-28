import {defineType} from 'sanity'
import sliceImage from './sliceImage'
import sliceImageWithText from './sliceImageWithText'
import slice2Up from './slice2Up'
import slice3Up from './slice3Up'
import sliceText from './sliceText'
import sliceImageSlideshow from './sliceImageSlideshow'

// Slice schemas — register each slice schema here as you add it. Order here is
// the order they appear in the document's "Add item" picker.
const sliceList = [
  sliceImage,
  sliceImageWithText,
  slice2Up,
  slice3Up,
  sliceText,
  sliceImageSlideshow,
]

// Generic `slices` array — accepts any registered slice. Documents that want
// the full picker reference `type: 'slices'`.
const slices = defineType({
  name: 'slices',
  title: 'Slices',
  type: 'array',
  of: sliceList.map((slice) => ({type: slice.name})),
})

export default [...sliceList, slices]
