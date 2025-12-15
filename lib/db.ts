import { Pool } from 'pg'

// Server-side only. Do NOT expose this via NEXT_PUBLIC_*
let pool: Pool | null = null

function shouldUseSSL(connectionString: string): boolean {
  // Allow explicit disable via env or connection string.
  if ((process.env.PGSSLMODE || '').toLowerCase() === 'disable') return false
  if (/[?&]sslmode=disable\b/i.test(connectionString)) return false
  // Supabase/Vercel production typically requires SSL.
  return process.env.NODE_ENV === 'production'
}

function getPool() {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // Important: don't throw at import-time (Next.js may import during build).
    throw new Error('DATABASE_URL is not set')
  }
  const ssl = shouldUseSSL(connectionString) ? { rejectUnauthorized: false } : undefined

  pool = new Pool({
    connectionString,
    ssl,
    // Keep small for serverless; prefer Supabase pooler in prod.
    max: Number(process.env.PGPOOL_MAX ?? '') || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  })

  pool.on('error', (err) => {
    // Avoid crashing the process on unexpected PG client errors.
    console.error('[db] unexpected pool error', err)
  })

  return pool
}

export const db = {
  query: (async (...args: any[]) => getPool().query(...(args as Parameters<Pool['query']>))) as Pool['query']
}
