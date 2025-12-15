// Service Worker for rorchat Push Notifications
// This file must be in /public to be served at the root

const CACHE_NAME = 'rorchat-v1'

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  // Skip waiting to activate immediately
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    })
  )
  // Take control of all pages immediately
  self.clients.claim()
})

// Push event - receive and display notification
self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('Push event with no data')
    return
  }

  let data
  try {
    data = event.data.json()
  } catch (e) {
    console.error('Error parsing push data:', e)
    return
  }

  const options = {
    body: data.body || 'New message',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag: data.tag || 'rorchat-notification',
    renotify: true, // Vibrate even if replacing existing notification
    requireInteraction: false, // Auto-dismiss on mobile
    data: {
      url: data.url || '/',
      conversationId: data.conversationId
    },
    // iOS-specific: actions don't work on iOS but we include for other platforms
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200] // Vibration pattern
  }

  const title = data.title || 'rorchat'

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// Notification click - open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'dismiss') {
    return
  }

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Focus the existing window and navigate if needed
          return client.focus().then((focusedClient) => {
            if (focusedClient && 'navigate' in focusedClient) {
              return focusedClient.navigate(urlToOpen)
            }
          })
        }
      }
      // No existing window, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  // Could track analytics here if needed
})
