import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ADMIN_COOKIE } from '../login/route'

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

  const { conversationId, content, replyToId } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const message = (content ?? '').toString().trim()
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  if (message.length > 5000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

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
    `INSERT INTO messages (conversation_id, content, is_admin, reply_to_id)
     VALUES ($1, $2, true, $3)
     RETURNING id, content, is_admin, created_at, reply_to_id`,
    [conversationId, message, replyToId || null]
  )

  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])

  return NextResponse.json({ message: rows[0] })
}
