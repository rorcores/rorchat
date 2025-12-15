import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { validateMessageContent, checkRateLimit, MAX_MESSAGE_LENGTH } from '@/lib/validation'
import { notifyAdminOfNewMessage } from '@/lib/push'

export const runtime = 'nodejs'

const PAGE_SIZE = 25
const MAX_PAGE_SIZE = 50

// Helper to fetch reactions for a list of messages
async function getReactionsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return {}
  
  const { rows } = await db.query(
    `SELECT message_id, emoji, COUNT(*) as count,
            BOOL_OR(is_admin) as has_admin,
            BOOL_OR(NOT is_admin) as has_user
     FROM message_reactions
     WHERE message_id = ANY($1)
     GROUP BY message_id, emoji`,
    [messageIds]
  )
  
  const reactions: Record<string, Array<{ emoji: string; count: number; hasAdmin: boolean; hasUser: boolean }>> = {}
  for (const row of rows) {
    if (!reactions[row.message_id]) reactions[row.message_id] = []
    reactions[row.message_id].push({
      emoji: row.emoji,
      count: parseInt(row.count),
      hasAdmin: row.has_admin,
      hasUser: row.has_user
    })
  }
  return reactions
}

// Helper to fetch reply-to info for messages
async function getReplyToInfo(messageIds: string[]) {
  if (messageIds.length === 0) return {}
  
  const { rows } = await db.query(
    `SELECT m.id, m.reply_to_id, r.content as reply_to_content, r.is_admin as reply_to_is_admin
     FROM messages m
     LEFT JOIN messages r ON r.id = m.reply_to_id
     WHERE m.id = ANY($1) AND m.reply_to_id IS NOT NULL`,
    [messageIds]
  )
  
  const replyInfo: Record<string, { id: string; content: string; is_admin: boolean }> = {}
  for (const row of rows) {
    if (row.reply_to_id) {
      replyInfo[row.id] = {
        id: row.reply_to_id,
        content: row.reply_to_content,
        is_admin: row.reply_to_is_admin
      }
    }
  }
  return replyInfo
}

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
      `SELECT id, content, is_admin, created_at, reply_to_id
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
        `SELECT id, content, is_admin, created_at, reply_to_id
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
      `SELECT id, content, is_admin, created_at, reply_to_id
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

  // Get reactions and reply info for all messages
  const messageIds = messages.map((m: { id: string }) => m.id).filter(Boolean)
  const [reactions, replyInfo] = await Promise.all([
    getReactionsForMessages(messageIds),
    getReplyToInfo(messageIds)
  ])

  // Attach reactions and reply info to messages
  const messagesWithMeta = messages.map((msg: { id: string; content: string; is_admin: boolean; created_at: string; reply_to_id?: string }) => ({
    ...msg,
    reactions: reactions[msg.id] || [],
    reply_to: replyInfo[msg.id] || null
  }))

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

  return NextResponse.json({ messages: messagesWithMeta, adminTyping, hasMore })
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

  const { conversationId, content, replyToId } = await request.json()

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

  const { rows: inserted } = await db.query(
    `INSERT INTO messages (conversation_id, content, is_admin, reply_to_id)
     VALUES ($1, $2, false, $3)
     RETURNING id, content, is_admin, created_at, reply_to_id`,
    [conversationId, message, replyToId || null]
  )

  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])

  // Send push notification to admin (don't await - fire and forget)
  const senderName = user.display_name || user.username || 'Someone'
  notifyAdminOfNewMessage(senderName, message, conversationId).catch(() => {})

  return NextResponse.json({ message: inserted[0] })
}
