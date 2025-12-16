import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { validateBase64Image } from '@/lib/imageUtils'
import { checkRateLimit } from '@/lib/validation'
import { notifyAdminOfNewMessage } from '@/lib/push'

export const runtime = 'nodejs'

// POST - Upload image message to chat
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limiting check (same as regular messages)
  const rateCheck = checkRateLimit(user.id)
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil((rateCheck.retryAfterMs || 60000) / 1000)
    return NextResponse.json(
      { error: `Too many messages. Please wait ${retryAfterSec} seconds.` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    )
  }

  try {
    const { conversationId, imageData, width, height, replyToId } = await request.json()

    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }

    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json({ error: 'imageData is required' }, { status: 400 })
    }

    // Validate the image
    const validation = validateBase64Image(imageData, 'chat')
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Validate dimensions
    const imgWidth = parseInt(width, 10) || 0
    const imgHeight = parseInt(height, 10) || 0
    if (imgWidth <= 0 || imgHeight <= 0 || imgWidth > 4096 || imgHeight > 4096) {
      return NextResponse.json({ error: 'Invalid image dimensions' }, { status: 400 })
    }

    // Ensure this conversation belongs to the current user
    const { rows: convRows } = await db.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
      [conversationId, user.id]
    )
    if (convRows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Validate replyToId if provided
    if (replyToId) {
      const { rows: replyRows } = await db.query(
        'SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 LIMIT 1',
        [replyToId, conversationId]
      )
      if (replyRows.length === 0) {
        return NextResponse.json({ error: 'Reply target not found' }, { status: 400 })
      }
    }

    // Insert image message
    const { rows: inserted } = await db.query(
      `INSERT INTO messages (conversation_id, content, is_admin, image_url, image_width, image_height, reply_to_id)
       VALUES ($1, $2, false, $3, $4, $5, $6)
       RETURNING id, content, is_admin, created_at, image_url, image_width, image_height, reply_to_id`,
      [conversationId, '📷 Image', imageData, imgWidth, imgHeight, replyToId || null]
    )

    // Update conversation timestamp
    await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])

    // Send push notification to admin
    const senderName = user.display_name || user.username || 'Someone'
    notifyAdminOfNewMessage(senderName, '📷 Sent an image', conversationId).catch(() => {})

    return NextResponse.json({ message: inserted[0] })
  } catch (err) {
    console.error('[api/chat/upload] error', err)
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
  }
}
