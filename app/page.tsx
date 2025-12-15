'use client'

import { useEffect, useState, useRef, TouchEvent } from 'react'

// Message validation constants (mirrored from server)
const MAX_MESSAGE_LENGTH = 500
const ALLOWED_CHARS_REGEX = /^[\p{L}\p{N}\p{Emoji}\p{Emoji_Component}\s\.,!?;:'"()\[\]{}\-_@#$%&*+=\/\\|~`^<>]*$/u

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

interface Message {
  id?: string
  content: string
  is_admin: boolean
  created_at: string
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin')
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
  const touchStartX = useRef<number | null>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingSentRef = useRef<number>(0)

  const testimonials = [
    {
      quote: "When Rory wasn't texting back, I used Rorchat and got a response within minutes!",
      author: "Elliot",
      title: "Friend of Rory"
    },
    {
      quote: "I used Rorchat to let Rory know that I had his mail while he was travelling!",
      author: "Guy",
      title: "Rory's upstairs neighbor, New York"
    },
    {
      quote: "Rorchat is incredibly impressive technology and I am acquiring it",
      author: "Elon Musk",
      title: "tech guy"
    },
    {
      quote: "Rory I am not going to use this to contact you, but I'm glad you made it",
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
      // Get the ID of the most recent message to only fetch newer ones
      const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null
      
      const url = lastMessageId 
        ? `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}&after=${encodeURIComponent(lastMessageId)}`
        : `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`
      
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      if (cancelled) return
      
      // Only append new messages if we have a cursor, otherwise replace
      if (lastMessageId && data.messages?.length > 0) {
        setMessages(prev => [...prev, ...data.messages])
      } else if (!lastMessageId) {
        setMessages(data.messages || [])
        setHasMoreMessages(data.hasMore || false)
      }
      
      setIsAdminTyping(data.adminTyping || false)
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [currentUser, conversationId, messages])

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

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Signup failed')
      return
    }

    setCurrentUser(data.user)
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    const form = e.currentTarget
    const username = (form.elements.namedItem('username') as HTMLInputElement).value
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Sign in failed')
      return
    }

    setCurrentUser(data.user)
  }

  const handleSignOut = async () => {
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

    setMessageInput('')
    setMessageError('')

    // Clear typing status
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    sendTypingStatus(false)

    // Optimistic update
    setMessages(prev => [...prev, {
      content,
      is_admin: false,
      created_at: new Date().toISOString()
    }])

    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content })
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

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return
    
    const touchEndX = e.changedTouches[0].clientX
    const diff = touchStartX.current - touchEndX
    const threshold = 50 // minimum swipe distance
    
    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        // Swiped left - go to next
        setTestimonialIndex((prev) => (prev + 1) % testimonials.length)
      } else {
        // Swiped right - go to previous
        setTestimonialIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length)
      }
    }
    
    touchStartX.current = null
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
                  <button onClick={handleSignOut}>
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
                <div key={i} className={`message-group ${msg.is_admin ? 'received' : 'sent'}`}>
                  {timestampType === 'header' && (
                    <div className="message-time-header">
                      {formatDateHeader(msg.created_at)}
                    </div>
                  )}
                  <div className={`message ${msg.is_admin ? 'received' : 'sent'}`}>
                    <div className="message-bubble">{msg.content}</div>
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
              <div className="auth-tabs">
                <button 
                  className={`auth-tab ${activeTab === 'signin' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('signin'); setError('') }}
                >
                  Sign in
                </button>
                <button 
                  className={`auth-tab ${activeTab === 'signup' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('signup'); setError('') }}
                >
                  Create account
                </button>
              </div>

              {error && <div className="auth-error show">{error}</div>}

              {activeTab === 'signin' ? (
                <form className="auth-form" onSubmit={handleSignIn}>
                  <div className="input-group">
                    <label>Username</label>
                    <input type="text" name="username" placeholder="Your username" required autoComplete="username" autoCapitalize="none" />
                  </div>
                  <div className="input-group">
                    <label>Password</label>
                    <input type="password" name="password" placeholder="Your password" required autoComplete="current-password" />
                  </div>
                  <button type="submit" className="auth-btn">Sign in</button>
                </form>
              ) : (
                <form className="auth-form" onSubmit={handleSignUp}>
                  <div className="input-group">
                    <label>Username</label>
                    <input type="text" name="username" placeholder="Pick a username" required autoComplete="username" autoCapitalize="none" minLength={3} maxLength={16} />
                  </div>
                  <div className="input-group">
                    <label>Password</label>
                    <input type="password" name="password" placeholder="Create a password" minLength={6} required autoComplete="new-password" />
                  </div>
                  <button type="submit" className="auth-btn">Create account</button>
                </form>
              )}
            </div>

            {/* Testimonials */}
            <div 
              className="testimonials"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="testimonial" key={testimonialIndex}>
                <p className="testimonial-quote">"{testimonials[testimonialIndex].quote}"</p>
                <p className="testimonial-author">
                  — {testimonials[testimonialIndex].author}
                  {testimonials[testimonialIndex].title && (
                    <span className="testimonial-title"> ({testimonials[testimonialIndex].title})</span>
                  )}
                </p>
              </div>
              <div className="testimonial-dots">
                {testimonials.map((_, i) => (
                  <button
                    key={i}
                    className={`testimonial-dot ${i === testimonialIndex ? 'active' : ''}`}
                    onClick={() => setTestimonialIndex(i)}
                    aria-label={`Go to testimonial ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
