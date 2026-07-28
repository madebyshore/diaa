import React, {useState, useRef, useEffect, useCallback, useMemo} from 'react'
import {Stack, Box, Card, Button, Flex, Text, Grid} from '@sanity/ui'
import {AddIcon, TrashIcon, ImageIcon} from '@sanity/icons'
import {set, setIfMissing} from 'sanity'
import {useClient} from 'sanity'
import imageUrlBuilder from '@sanity/image-url'

// Remove the import from sanity/assets
// import {useAssetSources} from 'sanity/assets'

const ImagePositioner = (props) => {
  const {onChange, value = {}} = props
  const [selectedImageIndex, setSelectedImageIndex] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({x: 0, y: 0})
  const canvasRef = useRef(null)
  const client = useClient({apiVersion: '2023-06-21'})

  // In Sanity v3, the asset sources functionality is available directly on the client
  // instead of using useAssetSources hook

  // Get project details from client config instead of useProjectConfig
  const projectId = client.config().projectId
  const dataset = client.config().dataset

  // Extract layout values or use defaults
  const layout = value?.layout || {}
  const canvasWidth = layout.canvasWidth || 500
  const canvasHeight = layout.canvasHeight || 500
  // Memoize images to stabilize the reference across renders — prevents
  // useCallback deps from changing every render when layout.images is undefined.
  const images = useMemo(() => layout.images || [], [layout.images])

  // Image URL builder for previews (optimized)
  const urlBuilder = useMemo(() => imageUrlBuilder({projectId, dataset}), [projectId, dataset])
  const buildImageUrl = (image, opts = {}) => {
    if (!image) return null
    let b = urlBuilder.image(image)
    if (opts.width) b = b.width(opts.width)
    if (opts.height) b = b.height(opts.height)
    if (opts.fit) b = b.fit(opts.fit)
    // Prefer modern format and reasonable quality for Studio previews
    b = b.format(opts.format || 'webp')
    if (typeof opts.quality === 'number') b = b.quality(opts.quality)
    return b.url()
  }

  // Handle canvas click for deselection
  const handleCanvasClick = (e) => {
    if (e.target === canvasRef.current) {
      setSelectedImageIndex(null)
    }
  }

  // Handle image selection
  const handleImageClick = (index, e) => {
    e.stopPropagation()
    setSelectedImageIndex(index)
  }

  // Improved mouse down handler for dragging
  const handleMouseDown = (index, e) => {
    if (index === selectedImageIndex && canvasRef.current) {
      e.preventDefault()
      setIsDragging(true)

      const imageElement = e.currentTarget.getBoundingClientRect()

      // Calculate click offset relative to the image element (as percentage of image size)
      const offsetX = (e.clientX - imageElement.left) / imageElement.width
      const offsetY = (e.clientY - imageElement.top) / imageElement.height

      setDragOffset({x: offsetX, y: offsetY})
    }
  }

  // Improved mouse move handler for smoother, contained dragging
  const handleMouseMove = useCallback(
    (e) => {
      if (isDragging && selectedImageIndex !== null && canvasRef.current) {
        const canvas = canvasRef.current.getBoundingClientRect()
        const selectedImage = images[selectedImageIndex]
        const imageWidth = selectedImage.width || 20
        const imageHeight = selectedImage.height || 20

        // Calculate position in canvas coordinate space
        const mouseXInCanvas = e.clientX - canvas.left
        const mouseYInCanvas = e.clientY - canvas.top

        // Convert to percentage of canvas, accounting for the offset within the image
        const newXPercent = (mouseXInCanvas / canvas.width) * 100 - dragOffset.x * imageWidth
        const newYPercent = (mouseYInCanvas / canvas.height) * 100 - dragOffset.y * imageHeight

        // Constrain to canvas boundaries, preventing image from going outside canvas
        const xConstrained = Math.max(0, Math.min(100 - imageWidth, newXPercent))
        const yConstrained = Math.max(0, Math.min(100 - imageHeight, newYPercent))

        // Update image position
        const updatedImages = [...images]
        updatedImages[selectedImageIndex] = {
          ...updatedImages[selectedImageIndex],
          x: xConstrained,
          y: yConstrained,
        }

        // Update the value
        onChange([setIfMissing({}, ['layout']), set(updatedImages, ['layout', 'images'])])
      }
    },
    [isDragging, selectedImageIndex, dragOffset, images, onChange],
  )

  // Handle dragging end
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Add mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Add a new image
  const handleAddImage = () => {
    const newImage = {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      zIndex: 0,
    }

    const updatedImages = [...images, newImage]

    onChange([setIfMissing({}, ['layout']), set(updatedImages, ['layout', 'images'])])

    // Select the newly added image
    setSelectedImageIndex(images.length)
  }

  // Remove selected image
  const handleRemoveImage = () => {
    if (selectedImageIndex !== null) {
      const updatedImages = [...images]
      updatedImages.splice(selectedImageIndex, 1)

      onChange([setIfMissing({}, ['layout']), set(updatedImages, ['layout', 'images'])])

      setSelectedImageIndex(null)
    }
  }

  // Update image properties with constraints
  const handleUpdateImageProperty = (index, property, newValue) => {
    const updatedImages = [...images]
    if (!updatedImages[index]) {
      updatedImages[index] = {}
    }

    // Apply specific constraints based on property
    let constrainedValue = newValue

    if (property === 'x' || property === 'y') {
      // For position, ensure it stays within canvas
      const width = updatedImages[index].width || 20
      const height = updatedImages[index].height || 20

      if (property === 'x') {
        constrainedValue = Math.max(0, Math.min(100 - width, newValue))
      } else {
        constrainedValue = Math.max(0, Math.min(100 - height, newValue))
      }
    } else if (property === 'width' || property === 'height') {
      // For dimensions, ensure they're positive and don't push image outside canvas
      constrainedValue = Math.max(1, Math.min(100, newValue))

      const x = updatedImages[index].x || 0
      const y = updatedImages[index].y || 0

      // If new dimension would push image outside canvas, adjust position
      if (property === 'width' && x + constrainedValue > 100) {
        updatedImages[index].x = 100 - constrainedValue
      } else if (property === 'height' && y + constrainedValue > 100) {
        updatedImages[index].y = 100 - constrainedValue
      }
    }

    updatedImages[index] = {
      ...updatedImages[index],
      [property]: typeof constrainedValue === 'number' ? constrainedValue : constrainedValue,
    }

    onChange([setIfMissing({}, ['layout']), set(updatedImages, ['layout', 'images'])])
  }

  // Update canvas dimensions
  const handleCanvasSizeChange = (dimension, newValue) => {
    onChange([setIfMissing({}, ['layout']), set(Math.max(50, newValue), ['layout', dimension])])
  }

  // Handle image selection using Sanity's asset selector
  // Updated for Sanity v3
  const handleSelectImage = (index) => {
    // In Sanity v3, we use the client directly to select assets
    client.assets
      .upload('image', {
        storeOriginalFilename: true,
        preserveFilename: true,
      })
      .then((asset) => {
        if (asset) {
          // Create proper image object with reference
          const imageValue = {
            _type: 'image',
            asset: {
              _type: 'reference',
              _ref: asset._id,
            },
          }

          // Update the image property for the selected index
          handleUpdateImageProperty(index, 'image', imageValue)
        }
      })
      .catch((error) => {
        console.error('Upload failed:', error)
      })
  }

  return (
    <Stack space={4}>
      <Card padding={4} radius={2} shadow={1}>
        <Stack space={4}>
          <Text weight="semibold" size={2}>
            Canvas Settings
          </Text>

          <Flex gap={3}>
            <Box flex={1}>
              <Text size={1}>Width</Text>
              <input
                type="number"
                value={canvasWidth}
                onChange={(e) => handleCanvasSizeChange('canvasWidth', Number(e.target.value))}
                style={{width: '100%', padding: '8px'}}
                min="50"
              />
            </Box>
            <Box flex={1}>
              <Text size={1}>Height</Text>
              <input
                type="number"
                value={canvasHeight}
                onChange={(e) => handleCanvasSizeChange('canvasHeight', Number(e.target.value))}
                style={{width: '100%', padding: '8px'}}
                min="50"
              />
            </Box>
          </Flex>
        </Stack>
      </Card>

      <Card padding={4} radius={2} shadow={1}>
        <Stack space={4}>
          <Flex align="center" justify="space-between">
            <Text weight="semibold" size={2}>
              Image Positioning
            </Text>
            <Flex gap={2}>
              <Button icon={AddIcon} text="Add Image" onClick={handleAddImage} tone="positive" />
              <Button
                icon={TrashIcon}
                text="Remove Selected"
                onClick={handleRemoveImage}
                tone="critical"
                disabled={selectedImageIndex === null}
              />
            </Flex>
          </Flex>

          <Box
            style={{
              position: 'relative',
              width: '100%',
              height: `${canvasHeight}px`,
              maxWidth: '100%',
              border: '1px solid #ccc',
              backgroundColor: '#f3f3f3',
              overflow: 'hidden',
            }}
            ref={canvasRef}
            onClick={handleCanvasClick}
          >
            {images.map((img, index) => {
              const pxW = Math.max(1, Math.round(((img.width || 20) / 100) * canvasWidth))
              const pxH = Math.max(1, Math.round(((img.height || 20) / 100) * canvasHeight))
              const imageUrl = img.image
                ? buildImageUrl(img.image, {width: pxW, height: pxH, fit: 'crop', quality: 80})
                : null

              return (
                <div
                  key={index}
                  style={{
                    position: 'absolute',
                    left: `${img.x || 0}%`,
                    top: `${img.y || 0}%`,
                    width: `${img.width || 20}%`,
                    height: `${img.height || 20}%`,
                    zIndex: img.zIndex || 0,
                    border: selectedImageIndex === index ? '2px solid #2276FC' : '1px solid #ddd',
                    backgroundColor: imageUrl ? 'transparent' : '#e1e1e1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: selectedImageIndex === index ? 'move' : 'pointer',
                    overflow: 'hidden',
                    userSelect: 'none',
                    touchAction: 'none',
                  }}
                  onClick={(e) => handleImageClick(index, e)}
                  onMouseDown={(e) => handleMouseDown(index, e)}
                >
                  {imageUrl ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt="Positioned content"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center',
                          pointerEvents: 'none', // This prevents the image from interfering with drag events
                        }}
                      />
                      {selectedImageIndex === index && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            padding: '4px',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            fontSize: '12px',
                            textAlign: 'center',
                          }}
                        >
                          Selected
                        </div>
                      )}
                    </div>
                  ) : (
                    <Text size={1}>No image selected</Text>
                  )}
                </div>
              )
            })}
          </Box>

          {selectedImageIndex !== null && (
            <Card padding={3} radius={2} tone="primary" marginTop={4}>
              <Stack space={3}>
                <Text weight="semibold">Edit Selected Image</Text>

                <Grid columns={[1, 2, 2]} gap={3}>
                  <Box>
                    <Text size={1}>X Position (%)</Text>
                    <input
                      type="number"
                      min="0"
                      max={100 - (images[selectedImageIndex]?.width || 20)}
                      value={images[selectedImageIndex]?.x || 0}
                      onChange={(e) =>
                        handleUpdateImageProperty(selectedImageIndex, 'x', Number(e.target.value))
                      }
                      style={{width: '100%', padding: '8px'}}
                    />
                  </Box>
                  <Box>
                    <Text size={1}>Y Position (%)</Text>
                    <input
                      type="number"
                      min="0"
                      max={100 - (images[selectedImageIndex]?.height || 20)}
                      value={images[selectedImageIndex]?.y || 0}
                      onChange={(e) =>
                        handleUpdateImageProperty(selectedImageIndex, 'y', Number(e.target.value))
                      }
                      style={{width: '100%', padding: '8px'}}
                    />
                  </Box>
                  <Box>
                    <Text size={1}>Width (%)</Text>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={images[selectedImageIndex]?.width || 20}
                      onChange={(e) =>
                        handleUpdateImageProperty(
                          selectedImageIndex,
                          'width',
                          Number(e.target.value),
                        )
                      }
                      style={{width: '100%', padding: '8px'}}
                    />
                  </Box>
                  <Box>
                    <Text size={1}>Height (%)</Text>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={images[selectedImageIndex]?.height || 20}
                      onChange={(e) =>
                        handleUpdateImageProperty(
                          selectedImageIndex,
                          'height',
                          Number(e.target.value),
                        )
                      }
                      style={{width: '100%', padding: '8px'}}
                    />
                  </Box>
                  <Box>
                    <Text size={1}>Z-Index</Text>
                    <input
                      type="number"
                      value={images[selectedImageIndex]?.zIndex || 0}
                      onChange={(e) =>
                        handleUpdateImageProperty(
                          selectedImageIndex,
                          'zIndex',
                          Number(e.target.value),
                        )
                      }
                      style={{width: '100%', padding: '8px'}}
                    />
                  </Box>
                  <Box>
                    <Text size={1}>Image</Text>
                    <Button
                      icon={ImageIcon}
                      text="Select Image"
                      tone="primary"
                      mode="ghost"
                      onClick={() => handleSelectImage(selectedImageIndex)}
                      style={{marginTop: '5px', width: '100%'}}
                    />
                    {images[selectedImageIndex]?.image && (
                      <Text size={1} style={{marginTop: '5px'}}>
                        Image selected
                      </Text>
                    )}
                  </Box>
                </Grid>
              </Stack>
            </Card>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}

export default ImagePositioner
