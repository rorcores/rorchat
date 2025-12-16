// Client-side image processing utilities
// Handles resizing, compression, and validation for profile pics and chat images

export const IMAGE_CONFIG = {
  profile: {
    maxWidth: 256,
    maxHeight: 256,
    maxSizeKB: 150,
    quality: 0.85,
  },
  chat: {
    maxWidth: 1200,
    maxHeight: 1200,
    maxSizeKB: 500,
    quality: 0.8,
  },
} as const

export type ImageType = keyof typeof IMAGE_CONFIG

export interface ProcessedImage {
  dataUrl: string
  width: number
  height: number
  sizeKB: number
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE_MB = 10 // Max upload before processing

/**
 * Validates that a file is an allowed image type and size
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Please select a JPEG, PNG, GIF, or WebP image' }
  }
  
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { valid: false, error: `Image must be under ${MAX_FILE_SIZE_MB}MB` }
  }
  
  return { valid: true }
}

/**
 * Loads an image file and returns an HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Calculates new dimensions maintaining aspect ratio
 */
function calculateDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  // If image is smaller than max, keep original size
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height }
  }
  
  const ratio = Math.min(maxWidth / width, maxHeight / height)
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  }
}

/**
 * Compresses image to target size by reducing quality iteratively
 */
function compressToSize(
  canvas: HTMLCanvasElement,
  maxSizeKB: number,
  initialQuality: number
): string {
  let quality = initialQuality
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  
  // Iteratively reduce quality until we're under the size limit
  while (dataUrl.length > maxSizeKB * 1024 * 1.37 && quality > 0.3) {
    // 1.37 accounts for base64 overhead
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  
  return dataUrl
}

/**
 * Process an image file: resize and compress for the specified use case
 */
export async function processImage(
  file: File,
  type: ImageType
): Promise<ProcessedImage> {
  const config = IMAGE_CONFIG[type]
  
  // Load the image
  const img = await loadImage(file)
  
  // Calculate new dimensions
  const { width, height } = calculateDimensions(
    img.width,
    img.height,
    config.maxWidth,
    config.maxHeight
  )
  
  // Create canvas and draw resized image
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get canvas context')
  }
  
  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  
  // Compress to target size
  const dataUrl = compressToSize(canvas, config.maxSizeKB, config.quality)
  
  // Calculate final size
  const sizeKB = Math.round((dataUrl.length * 0.73) / 1024) // 0.73 removes base64 overhead
  
  // Clean up
  URL.revokeObjectURL(img.src)
  
  return {
    dataUrl,
    width,
    height,
    sizeKB,
  }
}

// Allowed MIME types for server-side validation (no SVG - potential XSS vector)
const ALLOWED_MIME_TYPES_SERVER = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Server-side validation for base64 image data
 */
export function validateBase64Image(dataUrl: string, type: ImageType): { valid: boolean; error?: string } {
  // Check it's a valid data URL format
  if (!dataUrl.startsWith('data:image/')) {
    return { valid: false, error: 'Invalid image format' }
  }
  
  // Extract and validate MIME type (only allow jpeg, png, webp - no svg/gif)
  const mimeMatch = dataUrl.match(/^data:(image\/[a-z]+);base64,/)
  if (!mimeMatch) {
    return { valid: false, error: 'Invalid image data format' }
  }
  
  const mimeType = mimeMatch[1]
  if (!ALLOWED_MIME_TYPES_SERVER.includes(mimeType)) {
    return { valid: false, error: 'Only JPEG, PNG, and WebP images are allowed' }
  }
  
  // Extract the base64 part
  const base64 = dataUrl.split(',')[1]
  if (!base64) {
    return { valid: false, error: 'Invalid image data' }
  }
  
  // Validate base64 is properly formatted (only valid base64 chars)
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
  if (!base64Regex.test(base64)) {
    return { valid: false, error: 'Invalid base64 encoding' }
  }
  
  // Check minimum length (prevent empty/tiny images that aren't real)
  if (base64.length < 100) {
    return { valid: false, error: 'Image data too small' }
  }
  
  // Check size (base64 is ~33% larger than binary)
  const config = IMAGE_CONFIG[type]
  const estimatedSizeKB = (base64.length * 0.73) / 1024
  const maxAllowedKB = config.maxSizeKB * 1.5 // Allow some buffer
  
  if (estimatedSizeKB > maxAllowedKB) {
    return { valid: false, error: `Image too large (${Math.round(estimatedSizeKB)}KB > ${maxAllowedKB}KB max)` }
  }
  
  return { valid: true }
}

/**
 * Extract dimensions from a base64 image (server-side approximation)
 * Note: This is a rough check, actual validation happens client-side
 */
export function getImageMimeType(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,/)
  return match ? match[1] : null
}
