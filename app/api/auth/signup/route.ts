import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const USERNAME_MIN = 3
const USERNAME_MAX = 16
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED = ['admin', 'root', 'system', 'rory', 'rorchat', 'support', 'mod', 'staff', 'api', 'www']

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
  try {
    const { username, password } = await request.json()

    const uErr = validateUsername(username)
    if (uErr) return NextResponse.json({ error: uErr }, { status: 400 })

    const pErr = validatePassword(password)
    if (pErr) return NextResponse.json({ error: pErr }, { status: 400 })

    const cleanUsername = username.trim().toLowerCase()
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Check if username taken
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', cleanUsername)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 409 })
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10)

    const { data: user, error: insertErr } = await supabase
      .from('users')
      .insert({
        username: cleanUsername,
        password_hash: passwordHash,
        display_name: cleanUsername
      })
      .select('id, username, display_name')
      .single()

    if (insertErr || !user) {
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    // Set session cookie
    const response = NextResponse.json({ success: true, user: { id: user.id, username: user.username } })
    response.cookies.set('session', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30 // 30 days
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
