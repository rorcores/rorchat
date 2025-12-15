import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'

const ADMIN_COOKIE = 'admin_session'
const ADMIN_TTL_DAYS = 30

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminPassword) {
    return NextResponse.json({ error: 'Admin password not configured' }, { status: 500 })
  }

  if (typeof password !== 'string' || password !== adminPassword) {
    // keep message generic
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

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