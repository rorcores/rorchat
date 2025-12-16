import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { validateBase64Image, IMAGE_CONFIG } from '@/lib/imageUtils'
import { checkActionRateLimit } from '@/lib/validation'

export const runtime = 'nodejs'

// Username validation (same rules as login)
const USERNAME_MIN = 2
const USERNAME_MAX = 16
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED = ['admin', 'root', 'system', 'rory', 'rorchat', 'support', 'mod', 'staff', 'api', 'www', 'ror', 'r', 'ro', 'rordogs', 'the_real_rory', 'rorr']

// Username change limits
const MAX_USERNAME_CHANGES_PER_DAY = 3

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

    // Rate limit check - stricter for profile picture uploads
    const rateLimitAction = profile_picture !== undefined ? 'profilePicture' : 'profile'
    const rateCheck = checkActionRateLimit(user.id, rateLimitAction)
    if (!rateCheck.allowed) {
      const retryAfterSec = Math.ceil((rateCheck.retryAfterMs || 60000) / 1000)
      return NextResponse.json(
        { error: `Too many profile updates. Please wait ${retryAfterSec} seconds.` },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
      )
    }

    const updates: string[] = []
    const values: (string | null)[] = []
    let paramIndex = 1

    // Track if we're changing the username (for daily limit update)
    let isUsernameChange = false

    // Handle username change
    if (username !== undefined) {
      const cleanUsername = username.trim().toLowerCase()
      
      // Validate username format
      const usernameError = validateUsername(cleanUsername)
      if (usernameError) {
        return NextResponse.json({ error: usernameError }, { status: 400 })
      }

      // Check if this is actually a change (not same username)
      const { rows: currentUser } = await db.query(
        'SELECT username, username_changes_today, username_change_date FROM users WHERE id = $1',
        [user.id]
      )
      
      if (currentUser.length === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const currentUsername = currentUser[0].username
      
      // Only apply limits if actually changing to a different username
      if (cleanUsername !== currentUsername) {
        isUsernameChange = true
        
        // Check daily username change limit
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        const changeDate = currentUser[0].username_change_date
        const changesToday = currentUser[0].username_changes_today || 0
        
        // If last change was today and we've hit the limit, reject
        if (changeDate === today && changesToday >= MAX_USERNAME_CHANGES_PER_DAY) {
          return NextResponse.json(
            { error: `You can only change your username ${MAX_USERNAME_CHANGES_PER_DAY} times per day. Try again tomorrow.` },
            { status: 429 }
          )
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

    // If changing username, update the daily counter
    if (isUsernameChange) {
      const today = new Date().toISOString().split('T')[0]
      
      // Fetch current state again to handle race conditions
      const { rows: currentState } = await db.query(
        'SELECT username_change_date, username_changes_today FROM users WHERE id = $1',
        [user.id]
      )
      
      const changeDate = currentState[0]?.username_change_date
      const changesToday = currentState[0]?.username_changes_today || 0
      
      if (changeDate === today) {
        // Same day - increment counter
        updates.push(`username_changes_today = $${paramIndex}`)
        values.push(String(changesToday + 1))
        paramIndex++
      } else {
        // New day - reset counter to 1
        updates.push(`username_changes_today = $${paramIndex}`)
        values.push('1')
        paramIndex++
        updates.push(`username_change_date = $${paramIndex}`)
        values.push(today)
        paramIndex++
      }
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
