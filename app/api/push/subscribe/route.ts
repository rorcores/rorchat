import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { savePushSubscription, removePushSubscription } from '@/lib/push'

export const runtime = 'nodejs'

/**
 * Subscribe to push notifications (for users)
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subscription } = await request.json()

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await savePushSubscription(subscription, { userId: user.id })

  return NextResponse.json({ success: true })
}

/**
 * Unsubscribe from push notifications
 */
export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await request.json()

  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint required' }, { status: 400 })
  }

  await removePushSubscription(endpoint)

  return NextResponse.json({ success: true })
}
