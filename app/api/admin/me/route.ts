import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ADMIN_COOKIE } from '../login/route'

export const runtime = 'nodejs'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (!token) return NextResponse.json({ authenticated: false })

  const tokenHash = hashToken(token)
  const { rows } = await db.query(
    'SELECT id FROM admin_sessions WHERE token_hash = $1 AND expires_at > now() LIMIT 1',
    [tokenHash]
  )

  if (rows.length === 0) {
    const res = NextResponse.json({ authenticated: false })
    res.cookies.delete(ADMIN_COOKIE)
    return res
  }

  // best-effort update
  db.query('UPDATE admin_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]).catch(() => {})

  return NextResponse.json({ authenticated: true })
}
