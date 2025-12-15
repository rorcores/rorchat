import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

// Simple in-memory rate limiting
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const LOCKOUT_MINUTES = 15

function getClientIP(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         request.headers.get('x-real-ip') || 
         'unknown'
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  
  if (record && now < record.resetAt) {
    if (record.count >= MAX_ATTEMPTS) {
      return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) }
    }
  }
  
  return { allowed: true }
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  
  if (!record || now >= record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MINUTES * 60 * 1000 })
  } else {
    record.count++
  }
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  
  // Check rate limit
  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Please try again later.' },
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

    // Find user
    const { rows } = await db.query(
      'SELECT id, username, display_name, password_hash FROM users WHERE username = $1 LIMIT 1',
      [cleanUsername]
    )
    const user = rows[0]

    if (!user) {
      recordFailedAttempt(ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      recordFailedAttempt(ip)
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }
    
    // Clear rate limit on successful login
    clearAttempts(ip)

    const { token } = await createUserSession(user.id)

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, display_name: user.display_name }
    })
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())

    return response
  } catch {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
