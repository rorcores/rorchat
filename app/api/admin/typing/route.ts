import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

const ADMIN_COOKIE = 'admin_session'

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

  const { conversationId, isTyping } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  // Verify conversation exists
  const { rows: convRows } = await db.query(
    'SELECT id FROM conversations WHERE id = $1 LIMIT 1',
    [conversationId]
  )
  if (convRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isTyping) {
    // Upsert typing status
    await db.query(
      `INSERT INTO typing_status (conversation_id, is_admin, updated_at)
       VALUES ($1, true, now())
       ON CONFLICT (conversation_id, is_admin)
       DO UPDATE SET updated_at = now()`,
      [conversationId]
    )
  } else {
    // Remove typing status
    await db.query(
      'DELETE FROM typing_status WHERE conversation_id = $1 AND is_admin = true',
      [conversationId]
    )
  }

  return NextResponse.json({ ok: true })
}
