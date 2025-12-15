import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { validateMessageContent, checkRateLimit, MAX_MESSAGE_LENGTH } from '@/lib/validation'

export const runtime = 'nodejs'

const PAGE_SIZE = 25
const MAX_PAGE_SIZE = 50

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  // Parse pagination params
  const limitParam = parseInt(searchParams.get('limit') || '', 10)
  const limit = Math.min(Math.max(1, limitParam || PAGE_SIZE), MAX_PAGE_SIZE)
  const before = searchParams.get('before') // message ID to load messages before
  const after = searchParams.get('after') // message ID to load messages after (for polling)

  // Ensure this conversation belongs to the current user
  const { rows: convRows } = await db.query(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1',
    [conversationId, user.id]
  )
  if (convRows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let messages
  let hasMore = false

  if (before) {
    // Loading older messages (pagination)
    // Get the timestamp of the "before" message
    const { rows: beforeRows } = await db.query(
      'SELECT created_at FROM messages WHERE id = $1 AND conversation_id = $2',
      [before, conversationId]
    )
    if (beforeRows.length === 0) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }
    const beforeTimestamp = beforeRows[0].created_at

    // Fetch messages older than cursor, ordered newest first, then reverse
    const { rows } = await db.query(
      `SELECT id, content, is_admin, created_at
       FROM messages
       WHERE conversation_id = $1 AND created_at < $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [conversationId, beforeTimestamp, limit + 1]
    )
    
    // Check if there are more messages
    hasMore = rows.length > limit
    messages = rows.slice(0, limit).reverse() // Reverse to get chronological order
  } else if (after) {
    // Polling for new messages only (after a certain message)
    const { rows: afterRows } = await db.query(
      'SELECT created_at FROM messages WHERE id = $1 AND conversation_id = $2',
      [after, conversationId]
    )
    if (afterRows.length > 0) {
      const afterTimestamp = afterRows[0].created_at
      const { rows } = await db.query(
        `SELECT id, content, is_admin, created_at
         FROM messages
         WHERE conversation_id = $1 AND created_at > $2
         ORDER BY created_at ASC
         LIMIT $3`,
        [conversationId, afterTimestamp, MAX_PAGE_SIZE]
      )
      messages = rows
    } else {
      messages = []
    }
  } else {
    // Initial load - get most recent messages
    const { rows } = await db.query(
      `SELECT id, content, is_admin, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit + 1]
    )
    
    // Check if there are more messages
    hasMore = rows.length > limit
    messages = rows.slice(0, limit).reverse() // Reverse to get chronological order
  }

  // Check if admin is typing (within last 3 seconds)
  const { rows: typingRows } = await db.query(
    `SELECT 1 FROM typing_status 
     WHERE conversation_id = $1 
     AND is_admin = true 
     AND updated_at > now() - interval '3 seconds'
     LIMIT 1`,
    [conversationId]
  )
  const adminTyping = typingRows.length > 0

  return NextResponse.json({ messages, adminTyping, hasMore })
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limiting check
  const rateCheck = checkRateLimit(user.id)
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil((rateCheck.retryAfterMs || 60000) / 1000)
    return NextResponse.json(
      { error: `Too many messages. Please wait ${retryAfterSec} seconds.` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
    )
  }

  const { conversationId, content } = await request.json()

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const message = (content ?? '').toString().trim()
  
  // Validate message content (empty check, length, allowed characters)
  const validation = validateMessageContent(message)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

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
