import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get('session')?.value

  if (!sessionId) {
    return NextResponse.json({ user: null })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: user } = await supabase
    .from('users')
    .select('id, username, display_name')
    .eq('id', sessionId)
    .single()

  if (!user) {
    const response = NextResponse.json({ user: null })
    response.cookies.delete('session')
    return response
  }

  return NextResponse.json({ user })
}
