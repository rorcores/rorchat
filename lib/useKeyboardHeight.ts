'use client'

import { useEffect, useState, useRef } from 'react'

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const prevHeightRef = useRef(0)

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') return

    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const handleResize = () => {
      // Calculate keyboard height as difference between window height and visual viewport height
      const keyboardH = window.innerHeight - visualViewport.height
      const newKeyboardHeight = Math.max(0, keyboardH)
      
      // Detect if keyboard is opening (height increasing)
      const isKeyboardOpening = newKeyboardHeight > prevHeightRef.current
      prevHeightRef.current = newKeyboardHeight
      
      setKeyboardHeight(newKeyboardHeight)
      
      // Set CSS custom property for use in styles
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${newKeyboardHeight}px`
      )
      
      // Also set the visual viewport height
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${visualViewport.height}px`
      )
      
      // When keyboard opens, scroll the focused input into view smoothly
      if (isKeyboardOpening && newKeyboardHeight > 100) {
        requestAnimationFrame(() => {
          const activeElement = document.activeElement as HTMLElement
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            // Find the messages container and scroll it to the bottom
            const messagesContainer = document.querySelector('.messages-container')
            if (messagesContainer) {
              messagesContainer.scrollTop = messagesContainer.scrollHeight
            }
          }
        })
      }
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
