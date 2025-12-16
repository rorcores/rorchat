import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ADMIN_COOKIE } from '../login/route'
import { notifyUserOfReply } from '@/lib/push'
import { validateBase64Image } from '@/lib/imageUtils'

export const runtime = 'nodejs'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (!token) return false
  const { rows } = await db.query(
    'SELECT id FROM admin_sessions WHERE token_hash = $1 AND expires_at > now() LIMIT 1',
    [hashToken(token)]
  )
  return rows.length > 0
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { conversationId, content, replyToId, imageData, imageWidth, imageHeight } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const isImageMessage = !!imageData
  const message = isImageMessage ? '📷 Image' : (content ?? '').toString().trim()
  
  if (!isImageMessage && !message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }
  if (!isImageMessage && message.length > 5000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }

  // Validate image if provided
  if (isImageMessage) {
    const validation = validateBase64Image(imageData, 'chat')
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    
    const imgWidth = parseInt(imageWidth, 10) || 0
    const imgHeight = parseInt(imageHeight, 10) || 0
    if (imgWidth <= 0 || imgHeight <= 0 || imgWidth > 4096 || imgHeight > 4096) {
      return NextResponse.json({ error: 'Invalid image dimensions' }, { status: 400 })
    }
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

  const { rows } = await db.query(
    `INSERT INTO messages (conversation_id, content, is_admin, reply_to_id, image_url, image_width, image_height)
     VALUES ($1, $2, true, $3, $4, $5, $6)
     RETURNING id, content, is_admin, created_at, reply_to_id, image_url, image_width, image_height`,
    [conversationId, message, replyToId || null, imageData || null, imageWidth || null, imageHeight || null]
  )

  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])

  // Get the user_id for this conversation and send push notification
  const { rows: convRows } = await db.query(
    'SELECT user_id FROM conversations WHERE id = $1',
    [conversationId]
  )
  if (convRows[0]?.user_id) {
    const notifyMsg = isImageMessage ? '📷 Sent an image' : message
    notifyUserOfReply(convRows[0].user_id, notifyMsg, conversationId).catch(() => {})
  }

  return NextResponse.json({ message: rows[0] })
}
