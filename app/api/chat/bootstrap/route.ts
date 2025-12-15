import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // get or create conversation for user
  const { rows: existingRows } = await db.query(
    'SELECT id FROM conversations WHERE user_id = $1 LIMIT 1',
    [user.id]
  )

  let conversationId = existingRows[0]?.id as string | undefined

  if (!conversationId) {
    const { rows: createdRows } = await db.query(
      `INSERT INTO conversations (user_id, visitor_id, visitor_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [user.id, user.id, user.display_name || user.username]
    )
    conversationId = createdRows[0]?.id
  }

  if (!conversationId) {
    return NextResponse.json({ error: 'Failed to initialize chat' }, { status: 500 })
  }

  const PAGE_SIZE = 25

  // Get most recent messages only (paginated)
  const { rows } = await db.query(
    `SELECT id, content, is_admin, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, PAGE_SIZE + 1]
  )

  // Check if there are more messages
  const hasMore = rows.length > PAGE_SIZE
  const messages = rows.slice(0, PAGE_SIZE).reverse() // Reverse to get chronological order

  return NextResponse.json({
    conversationId,
    messages,
    hasMore
  })
}
