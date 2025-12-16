import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { validateBase64Image, IMAGE_CONFIG } from '@/lib/imageUtils'

export const runtime = 'nodejs'

// Username validation (same rules as login)
const USERNAME_MIN = 2
const USERNAME_MAX = 16
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED = ['admin', 'root', 'system', 'rory', 'rorchat', 'support', 'mod', 'staff', 'api', 'www', 'ror', 'r', 'ro', 'rordogs', 'the_real_rory', 'rorr']

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

// GET - Fetch current user profile
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch full profile including profile picture
  const { rows } = await db.query(
    'SELECT id, username, display_name, profile_picture_url, created_at FROM users WHERE id = $1',
    [user.id]
  )

  if (rows.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({ user: rows[0] })
}

// PATCH - Update profile (username, display_name, profile_picture)
export async function PATCH(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserFromSessionToken(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { username, display_name, profile_picture } = body

    const updates: string[] = []
    const values: (string | null)[] = []
    let paramIndex = 1

    // Handle username change
    if (username !== undefined) {
      const cleanUsername = username.trim().toLowerCase()
      
      // Validate username format
      const usernameError = validateUsername(cleanUsername)
      if (usernameError) {
        return NextResponse.json({ error: usernameError }, { status: 400 })
      }

      // Check if username is already taken (by someone else)
      const { rows: existingRows } = await db.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [cleanUsername, user.id]
      )
      
      if (existingRows.length > 0) {
        return NextResponse.json({ error: 'Username is already taken' }, { status: 409 })
      }

      updates.push(`username = $${paramIndex}`)
      values.push(cleanUsername)
      paramIndex++
    }

    // Handle display name change
    if (display_name !== undefined) {
      const cleanDisplayName = display_name.trim()
      
      if (cleanDisplayName.length > 32) {
        return NextResponse.json({ error: 'Display name must be 32 characters or less' }, { status: 400 })
      }

      updates.push(`display_name = $${paramIndex}`)
      values.push(cleanDisplayName || null)
      paramIndex++
    }

    // Handle profile picture change
    if (profile_picture !== undefined) {
      if (profile_picture === null) {
        // Allow removing profile picture
        updates.push(`profile_picture_url = $${paramIndex}`)
        values.push(null)
        paramIndex++
      } else if (typeof profile_picture === 'string') {
        // Validate the image
        const validation = validateBase64Image(profile_picture, 'profile')
        if (!validation.valid) {
          return NextResponse.json({ error: validation.error }, { status: 400 })
        }

        updates.push(`profile_picture_url = $${paramIndex}`)
        values.push(profile_picture)
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Execute update
    values.push(user.id)
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} 
       RETURNING id, username, display_name, profile_picture_url`,
      values
    )

    return NextResponse.json({ 
      success: true,
      user: rows[0]
    })
  } catch (err) {
    console.error('[api/auth/profile] error', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
