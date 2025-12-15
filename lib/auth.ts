import crypto from 'crypto'
import { db } from './db'

const SESSION_COOKIE = 'session'
const SESSION_TTL_DAYS = 30

export function generateSessionToken(): string {
  // 32 bytes -> 256 bits
  return crypto.randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS
  }
}

export async function createUserSession(userId: string) {
  const token = generateSessionToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  )

  return { token }
}

export async function getUserFromSessionToken(token: string) {
  const tokenHash = hashToken(token)

  const { rows } = await db.query(
    `SELECT u.id, u.username, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash]
  )

  const user = rows[0] ?? null

  if (user) {
    // best-effort update
    db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]).catch(() => {})
  }

  return user
}

export async function deleteUserSession(token: string) {
  const tokenHash = hashToken(token)
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
}

export { SESSION_COOKIE }
