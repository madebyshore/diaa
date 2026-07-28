import {Card, Grid, Box, Container} from '@sanity/ui'
import {useClient} from 'sanity'
import {useEffect, useState} from 'react'

export default function GridBuilder(props) {
  const client = useClient()
  const [studies, setStudies] = useState({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const refs = props?.value?.map((item) => item?.study?._ref).filter(Boolean)

    if (refs?.length) {
      client.fetch(`*[_id in $ids]{_id, title, caseCover{asset->}}`, {ids: refs}).then((data) => {
        const map = {}
        data.forEach((doc) => {
          const aspect = doc.caseCover.asset.metadata.dimensions.aspectRatio
          const image = doc.caseCover.asset.url
          map[doc._id] = {title: doc.title, aspect: aspect, image: image}
        })
        setStudies(map)
      })
    }

    // console.log(props.value)
  }, [props, client])

  useEffect(() => {
    // console.log(studies)
    if (studies) setLoaded(true)
  }, [studies])

  return (
    <Container>
      <Card
        style={{
          border: '1px solid lightgray',
          borderRadius: '4px',
          aspectRatio: '1440/900',
          overflow: 'scroll',
          paddingBottom: 0,
        }}
        marginBottom={4}
      >
        {loaded && (
          <Grid columns={24} padding={2} style={{rowGap: '10px', columnGap: '2px'}}>
            {studies &&
              props?.value?.map((item, index) => (
                <Box
                  style={{
                    gridColumn: `${item.gridCol} / span ${item.gridSpan}`,
                    // border: `red solid 1px`,
                    // borderRadius: '8px',
                    gridRow: index + 1,
                    overflow: 'hidden',
                    aspectRatio: studies[item.study?._ref]?.aspect,
                  }}
                  key={index}
                >
                  {studies[item.study?._ref]?.image && (
                    <img
                      src={studies[item.study?._ref]?.image}
                      alt=""
                      style={{
                        // borderRadius: '4px',
                        height: '100%',
                        width: '100%',
                        verticalAlign: 'top',
                      }}
                    />
                  )}
                </Box>
              ))}
          </Grid>
        )}
      </Card>
      {props.renderDefault(props)}
    </Container>
  )
}
