'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastHeightRef = useRef<number>(typeof window !== 'undefined' ? window.innerHeight : 0)
  const isAnimatingRef = useRef(false)

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const visualViewport = window.visualViewport
    if (!visualViewport) return

    // Set initial height
    lastHeightRef.current = window.innerHeight
    document.documentElement.style.setProperty(
      '--visual-viewport-height',
      `${window.innerHeight}px`
    )

    const applyHeight = (height: number) => {
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${height}px`
      )
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${Math.max(0, window.innerHeight - height)}px`
      )
      setKeyboardHeight(Math.max(0, window.innerHeight - height))
      lastHeightRef.current = height
    }

    const handleResize = () => {
      const newHeight = visualViewport.height
      
      // If height changed significantly (keyboard opening/closing)
      if (Math.abs(newHeight - lastHeightRef.current) > 50) {
        // Clear any pending timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        
        // Mark as animating
        isAnimatingRef.current = true
        
        // Debounce: wait for animation to settle before applying
        timeoutRef.current = setTimeout(() => {
          applyHeight(visualViewport.height)
          isAnimatingRef.current = false
          
          // Scroll messages to bottom after resize settles
          requestAnimationFrame(() => {
            const messagesContainer = document.querySelector('.messages-container')
            if (messagesContainer) {
              messagesContainer.scrollTop = messagesContainer.scrollHeight
            }
          })
        }, 150)
      } else if (!isAnimatingRef.current) {
        // Small change and not animating - apply immediately
        applyHeight(newHeight)
      }
    }
    
    const handleScroll = () => {
      // Prevent the page from scrolling when keyboard causes viewport offset
      if (visualViewport.offsetTop > 0) {
        window.scrollTo(0, 0)
      }
    }

    visualViewport.addEventListener('resize', handleResize)
    visualViewport.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleResize)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      visualViewport.removeEventListener('resize', handleResize)
      visualViewport.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return keyboardHeight
}
