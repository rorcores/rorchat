import { NextRequest } from 'next/server'
import { POST as login } from '../login/route'

export async function POST(request: NextRequest) {
  // Backwards-compat: old admin UI posts to /api/admin/verify
  return login(request)
}

