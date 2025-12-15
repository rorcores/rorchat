'use client'

import { useEffect, useState, useRef } from 'react'

// Message validation constants (mirrored from server)
const MAX_MESSAGE_LENGTH = 500
const ALLOWED_CHARS_REGEX = /^[\p{L}\p{N}\p{Emoji}\p{Emoji_Component}\s\u00A0\u202F\.,!?¿¡;:'"''""´`ʻʼʽʹʺ′″‵‶()\[\]{}\-–—_@#$%&*+=\/\\|~^<>…•°€£¥¢₹₽₿©®™½¼¾×÷±≈]*$/u

function validateMessageContent(content: string): { valid: boolean; error?: string } {
  const trimmed = content.trim()
  if (!trimmed) {
    return { valid: false, error: 'Message cannot be empty' }
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` }
  }
  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: 'Message contains invalid characters' }
  }
  return { valid: true }
}

interface User {
  id: string
  username: string
  display_name: string
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

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [authLoading, setAuthLoading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [isAdminOnline, setIsAdminOnline] = useState(false)
  const [isAdminTyping, setIsAdminTyping] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [messageError, setMessageError] = useState('')
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [testimonialIndex, setTestimonialIndex] = useState(0)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingSentRef = useRef<number>(0)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [activeReactionPicker, setActiveReactionPicker] = useState<string | null>(null)
  const reactionPickerTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggeredRef = useRef<boolean>(false)
  const lastOptimisticUpdateRef = useRef<number>(0)

  const testimonials = [
    {
      quote: "Use this when Rory isn't texting back!",
      author: "Elliot",
      title: "Friend of Rory"
    },
    {
      quote: "Rorchat is incredibly impressive technology",
      author: "Elon Musk",
      title: "tech guy"
    },
    {
      quote: "Rory I am not going to use this to contact you",
      author: "Olivia",
      title: "Rory's other neighbor, New York"
    },
  ]

  // Preview messages shown in the background when not logged in
  const previewMessages: Message[] = [
    { content: "Hey! 👋 Sign up to start chatting with me!", is_admin: true, created_at: new Date(Date.now() - 3600000).toISOString() },
  ]

  useEffect(() => {
    // Check if already logged in
    checkAuth()
  }, [])

  // Check admin online status
  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const res = await fetch('/api/admin/status')
        const data = await res.json()
        setIsAdminOnline(data.online)
      } catch {
        setIsAdminOnline(false)
      }
    }

    checkAdminStatus()
    const interval = setInterval(checkAdminStatus, 10_000) // Check every 10 seconds
    return () => clearInterval(interval)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const dropdown = document.querySelector('.user-dropdown.show')
      const userMenu = document.querySelector('.user-menu')
      if (dropdown && userMenu && !userMenu.contains(e.target as Node)) {
        dropdown.classList.remove('show')
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Track message count to only auto-scroll when new messages arrive
  const prevMessageCountRef = useRef(0)
  
  useEffect(() => {
    // Only scroll if new messages were added
    if (messages.length > prevMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessageCountRef.current = messages.length
  }, [messages])

  useEffect(() => {
    const interval = setInterval(() => {
      setTestimonialIndex((prev) => (prev + 1) % testimonials.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [testimonials.length])

  // Rate limit countdown timer
  useEffect(() => {
    if (rateLimitCountdown <= 0) return
    
    const timer = setInterval(() => {
      setRateLimitCountdown(prev => {
        if (prev <= 1) {
          setMessageError('')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(timer)
  }, [rateLimitCountdown])

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      if (data.user) {
        setCurrentUser(data.user)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!currentUser) return

    let cancelled = false

    const bootstrap = async () => {
      const res = await fetch('/api/chat/bootstrap', { method: 'POST' })
      if (!res.ok) return
      const data = await res.json()
      if (cancelled) return
      setConversationId(data.conversationId)
      setMessages(data.messages || [])
      setHasMoreMessages(data.hasMore || false)
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [currentUser])

  // Poll for new messages only (using "after" param for efficiency)
  useEffect(() => {
    if (!currentUser || !conversationId) return

    let cancelled = false
    const interval = setInterval(async () => {
      // Skip poll if an optimistic update happened in the last 3 seconds
      // This prevents polling from interfering with optimistic reaction/message updates
      if (Date.now() - lastOptimisticUpdateRef.current < 3000) {
        return
      }
      
      // Use functional state to get the latest messages without adding to dependencies
      let lastMessageId: string | null = null
      setMessages(prev => {
        // Find the last message WITH an id (skip optimistic messages without ids)
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].id) {
            lastMessageId = prev[i].id!
            break
          }
        }
        return prev // Don't actually change state, just read it
      })
      
      const url = lastMessageId 
        ? `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}&after=${encodeURIComponent(lastMessageId)}`
        : `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`
      
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      if (cancelled) return
      
      if (data.messages?.length > 0) {
        setMessages(prev => {
          // Build a set of existing message IDs for deduplication
          const existingIds = new Set(prev.map(m => m.id).filter(Boolean))
          
          // Filter out any messages we already have
          const newMessages = data.messages.filter((m: Message) => m.id && !existingIds.has(m.id))
          
          if (newMessages.length === 0) return prev // No new messages, don't update state
          
          // Remove any optimistic messages that match new messages by content
          // (optimistic messages have no id but same content)
          const prevWithoutOptimistic = prev.filter(m => {
            if (m.id) return true // Keep messages with IDs
            // Check if any new message matches this optimistic one
            return !newMessages.some((nm: Message) => 
              nm.content === m.content && nm.is_admin === m.is_admin
            )
          })
          
          return [...prevWithoutOptimistic, ...newMessages]
        })
      } else if (!lastMessageId) {
        // Initial load case - no existing messages with IDs
        setMessages(data.messages || [])
        setHasMoreMessages(data.hasMore || false)
      }
      
      setIsAdminTyping(data.adminTyping || false)
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [currentUser, conversationId]) // Removed 'messages' from dependencies

  // Load older messages when scrolling to top
  const loadMoreMessages = async () => {
    if (!conversationId || !hasMoreMessages || loadingMore || messages.length === 0) return
    
    const oldestMessage = messages[0]
    if (!oldestMessage.id) return

    setLoadingMore(true)
    
    // Save scroll position
    const container = messagesContainerRef.current
    const scrollHeightBefore = container?.scrollHeight || 0

    try {
      const res = await fetch(
        `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}&before=${encodeURIComponent(oldestMessage.id)}`
      )
      if (!res.ok) {
        // On error, assume no more messages to prevent infinite retry loops
        setHasMoreMessages(false)
        return
      }
      const data = await res.json()
      
      // Always update hasMore from server response (defaults to false)
      const hasMore = data.hasMore === true
      setHasMoreMessages(hasMore)
      
      if (data.messages?.length > 0) {
        setMessages(prev => [...data.messages, ...prev])
        
        // Restore scroll position after DOM update
        requestAnimationFrame(() => {
          if (container) {
            const scrollHeightAfter = container.scrollHeight
            container.scrollTop = scrollHeightAfter - scrollHeightBefore
          }
        })
      }
    } catch {
      // On network error, assume no more messages
      setHasMoreMessages(false)
    } finally {
      setLoadingMore(false)
    }
  }

  // Handle scroll to detect when user scrolls near top
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return
    
    // Load more when scrolled within 100px of the top
    if (container.scrollTop < 100 && hasMoreMessages && !loadingMore) {
      loadMoreMessages()
    }
  }

  // Send typing status to server
  const sendTypingStatus = async (isTyping: boolean) => {
    if (!conversationId) return
    
    // Debounce: don't send more than once per second
    const now = Date.now()
    if (isTyping && now - lastTypingSentRef.current < 1000) return
    lastTypingSentRef.current = now

    fetch('/api/chat/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, isTyping })
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

  const handleAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setAuthLoading(true)

    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Authentication failed')
        return
      }

      setCurrentUser(data.user)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Close the dropdown immediately
    const dropdown = document.querySelector('.user-dropdown.show')
    dropdown?.classList.remove('show')
    
    await fetch('/api/auth/signout', { method: 'POST' })
    setCurrentUser(null)
    setConversationId(null)
    setMessages([])
  }

  const sendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!conversationId) return
    
    // Don't allow sending if rate limited
    if (rateLimitCountdown > 0) return

    const content = messageInput.trim()
    
    // Client-side validation
    const validation = validateMessageContent(content)
    if (!validation.valid) {
      setMessageError(validation.error || 'Invalid message')
      return
    }

    const replyToId = replyingTo?.id

    setMessageInput('')
    setMessageError('')
    setReplyingTo(null)

    // Clear typing status
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    sendTypingStatus(false)

    // Mark that an optimistic update is happening
    lastOptimisticUpdateRef.current = Date.now()

    // Optimistic update
    setMessages(prev => [...prev, {
      content,
      is_admin: false,
      created_at: new Date().toISOString(),
      reply_to: replyingTo ? {
        id: replyingTo.id!,
        content: replyingTo.content,
        is_admin: replyingTo.is_admin
      } : null
    }])

    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content, replyToId })
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      
      // Handle rate limiting with countdown
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10)
        setRateLimitCountdown(retryAfter)
        setMessageError(`Too many messages. Please wait...`)
      } else {
        setMessageError(data.error || 'Failed to send message')
      }
      
      // fallback: refresh from server
      const refresh = await fetch(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`)
      if (refresh.ok) {
        const refreshData = await refresh.json()
        setMessages(refreshData.messages || [])
      }
    }
  }

  const handleReaction = async (messageId: string | undefined, emoji: string) => {
    if (!messageId || !conversationId) return
    
    setActiveReactionPicker(null)
    
    // Mark that an optimistic update is happening
    lastOptimisticUpdateRef.current = Date.now()
    
    // Optimistic update
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg
      
      const reactions = [...(msg.reactions || [])]
      const existingIdx = reactions.findIndex(r => r.emoji === emoji)
      
      if (existingIdx >= 0) {
        const existing = reactions[existingIdx]
        if (existing.hasUser) {
          // Remove user's reaction
          if (existing.count <= 1 && !existing.hasAdmin) {
            reactions.splice(existingIdx, 1)
          } else {
            reactions[existingIdx] = { ...existing, count: existing.count - 1, hasUser: false }
          }
        } else {
          // Add user's reaction (replacing any existing)
          const otherReactions = reactions.filter((r, i) => i !== existingIdx && !r.hasUser)
          reactions.length = 0
          reactions.push(...otherReactions, { ...existing, count: existing.count + 1, hasUser: true })
        }
      } else {
        // Remove user's other reactions first
        const cleanedReactions = reactions.map(r => 
          r.hasUser ? { ...r, count: r.count - 1, hasUser: false } : r
        ).filter(r => r.count > 0)
        cleanedReactions.push({ emoji, count: 1, hasAdmin: false, hasUser: true })
        reactions.length = 0
        reactions.push(...cleanedReactions)
      }
      
      return { ...msg, reactions }
    }))
    
    // Send to server
    await fetch('/api/chat/reactions', {
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
    
    // Clear any existing timeout
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
    }
    
    setActiveReactionPicker(messageId)
    
    // Auto-hide after 5 seconds
    reactionPickerTimeoutRef.current = setTimeout(() => {
      setActiveReactionPicker(null)
    }, 5000)
  }

  const hideReactionPicker = () => {
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
    }
    setActiveReactionPicker(null)
  }

  // Long press handlers for mobile
  const handleMessageTouchStart = (messageId: string | undefined) => {
    if (!messageId || !currentUser) return
    
    longPressTriggeredRef.current = false
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      showReactionPicker(messageId)
      // Vibrate on mobile if supported
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, 500) // 500ms long press
  }

  const handleMessageTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
    }
  }

  const handleMessageTouchMove = () => {
    // Cancel long press if user moves finger
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatDateHeader = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return formatTime(timestamp)
    } else if (diffDays === 1) {
      return `Yesterday ${formatTime(timestamp)}`
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' }) + ' ' + formatTime(timestamp)
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(timestamp)
    }
  }

  const shouldShowTimestamp = (messages: Message[], index: number): 'none' | 'inline' | 'header' => {
    if (index === 0) return 'header'
    
    const currentMsg = messages[index]
    const prevMsg = messages[index - 1]
    
    const currentTime = new Date(currentMsg.created_at).getTime()
    const prevTime = new Date(prevMsg.created_at).getTime()
    const diffMinutes = (currentTime - prevTime) / (1000 * 60)
    
    // If more than 15 minutes, show a header timestamp (centered, like iMessage)
    if (diffMinutes > 15) return 'header'
    
    // If sender changed, show inline timestamp on last message of previous group
    if (currentMsg.is_admin !== prevMsg.is_admin) return 'none'
    
    // Same sender, within 5 minutes - no timestamp needed
    if (diffMinutes <= 5) return 'none'
    
    // Same sender but 5-15 minutes gap - show inline
    return 'inline'
  }

  const shouldShowInlineTimestamp = (messages: Message[], index: number): boolean => {
    // Show inline timestamp on the LAST message of a group
    if (index === messages.length - 1) return true
    
    const currentMsg = messages[index]
    const nextMsg = messages[index + 1]
    
    const currentTime = new Date(currentMsg.created_at).getTime()
    const nextTime = new Date(nextMsg.created_at).getTime()
    const diffMinutes = (nextTime - currentTime) / (1000 * 60)
    
    // Show timestamp if next message is from different sender
    if (currentMsg.is_admin !== nextMsg.is_admin) return true
    
    // Show timestamp if there's a significant gap before next message
    if (diffMinutes > 5) return true
    
    return false
  }

  // Messages to display - real ones when logged in, preview when not
  const displayMessages = currentUser ? messages : previewMessages

  if (loading) {
    return (
      <div className="app">
        <div className="chat-view active">
          <header className="chat-header">
            <div className="chat-header-left">
              <div className="avatar-img">
                <img src="/profpic.png" alt="Rory" />
              </div>
              <div className="chat-header-info">
                <h2>Rory</h2>
                <div className="status">
                  <span className={`status-dot ${isAdminOnline ? 'online' : ''}`}></span>
                  {isAdminOnline ? 'Online' : 'Offline'}
                </div>
              </div>
            </div>
            <span className="header-logo">rorchat<span className="dot">.</span></span>
            <div className="header-actions"></div>
          </header>
          <div className="messages-container">
            <div className="loading-spinner"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Chat Interface - Always visible as background */}
      <div className={`chat-view active ${!currentUser ? 'preview-mode' : ''}`}>
        <header className="chat-header">
          <div className="chat-header-left">
            <div className="avatar-img">
              <img src="/profpic.png" alt="Rory" />
            </div>
            <div className="chat-header-info">
              <h2>Rory</h2>
              <div className="status">
                <span className={`status-dot ${isAdminOnline ? 'online' : ''}`}></span>
                {isAdminOnline ? 'Online' : 'Offline'}
              </div>
            </div>
          </div>
          <span className="header-logo">rorchat<span className="dot">.</span></span>
          
          <div className="header-actions">
            {currentUser && (
              <div className="user-menu">
                <button className="user-pill" onClick={(e) => {
                  const menu = e.currentTarget.nextElementSibling;
                  menu?.classList.toggle('show');
                }}>
                  <span>{currentUser?.display_name || currentUser?.username || 'User'}</span>
                  <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                <div className="user-dropdown">
                  <button onClick={(e) => handleSignOut(e)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        <div 
          className="messages-container" 
          ref={messagesContainerRef}
          onScroll={handleScroll}
        >
          {/* Loading indicator for older messages */}
          {loadingMore && (
            <div className="load-more-indicator">
              <div className="loading-spinner small"></div>
            </div>
          )}
          {/* Show "load more" hint if there are more messages */}
          {hasMoreMessages && !loadingMore && currentUser && messages.length > 0 && (
            <button className="load-more-btn" onClick={loadMoreMessages}>
              Load older messages
            </button>
          )}
          {displayMessages.length === 0 ? (
            <div className="welcome-chat">
              <div className="welcome-icon">💬</div>
              <h3>Start a conversation</h3>
              <p>Send a message and Rory will get back to you soon.</p>
            </div>
          ) : (
            displayMessages.map((msg, i) => {
              const timestampType = shouldShowTimestamp(displayMessages, i)
              const showInline = shouldShowInlineTimestamp(displayMessages, i)
              
              return (
                <div key={msg.id || i} className={`message-group ${msg.is_admin ? 'received' : 'sent'}`}>
                  {timestampType === 'header' && (
                    <div className="message-time-header">
                      {formatDateHeader(msg.created_at)}
                    </div>
                  )}
                  <div 
                    className={`message ${msg.is_admin ? 'received' : 'sent'} ${activeReactionPicker === msg.id ? 'picker-active' : ''}`}
                    onTouchStart={() => handleMessageTouchStart(msg.id)}
                    onTouchEnd={handleMessageTouchEnd}
                    onTouchMove={handleMessageTouchMove}
                  >
                    {/* Reply context */}
                    {msg.reply_to && (
                      <div className={`reply-context ${msg.reply_to.is_admin ? 'from-admin' : 'from-user'}`}>
                        <div className="reply-context-label">
                          {msg.reply_to.is_admin ? 'Rory' : 'You'}
                        </div>
                        <div className="reply-context-content">
                          {msg.reply_to.content.length > 50 
                            ? msg.reply_to.content.slice(0, 50) + '...' 
                            : msg.reply_to.content}
                        </div>
                      </div>
                    )}
                    <div className="message-bubble">{msg.content}</div>
                    
                    {/* Hover action buttons (desktop) */}
                    {currentUser && msg.id && (
                      <div className={`message-actions ${msg.is_admin ? 'left' : 'right'}`}>
                        <button 
                          className="message-action-btn"
                          onClick={() => showReactionPicker(msg.id)}
                          title="React"
                        >
                          😊
                        </button>
                        <button 
                          className="message-action-btn"
                          onClick={() => handleReply(msg)}
                          title="Reply"
                        >
                          ↩️
                        </button>
                      </div>
                    )}
                    
                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="message-reactions">
                        {msg.reactions.map(r => (
                          <button
                            key={r.emoji}
                            className={`reaction-badge ${r.hasUser ? 'user-reacted' : ''}`}
                            onClick={() => currentUser && handleReaction(msg.id, r.emoji)}
                          >
                            <span className="reaction-emoji">{r.emoji}</span>
                            {r.count > 1 && <span className="reaction-count">{r.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Reaction picker (shown on mobile long-press or desktop click) */}
                    {activeReactionPicker === msg.id && currentUser && (
                      <div className="reaction-picker-overlay" onClick={hideReactionPicker}>
                        <div className="reaction-picker" onClick={e => e.stopPropagation()}>
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
                      </div>
                    )}
                    
                    {showInline && (
                      <div className="message-time">{formatTime(msg.created_at)}</div>
                    )}
                  </div>
                </div>
              )
            })
          )}
          {isAdminTyping && currentUser && (
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

        <form className="input-area" onSubmit={sendMessage}>
          {/* Reply preview */}
          {replyingTo && (
            <div className="reply-preview">
              <div className="reply-preview-content">
                <span className="reply-preview-label">
                  Replying to {replyingTo.is_admin ? 'Rory' : 'yourself'}
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
          {messageError && (
            <div className={`message-error ${rateLimitCountdown > 0 ? 'rate-limited' : ''}`}>
              {rateLimitCountdown > 0 ? (
                <>
                  <span className="rate-limit-icon">⏱️</span>
                  <span>Too many messages. Try again in <strong>{rateLimitCountdown}s</strong></span>
                </>
              ) : messageError}
            </div>
          )}
          <div className="input-wrapper">
            <textarea 
              className="message-input" 
              name="message"
              placeholder={rateLimitCountdown > 0 ? `Wait ${rateLimitCountdown}s...` : "Message..."}
              rows={1}
              disabled={!currentUser || rateLimitCountdown > 0}
              value={messageInput}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => {
                setMessageInput(e.target.value)
                if (rateLimitCountdown === 0) setMessageError('')
                handleTyping()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button type="submit" className="send-btn" disabled={!currentUser || !messageInput.trim() || rateLimitCountdown > 0}>
              <svg viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
          {messageInput.length > MAX_MESSAGE_LENGTH * 0.8 && (
            <div className={`char-count ${messageInput.length >= MAX_MESSAGE_LENGTH ? 'limit' : ''}`}>
              {messageInput.length}/{MAX_MESSAGE_LENGTH}
            </div>
          )}
        </form>
      </div>

      {/* Auth Modal Overlay */}
      {!currentUser && (
        <div className="auth-overlay">
          <div className="auth-modal-card">
            <a href="/" className="logo">
              <span className="logo-text">rorchat<span className="dot">.</span></span>
            </a>
            
            <div className="hero">
              <h1>Reach Rory, Today</h1>
              <p>The easiest way to reach Rory. Simple, fast.</p>
            </div>

            <div className="auth-card">
              {error && <div className="auth-error show">{error}</div>}

              <form className="auth-form" onSubmit={handleAuth}>
                <div className="input-group">
                  <label>Username</label>
                  <input type="text" name="username" placeholder="Enter username" required autoComplete="username" autoCapitalize="none" minLength={2} maxLength={16} />
                </div>
                <div className="input-group">
                  <label>Password</label>
                  <input type="password" name="password" placeholder="Enter password" minLength={6} required autoComplete="current-password" />
                </div>
                <button type="submit" className="auth-btn" disabled={authLoading}>
                  {authLoading ? 'Loading...' : 'Continue'}
                </button>
              </form>
            </div>

            {/* Testimonials */}
            <div className="testimonials">
              <div className="testimonial" key={testimonialIndex}>
                <p className="testimonial-quote">"{testimonials[testimonialIndex].quote}"</p>
                <p className="testimonial-author">
                  — {testimonials[testimonialIndex].author}
                  {testimonials[testimonialIndex].title && (
                    <span className="testimonial-title"> ({testimonials[testimonialIndex].title})</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
