import { NextRequest, NextResponse } from 'next/server'
import { deleteUserSession, SESSION_COOKIE } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    await deleteUserSession(token)
  }
  const response = NextResponse.json({ success: true })
  response.cookies.delete(SESSION_COOKIE)
  return response
}
