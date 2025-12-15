import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢']

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messageId, emoji } = await request.json()

  if (!messageId || typeof messageId !== 'string') {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  }

  if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })
  }

  // Verify the message belongs to a conversation the user owns
  const { rows: msgRows } = await db.query(
    `SELECT m.id FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND c.user_id = $2
     LIMIT 1`,
    [messageId, user.id]
  )
  
  if (msgRows.length === 0) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Toggle reaction: if exists, remove it; if not, add it
  const { rows: existing } = await db.query(
    `SELECT id FROM message_reactions 
     WHERE message_id = $1 AND user_id = $2 AND is_admin = false AND emoji = $3`,
    [messageId, user.id, emoji]
  )

  if (existing.length > 0) {
    // Remove reaction
    await db.query(
      `DELETE FROM message_reactions WHERE id = $1`,
      [existing[0].id]
    )
    return NextResponse.json({ action: 'removed', emoji })
  } else {
    // Remove any existing reaction from this user on this message (one reaction per user)
    await db.query(
      `DELETE FROM message_reactions 
       WHERE message_id = $1 AND user_id = $2 AND is_admin = false`,
      [messageId, user.id]
    )
    // Add new reaction
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, is_admin, emoji)
       VALUES ($1, $2, false, $3)`,
      [messageId, user.id, emoji]
    )
    return NextResponse.json({ action: 'added', emoji })
  }
}
