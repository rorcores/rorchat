import { NextRequest, NextResponse } from 'next/server'
import { getUserFromSessionToken, SESSION_COOKIE } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    return NextResponse.json({ user: null })
  }

  const user = await getUserFromSessionToken(token)

  if (!user) {
    const response = NextResponse.json({ user: null })
    response.cookies.delete(SESSION_COOKIE)
    return response
  }

  return NextResponse.json({ user })
}
