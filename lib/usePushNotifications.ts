'use client'

import { useState, useEffect, useCallback } from 'react'

type PushState = 'loading' | 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'unsubscribed'

interface UsePushNotificationsOptions {
  // API endpoint for subscribe/unsubscribe (different for user vs admin)
  subscribeEndpoint: string
}

export function usePushNotifications({ subscribeEndpoint }: UsePushNotificationsOptions) {
  const [state, setState] = useState<PushState>('loading')
  const [error, setError] = useState<string | null>(null)

  // Check current state on mount
  useEffect(() => {
    checkPushState()
  }, [])

  const checkPushState = useCallback(async () => {
    // Check if push is supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }

    // Check notification permission
    const permission = Notification.permission
    if (permission === 'denied') {
      setState('denied')
      return
    }

    // Register service worker if not already
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      
      // Check if already subscribed
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        setState('subscribed')
      } else {
        setState(permission === 'granted' ? 'unsubscribed' : 'prompt')
      }
    } catch (err) {
      console.error('Service worker registration failed:', err)
      setState('unsupported')
    }
  }, [])

  const subscribe = useCallback(async () => {
    setError(null)
    
    try {
      // Request notification permission if needed
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        return false
      }

      // Get the service worker registration
      const registration = await navigator.serviceWorker.ready

      // Get VAPID public key from env
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        setError('Push notifications not configured')
        return false
      }

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      })

      // Send subscription to server
      const response = await fetch(subscribeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      })

      if (!response.ok) {
        throw new Error('Failed to save subscription')
      }

      setState('subscribed')
      return true
    } catch (err: any) {
      console.error('Push subscription failed:', err)
      setError(err.message || 'Failed to enable notifications')
      return false
    }
  }, [subscribeEndpoint])

  const unsubscribe = useCallback(async () => {
    setError(null)
    
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      
      if (subscription) {
        // Unsubscribe from browser
        await subscription.unsubscribe()
        
        // Remove from server
        await fetch(subscribeEndpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        })
      }

      setState('unsubscribed')
      return true
    } catch (err: any) {
      console.error('Push unsubscription failed:', err)
      setError(err.message || 'Failed to disable notifications')
      return false
    }
  }, [subscribeEndpoint])

  return {
    state,
    error,
    subscribe,
    unsubscribe,
    isSupported: state !== 'unsupported',
    isSubscribed: state === 'subscribed',
    canSubscribe: state === 'prompt' || state === 'unsubscribed'
  }
}

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer as ArrayBuffer
}
