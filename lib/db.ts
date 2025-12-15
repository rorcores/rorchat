import { Pool } from 'pg'

// Server-side only. Do NOT expose this via NEXT_PUBLIC_*
let pool: Pool | null = null

function getPool() {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // Important: don't throw at import-time (Next.js may import during build).
    throw new Error('DATABASE_URL is not set')
  }
  pool = new Pool({ connectionString })
  return pool
}

export const db = {
  query: (async (...args: any[]) => getPool().query(...(args as Parameters<Pool['query']>))) as Pool['query']
}
