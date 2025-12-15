import webpush from 'web-push'
import { db } from './db'

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:hello@ror.chat'

let isConfigured = false

function ensureConfigured() {
  if (isConfigured) return true
  
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not configured - push notifications disabled')
    return false
  }
  
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  isConfigured = true
  return true
}

interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/**
 * Save a push subscription to the database
 */
export async function savePushSubscription(
  subscription: PushSubscriptionData,
  options: { userId?: string; isAdmin?: boolean }
): Promise<void> {
  const { endpoint, keys } = subscription
  const { userId, isAdmin = false } = options

  // Upsert: update if endpoint exists, insert if not
  await db.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_id = EXCLUDED.user_id,
       is_admin = EXCLUDED.is_admin,
       updated_at = now()`,
    [endpoint, keys.p256dh, keys.auth, userId || null, isAdmin]
  )
}

/**
 * Remove a push subscription from the database
 */
export async function removePushSubscription(endpoint: string): Promise<void> {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
}

/**
 * Send a push notification to a specific subscription
 */
async function sendToSubscription(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: object
): Promise<boolean> {
  if (!ensureConfigured()) return false

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      },
      JSON.stringify(payload),
      {
        TTL: 60 * 5, // 5 minute TTL - signals time-sensitivity to iOS/APNs
        urgency: 'high'
      }
    )
    return true
  } catch (error: any) {
    // Handle expired/invalid subscriptions
    if (error.statusCode === 404 || error.statusCode === 410) {
      console.log('[push] Subscription expired, removing:', subscription.endpoint.slice(0, 50))
      await removePushSubscription(subscription.endpoint)
    } else {
      console.error('[push] Failed to send notification:', error.message)
    }
    return false
  }
}

/**
 * Notify admin(s) that a user sent a message
 */
export async function notifyAdminOfNewMessage(
  senderName: string,
  messageContent: string,
  conversationId: string
): Promise<void> {
  if (!ensureConfigured()) return

  const { rows: subscriptions } = await db.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE is_admin = TRUE'
  )

  if (subscriptions.length === 0) {
    console.log('[push] No admin subscriptions found')
    return
  }

  // Truncate message for notification
  const truncatedMessage = messageContent.length > 100 
    ? messageContent.slice(0, 100) + '...' 
    : messageContent

  const payload = {
    title: `New message from ${senderName}`,
    body: truncatedMessage,
    tag: `conv-${conversationId}`,
    url: '/admin',
    conversationId
  }

  // Send to all admin subscriptions in parallel
  await Promise.all(
    subscriptions.map(sub => sendToSubscription(sub, payload))
  )
}

/**
 * Notify a user that admin replied to their conversation
 */
export async function notifyUserOfReply(
  userId: string,
  messageContent: string,
  conversationId: string
): Promise<void> {
  if (!ensureConfigured()) return

  const { rows: subscriptions } = await db.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  )

  if (subscriptions.length === 0) {
    return // User has no subscriptions, that's fine
  }

  // Truncate message for notification
  const truncatedMessage = messageContent.length > 100 
    ? messageContent.slice(0, 100) + '...' 
    : messageContent

  const payload = {
    title: 'Rory replied',
    body: truncatedMessage,
    tag: `conv-${conversationId}`,
    url: '/',
    conversationId
  }

  // Send to all user's subscriptions (they might have multiple devices)
  await Promise.all(
    subscriptions.map(sub => sendToSubscription(sub, payload))
  )
}

/**
 * Check if push notifications are available (VAPID keys configured)
 */
export function isPushAvailable(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
}
