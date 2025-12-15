'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

interface Conversation {
  id: string
  visitor_name: string
  updated_at: string
  user_id: string
}

interface Message {
  id?: string
  content: string
  is_admin: boolean
  created_at: string
}

interface Profile {
  username: string
  display_name: string
}

export default function Admin() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (url && key) {
      setSupabase(createClient(url, key))
    }

    if (typeof window !== 'undefined' && localStorage.getItem('rorchat_admin') === 'true') {
      setIsAuthenticated(true)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated && supabase) {
      loadConversations()
      subscribeToConversations()
    }
  }, [isAuthenticated, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })

    if (res.ok) {
      setIsAuthenticated(true)
      localStorage.setItem('rorchat_admin', 'true')
    } else {
      setError('Invalid password')
    }
  }

  const loadConversations = async () => {
    if (!supabase) return

    const { data: convs } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })

    if (convs) {
      setConversations(convs)
      
      const userIds = [...new Set(convs.map(c => c.user_id).filter(Boolean))]
      const { data: profs } = await supabase
        .from('users')
        .select('id, username, display_name')
        .in('id', userIds)
      
      if (profs) {
        const profileMap: Record<string, Profile> = {}
        profs.forEach(p => {
          profileMap[p.id] = { username: p.username, display_name: p.display_name }
        })
        setProfiles(profileMap)
      }
    }
  }

  const subscribeToConversations = () => {
    if (!supabase) return

    supabase
      .channel('admin-conversations')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'conversations' }, 
        () => loadConversations()
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (selectedConv && payload.new.conversation_id === selectedConv.id && !payload.new.is_admin) {
            setMessages(prev => [...prev, payload.new as Message])
          }
          loadConversations()
        }
      )
      .subscribe()
  }

  const selectConversation = async (conv: Conversation) => {
    if (!supabase) return
    
    setSelectedConv(conv)
    
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
    
    if (msgs) setMessages(msgs)
  }

  const sendReply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!supabase || !selectedConv) return

    const form = e.currentTarget
    const input = form.elements.namedItem('reply') as HTMLTextAreaElement
    const content = input.value.trim()
    
    if (!content) return

    input.value = ''

    setMessages(prev => [...prev, {
      content,
      is_admin: true,
      created_at: new Date().toISOString()
    }])

    await supabase.from('messages').insert({
      conversation_id: selectedConv.id,
      content,
      is_admin: true
    })

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', selectedConv.id)
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
    const profile = profiles[conv.user_id]
    if (profile) {
      return profile.display_name || profile.username
    }
    return conv.visitor_name || 'Anonymous'
  }

  const getUsername = (conv: Conversation) => {
    const profile = profiles[conv.user_id]
    return profile?.username || ''
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

      <div className="admin-app" style={{ display: isAuthenticated ? 'flex' : 'none' }}>
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
                    <span className="conversation-name">
                      {getDisplayName(conv)}
                    </span>
                    <span className="conversation-time">{formatTime(conv.updated_at)}</span>
                  </div>
                  <div className="conversation-preview">
                    @{getUsername(conv)}
                  </div>
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
              <header className="chat-header">
                <div className="chat-header-left">
                  <div className="avatar">
                    {getDisplayName(selectedConv).charAt(0).toUpperCase()}
                  </div>
                  <div className="chat-header-info">
                    <h2>{getDisplayName(selectedConv)}</h2>
                    <div className="status">@{getUsername(selectedConv)}</div>
                  </div>
                </div>
              </header>

              <div className="messages-container">
                {messages.map((msg, i) => (
                  <div key={i} className={`message ${msg.is_admin ? 'sent' : 'received'}`}>
                    <div className="message-bubble">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form className="reply-area" onSubmit={sendReply}>
                <textarea
                  className="reply-input"
                  name="reply"
                  placeholder="Type a reply..."
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
              </form>
            </>
          )}
        </main>
      </div>
    </>
  )
}

