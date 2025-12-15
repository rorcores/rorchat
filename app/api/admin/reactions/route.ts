import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ADMIN_COOKIE } from '../login/route'

export const runtime = 'nodejs'

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢']

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

  const { messageId, emoji } = await request.json()

  if (!messageId || typeof messageId !== 'string') {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  }

  if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })
  }

  // Verify the message exists
  const { rows: msgRows } = await db.query(
    `SELECT id FROM messages WHERE id = $1 LIMIT 1`,
    [messageId]
  )
  
  if (msgRows.length === 0) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Toggle reaction: if exists, remove it; if not, add it
  // Admin reactions use user_id = NULL and is_admin = true
  const { rows: existing } = await db.query(
    `SELECT id FROM message_reactions 
     WHERE message_id = $1 AND is_admin = true AND emoji = $2`,
    [messageId, emoji]
  )

  if (existing.length > 0) {
    // Remove reaction
    await db.query(
      `DELETE FROM message_reactions WHERE id = $1`,
      [existing[0].id]
    )
    return NextResponse.json({ action: 'removed', emoji })
  } else {
    // Remove any existing reaction from admin on this message (one reaction per admin)
    await db.query(
      `DELETE FROM message_reactions 
       WHERE message_id = $1 AND is_admin = true`,
      [messageId]
    )
    // Add new reaction
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, is_admin, emoji)
       VALUES ($1, NULL, true, $2)`,
      [messageId, emoji]
    )
    return NextResponse.json({ action: 'added', emoji })
  }
}
