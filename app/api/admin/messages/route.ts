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
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  const { rows } = await db.query(
    `SELECT id, content, is_admin, created_at, reply_to_id
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  )

  // Get reactions and reply info for all messages
  const messageIds = rows.map((m: { id: string }) => m.id).filter(Boolean)
  const [reactions, replyInfo] = await Promise.all([
    getReactionsForMessages(messageIds),
    getReplyToInfo(messageIds)
  ])

  // Attach reactions and reply info to messages
  const messagesWithMeta = rows.map((msg: { id: string; content: string; is_admin: boolean; created_at: string; reply_to_id?: string }) => ({
    ...msg,
    reactions: reactions[msg.id] || [],
    reply_to: replyInfo[msg.id] || null
  }))

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

  return NextResponse.json({ messages: messagesWithMeta, userTyping })
}
