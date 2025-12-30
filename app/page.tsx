'use client'

import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { usePushNotifications } from '@/lib/usePushNotifications'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'

// Lazy load the cropper to avoid SSR issues
const ImageCropper = lazy(() => import('@/lib/ImageCropper'))

// Message validation constants (mirrored from server)
const MAX_MESSAGE_LENGTH = 500
const ALLOWED_CHARS_REGEX = /^[\p{L}\p{N}\p{P}\p{S}\p{M}\p{Z}\p{Emoji}\p{Emoji_Component}]*$/u

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

// Import image utilities dynamically to avoid SSR issues
async function processImageFile(file: File, type: 'profile' | 'chat') {
  const { processImage, validateImageFile } = await import('@/lib/imageUtils')
  const validation = validateImageFile(file)
  if (!validation.valid) {
    throw new Error(validation.error)
  }
  return processImage(file, type)
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false)
  const [settingsUsername, setSettingsUsername] = useState('')
  const [settingsProfilePic, setSettingsProfilePic] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')
  const [imageToCrop, setImageToCrop] = useState<string | null>(null)

  // Image upload state for chat
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ dataUrl: string; width: number; height: number } | null>(null)

  // Image lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Handle mobile keyboard
  useKeyboardHeight()

  // Push notifications
  const { state: pushState, subscribe: subscribePush, unsubscribe: unsubscribePush, isSupported: pushSupported } = usePushNotifications({
    subscribeEndpoint: '/api/push/subscribe'
  })

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
      title: "Rory's neighbor, New York"
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

  // Auto-resize textarea when input changes
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to correctly calculate scrollHeight for shrinking
    textarea.style.height = 'auto'
    // Set new height based on scrollHeight + borders (2px top + 2px bottom = 4px)
    textarea.style.height = `${textarea.scrollHeight + 4}px`
  }, [messageInput])

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

  const sendMessage = async (e?: React.SyntheticEvent) => {
    e?.preventDefault()
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

  // Settings modal functions
  const openSettings = () => {
    if (currentUser) {
      setSettingsUsername(currentUser.username || '')
      setSettingsProfilePic(currentUser.profile_picture_url || null)
      setSettingsError('')
      setSettingsSuccess('')
      setImageToCrop(null)
      setShowSettings(true)
    }
  }

  const closeSettings = () => {
    setShowSettings(false)
    setSettingsError('')
    setSettingsSuccess('')
  }

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
        // Desktop browsers often fire `focus` before the input's `change` event.
        // Delay the "treat as cancel" path, and only cancel if no file was selected.
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

  const handleProfilePicFile = async (file: File) => {
    try {
      setSettingsError('')
      // Load image as data URL for cropper
      const reader = new FileReader()
      reader.onload = (event) => {
        setImageToCrop(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load image')
    }
  }

  const pickProfilePhoto = async () => {
    const file = await pickFile('image/jpeg,image/png,image/gif,image/webp')
    if (!file) return
    await handleProfilePicFile(file)
  }

  const handleCropComplete = (croppedDataUrl: string) => {
    setSettingsProfilePic(croppedDataUrl)
    setImageToCrop(null)
  }

  const handleCropCancel = () => {
    setImageToCrop(null)
  }

  const saveSettings = async () => {
    if (!currentUser) return

    setSettingsSaving(true)
    setSettingsError('')
    setSettingsSuccess('')

    try {
      const updates: Record<string, string | null> = {}

      if (settingsUsername !== currentUser.username) {
        updates.username = settingsUsername
        // Also update display_name to match username
        updates.display_name = settingsUsername
      }
      if (settingsProfilePic !== (currentUser.profile_picture_url || null)) {
        updates.profile_picture = settingsProfilePic
      }

      if (Object.keys(updates).length === 0) {
        setSettingsSuccess('No changes to save')
        setSettingsSaving(false)
        return
      }

      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      const data = await res.json()

      if (!res.ok) {
        setSettingsError(data.error || 'Failed to save settings')
        return
      }

      // Update local user state
      setCurrentUser(data.user)
      setSettingsSuccess('Settings saved!')

      // Close modal after short delay
      setTimeout(() => closeSettings(), 1500)
    } catch {
      setSettingsError('Failed to save settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  // Image upload for chat
  const handleChatImageFile = async (file: File) => {
    try {
      setMessageError('')
      const processed = await processImageFile(file, 'chat')
      setImagePreview({
        dataUrl: processed.dataUrl,
        width: processed.width,
        height: processed.height
      })
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to process image')
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          e.preventDefault()
          if (!currentUser || rateLimitCountdown > 0 || imagePreview) return
          await handleChatImageFile(file)
          break
        }
      }
    }
  }

  const pickChatImage = async () => {
    if (!currentUser || rateLimitCountdown > 0 || imagePreview) return
    const file = await pickFile('image/jpeg,image/png,image/gif,image/webp')
    if (!file) return
    await handleChatImageFile(file)
  }

  const cancelImageUpload = () => {
    setImagePreview(null)
  }

  const sendImageMessage = async () => {
    if (!conversationId || !imagePreview || uploadingImage) return
    if (rateLimitCountdown > 0) return

    setUploadingImage(true)
    setMessageError('')

    // Mark optimistic update
    lastOptimisticUpdateRef.current = Date.now()

    // Optimistic update
    const tempMessage: Message = {
      content: '📷 Image',
      is_admin: false,
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
    setMessages(prev => [...prev, tempMessage])

    const replyToId = replyingTo?.id
    setImagePreview(null)
    setReplyingTo(null)

    try {
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          imageData: tempMessage.image_url,
          width: tempMessage.image_width,
          height: tempMessage.image_height,
          replyToId
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))

        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10)
          setRateLimitCountdown(retryAfter)
          setMessageError('Too many messages. Please wait...')
        } else {
          setMessageError(data.error || 'Failed to send image')
        }

        // Refresh from server on error
        const refresh = await fetch(`/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`)
        if (refresh.ok) {
          const refreshData = await refresh.json()
          setMessages(refreshData.messages || [])
        }
      }
    } finally {
      setUploadingImage(false)
    }
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
              <>
                {/* Notification bell */}
                {pushSupported && (
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
                <div className="user-menu">
                  <button className="user-pill" onClick={(e) => {
                    const menu = e.currentTarget.nextElementSibling;
                    menu?.classList.toggle('show');
                  }}>
                    <span>{currentUser?.display_name || currentUser?.username || 'User'}</span>
                    <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <div className="user-dropdown">
                    <button onClick={(e) => { e.stopPropagation(); openSettings(); document.querySelector('.user-dropdown')?.classList.remove('show'); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      Settings
                    </button>
                    <button onClick={(e) => handleSignOut(e)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                </div>
              </>
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
              <p>Rory will reply to you as soon as possible!</p>
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

        {/* Not a <form>: avoids iOS Safari's Prev/Next/Done accessory bar */}
        <div className="input-area" role="form" aria-label="Message composer">

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
                  disabled={uploadingImage || rateLimitCountdown > 0}
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
                  <path d="M18 6L6 18M6 6l12 12" />
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
            {!imagePreview && (
              <button
                type="button"
                className="image-picker-btn"
                onClick={pickChatImage}
                disabled={!currentUser || rateLimitCountdown > 0}
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
              ref={textareaRef}
              className="message-input"
              aria-label="Message"
              placeholder={rateLimitCountdown > 0 ? `Wait ${rateLimitCountdown}s...` : "Message..."}
              rows={1}
              disabled={!currentUser || rateLimitCountdown > 0 || !!imagePreview}
              value={messageInput}
              maxLength={MAX_MESSAGE_LENGTH}
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck="false"
              inputMode="text"
              onChange={(e) => {
                setMessageInput(e.target.value)
                if (rateLimitCountdown === 0) setMessageError('')
                handleTyping()
              }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage()
                }
              }}
            />
            <button
              type="button"
              className="send-btn"
              onClick={() => void sendMessage()}
              disabled={!currentUser || !messageInput.trim() || rateLimitCountdown > 0 || !!imagePreview}
            >
              <svg viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
          {messageInput.length > MAX_MESSAGE_LENGTH * 0.8 && (
            <div className={`char-count ${messageInput.length >= MAX_MESSAGE_LENGTH ? 'limit' : ''}`}>
              {messageInput.length}/{MAX_MESSAGE_LENGTH}
            </div>
          )}
        </div>
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

              <form
                className="auth-form"
                onSubmit={handleAuth}
                action="#"
                method="POST"
              >
                <div className="input-group">
                  <label htmlFor="auth-username">Username</label>
                  <input
                    id="auth-username"
                    type="text"
                    name="username"
                    placeholder="Enter username"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    minLength={2}
                    maxLength={16}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="auth-password">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    name="password"
                    placeholder="Enter password"
                    minLength={6}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <button
                  type="submit"
                  className="auth-btn"
                  disabled={authLoading}
                >
                  {authLoading ? 'Loading...' : 'Sign Up/In'}
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

      {/* Settings Modal */}
      {showSettings && currentUser && (
        <div className="settings-overlay" onClick={closeSettings}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="settings-close" onClick={closeSettings}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="settings-content">
              {/* Profile Picture */}
              <div className="settings-section">
                <label className="settings-label">Profile Picture</label>
                <div className="profile-pic-editor">
                  <div className="profile-pic-preview">
                    {settingsProfilePic ? (
                      <img src={settingsProfilePic} alt="Profile" />
                    ) : (
                      <div className="profile-pic-placeholder">
                        {(settingsUsername || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="profile-pic-actions">
                    <button
                      type="button"
                      className="profile-pic-btn"
                      onClick={pickProfilePhoto}
                    >
                      Change Photo
                    </button>
                    {settingsProfilePic && (
                      <button
                        type="button"
                        className="profile-pic-btn remove"
                        onClick={() => setSettingsProfilePic(null)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Username */}
              <div className="settings-section">
                <label className="settings-label" htmlFor="settings-username">Username</label>
                <input
                  id="settings-username"
                  type="text"
                  className="settings-input"
                  value={settingsUsername}
                  onChange={e => setSettingsUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  maxLength={16}
                  placeholder="username"
                />
                <span className="settings-hint">2-16 characters, letters, numbers, underscores</span>
              </div>

              {/* Error/Success messages */}
              {settingsError && <div className="settings-error">{settingsError}</div>}
              {settingsSuccess && <div className="settings-success">{settingsSuccess}</div>}
            </div>

            <div className="settings-footer">
              <button className="settings-btn cancel" onClick={closeSettings}>
                Cancel
              </button>
              <button
                className="settings-btn save"
                onClick={saveSettings}
                disabled={settingsSaving}
              >
                {settingsSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Cropper */}
      {imageToCrop && (
        <Suspense fallback={<div className="image-cropper-overlay"><div className="loading-spinner" /></div>}>
          <ImageCropper
            imageSrc={imageToCrop}
            onCrop={handleCropComplete}
            onCancel={handleCropCancel}
          />
        </Suspense>
      )}
    </div>
  )
}
