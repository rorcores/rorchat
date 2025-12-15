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

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  const { rows } = await db.query(
    `SELECT id, content, is_admin, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  )

  // Check if user is typing (within last 3 seconds)
  const { rows: typingRows } = await db.query(
    `SELECT 1 FROM typing_status 
     WHERE conversation_id = $1 
     AND is_admin = false 
     AND updated_at > now() - interval '3 seconds'
     LIMIT 1`,
    [conversationId]
  )
  const userTyping = typingRows.length > 0

  return NextResponse.json({ messages: rows, userTyping })
}
