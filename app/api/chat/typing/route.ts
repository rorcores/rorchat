import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId, isTyping } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  // Ensure this conversation belongs to the current user
  const { rows: convRows } = await db.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, user.id]
  )
  if (convRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isTyping) {
    // Upsert typing status
    await db.query(
      `INSERT INTO typing_status (conversation_id, is_admin, updated_at)
       VALUES ($1, false, now())
       ON CONFLICT (conversation_id, is_admin)
       DO UPDATE SET updated_at = now()`,
      [conversationId]
    )
  } else {
    // Remove typing status
    await db.query(
      'DELETE FROM typing_status WHERE conversation_id = $1 AND is_admin = false',
      [conversationId]
    )
  }

  return NextResponse.json({ ok: true })
}
