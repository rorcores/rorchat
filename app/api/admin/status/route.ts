import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Check if admin has been active in the last 30 seconds
const ONLINE_THRESHOLD_MS = 30_000

export async function GET() {
  try {
    const { rows } = await db.query(
      `SELECT last_seen_at FROM admin_sessions 
       WHERE expires_at > now() 
       ORDER BY last_seen_at DESC 
       LIMIT 1`
    )

    if (rows.length === 0) {
      return NextResponse.json({ online: false })
    }

    const lastSeen = new Date(rows[0].last_seen_at).getTime()
    const now = Date.now()
    const online = (now - lastSeen) < ONLINE_THRESHOLD_MS

    return NextResponse.json({ online })
  } catch {
    return NextResponse.json({ online: false })
  }
}
