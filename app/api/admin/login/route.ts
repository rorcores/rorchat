import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'

const ADMIN_COOKIE = 'admin_session'
const ADMIN_TTL_DAYS = 30

// Simple in-memory rate limiting for admin login
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // Use a fixed-length comparison to prevent length leaks
  const maxLen = Math.max(bufA.length, bufB.length)
  const paddedA = Buffer.alloc(maxLen)
  const paddedB = Buffer.alloc(maxLen)
  bufA.copy(paddedA)
  bufB.copy(paddedB)
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length
}

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

  const { password } = await request.json()
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminPassword) {
    return NextResponse.json({ error: 'Admin password not configured' }, { status: 500 })
  }

  // Use constant-time comparison to prevent timing attacks
  if (typeof password !== 'string' || !secureCompare(password, adminPassword)) {
    recordFailedAttempt(ip)
    // keep message generic
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }
  
  // Clear rate limit on successful login
  clearAttempts(ip)

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + ADMIN_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.query('INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)', [tokenHash, expiresAt])

  const response = NextResponse.json({ success: true })
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * ADMIN_TTL_DAYS
  })
  return response
}

export { ADMIN_COOKIE }