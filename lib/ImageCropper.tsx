'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface ImageCropperProps {
  imageSrc: string
  onCrop: (croppedDataUrl: string) => void
  onCancel: () => void
}

export default function ImageCropper({ imageSrc, onCrop, onCancel }: ImageCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  
  const CROP_SIZE = 200 // Size of the crop area

  // Load the image
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImage(img)
      // Calculate initial scale to fit image in crop area
      const minDim = Math.min(img.width, img.height)
      const initialScale = CROP_SIZE / minDim
      setScale(Math.max(initialScale, 0.5))
      setPosition({ x: 0, y: 0 })
    }
    img.src = imageSrc
  }, [imageSrc])

  // Draw the image on canvas
  const drawImage = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !image) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate dimensions
    const scaledWidth = image.width * scale
    const scaledHeight = image.height * scale
    
    // Center position plus offset
    const x = (canvas.width - scaledWidth) / 2 + position.x
    const y = (canvas.height - scaledHeight) / 2 + position.y

    // Draw image
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight)

    // Draw dark overlay with circular cutout
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    
    // Cut out circle
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(canvas.width / 2, canvas.height / 2, CROP_SIZE / 2, 0, Math.PI * 2)
    ctx.fill()
    
    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over'
    
    // Draw circle border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(canvas.width / 2, canvas.height / 2, CROP_SIZE / 2, 0, Math.PI * 2)
    ctx.stroke()
  }, [image, scale, position])

  useEffect(() => {
    drawImage()
  }, [drawImage])

  // Handle mouse/touch events for dragging
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    })
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  // Handle zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setScale(prev => Math.max(0.2, Math.min(3, prev + delta)))
  }

  const handleZoomIn = () => setScale(prev => Math.min(3, prev + 0.2))
  const handleZoomOut = () => setScale(prev => Math.max(0.2, prev - 0.2))

  // Crop the image
  const handleCrop = () => {
    if (!image) return

    // Create a new canvas for the cropped image
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = 256  // Final output size
    cropCanvas.height = 256
    const cropCtx = cropCanvas.getContext('2d')
    if (!cropCtx) return

    // Calculate the crop area in image coordinates
    const canvas = canvasRef.current
    if (!canvas) return

    const scaledWidth = image.width * scale
    const scaledHeight = image.height * scale
    const imgX = (canvas.width - scaledWidth) / 2 + position.x
    const imgY = (canvas.height - scaledHeight) / 2 + position.y

    // Calculate source rectangle (in original image coordinates)
    const cropCenterX = canvas.width / 2
    const cropCenterY = canvas.height / 2
    
    const srcX = (cropCenterX - CROP_SIZE / 2 - imgX) / scale
    const srcY = (cropCenterY - CROP_SIZE / 2 - imgY) / scale
    const srcSize = CROP_SIZE / scale

    // Draw cropped and resized image
    cropCtx.drawImage(
      image,
      srcX, srcY, srcSize, srcSize,
      0, 0, 256, 256
    )

    // Convert to data URL with compression
    const croppedDataUrl = cropCanvas.toDataURL('image/jpeg', 0.85)
    onCrop(croppedDataUrl)
  }

  return (
    <div className="image-cropper-overlay">
      <div className="image-cropper-modal">
        <div className="image-cropper-header">
          <h3>Crop Photo</h3>
          <p>Drag to reposition, scroll to zoom</p>
        </div>
        
        <div 
          className="image-cropper-container" 
          ref={containerRef}
          onWheel={handleWheel}
        >
          <canvas
            ref={canvasRef}
            width={300}
            height={300}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          />
        </div>

        <div className="image-cropper-zoom">
          <button type="button" onClick={handleZoomOut} className="zoom-btn">−</button>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="zoom-slider"
          />
          <button type="button" onClick={handleZoomIn} className="zoom-btn">+</button>
        </div>

        <div className="image-cropper-actions">
          <button type="button" className="cropper-btn cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="cropper-btn confirm" onClick={handleCrop}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
