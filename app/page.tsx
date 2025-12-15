'use client'

import { useEffect, useState, useRef } from 'react'

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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [testimonialIndex, setTestimonialIndex] = useState(0)

  const testimonials = [
    {
      quote: "When Rory wasn't texting back, I used Rorchat and got a response within minutes!",
      author: "Elliot",
      title: "CoFounded a company with Rory"
    },
    {
      quote: "I used Rorchat to let Rory know that I had his mail while he was travelling and I haaaated it",
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

  useEffect(() => {
    // Check if already logged in
    checkAuth()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const interval = setInterval(() => {
      setTestimonialIndex((prev) => (prev + 1) % testimonials.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [testimonials.length])

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
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser || !conversationId) return

    let cancelled = false
    const interval = setInterval(async () => {
      const res = await fetch(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`)
      if (!res.ok) return
      const data = await res.json()
      if (cancelled) return
      setMessages(data.messages || [])
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [currentUser, conversationId])

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

    const form = e.currentTarget
    const input = form.elements.namedItem('message') as HTMLTextAreaElement
    const content = input.value.trim()
    
    if (!content) return

    input.value = ''

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
      // fallback: refresh from server
      const refresh = await fetch(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`)
      if (refresh.ok) {
        const data = await refresh.json()
        setMessages(data.messages || [])
      }
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  if (loading) {
    return (
      <div className="app">
        <div className="auth-view">
          <div className="auth-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Decorative Background */}
      <div className="bg-decoration">
        <svg className="wave-top" viewBox="0 0 1440 120" fill="none" preserveAspectRatio="none">
          <path d="M0,60 C360,120 720,0 1080,60 C1260,90 1380,30 1440,60 L1440,0 L0,0 Z" fill="var(--primary)" opacity="0.03"/>
          <path d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,0 L0,0 Z" fill="var(--primary)" opacity="0.02"/>
        </svg>
        <svg className="wave-bottom" viewBox="0 0 1440 100" fill="none" preserveAspectRatio="none">
          <path d="M0,50 C360,100 720,0 1080,50 C1260,75 1380,25 1440,50 L1440,0 L0,0 Z" fill="var(--success)" opacity="0.03"/>
        </svg>
        <svg className="line-art line-art-1" viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="80" stroke="var(--primary)" strokeWidth="1"/>
          <circle cx="100" cy="100" r="60" stroke="var(--primary)" strokeWidth="0.5"/>
          <circle cx="100" cy="100" r="40" stroke="var(--primary)" strokeWidth="0.5"/>
          <path d="M20,100 Q100,20 180,100 Q100,180 20,100" stroke="var(--primary)" strokeWidth="0.5" fill="none"/>
        </svg>
        <svg className="line-art line-art-2" viewBox="0 0 200 200" fill="none">
          <path d="M0,100 C50,50 150,150 200,100" stroke="var(--text)" strokeWidth="1" fill="none"/>
          <path d="M0,120 C50,70 150,170 200,120" stroke="var(--text)" strokeWidth="0.5" fill="none"/>
          <path d="M0,140 C50,90 150,190 200,140" stroke="var(--text)" strokeWidth="0.5" fill="none"/>
          <circle cx="50" cy="100" r="30" stroke="var(--text)" strokeWidth="0.5" fill="none"/>
          <circle cx="150" cy="100" r="25" stroke="var(--text)" strokeWidth="0.5" fill="none"/>
        </svg>
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
      </div>

      <div className="app">
        {/* Auth View */}
        <div className={`auth-view ${currentUser ? 'hidden' : ''}`}>
          <div className="auth-header">
            <a href="/" className="logo">
              <span className="logo-text">rorchat<span className="dot">.</span></span>
            </a>
          </div>

          <div className="auth-content">
            <div className="hero">
              <h1>Reach Rory, Today</h1>
              <p>The easiest way to reach Rory. Simple, fast, straightforward.</p>
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
                    <span className="input-hint">3-16 chars, starts with a letter</span>
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
              <div className="testimonial-dots">
                {testimonials.map((_, i) => (
                  <button
                    key={i}
                    className={`testimonial-dot ${i === testimonialIndex ? 'active' : ''}`}
                    onClick={() => setTestimonialIndex(i)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chat View */}
        <div className={`chat-view ${currentUser ? 'active' : ''}`}>
          <header className="chat-header">
            <div className="chat-header-left">
              <div className="avatar">R</div>
              <div className="chat-header-info">
                <h2>Rory</h2>
                <div className="status">
                  <span className="status-dot"></span>
                  Online
                </div>
              </div>
            </div>
            <div className="header-actions">
              <div className="user-pill">
                <span>{currentUser?.display_name || currentUser?.username || 'User'}</span>
              </div>
              <button className="header-btn" onClick={handleSignOut} title="Sign out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
              </button>
            </div>
          </header>

          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="welcome-chat">
                <div className="welcome-icon">💬</div>
                <h3>Start a conversation</h3>
                <p>Send a message and Rory will get back to you soon.</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`message ${msg.is_admin ? 'received' : 'sent'}`}>
                  <div className="message-bubble">{msg.content}</div>
                  <div className="message-time">{formatTime(msg.created_at)}</div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="input-area" onSubmit={sendMessage}>
            <div className="input-wrapper">
              <textarea 
                className="message-input" 
                name="message"
                placeholder="Message..."
                rows={1}
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
        </div>
      </div>
    </>
  )
}
