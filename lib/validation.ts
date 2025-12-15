// Shared validation constants and utilities for messages
// Used by both client and server

export const MAX_MESSAGE_LENGTH = 500 // Most chat apps use 500-1000 chars

// Allowed characters: letters, numbers, basic punctuation, common symbols, and emojis
// This regex allows:
// - Letters (any script via Unicode)
// - Numbers
// - Common punctuation: . , ! ? ; : ' " - _ ( ) [ ] { } @ # $ % & * + = / \ | ~ ` ^ < >
// - Whitespace (space, newline, tab)
// - Emojis (via Unicode ranges)
const ALLOWED_CHARS_REGEX = /^[\p{L}\p{N}\p{Emoji}\p{Emoji_Component}\s\.,!?;:'"''""()\[\]{}\-_@#$%&*+=\/\\|~`^<>]*$/u

export function validateMessageContent(content: string): { valid: boolean; error?: string } {
  // Check if it's only whitespace
  const trimmed = content.trim()
  if (!trimmed) {
    return { valid: false, error: 'Message cannot be empty' }
  }

  // Check length
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` }
  }

  // Check for disallowed characters
  if (!ALLOWED_CHARS_REGEX.test(trimmed)) {
    return { valid: false, error: 'Message contains invalid characters' }
  }

  return { valid: true }
}

// Rate limiting: track message timestamps per user
// In production, this should use Redis or database
const userMessageTimestamps: Map<string, number[]> = new Map()

export const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
export const RATE_LIMIT_MAX_MESSAGES = 15 // 15 messages per minute

export function checkRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now()
  const timestamps = userMessageTimestamps.get(userId) || []
  
  // Remove timestamps older than the window
  const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS)
  
  if (recentTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    // Find when the oldest message in window will expire
    const oldestInWindow = Math.min(...recentTimestamps)
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow)
    return { allowed: false, retryAfterMs }
  }
  
  // Add current timestamp and update map
  recentTimestamps.push(now)
  userMessageTimestamps.set(userId, recentTimestamps)
  
  return { allowed: true }
}

// Clean up old entries periodically (call this in a cleanup routine if needed)
export function cleanupRateLimitData(): void {
  const now = Date.now()
  for (const [userId, timestamps] of userMessageTimestamps.entries()) {
    const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS)
    if (recentTimestamps.length === 0) {
      userMessageTimestamps.delete(userId)
    } else {
      userMessageTimestamps.set(userId, recentTimestamps)
    }
  }
}
