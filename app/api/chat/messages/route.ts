import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  // Ensure this conversation belongs to the current user
  const { rows: convRows } = await db.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, user.id]
  )
  if (convRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { rows: messages } = await db.query(
    `SELECT id, content, is_admin, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  )

  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId, content } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const message = (content ?? '').toString().trim()
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // Ensure this conversation belongs to the current user
  const { rows: convRows } = await db.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, user.id]
  )
  if (convRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { rows: inserted } = await db.query(
    `INSERT INTO messages (conversation_id, content, is_admin)
     VALUES ($1, $2, false)
     RETURNING id, content, is_admin, created_at`,
    [conversationId, message]
  )

  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])

  return NextResponse.json({ message: inserted[0] })
}
