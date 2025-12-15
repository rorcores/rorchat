'use client'

import { useEffect, useState, useRef } from 'react'

interface Conversation {
  id: string
  visitor_name: string
  updated_at: string
  user_id: string | null
  username?: string | null
  display_name?: string | null
}

interface Reaction {
  emoji: string
  count: number
  hasAdmin: boolean
  hasUser: boolean
}

interface ReplyTo {
  id: string
  content: string
  is_admin: boolean
}

interface Message {
  id?: string
  content: string
  is_admin: boolean
  created_at: string
  reactions?: Reaction[]
  reply_to?: ReplyTo | null
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢']

export default function Admin() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const [isUserTyping, setIsUserTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingSentRef = useRef<number>(0)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [activeReactionPicker, setActiveReactionPicker] = useState<string | null>(null)
  const reactionPickerTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    checkAdminSession()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!isAuthenticated) return

    loadConversations()
    const interval = setInterval(loadConversations, 2000)
    return () => clearInterval(interval)
  }, [isAuthenticated])

  // Heartbeat to keep admin status "online"
  useEffect(() => {
    if (!isAuthenticated) return

    const heartbeat = () => fetch('/api/admin/me').catch(() => {})
    heartbeat() // Initial ping
    const interval = setInterval(heartbeat, 10_000) // Every 10 seconds
    return () => clearInterval(interval)
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !selectedConv) return

    loadMessages(selectedConv.id)
    const interval = setInterval(() => loadMessages(selectedConv.id), 2000)
    return () => clearInterval(interval)
  }, [isAuthenticated, selectedConv?.id])

  const checkAdminSession = async () => {
    const res = await fetch('/api/admin/me')
    const data = await res.json()
    setIsAuthenticated(Boolean(data.authenticated))
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })

    if (res.ok) {
      setIsAuthenticated(true)
      setPassword('')
    } else {
      setError('Invalid password')
    }
  }

  const loadConversations = async () => {
    const res = await fetch('/api/admin/conversations')
    if (!res.ok) return
    const data = await res.json()
    setConversations(data.conversations || [])
  }

  const loadMessages = async (conversationId: string) => {
    const res = await fetch(`/api/admin/messages?conversationId=${encodeURIComponent(conversationId)}`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.messages || [])
    setIsUserTyping(data.userTyping || false)
  }

  // Send typing status to server
  const sendTypingStatus = async (isTyping: boolean) => {
    if (!selectedConv) return
    
    // Debounce: don't send more than once per second
    const now = Date.now()
    if (isTyping && now - lastTypingSentRef.current < 1000) return
    lastTypingSentRef.current = now

    fetch('/api/admin/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedConv.id, isTyping })
    }).catch(() => {})
  }

  const handleTyping = () => {
    sendTypingStatus(true)
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    
    // Set timeout to clear typing status after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false)
    }, 2000)
  }

  const handleReaction = async (messageId: string | undefined, emoji: string) => {
    if (!messageId) return
    
    setActiveReactionPicker(null)
    
    // Optimistic update
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg
      
      const reactions = [...(msg.reactions || [])]
      const existingIdx = reactions.findIndex(r => r.emoji === emoji)
      
      if (existingIdx >= 0) {
        const existing = reactions[existingIdx]
        if (existing.hasAdmin) {
          // Remove admin's reaction
          if (existing.count <= 1 && !existing.hasUser) {
            reactions.splice(existingIdx, 1)
          } else {
            reactions[existingIdx] = { ...existing, count: existing.count - 1, hasAdmin: false }
          }
        } else {
          // Add admin's reaction (replacing any existing)
          const otherReactions = reactions.filter((r, i) => i !== existingIdx && !r.hasAdmin)
          reactions.length = 0
          reactions.push(...otherReactions, { ...existing, count: existing.count + 1, hasAdmin: true })
        }
      } else {
        // Remove admin's other reactions first
        const cleanedReactions = reactions.map(r => 
          r.hasAdmin ? { ...r, count: r.count - 1, hasAdmin: false } : r
        ).filter(r => r.count > 0)
        cleanedReactions.push({ emoji, count: 1, hasAdmin: true, hasUser: false })
        reactions.length = 0
        reactions.push(...cleanedReactions)
      }
      
      return { ...msg, reactions }
    }))
    
    // Send to server
    await fetch('/api/admin/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, emoji })
    })
  }

  const handleReply = (msg: Message) => {
    setReplyingTo(msg)
    setActiveReactionPicker(null)
  }

  const cancelReply = () => {
    setReplyingTo(null)
  }

  const showReactionPicker = (messageId: string | undefined) => {
    if (!messageId) return
    
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
    }
    
    setActiveReactionPicker(messageId)
    
    reactionPickerTimeoutRef.current = setTimeout(() => {
      setActiveReactionPicker(null)
    }, 5000)
  }

  const selectConversation = async (conv: Conversation) => {
    setSelectedConv(conv)
    setMobileView('chat')
    setReplyingTo(null)
    setActiveReactionPicker(null)
    await loadMessages(conv.id)
  }

  const goBackToList = () => {
    setMobileView('list')
    setReplyingTo(null)
    setActiveReactionPicker(null)
  }

  const sendReply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedConv) return

    const form = e.currentTarget
    const input = form.elements.namedItem('reply') as HTMLTextAreaElement
    const content = input.value.trim()

    if (!content) return

    const replyToId = replyingTo?.id

    input.value = ''
    setReplyingTo(null)

    // Clear typing status
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    sendTypingStatus(false)

    // Optimistic update
    setMessages(prev => [...prev, {
      content,
      is_admin: true,
      created_at: new Date().toISOString(),
      reply_to: replyingTo ? {
        id: replyingTo.id!,
        content: replyingTo.content,
        is_admin: replyingTo.is_admin
      } : null
    }])

    await fetch('/api/admin/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: selectedConv.id, content, replyToId })
    })
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const getDisplayName = (conv: Conversation) => {
    if (conv.display_name) return conv.display_name
    if (conv.username) return conv.username
    return conv.visitor_name || 'Anonymous'
  }

  const getUsername = (conv: Conversation) => {
    return conv.username || ''
  }

  return (
    <>
      <div className="bg-decoration">
        <svg className="wave-top" viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
          <path d="M0,60 C360,120 720,0 1080,60 C1260,90 1380,30 1440,60 L1440,0 L0,0 Z" fill="var(--primary)" opacity="0.03"/>
        </svg>
        <div className="gradient-orb orb-1"></div>
      </div>

      <div className={`admin-modal ${isAuthenticated ? 'hidden' : ''}`}>
        <div className="admin-modal-content">
          <div className="admin-icon">🔐</div>
          <h2>Admin access</h2>
          <p>Enter your password to continue</p>
          {error && <div className="error-msg show">{error}</div>}
          <form onSubmit={handleLogin}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <button type="submit">Sign in</button>
          </form>
        </div>
      </div>

      <div className={`admin-app ${mobileView === 'chat' ? 'mobile-chat-view' : 'mobile-list-view'}`} style={{ display: isAuthenticated ? 'flex' : 'none' }}>
        <aside className="sidebar">
          <div className="sidebar-header">
            <a href="/" className="logo">
              <span className="logo-text">rorchat<span className="dot">.</span></span>
            </a>
            <span className="admin-badge">Admin</span>
          </div>

          <div className="stats">
            <div>
              <div className="stat-value">{conversations.length}</div>
              <div className="stat-label">Conversations</div>
            </div>
          </div>

          <div className="conversations-list">
            {conversations.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <p>No conversations yet</p>
              </div>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`conversation-item ${selectedConv?.id === conv.id ? 'active' : ''}`}
                  onClick={() => selectConversation(conv)}
                >
                  <div className="conversation-header">
                    <span className="conversation-name">{getDisplayName(conv)}</span>
                    <span className="conversation-time">{formatTime(conv.updated_at)}</span>
                  </div>
                  <div className="conversation-preview">@{getUsername(conv)}</div>
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="chat-area">
          {!selectedConv ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">📬</div>
              <h2>Select a conversation</h2>
              <p>Choose from the list to reply</p>
            </div>
          ) : (
            <>
              <header className="chat-header admin-chat-header">
                <div className="chat-header-left">
                  <button className="back-btn" onClick={goBackToList} aria-label="Back to conversations">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                  </button>
                  <div className="avatar">{getDisplayName(selectedConv).charAt(0).toUpperCase()}</div>
                  <div className="chat-header-info">
                    <h2>{getDisplayName(selectedConv)}</h2>
                    <div className="status">@{getUsername(selectedConv)}</div>
                  </div>
                </div>
              </header>

              <div className="messages-container">
                {messages.map((msg, i) => (
                  <div 
                    key={msg.id || i} 
                    className={`message ${msg.is_admin ? 'sent' : 'received'}`}
                    onDoubleClick={() => msg.id && showReactionPicker(msg.id)}
                  >
                    {/* Reply context */}
                    {msg.reply_to && (
                      <div className={`reply-context ${msg.reply_to.is_admin ? 'from-admin' : 'from-user'}`}>
                        <div className="reply-context-label">
                          {msg.reply_to.is_admin ? 'You' : getDisplayName(selectedConv)}
                        </div>
                        <div className="reply-context-content">
                          {msg.reply_to.content.length > 50 
                            ? msg.reply_to.content.slice(0, 50) + '...' 
                            : msg.reply_to.content}
                        </div>
                      </div>
                    )}
                    <div className="message-bubble">{msg.content}</div>
                    
                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="message-reactions">
                        {msg.reactions.map(r => (
                          <button
                            key={r.emoji}
                            className={`reaction-badge ${r.hasAdmin ? 'admin-reacted' : ''}`}
                            onClick={() => handleReaction(msg.id, r.emoji)}
                          >
                            <span className="reaction-emoji">{r.emoji}</span>
                            {r.count > 1 && <span className="reaction-count">{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Reaction picker */}
                    {activeReactionPicker === msg.id && (
                      <div className="reaction-picker">
                        {REACTION_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            className="reaction-picker-btn"
                            onClick={() => handleReaction(msg.id, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          className="reaction-picker-btn reply-btn"
                          onClick={() => handleReply(msg)}
                          title="Reply"
                        >
                          ↩️
                        </button>
                      </div>
                    )}
                    
                    <div className="message-time">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
                {isUserTyping && (
                  <div className="typing-indicator">
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form className="reply-area" onSubmit={sendReply}>
                {/* Reply preview */}
                {replyingTo && (
                  <div className="reply-preview">
                    <div className="reply-preview-content">
                      <span className="reply-preview-label">
                        Replying to {replyingTo.is_admin ? 'yourself' : getDisplayName(selectedConv)}
                      </span>
                      <span className="reply-preview-text">
                        {replyingTo.content.length > 60 
                          ? replyingTo.content.slice(0, 60) + '...' 
                          : replyingTo.content}
                      </span>
                    </div>
                    <button type="button" className="reply-cancel" onClick={cancelReply}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                )}
                <div className="reply-input-wrapper">
                  <textarea
                    className="reply-input"
                    name="reply"
                    placeholder="Type a reply..."
                    rows={1}
                    onInput={handleTyping}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        e.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button type="submit" className="send-btn">
                    <svg viewBox="0 0 24 24">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>
                  </button>
                </div>
              </form>
            </>
          )}
        </main>
      </div>
    </>
  )
}
