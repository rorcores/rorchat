import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { ADMIN_COOKIE } from '../login/route'

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  if (token) {
    await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)])
  }

  const res = NextResponse.json({ success: true })
  res.cookies.delete(ADMIN_COOKIE)
  return res
}
