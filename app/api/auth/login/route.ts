import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export const runtime = 'nodejs'

const USERNAME_MIN = 2
const USERNAME_MAX = 16
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED = ['admin', 'root', 'system', 'rory', 'rorchat', 'support', 'mod', 'staff', 'api', 'www', 'ror', 'r', 'ro', 'rordogs', 'the_real_rory', 'rorr']

// Rate limiting for auth attempts
const authAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const LOCKOUT_MINUTES = 15

// Separate rate limiting for new account creation (more strict)
const signupAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_SIGNUPS = 3
const SIGNUP_WINDOW_MINUTES = 60

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         request.headers.get('x-real-ip') || 
         'unknown'
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const record = authAttempts.get(ip)
  
  if (record && now < record.resetAt) {
    if (record.count >= MAX_ATTEMPTS) {
      return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) }
    }
  }
  
  return { allowed: true }
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const record = authAttempts.get(ip)
  
  if (!record || now >= record.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MINUTES * 60 * 1000 })
  } else {
    record.count++
  }
}

function clearAttempts(ip: string): void {
  authAttempts.delete(ip)
}

function checkSignupRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const record = signupAttempts.get(ip)
  
  if (record && now < record.resetAt) {
    if (record.count >= MAX_SIGNUPS) {
      return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) }
    }
  }
  
  return { allowed: true }
}

function recordSignup(ip: string): void {
  const now = Date.now()
  const record = signupAttempts.get(ip)
  
  if (!record || now >= record.resetAt) {
    signupAttempts.set(ip, { count: 1, resetAt: now + SIGNUP_WINDOW_MINUTES * 60 * 1000 })
  } else {
    record.count++
  }
}

function validateUsername(u: string): string | null {
  if (!u || typeof u !== 'string') return 'Username is required'
  const clean = u.trim().toLowerCase()
  if (clean.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`
  if (clean.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or less`
  if (!USERNAME_REGEX.test(clean)) return 'Username must start with a letter and contain only letters, numbers, underscores'
  if (/__/.test(clean)) return 'No consecutive underscores'
  if (RESERVED.includes(clean)) return 'This username is reserved'
  return null
}

function validatePassword(p: string): string | null {
  if (!p || typeof p !== 'string') return 'Password is required'
  if (p.length < 6) return 'Password must be at least 6 characters'
  if (p.length > 72) return 'Password is too long'
  return null
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  
  // Check general rate limit
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { 
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) }
      }
    )
  }

  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
    }

    const cleanUsername = username.trim().toLowerCase()

    // Check if user exists
    const { rows: existingRows } = await db.query(
      'SELECT id, username, display_name, password_hash FROM users WHERE username = $1 LIMIT 1',
      [cleanUsername]
    )
    const existingUser = existingRows[0]

    if (existingUser) {
      // User exists - sign in
      const valid = await bcrypt.compare(password, existingUser.password_hash)
      if (!valid) {
        recordFailedAttempt(ip)
        return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
      }
      
      // Clear rate limit on successful login
      clearAttempts(ip)

      const { token } = await createUserSession(existingUser.id)

      const response = NextResponse.json({
        success: true,
        isNewUser: false,
        user: { id: existingUser.id, username: existingUser.username, display_name: existingUser.display_name }
      })
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())

      return response
    } else {
      // User doesn't exist - create account
      
      // Check signup-specific rate limit
      const signupLimit = checkSignupRateLimit(ip)
      if (!signupLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many new accounts created. Please try again later.' },
          { 
            status: 429,
            headers: { 'Retry-After': String(signupLimit.retryAfter) }
          }
        )
      }

      // Validate username for new accounts
      const uErr = validateUsername(username)
      if (uErr) return NextResponse.json({ error: uErr }, { status: 400 })

      // Validate password
      const pErr = validatePassword(password)
      if (pErr) return NextResponse.json({ error: pErr }, { status: 400 })

      // Hash password and create user
      const passwordHash = await bcrypt.hash(password, 10)

      const { rows: userRows } = await db.query(
        `INSERT INTO users (username, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, username, display_name`,
        [cleanUsername, passwordHash, cleanUsername]
      )

      const user = userRows[0]
      if (!user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

      // Record signup for rate limiting
      recordSignup(ip)

      const { token } = await createUserSession(user.id)

      const response = NextResponse.json({ 
        success: true, 
        isNewUser: true,
        user: { id: user.id, username: user.username, display_name: user.display_name } 
      })
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())

      return response
    }
  } catch (err) {
    console.error('[api/auth/login] error', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
