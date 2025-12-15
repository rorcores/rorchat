import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

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
