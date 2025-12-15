import { Pool } from 'pg'

// Server-side only. Do NOT expose this via NEXT_PUBLIC_*
let pool: Pool | null = null

function normalizeConnectionString(raw: string): string {
  // Vercel env vars sometimes get pasted with whitespace or wrapped in quotes.
  const trimmed = raw.trim()
  return trimmed.replace(/^["'](.*)["']$/, '$1')
}

function redactConnectionString(connectionString: string): string {
  // Best-effort redaction: hide password if url is like protocol://user:pass@host/...
  return connectionString.replace(
    /^(postgres(?:ql)?:\/\/[^:/?#\s]+:)([^@]*)(@)/i,
    '$1***$3'
  )
}

function shouldUseSSL(connectionString: string): boolean {
  // Allow explicit disable via env or connection string.
  if ((process.env.PGSSLMODE || '').toLowerCase() === 'disable') return false
  if (/[?&]sslmode=disable\b/i.test(connectionString)) return false
  // Supabase/Vercel production typically requires SSL.
  return process.env.NODE_ENV === 'production'
}

function getPool() {
  if (pool) return pool
  const rawConnectionString = process.env.DATABASE_URL
  if (!rawConnectionString) {
    // Important: don't throw at import-time (Next.js may import during build).
    throw new Error('DATABASE_URL is not set')
  }
  const connectionString = normalizeConnectionString(rawConnectionString)

  // Validate early so we fail with a clear message (pg-connection-string can crash with a vague TypeError).
  try {
    // eslint-disable-next-line no-new
    new URL(connectionString)
  } catch {
    const redacted = redactConnectionString(connectionString)
    console.error('[db] invalid DATABASE_URL', {
      vercelEnv: process.env.VERCEL_ENV,
      nodeEnv: process.env.NODE_ENV,
      hasWhitespace: /\s/.test(connectionString),
      hasAngleBrackets: /[<>]/.test(connectionString),
      hasQuotes: /^["']|["']$/.test(connectionString),
      length: connectionString.length,
      preview: JSON.stringify(redacted)
    })
    throw new Error(
      'DATABASE_URL is invalid. Ensure it is a full URL like postgresql://user:password@host:5432/db?sslmode=require. ' +
        'If your password contains special characters (like @ : / # ?), it must be URL-encoded. ' +
        'Also ensure the value is not wrapped in quotes.'
    )
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
