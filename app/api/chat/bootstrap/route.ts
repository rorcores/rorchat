import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

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
    `SELECT id, content, is_admin, created_at, reply_to_id, image_url, image_width, image_height
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, PAGE_SIZE + 1]
  )

  // Check if there are more messages
  const hasMore = rows.length > PAGE_SIZE
  const messages = rows.slice(0, PAGE_SIZE).reverse() // Reverse to get chronological order

  // Get reactions and reply info for all messages
  const messageIds = messages.map((m: { id: string }) => m.id).filter(Boolean)
  const [reactions, replyInfo] = await Promise.all([
    getReactionsForMessages(messageIds),
    getReplyToInfo(messageIds)
  ])

  // Attach reactions and reply info to messages
  const messagesWithMeta = messages.map((msg: { id: string; content: string; is_admin: boolean; created_at: string; reply_to_id?: string; image_url?: string; image_width?: number; image_height?: number }) => ({
    ...msg,
    reactions: reactions[msg.id] || [],
    reply_to: replyInfo[msg.id] || null
  }))

  return NextResponse.json({
    conversationId,
    messages: messagesWithMeta,
    hasMore
  })
}
