'use client'

import { useEffect, useRef } from 'react'

// Check if device has a virtual keyboard (mobile/tablet with touch)
function isMobileDevice() {
  if (typeof window === 'undefined') return false
  
  // Check for touch capability AND small screen (to exclude touch laptops)
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const isSmallScreen = window.innerWidth <= 768
  
  return hasTouch && isSmallScreen
}

export function useKeyboardHeight() {
  const lastKnownKeyboardHeight = useRef<number>(0)
  const isKeyboardOpen = useRef(false)
  const stableViewportHeight = useRef<number>(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    
    // Only run on mobile devices with virtual keyboards
    if (!isMobileDevice()) return

    const visualViewport = window.visualViewport
    
    // Don't set --visual-viewport-height initially - let CSS 100dvh handle it
    // This prevents issues on iOS where initial innerHeight can be wrong
    // We'll capture the "stable" height when visualViewport is available
    if (visualViewport) {
      stableViewportHeight.current = visualViewport.height
    }

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        isKeyboardOpen.current = true
        document.body.classList.add('keyboard-open')
        
        // Get the current stable height (use visualViewport if available, otherwise window.innerHeight)
        const currentHeight = stableViewportHeight.current || window.innerHeight
        
        // Use last known keyboard height or estimate based on screen size
        // Typical iOS keyboard is ~40-45% of screen height
        const estimatedKeyboardHeight = lastKnownKeyboardHeight.current || Math.round(currentHeight * 0.4)
        const estimatedViewportHeight = currentHeight - estimatedKeyboardHeight
        
        // Set to estimated height for smooth transition
        document.documentElement.style.setProperty(
          '--visual-viewport-height',
          `${estimatedViewportHeight}px`
        )
        
        // Scroll messages to bottom
        setTimeout(() => {
          const messagesContainer = document.querySelector('.messages-container')
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight
          }
        }, 50)
      }
    }

    const handleFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
          isKeyboardOpen.current = false
          document.body.classList.remove('keyboard-open')
          
          // Remove the CSS property entirely - let CSS 100dvh handle it
          // This prevents stale height values from persisting
          document.documentElement.style.removeProperty('--visual-viewport-height')
        }
      }, 100)
    }

    if (visualViewport) {
      // Track actual keyboard height and stable viewport height
      const trackKeyboardHeight = () => {
        const currentVisualHeight = visualViewport.height
        
        // If keyboard is open, update to actual height
        if (isKeyboardOpen.current) {
          // Calculate keyboard height based on stable height
          const keyboardHeight = stableViewportHeight.current - currentVisualHeight
          if (keyboardHeight > 100) {
            lastKnownKeyboardHeight.current = keyboardHeight
          }
          
          document.documentElement.style.setProperty(
            '--visual-viewport-height',
            `${currentVisualHeight}px`
          )
        } else {
          // Keyboard is not open - update stable height reference
          // Only update if it seems like a reasonable full height (not during keyboard transition)
          if (currentVisualHeight > stableViewportHeight.current * 0.8 || stableViewportHeight.current === 0) {
            stableViewportHeight.current = currentVisualHeight
          }
        }
      }
      
      const preventScroll = () => {
        if (visualViewport.offsetTop > 0) {
          window.scrollTo(0, 0)
        }
      }

      visualViewport.addEventListener('resize', trackKeyboardHeight)
      visualViewport.addEventListener('scroll', preventScroll)
      document.addEventListener('focusin', handleFocusIn)
      document.addEventListener('focusout', handleFocusOut)

      return () => {
        visualViewport.removeEventListener('resize', trackKeyboardHeight)
        visualViewport.removeEventListener('scroll', preventScroll)
        document.removeEventListener('focusin', handleFocusIn)
        document.removeEventListener('focusout', handleFocusOut)
        // Clean up on unmount
        document.documentElement.style.removeProperty('--visual-viewport-height')
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      // Clean up on unmount
      document.documentElement.style.removeProperty('--visual-viewport-height')
    }
  }, [])
}
