'use client'

import { useEffect, useState, useRef } from 'react'
import { usePushNotifications } from '@/lib/usePushNotifications'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

interface Conversation {
  id: string
  visitor_name: string
  updated_at: string
  user_id: string | null
  username?: string | null
  display_name?: string | null
  profile_picture_url?: string | null
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
  image_url?: string | null
  image_width?: number
  image_height?: number
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
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggeredRef = useRef<boolean>(false)
  const lastOptimisticUpdateRef = useRef<number>(0)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const isInitialLoadRef = useRef<boolean>(true)
  const prevMessageCountRef = useRef<number>(0)

  // Image lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Image upload state
  const [imagePreview, setImagePreview] = useState<{ dataUrl: string; width: number; height: number } | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  // Handle mobile keyboard
  useKeyboardHeight()

  // Push notifications for admin
  const { state: pushState, subscribe: subscribePush, unsubscribe: unsubscribePush, isSupported: pushSupported } = usePushNotifications({
    subscribeEndpoint: '/api/admin/push/subscribe'
  })

  useEffect(() => {
    checkAdminSession()

    // Cleanup all timeouts on unmount
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (reactionPickerTimeoutRef.current) clearTimeout(reactionPickerTimeoutRef.current)
      if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (messages.length === 0) return

    // On initial load or conversation switch, scroll instantly (no animation)
    // On new messages, scroll smoothly
    const isInitialOrSwitch = isInitialLoadRef.current || prevMessageCountRef.current === 0
    const hasNewMessages = messages.length > prevMessageCountRef.current

    if (isInitialOrSwitch) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      isInitialLoadRef.current = false
    } else if (hasNewMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    prevMessageCountRef.current = messages.length
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

    const heartbeat = () => fetch('/api/admin/me').catch(() => { })
    heartbeat() // Initial ping
    const interval = setInterval(heartbeat, 10_000) // Every 10 seconds
    return () => clearInterval(interval)
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !selectedConv) return

    // Clear messages immediately when switching conversations to prevent stale data
    setMessages([])
    setIsUserTyping(false)

    // Track if this effect is still current (prevents stale responses from overwriting)
    let isCurrent = true
    const convId = selectedConv.id

    const loadMessagesForConv = async (force = false) => {
      if (!isCurrent) return
      // Skip refresh if an optimistic update happened in the last 3 seconds
      if (!force && Date.now() - lastOptimisticUpdateRef.current < 3000) {
        return
      }

      const res = await fetch(`/api/admin/messages?conversationId=${encodeURIComponent(convId)}`)
      if (!res.ok || !isCurrent) return
      const data = await res.json()
      if (!isCurrent) return // Double-check after async
      setMessages(data.messages || [])
      setIsUserTyping(data.userTyping || false)
    }

    loadMessagesForConv(true) // Force initial load
    const interval = setInterval(() => loadMessagesForConv(), 2000)

    return () => {
      isCurrent = false
      clearInterval(interval)
    }
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
    }).catch(() => { })
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

    // Mark that an optimistic update is happening
    lastOptimisticUpdateRef.current = Date.now()

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

  const hideReactionPicker = () => {
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
    }
    setActiveReactionPicker(null)
  }

  // Long press handlers for mobile
  const handleMessageTouchStart = (messageId: string | undefined) => {
    if (!messageId) return

    longPressTriggeredRef.current = false
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      showReactionPicker(messageId)
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, 500)
  }

  const handleMessageTouchEnd = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
    }
  }

  const handleMessageTouchMove = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
    }
  }

  const selectConversation = (conv: Conversation) => {
    // Clear any pending timeouts from previous conversation
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
      reactionPickerTimeoutRef.current = null
    }

    setSelectedConv(conv)
    setMobileView('chat')
    setReplyingTo(null)
    setActiveReactionPicker(null)
    setImagePreview(null)
    // Reset scroll tracking for new conversation
    isInitialLoadRef.current = true
    prevMessageCountRef.current = 0
    // Messages will be loaded by the useEffect when selectedConv changes
  }

  const goBackToList = () => {
    // Clear all pending timeouts to prevent stale state updates
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
    if (reactionPickerTimeoutRef.current) {
      clearTimeout(reactionPickerTimeoutRef.current)
      reactionPickerTimeoutRef.current = null
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }

    setMobileView('list')
    setSelectedConv(null) // Clear selected conversation to stop message polling
    setMessages([]) // Clear messages to prevent stale data
    setReplyingTo(null)
    setActiveReactionPicker(null)
    setIsUserTyping(false)
    setImagePreview(null)
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
    if (input) {
      input.style.height = 'auto'
      input.style.height = '48px' // Reset to default min-height
    }
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

  // Image upload functions
  const pickFile = (accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      let settled = false
      let focusTimer: number | null = null

      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.tabIndex = -1
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '-9999px'
      input.style.opacity = '0'
      input.style.pointerEvents = 'none'

      const cleanup = () => {
        if (focusTimer !== null) {
          window.clearTimeout(focusTimer)
          focusTimer = null
        }
        window.removeEventListener('focus', onWindowFocus, true)
        input.remove()
      }

      const settle = (file: File | null) => {
        if (settled) return
        settled = true
        resolve(file)
        cleanup()
      }

      const onChange = () => {
        settle(input.files?.[0] ?? null)
      }

      const onWindowFocus = () => {
        if (focusTimer !== null) window.clearTimeout(focusTimer)
        focusTimer = window.setTimeout(() => {
          if (settled) return
          if (input.files && input.files.length > 0) return
          settle(null)
        }, 300)
      }

      input.addEventListener('change', onChange, { once: true })
      window.addEventListener('focus', onWindowFocus, true)

      document.body.appendChild(input)
      input.click()
    })
  }

  const handleChatImageFile = async (file: File) => {
    try {
      const { processImage, validateImageFile } = await import('@/lib/imageUtils')
      const validation = validateImageFile(file)
      if (!validation.valid) {
        setError(validation.error || 'Invalid image')
        return
      }
      const processed = await processImage(file, 'chat')
      setImagePreview({
        dataUrl: processed.dataUrl,
        width: processed.width,
        height: processed.height
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image')
    }
  }

  const pickChatImage = async () => {
    if (!selectedConv || imagePreview) return
    const file = await pickFile('image/jpeg,image/png,image/gif,image/webp')
    if (!file) return
    await handleChatImageFile(file)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          e.preventDefault()
          if (!selectedConv || imagePreview) return
          await handleChatImageFile(file)
          break
        }
      }
    }
  }

  const cancelImageUpload = () => {
    setImagePreview(null)
  }

  const sendImageMessage = async () => {
    if (!selectedConv || !imagePreview || uploadingImage) return

    setUploadingImage(true)

    // Mark optimistic update
    lastOptimisticUpdateRef.current = Date.now()

    // Store values before clearing state
    const tempMessage: Message = {
      content: '📷 Image',
      is_admin: true,
      created_at: new Date().toISOString(),
      image_url: imagePreview.dataUrl,
      image_width: imagePreview.width,
      image_height: imagePreview.height,
      reply_to: replyingTo ? {
        id: replyingTo.id!,
        content: replyingTo.content,
        is_admin: replyingTo.is_admin
      } : null
    }

    // Optimistic update
    setMessages(prev => [...prev, tempMessage])

    const replyToId = replyingTo?.id
    setImagePreview(null)
    setReplyingTo(null)

    try {
      await fetch('/api/admin/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          imageData: tempMessage.image_url,
          imageWidth: tempMessage.image_width,
          imageHeight: tempMessage.image_height,
          replyToId
        })
      })
    } finally {
      setUploadingImage(false)
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()

    // Check if it's today by comparing dates (not just time diff)
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      const diff = now.getTime() - date.getTime()
      if (diff < 60000) return 'Just now'
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Not today - show relative days/weeks
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 7) return `${diffDays}d`

    const diffWeeks = Math.floor(diffDays / 7)
    if (diffWeeks < 4) return `${diffWeeks}w`

    const diffMonths = Math.floor(diffDays / 30)
    if (diffMonths < 12) return `${diffMonths}mo`

    const diffYears = Math.floor(diffDays / 365)
    return `${diffYears}y`
  }

  const getDisplayName = (conv: Conversation) => {
    if (conv.display_name) return conv.display_name
    if (conv.username) return conv.username
    return conv.visitor_name || 'Anonymous'
  }

  const getUsername = (conv: Conversation) => {
    return conv.username || ''
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

  const formatDateHeader = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return `Yesterday ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' }) + ' ' + new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }

  return (
    <>
      <div className="bg-decoration">
        <svg className="wave-top" viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
          <path d="M0,60 C360,120 720,0 1080,60 C1260,90 1380,30 1440,60 L1440,0 L0,0 Z" fill="var(--primary)" opacity="0.03" />
        </svg>
        <div className="gradient-orb orb-1"></div>
      </div>

      {!isAuthenticated && (
        <div className="admin-modal">
          <div className="admin-modal-content">
            <div className="admin-icon">🔐</div>
            <h2>Admin access</h2>
            <p>Enter your password to continue</p>
            {error && <div className="error-msg show">{error}</div>}
            <form onSubmit={handleLogin} autoComplete="off" data-form-type="other">
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              <button type="submit">Sign in</button>
            </form>
          </div>
        </div>
      )}

      <div className={`admin-app ${mobileView === 'chat' ? 'mobile-chat-view' : 'mobile-list-view'}`} style={{ display: isAuthenticated ? 'flex' : 'none' }}>
        <aside className="sidebar">
          <div className="sidebar-header">
            <a href="/" className="logo">
              <span className="logo-text">rorchat<span className="dot">.</span></span>
            </a>
            <div className="sidebar-header-actions">
              {/* Notification bell for admin */}
              {pushSupported && isAuthenticated && (
                <button
                  className={`notification-btn ${pushState === 'subscribed' ? 'active' : ''}`}
                  onClick={() => pushState === 'subscribed' ? unsubscribePush() : subscribePush()}
                  title={pushState === 'subscribed' ? 'Notifications on' : 'Enable notifications'}
                  aria-label={pushState === 'subscribed' ? 'Disable notifications' : 'Enable notifications'}
                >
                  {pushState === 'subscribed' ? (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  )}
                </button>
              )}
              <span className="admin-badge">Admin</span>
            </div>
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
                <h3>No conversations yet</h3>
                <p>When someone messages you, their conversation will appear here</p>
              </div>
            ) : (
              <>
                {conversations.map(conv => (
                  <div
                    key={conv.id}
                    className={`conversation-item ${selectedConv?.id === conv.id ? 'active' : ''}`}
                    onClick={() => selectConversation(conv)}
                  >
                    <div className="conversation-item-content">
                      <div className="conversation-avatar">
                        {conv.profile_picture_url ? (
                          <img src={conv.profile_picture_url} alt={getDisplayName(conv)} />
                        ) : (
                          <span>{getDisplayName(conv).charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="conversation-info">
                        <div className="conversation-header">
                          <span className="conversation-name">{getDisplayName(conv)}</span>
                          <span className="conversation-time">{formatTime(conv.updated_at)}</span>
                        </div>
                        <div className="conversation-preview">@{getUsername(conv)}</div>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="conversations-footer">
                  <div className="footer-decoration"></div>
                </div>
              </>
            )}
          </div>
        </aside>

        <main className="chat-area">
          {!selectedConv ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">📬</div>
              <h2>Select a conversation</h2>
              <p>Choose a conversation from the list to view messages and reply</p>
            </div>
          ) : (
            <>
              <header className="chat-header admin-chat-header">
                <div className="chat-header-left">
                  <button className="back-btn" onClick={goBackToList} aria-label="Back to conversations">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {selectedConv.profile_picture_url ? (
                    <div className="avatar-img">
                      <img src={selectedConv.profile_picture_url} alt={getDisplayName(selectedConv)} />
                    </div>
                  ) : (
                    <div className="avatar">{getDisplayName(selectedConv).charAt(0).toUpperCase()}</div>
                  )}
                  <div className="chat-header-info">
                    <h2>{getDisplayName(selectedConv)}</h2>
                    <div className="status">@{getUsername(selectedConv)}</div>
                  </div>
                </div>
              </header>

              <div className="messages-container">
                {messages.map((msg, i) => {
                  const timestampType = shouldShowTimestamp(messages, i)
                  const showInline = shouldShowInlineTimestamp(messages, i)

                  return (
                    <div key={msg.id || i} className={`message-group ${msg.is_admin ? 'sent' : 'received'}`}>
                      {timestampType === 'header' && (
                        <div className="message-time-header">
                          {formatDateHeader(msg.created_at)}
                        </div>
                      )}
                      <div
                        className={`message ${msg.is_admin ? 'sent' : 'received'} ${activeReactionPicker === msg.id ? 'picker-active' : ''}`}
                        onTouchStart={() => handleMessageTouchStart(msg.id)}
                        onTouchEnd={handleMessageTouchEnd}
                        onTouchMove={handleMessageTouchMove}
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
                        {msg.image_url ? (
                          <div className="message-image" onClick={() => setLightboxImage(msg.image_url!)}>
                            <img
                              src={msg.image_url}
                              alt="Shared image"
                            />
                          </div>
                        ) : (
                          <div className="message-bubble">{msg.content}</div>
                        )}

                        {/* Hover action buttons (desktop) */}
                        {msg.id && (
                          <div className={`message-actions ${msg.is_admin ? 'right' : 'left'}`}>
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
                                className={`reaction-badge ${r.hasAdmin ? 'admin-reacted' : ''}`}
                                onClick={() => handleReaction(msg.id, r.emoji)}
                              >
                                <span className="reaction-emoji">{r.emoji}</span>
                                {r.count > 1 && <span className="reaction-count">{r.count}</span>}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Reaction picker (shown on mobile long-press or desktop click) */}
                        {activeReactionPicker === msg.id && (
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
                          <div className="message-time">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
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

              <form className="reply-area" onSubmit={sendReply} autoComplete="off" data-form-type="other">
                {/* Image preview */}
                {imagePreview && (
                  <div className="image-preview">
                    <img src={imagePreview.dataUrl} alt="Preview" />
                    <div className="image-preview-actions">
                      <button type="button" className="image-preview-cancel" onClick={cancelImageUpload}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="image-preview-send"
                        onClick={sendImageMessage}
                        disabled={uploadingImage}
                      >
                        {uploadingImage ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply preview */}
                {replyingTo && !imagePreview && (
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
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
                <div className="reply-input-wrapper">
                  {!imagePreview && (
                    <button
                      type="button"
                      className="image-picker-btn"
                      onClick={pickChatImage}
                      title="Send image"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </button>
                  )}
                  <textarea
                    ref={replyInputRef}
                    className="reply-input"
                    name="reply"
                    placeholder="Type a reply..."
                    rows={1}
                    enterKeyHint="send"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="sentences"
                    spellCheck="false"
                    inputMode="text"
                    disabled={!!imagePreview}
                    onInput={(e) => {
                      handleTyping()
                      const target = e.target as HTMLTextAreaElement
                      target.style.height = 'auto'
                      target.style.height = `${target.scrollHeight + 4}px`
                    }}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        e.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button type="submit" className="send-btn" disabled={!!imagePreview}>
                    <svg viewBox="0 0 24 24">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  </button>
                </div>
              </form>
            </>
          )}
        </main>
      </div>

      {/* Image Lightbox */}
      {lightboxImage && (
        <div className="image-lightbox" onClick={() => setLightboxImage(null)}>
          <button className="lightbox-close" onClick={() => setLightboxImage(null)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <img src={lightboxImage} alt="Full size" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
