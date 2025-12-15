'use client'

import { useEffect, useRef } from 'react'

export function useKeyboardHeight() {
  const lastKnownKeyboardHeight = useRef<number>(0)
  const isKeyboardOpen = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const visualViewport = window.visualViewport
    const initialHeight = window.innerHeight

    // Set initial viewport height
    document.documentElement.style.setProperty(
      '--visual-viewport-height',
      `${initialHeight}px`
    )

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        isKeyboardOpen.current = true
        document.body.classList.add('keyboard-open')
        
        // Use last known keyboard height or estimate based on screen size
        // Typical iOS keyboard is ~40-45% of screen height
        const estimatedKeyboardHeight = lastKnownKeyboardHeight.current || Math.round(initialHeight * 0.4)
        const estimatedViewportHeight = initialHeight - estimatedKeyboardHeight
        
        // Immediately set to estimated height for smooth transition
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
          
          // Restore full height
          document.documentElement.style.setProperty(
            '--visual-viewport-height',
            `${initialHeight}px`
          )
        }
      }, 100)
    }

    if (visualViewport) {
      // Track actual keyboard height for future use
      const trackKeyboardHeight = () => {
        const keyboardHeight = initialHeight - visualViewport.height
        if (keyboardHeight > 100) {
          // Only update if keyboard is actually showing
          lastKnownKeyboardHeight.current = keyboardHeight
          
          // If keyboard is open, update to actual height (refinement)
          if (isKeyboardOpen.current) {
            document.documentElement.style.setProperty(
              '--visual-viewport-height',
              `${visualViewport.height}px`
            )
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
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])
}
