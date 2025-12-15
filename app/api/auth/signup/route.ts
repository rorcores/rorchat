import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

const USERNAME_MIN = 3
const USERNAME_MAX = 16
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED = ['admin', 'root', 'system', 'rory', 'rorchat', 'support', 'mod', 'staff', 'api', 'www']

// Rate limiting for signups (more strict to prevent spam)
const signupAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_SIGNUPS = 3  // Max signups per IP per hour
const SIGNUP_WINDOW_MINUTES = 60

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         request.headers.get('x-real-ip') || 
         'unknown'
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
  
  // Check rate limit
  const rateLimit = checkSignupRateLimit(ip)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many signups. Please try again later.' },
      { 
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfter) }
      }
    )
  }

  try {
    const { username, password } = await request.json()

    const uErr = validateUsername(username)
    if (uErr) return NextResponse.json({ error: uErr }, { status: 400 })

    const pErr = validatePassword(password)
    if (pErr) return NextResponse.json({ error: pErr }, { status: 400 })

    const cleanUsername = username.trim().toLowerCase()

    // Check if username taken
    const { rows: existingRows } = await db.query(
      'SELECT id FROM users WHERE username = $1 LIMIT 1',
      [cleanUsername]
    )

    if (existingRows.length > 0) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 409 })
    }

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

    const response = NextResponse.json({ success: true, user: { id: user.id, username: user.username, display_name: user.display_name } })
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())

    return response
  } catch {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
