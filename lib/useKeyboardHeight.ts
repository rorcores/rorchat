'use client'

import { useEffect, useState } from 'react'

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const handleResize = () => {
      // Calculate keyboard height as difference between window height and visual viewport height
      const keyboardH = window.innerHeight - visualViewport.height
      setKeyboardHeight(Math.max(0, keyboardH))
      
      // Set CSS custom property for use in styles
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${Math.max(0, keyboardH)}px`
      )
      
      // Also set the visual viewport height
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${visualViewport.height}px`
      )
    }
    
    const handleScroll = () => {
      // Prevent the page from scrolling when keyboard causes viewport offset
      // This keeps the fixed positioning working correctly
      if (visualViewport.offsetTop > 0) {
        window.scrollTo(0, 0)
      }
    }

    // Initial call
    handleResize()

    visualViewport.addEventListener('resize', handleResize)
    visualViewport.addEventListener('scroll', handleScroll)
    
    // Also handle regular window resize
    window.addEventListener('resize', handleResize)

    return () => {
      visualViewport.removeEventListener('resize', handleResize)
      visualViewport.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return keyboardHeight
}
